import { describe, expect, it } from 'vitest';
import { ForgeEventSchema, ForgeSnapshotSchema, type ForgeSnapshot } from '../engine/forge-protocol';
import { forgeProgress } from '../web/overlay/progress';
import { harness } from './forge-helpers';

async function snapshot(mode: 'codex' | 'replay' = 'codex'): Promise<ForgeSnapshot> {
  const { coordinator } = harness({}, { mode });
  await coordinator.submit({ creator: 'progress_viewer', text: 'A slow original fire boss.' });
  await coordinator.close();
  const state = coordinator.snapshot();
  state.jobs[0]!.attempt = 2; state.jobs[0]!.status = 'building';
  const event = { seq: 10, at: 0, jobId: state.jobs[0]!.id, phase: 'writing' as const, message: 'Reported edit.' };
  state.events.push({ ...event, mode, progress: { attempt: 1, files: ['boss.json'] } });
  state.events.push({ ...event, seq: 11, mode: 'server', phase: 'verifying', progress: { attempt: 1, checks: [{ id: 'safeSpace', passed: false }] } });
  // Even typed agent claims cannot overwrite an authoritative gate result.
  state.events.push({ ...event, seq: 12, mode, progress: { attempt: 2, checks: [{ id: 'safeSpace', passed: true }] } });
  return state;
}

describe('public forge activity', () => {
  it('shows attempts, file edits and failed checks with their actual attempt during revision', async () => {
    const state = await snapshot();
    expect(ForgeSnapshotSchema.safeParse(state).success).toBe(true);
    const progress = forgeProgress(state)!;
    expect(progress.activity).toContain('LIVE CODEX · ATTEMPT 2/3');
    expect(progress.files).toContain('boss.json');
    expect(progress.gateLabel).toContain('ATTEMPT 1/3');
    expect(progress.checks).toEqual([{ id: 'safeSpace', passed: false }]);
    state.events.push({ ...state.events.at(-1)!, mode: 'server', phase: 'verifying', progress: { attempt: 2, checks: [{ id: 'safeSpace', passed: true }] } });
    expect(forgeProgress(state)?.checks).toEqual([{ id: 'safeSpace', passed: true }]);
  });

  it('keeps cached activity explicitly labeled and accepts old snapshots without progress', async () => {
    const state = await snapshot('replay');
    expect(forgeProgress(state)?.activity).toContain('CACHED REPLAY · NO LIVE CODEX');
    for (const event of state.events) delete event.progress;
    expect(ForgeSnapshotSchema.safeParse(state).success).toBe(true);
    expect(forgeProgress(state)?.checks).toEqual([]);
  });

  it('rejects arbitrary filenames, check names and out-of-range attempts at the wire boundary', async () => {
    const state = await snapshot(), event = state.events.at(-1)!;
    for (const progress of [{ attempt: 4 }, { attempt: 1, files: ['.env'] }, { attempt: 1, checks: [{ id: 'agentSaysPassed', passed: true }] }]) {
      expect(ForgeEventSchema.safeParse({ ...event, progress }).success).toBe(false);
    }
  });
});
