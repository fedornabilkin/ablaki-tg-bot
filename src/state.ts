import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { requestIdSchema } from './site-api.js';

const receiptSchema = z.object({
  requestId: requestIdSchema,
  userId: z.string().regex(/^[1-9]\d{0,15}$/),
  messageId: z.number().int().positive(),
  purpose: z.enum(['login', 'link']),
  expiresAt: z.number().int().positive(),
  startUpdateId: z.number().int().nonnegative(),
});
const stateSchema = z.object({
  version: z.literal(1), botId: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  receipts: z.record(z.string(), receiptSchema),
});
export type Receipt = z.infer<typeof receiptSchema>;
type State = z.infer<typeof stateSchema>;

// One sequential worker owns this file. Docker uses flock on the same persistent volume.
export class StateStore {
  private constructor(private readonly dir: string, private readonly state: State) {}

  static async load(dir: string, botId: number): Promise<StateStore> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    let state: State;
    try {
      state = stateSchema.parse(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')));
      if (state.botId !== botId) throw new Error('Wrong bot');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Invalid persisted bot state; restore the volume or use a separate volume for a different bot.');
      state = { version: 1, botId, offset: 0, receipts: {} };
    }
    return new StateStore(dir, state);
  }

  get offset() { return this.state.offset; }
  receipt(id: string) { return this.state.receipts[id]; }
  async remember(receipt: Receipt) {
    this.state.receipts[receipt.requestId] = receipt;
    await this.save();
  }
  async acknowledge(updateId: number) {
    this.state.offset = updateId + 1;
    await this.save();
  }
  private async save() {
    const cutoff = Math.floor(Date.now() / 1000) - 120;
    for (const [id, receipt] of Object.entries(this.state.receipts)) {
      if (receipt.expiresAt < cutoff) delete this.state.receipts[id];
    }
    const temporary = join(this.dir, 'state.json.tmp');
    const handle = await open(temporary, 'w', 0o600);
    try { await handle.writeFile(JSON.stringify(this.state), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, join(this.dir, 'state.json'));
    // fsync the containing directory makes rename durable on Linux.
    if (process.platform !== 'win32') {
      const directory = await open(this.dir, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  }
}
