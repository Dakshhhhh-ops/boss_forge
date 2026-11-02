import { GATE_POLICY } from '../../engine/fairness-policy';
import type { QueuedBoss } from '../../engine/forge-protocol';
import { specHash } from '../gate/runner';
import { gateSummary } from './coordinator';
import { ForgeCheckpointSchema, type ForgeCheckpoint } from './recovery';
import type { ForgeServices } from './types';

/** Saved reports never certify a restored boss. Recheck every actual spec with the current server gate. */
export async function restoreForge(input: ForgeCheckpoint, verify: NonNullable<ForgeServices['reverify']>) {
  const state = ForgeCheckpointSchema.parse(input);
  const queuedIds = new Set<string>();
  async function recheck(boss: QueuedBoss) {
    const job = state.jobs.find((entry) => entry.id === boss.jobId);
    if (boss.mode !== 'house' && (!job || job.creator !== boss.spec.meta.creator || job.text !== boss.spec.meta.sourceQuote || boss.id !== job.id)) throw new Error('Saved boss request identity mismatch.');
    if (queuedIds.has(boss.id)) throw new Error('Duplicate boss in recovery checkpoint.');
    queuedIds.add(boss.id);
    const result = await verify(boss.spec), report = result.report;
    if (!result.spec || !report.passed || report.policyVersion !== GATE_POLICY.version || !report.checks.length || !report.checks.every((check) => check.passed)
      || specHash(result.spec) !== specHash(boss.spec) || report.specHash !== boss.gate.specHash || report.specHash !== specHash(boss.spec)) {
      throw new Error('Saved boss failed fresh server verification. Checkpoint retained for operator review.');
    }
    return { ...boss, spec: result.spec, gate: gateSummary(report) };
  }
  // Finish every check before changing the live coordinator or overwriting the checkpoint.
  if (state.activeFight) state.activeFight = { ...state.activeFight, boss: await recheck(state.activeFight.boss), resumable: true };
  const queue: QueuedBoss[] = [];
  for (const boss of state.queue) queue.push(await recheck(boss));
  state.queue = queue;
  for (const job of state.jobs) {
    if (queuedIds.has(job.id)) {
      const boss = state.queue.find((entry) => entry.jobId === job.id) ?? state.activeFight?.boss;
      job.status = 'queued'; job.gate = boss!.gate; job.message = 'Restored after fresh server verification.';
    } else if (['waiting', 'building', 'verifying', 'queued'].includes(job.status)) {
      job.status = 'failed'; job.message = 'Interrupted before a verified boss was durably queued. Any unfulfilled redemption will be refunded.';
    }
  }
  return state;
}
