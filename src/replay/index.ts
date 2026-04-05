export type { TapeEntry, ReplayTape, TapeStats, ReplayFrame } from './types.js';
export { TapeRecorder } from './tape-recorder.js';
export { TapePlayer } from './tape-player.js';

import type { Session } from '../core/types.js';
import type { ReplayTape } from './types.js';
import { TapeRecorder } from './tape-recorder.js';

/**
 * Create a TapeRecorder from an existing Session.
 * Reconstructs the tape by replaying operations from the session.
 */
export function sessionToTape(
  session: Session,
  fileContentResolver?: (path: string) => string | null,
): ReplayTape {
  const recorder = new TapeRecorder(session.name);

  for (const op of session.operations) {
    if (op.type === 'read') {
      const content = fileContentResolver?.(op.target) ?? '';
      recorder.recordFileRead(op.target, content);
    } else if (op.type === 'exec') {
      const output = op.metadata.output ?? '';
      recorder.recordExecOutput(op.target, output, op.metadata.exitCode);
    }
    // 'write', 'create', 'delete' are outputs — skip
  }

  return recorder.finalize();
}
