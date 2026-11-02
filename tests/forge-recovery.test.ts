import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ForgeSnapshotSchema } from '../engine/forge-protocol';
import type { BossSpec } from '../engine/boss-api';
import { buildRuntime, verifySavedSpec } from '../server/forge/artifacts';
import { RecoveryStore, type RedemptionPersistence } from '../server/forge/recovery';
import { Redemptions } from '../server/twitch/redemptions';
import type { RewardsApi } from '../server/twitch/rewards';
import { specHash } from '../server/gate/runner';
import { harness, replay } from './forge-helpers';

let root: string, count = 0;
const event = { id: 'redemption-1', broadcaster_user_id: '1', user_login: 'paid_viewer', user_input: 'A slow original fire boss.', status: 'unfulfilled', reward: { id: 'reward-1' } };
const rewards = () => ({ id: 'reward-1', settle: vi.fn<(id: string, status: 'CANCELED' | 'FULFILLED') => Promise<void>>(async () => {}), unfulfilled: vi.fn(async (): Promise<string[]> => []) });
const reverify = async (spec: BossSpec) => {
  const report = structuredClone(replay.report); report.specHash = specHash(spec); report.bossName = spec.meta.name;
  return { spec, report };
};
async function store() {
  const file = join(root, `state-${++count}.json`), state = new RecoveryStore(file, 'test-channel');
  await state.load(); return { file, state };
}
function forge(state: RecoveryStore, options = { autoApprove: true }) {
  return harness({ checkpoint: (value) => state.saveForge(value), reverify }, { cooldownMs: 0, ...options }).coordinator;
}
function tracker(coordinator: ReturnType<typeof forge>, api: ReturnType<typeof rewards>, persistence: RedemptionPersistence) {
  return new Redemptions(coordinator, api as unknown as RewardsApi, '1', async () => {}, persistence);
}
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'bf-recovery-')); await buildRuntime(root); }, 30000);
afterAll(async () => {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('bf-recovery-')) throw new Error('Unsafe recovery test cleanup.');
  await rm(root, { recursive: true, force: true });
});

