import type { ForgeSnapshot } from '../../engine/forge-protocol';

export const CHECK_LABELS = {
  schema: 'Schema', telegraphs: 'Telegraphs', aimedSpeed: 'Aimed speed', bulletCap: 'Bullet cap',
  safeSpace: 'Safe space', ttk: 'Time to kill', beatable: 'Beatable', interesting: 'Challenge',
  exceptions: 'No exceptions', tickBudget: 'Tick budget', scriptSupport: 'Script safety',
} as const;

/** Only server-origin checks can produce a pass/fail badge. Cached work stays labeled. */
export function forgeProgress(snapshot: ForgeSnapshot) {
  const job = snapshot.jobs.find((entry) => ['building', 'verifying'].includes(entry.status))
    ?? [...snapshot.jobs].reverse().find((entry) => entry.attempt > 0);
  if (!job) return null;
  const events = snapshot.events.filter((event) => event.jobId === job.id);
  const checked = [...events].reverse().find((event) => event.mode === 'server' && event.progress?.checks);
  const files = [...new Set(events.flatMap((event) => event.progress?.files ?? []))];
  return {
    activity: `${job.mode === 'replay' ? 'CACHED REPLAY · NO LIVE CODEX' : 'LIVE CODEX'} · ATTEMPT ${job.attempt}/3 · ${job.status.toUpperCase()} · @${job.creator}`,
    files: files.length ? `Files updated: ${files.join(' · ')}` : 'Waiting for reported file edits.',
    checks: checked?.progress?.checks ?? [],
    gateLabel: checked ? `INDEPENDENT SERVER GATE · ATTEMPT ${checked.progress!.attempt}/3` : 'INDEPENDENT SERVER GATE · WAITING FOR RESULTS',
  };
}
