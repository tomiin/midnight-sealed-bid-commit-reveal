// src/checkpoint.ts — persist wallet sync progress to disk so the long DUST
// cold-sync survives restarts. The dust + unshielded wallets expose
// serializeState()/restore(); the shielded wallet does not (and we never block
// on it), so we only checkpoint those two.
import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join } from 'path';

const CHECKPOINT_PATH = join(process.cwd(), 'wallet-checkpoint.json');

export type Checkpoint = { dust: string; unshielded: string; savedAt: number; dustIndex?: number };

export function loadCheckpoint(): Checkpoint | null {
  if (!existsSync(CHECKPOINT_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

// Write atomically (tmp + rename) so a crash mid-write can't corrupt the file.
export async function saveCheckpoint(facade: any, dustIndex?: number): Promise<void> {
  const dust = await facade.dust.serializeState();
  const unshielded = await facade.unshielded.serializeState();
  const payload: Checkpoint = { dust, unshielded, savedAt: Date.now(), dustIndex };
  const tmp = CHECKPOINT_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(payload));
  renameSync(tmp, CHECKPOINT_PATH);
}

export function checkpointPath(): string {
  return CHECKPOINT_PATH;
}
