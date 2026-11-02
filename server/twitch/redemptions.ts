import { z } from 'zod';
import type { ForgeJob } from '../../engine/forge-protocol';
import type { ForgeCoordinator } from '../forge/coordinator';
import type { RewardsApi } from './rewards';
import type { RedemptionPersistence, RedemptionRecord } from '../forge/recovery';

export const RedemptionEvent = z.object({ id: z.string().min(1).max(128), broadcaster_user_id: z.string(), user_login: z.string().regex(/^[a-z0-9_]{1,25}$/),
  user_input: z.string().max(10000), status: z.string(), reward: z.object({ id: z.string() }) });
export class Redemptions {
  private readonly records = new Map<string, RedemptionRecord>();
  private flushing: Promise<void> | null = null;
  constructor(private readonly coordinator: ForgeCoordinator, private readonly rewards: RewardsApi,
    private readonly broadcasterId: string, private readonly say: (message: string) => Promise<void>, private readonly persistence?: RedemptionPersistence) {
    for (const record of persistence?.loadRedemptions() ?? []) this.records.set(record.id, record);
  }
  private persist() { return this.persistence?.saveRedemptions([...this.records.values()]) ?? Promise.resolve(); }
  async accept(input: unknown) {
    const parsed = RedemptionEvent.safeParse(input);
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.broadcaster_user_id !== this.broadcasterId || event.reward.id !== this.rewards.id || event.status !== 'unfulfilled' || this.records.has(event.id)) return;
    this.trim();
    if (this.records.size >= 5000) throw new Error('Too many unresolved redemptions.');
    const record: RedemptionRecord = { id: event.id, rewardId: event.reward.id, creator: event.user_login, jobId: null, target: null, done: false };
    this.records.set(event.id, record);
    await this.persist();
    try {
      if (this.records.size > 5000) throw new Error('Too many unresolved redemptions.');
      const job = await this.coordinator.submit({ creator: event.user_login, text: event.user_input }, 'twitch', async (id) => { record.jobId = id; await this.persist(); });
      record.jobId = job.id;
    } catch { record.target = 'CANCELED'; }
    await this.persist();
    if (record.jobId) await this.say(`@${event.user_login} request ${record.jobId} received; waiting for approval or the forge.`).catch(() => {});
    this.observe(this.coordinator.snapshot().jobs);
    await this.flush();
  }
  observe(jobs: ForgeJob[]) {
    let changed = false;
    for (const record of this.records.values()) {
      if (record.done || record.target || !record.jobId) continue;
      const job = jobs.find((entry) => entry.id === record.jobId);
      if (job?.status === 'queued' || job?.status === 'finished') record.target = 'FULFILLED';
      else if (job?.status === 'failed' || job?.status === 'rejected') record.target = 'CANCELED';
      if (record.target) changed = true;
    }
    return changed;
  }
  /** Restore links and retry the saved settlement intent; refund only requests without a recoverable job. */
  async recover() {
    if ([...this.records.values()].some((record) => !record.done && record.rewardId !== this.rewards.id)) throw new Error('Unresolved redemptions belong to another reward.');
    this.observe(this.coordinator.snapshot().jobs);
    const jobs = this.coordinator.snapshot().jobs;
    for (const record of this.records.values()) {
      if (!record.done && !record.target && (!record.jobId || !jobs.some((job) => job.id === record.jobId))) record.target = 'CANCELED';
    }
    for (const id of await this.rewards.unfulfilled()) {
      if (!this.records.has(id)) this.records.set(id, { id, rewardId: this.rewards.id!, jobId: null, creator: '', target: 'CANCELED', done: false });
    }
    await this.flush(); this.trim();
    if ([...this.records.values()].some((record) => record.target && !record.done)) throw new Error('Outstanding redemption updates need attention.');
  }
  flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      for (const record of this.records.values()) {
        if (!record.target || record.done || record.rewardId !== this.rewards.id) continue;
        try {
          // A fulfillment intent cannot leave the process before its actual boss is durably saved.
          if (record.target === 'FULFILLED') await this.coordinator.durable();
          await this.persist();
          await this.rewards.settle(record.id, record.target); record.done = true;
          try { await this.persist(); } catch (error) { record.done = false; throw error; }
          if (record.target === 'CANCELED') {
            this.coordinator.notify(`${record.creator ? `@${record.creator}: ` : ''}Request canceled. Channel Points refunded.`, 'info', 'twitch');
            await this.say(`${record.creator ? `@${record.creator} ` : ''}That boss could not be queued. Your Channel Points were refunded; try a different idea.`).catch(() => {});
          }
        } catch {
          this.coordinator.notify('A Channel Points update is pending. Retrying; moderators can inspect the Twitch reward queue.', 'warning', 'twitch');
          break;
        }
      }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  private trim() {
    for (const [id, record] of this.records) { if (this.records.size <= 4000) break; if (record.done) this.records.delete(id); }
  }
  async cancelPending() {
    for (const record of this.records.values()) if (!record.done && record.target !== 'FULFILLED') record.target = 'CANCELED';
    await this.flush();
  }
}
