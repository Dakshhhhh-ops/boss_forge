import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { z } from 'zod';
import { FightSchema, ForgeJobSchema, QueuedBossSchema } from '../../engine/forge-protocol';
import { readLocalFile } from '../scripts/load';

export const ForgeCheckpointSchema = z.strictObject({
  jobs: z.array(ForgeJobSchema).max(50), queue: z.array(QueuedBossSchema).max(5),
  activeFight: FightSchema.nullable(), round: z.number().int().min(0), completedFights: z.array(z.string().max(64)).max(50),
});
export type ForgeCheckpoint = z.infer<typeof ForgeCheckpointSchema>;
export const RedemptionRecordSchema = z.strictObject({
  id: z.string().min(1).max(128), rewardId: z.string().min(1).max(128), creator: z.string().max(25),
  jobId: z.string().max(64).nullable(), target: z.enum(['CANCELED', 'FULFILLED']).nullable(), done: z.boolean(),
});
export type RedemptionRecord = z.infer<typeof RedemptionRecordSchema>;
const RecoveryFileSchema = z.strictObject({
  version: z.literal(1), scope: z.string().min(1).max(256), forge: ForgeCheckpointSchema.nullable(),
  redemptions: z.array(RedemptionRecordSchema).max(5000),
});
export interface RedemptionPersistence {
  loadRedemptions(): RedemptionRecord[];
  saveRedemptions(records: RedemptionRecord[]): Promise<void>;
}

/** One server-owned checkpoint: atomic replacement after syncing data, serialized across both writers. */
export class RecoveryStore implements RedemptionPersistence {
  private data: z.infer<typeof RecoveryFileSchema>;
  private loaded = false;
  private writing = Promise.resolve();
  constructor(private readonly file: string, private readonly scope: string) {
    this.data = { version: 1, scope, forge: null, redemptions: [] };
  }
  async load() {
    try {
      const data = RecoveryFileSchema.parse(JSON.parse(await readLocalFile(dirname(this.file), basename(this.file), 8 * 1024 * 1024)));
      if (data.scope !== this.scope) throw new Error('Recovery owner mismatch.');
      this.data = data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Recovery checkpoint is invalid or belongs to another channel. Preserve it for operator review.', { cause: error });
    }
    this.loaded = true;
  }
  forge() { return structuredClone(this.data.forge); }
  loadRedemptions() { return structuredClone(this.data.redemptions); }
  saveForge(state: ForgeCheckpoint) { this.data.forge = ForgeCheckpointSchema.parse(state); return this.save(); }
  saveRedemptions(records: RedemptionRecord[]) { this.data.redemptions = z.array(RedemptionRecordSchema).max(5000).parse(records); return this.save(); }
  private save() {
    if (!this.loaded) return Promise.reject(new Error('Load recovery state before writing.'));
    const payload = `${JSON.stringify(this.data)}\n`;
    const task = this.writing.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(payload, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, this.file);
        if (process.platform !== 'win32') {
          const directory = await open(dirname(this.file), 'r');
          try { await directory.sync(); } finally { await directory.close(); }
        }
      } finally { await unlink(temporary).catch(() => {}); }
    });
    this.writing = task;
    void task.catch(() => {}); // Keep failures observable through the returned task and flush().
    return task;
  }
  async flush() { await this.writing; }
}