describe('durable forge and redemption recovery', () => {
  it('saves the actual spec and redemption intent before fulfilling, then gates it afresh on restart', async () => {
    const { file, state } = await store(), coordinator = forge(state), api = rewards();
    api.settle.mockImplementation(async (_id, status) => {
      expect(status).toBe('FULFILLED');
      const disk = new RecoveryStore(file, 'test-channel'); await disk.load();
      expect(disk.forge()?.queue).toHaveLength(1);
      expect(disk.loadRedemptions()[0]).toMatchObject({ jobId: disk.forge()!.queue[0]!.jobId, target: 'FULFILLED', done: false });
    });
    const redemptions = tracker(coordinator, api, state);
    await redemptions.accept(event); await coordinator.idle();
    redemptions.observe(coordinator.snapshot().jobs); await redemptions.flush();
    expect(api.settle).toHaveBeenCalledExactlyOnceWith(event.id, 'FULFILLED');
    const saved = state.forge()!, spec = saved.queue[0]!.spec;
    saved.queue[0]!.gate.passed = false; saved.queue[0]!.gate.summary = 'Untrusted cached report';
    await state.saveForge(saved);
    // A new process reads disk; no in-memory queue or cached gate report is reused.
    const disk = new RecoveryStore(file, 'test-channel'); await disk.load();
    const fresh = vi.fn((input: BossSpec) => verifySavedSpec(input, root));
    const restarted = harness({ checkpoint: (value) => disk.saveForge(value), reverify: fresh }).coordinator;
    await restarted.restore(disk.forge());
    expect(fresh).toHaveBeenCalledExactlyOnceWith(spec);
    expect(restarted.snapshot().queue[0]).toMatchObject({ spec, gate: { passed: true } });
    expect(restarted.snapshot().queue[0]?.gate.summary).not.toBe('Untrusted cached report');
    const api2 = rewards(); await tracker(restarted, api2, disk).recover();
    expect(api2.settle).not.toHaveBeenCalled();
    expect(ForgeSnapshotSchema.safeParse(restarted.snapshot()).success).toBe(true);
    await coordinator.close(); await restarted.close();
  });

  it('restores an interrupted fight separately from a full queue and retries the same seed', async () => {
    const { file, state } = await store(), coordinator = forge(state);
    for (let i = 0; i < 5; i++) await coordinator.submit({ creator: `viewer_${i}`, text: event.user_input });
    await coordinator.idle(); const active = coordinator.claimNext(); await coordinator.idle();
    await coordinator.submitRematch({ fightId: 'earlier-win', previous: replay.spec, generation: 2, stats: null }); await coordinator.idle();
    expect(coordinator.snapshot().queue).toHaveLength(5);
    const disk = new RecoveryStore(file, 'test-channel'); await disk.load();
    const restarted = forge(disk); await restarted.restore(disk.forge());
    expect(restarted.snapshot().activeFight).toMatchObject({ id: active.id, resumable: true });
    expect(restarted.snapshot().queue).toHaveLength(5);
    const retried = restarted.claimNext(); await restarted.durable();
    expect(retried).toMatchObject({ id: active.id, seed: active.seed, boss: active.boss, resumable: false });
    expect(() => restarted.claimNext()).toThrow('already active');
    await restarted.finishFight(retried.id, 'won');
    const completed = new RecoveryStore(file, 'test-channel'); await completed.load();
    const third = forge(completed); await third.restore(completed.forge());
    await third.finishFight(retried.id, 'won'); // Duplicate delivery after restart is harmless.
    expect(third.snapshot().activeFight).toBeNull(); expect(third.snapshot().queue).toHaveLength(5);
    await coordinator.close(); await restarted.close(); await third.close();
  });

  it('retains a checkpoint and blocks startup if its actual saved boss fails the new gate', async () => {
    const { file, state } = await store(), coordinator = forge(state);
    await coordinator.submit({ creator: 'viewer', text: event.user_input }); await coordinator.idle();
    const saved = state.forge()!; saved.queue[0]!.spec.hp = 1;
    saved.queue[0]!.gate.specHash = specHash(saved.queue[0]!.spec); // Even a matching fabricated cache cannot certify it.
    await state.saveForge(saved); const before = await readFile(file, 'utf8');
    const restarted = harness({ checkpoint: (value) => state.saveForge(value), reverify: (spec) => verifySavedSpec(spec, root) }).coordinator;
    await expect(restarted.restore(state.forge())).rejects.toThrow('fresh server verification');
    expect(restarted.snapshot().queue).toEqual([]); expect(await readFile(file, 'utf8')).toBe(before);
    await coordinator.close(); await restarted.close();
  });

  it('retries an uncertain fulfillment after a crash without generating a second boss', async () => {
    const { file, state } = await store(), coordinator = forge(state), api = rewards();
    const uncertain: RedemptionPersistence = {
      loadRedemptions: () => state.loadRedemptions(),
      saveRedemptions: async (records) => { if (records.some((entry) => entry.done)) throw new Error('Disk unavailable after Twitch confirmed.'); await state.saveRedemptions(records); },
    };
    const redemptions = tracker(coordinator, api, uncertain);
    await redemptions.accept(event); await coordinator.idle(); redemptions.observe(coordinator.snapshot().jobs); await redemptions.flush();
    expect(api.settle).toHaveBeenCalledExactlyOnceWith(event.id, 'FULFILLED');
    const disk = new RecoveryStore(file, 'test-channel'); await disk.load();
    expect(disk.loadRedemptions()[0]).toMatchObject({ target: 'FULFILLED', done: false });
    const restarted = forge(disk); await restarted.restore(disk.forge());
    const api2 = rewards(), retry = tracker(restarted, api2, disk); await retry.recover(); await retry.recover(); await retry.accept(event);
    expect(api2.settle).toHaveBeenCalledExactlyOnceWith(event.id, 'FULFILLED');
    expect(restarted.snapshot().jobs).toHaveLength(1); expect(restarted.snapshot().queue).toHaveLength(1);
    expect(disk.loadRedemptions()[0]?.done).toBe(true);
    await coordinator.close(); await restarted.close();
  });

  it('refunds interrupted builds and orphan deliveries while preserving pending local approval', async () => {
    const { file, state } = await store(), coordinator = forge(state, { autoApprove: false }), api = rewards();
    const redemptions = tracker(coordinator, api, state);
    await redemptions.accept(event);
    const saved = state.forge()!; saved.jobs[0]!.status = 'building'; saved.jobs[0]!.attempt = 1;
    const pending = structuredClone(saved.jobs[0]!); pending.id = 'pending-request'; pending.status = 'pending'; saved.jobs.push(pending);
    await state.saveForge(saved);
    const disk = new RecoveryStore(file, 'test-channel'); await disk.load();
    const restarted = forge(disk); await restarted.restore(disk.forge());
    const api2 = rewards(); api2.unfulfilled.mockResolvedValue([event.id, 'missed-delivery']);
    await tracker(restarted, api2, disk).recover();
    expect(api2.settle).toHaveBeenCalledWith(event.id, 'CANCELED'); expect(api2.settle).toHaveBeenCalledWith('missed-delivery', 'CANCELED');
    expect(restarted.snapshot().jobs.find((job) => job.id === 'pending-request')?.status).toBe('pending');
    expect(restarted.snapshot().queue).toHaveLength(0);
    await coordinator.close(); await restarted.close();
  });

  it('keeps an uncommitted boss invisible and unclaimable until the queue write completes', async () => {
    const { state } = await store(); let release!: () => void, entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; }), ready = new Promise<void>((resolve) => { entered = resolve; });
    const coordinator = harness({ checkpoint: async (value) => { if (value.queue.length) { entered(); await held; } await state.saveForge(value); } }, { autoApprove: true }).coordinator;
    const api = rewards(), redemptions = tracker(coordinator, api, state);
    await redemptions.accept(event); await ready;
    expect(coordinator.snapshot().queue).toHaveLength(0); expect(coordinator.snapshot().jobs[0]?.status).toBe('verifying');
    expect(() => coordinator.claimNext()).toThrow('being saved');
    redemptions.observe(coordinator.snapshot().jobs); await redemptions.flush(); expect(api.settle).not.toHaveBeenCalled();
    release(); await coordinator.idle(); redemptions.observe(coordinator.snapshot().jobs); await redemptions.flush();
    expect(api.settle).toHaveBeenCalledWith(event.id, 'FULFILLED'); await coordinator.close();
  });

  it('never fulfills when the verified queue cannot be saved', async () => {
    const { state } = await store();
    const coordinator = harness({ checkpoint: async (value) => { if (value.queue.length) throw new Error('Injected storage failure.'); await state.saveForge(value); } }, { autoApprove: true }).coordinator;
    const api = rewards(), redemptions = tracker(coordinator, api, state);
    await redemptions.accept(event); await coordinator.idle(); redemptions.observe(coordinator.snapshot().jobs); await redemptions.flush();
    expect(coordinator.snapshot().queue).toEqual([]); expect(api.settle).toHaveBeenCalledExactlyOnceWith(event.id, 'CANCELED');
    expect(state.forge()?.queue).toEqual([]); await coordinator.close();
  });

  it('does not admit a paid job when its redemption linkage cannot be saved', async () => {
    const { state } = await store(), coordinator = forge(state), api = rewards(); let failed = false;
    const persistence: RedemptionPersistence = {
      loadRedemptions: () => [],
      saveRedemptions: async (records) => {
        if (!failed && records.some((record) => record.jobId && !record.target)) { failed = true; throw new Error('Link write failed.'); }
        await state.saveRedemptions(records);
      },
    };
    await tracker(coordinator, api, persistence).accept(event); await coordinator.idle();
    expect(coordinator.snapshot().jobs).toEqual([]); expect(coordinator.snapshot().queue).toEqual([]);
    expect(api.settle).toHaveBeenCalledExactlyOnceWith(event.id, 'CANCELED'); await coordinator.close();
  });

  it('does not send fulfillment until its outbox intent is durable, and recovers later', async () => {
    const { file, state } = await store(), coordinator = forge(state), api = rewards();
    const persistence: RedemptionPersistence = {
      loadRedemptions: () => [],
      saveRedemptions: async (records) => {
        if (records.some((record) => record.target === 'FULFILLED')) throw new Error('Outbox write failed.');
        await state.saveRedemptions(records);
      },
    };
    const redemptions = tracker(coordinator, api, persistence);
    await redemptions.accept(event); await coordinator.idle(); redemptions.observe(coordinator.snapshot().jobs); await redemptions.flush();
    expect(api.settle).not.toHaveBeenCalled(); expect(coordinator.snapshot().queue).toHaveLength(1);
    const disk = new RecoveryStore(file, 'test-channel'); await disk.load(); const restarted = forge(disk); await restarted.restore(disk.forge());
    const api2 = rewards(); await tracker(restarted, api2, disk).recover();
    expect(api2.settle).toHaveBeenCalledExactlyOnceWith(event.id, 'FULFILLED');
    await coordinator.close(); await restarted.close();
  });

  it('refuses corrupt or cross-channel checkpoints without overwriting them', async () => {
    const { file, state } = await store(); await state.saveRedemptions([]);
    await expect(new RecoveryStore(file, 'different-channel').load()).rejects.toThrow('another channel');
    await writeFile(file, '{broken');
    await expect(new RecoveryStore(file, 'test-channel').load()).rejects.toThrow('invalid');
    expect(await readFile(file, 'utf8')).toBe('{broken');
  });
});
