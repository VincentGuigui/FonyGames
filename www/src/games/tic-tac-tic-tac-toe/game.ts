import type { ServerMessage, TttState } from '../../../../shared/protocol';
import { tttWinningLine } from '../../../../shared/ticTacTicTacToe';

export class TttGame {
  state: TttState | null = null;
  apply(msg: ServerMessage): void {
    if (msg.t === 'tttt') this.state = msg.d;
  }
}

/**
 * The winning finale (spec §4). The referee decides `phase: 'over'` on the tap
 * that wins the meta grid, and before this existed the board vanished in the
 * same frame — the winning move was the one move nobody ever saw land.
 *
 * Two beats, then the results:
 *
 * 1. **The stamp**, `TTT_STAMP_MS`: the child grid that was just won stays on
 *    screen with the winner's symbol over it. This is the board the match was
 *    decided on, held long enough to read.
 * 2. **The line**, `TTT_PULSE_MS`: back out to the meta grid, and the three
 *    aligned symbols pulse once a second, so the win is shown as a line rather
 *    than announced as a name.
 */
export const TTT_STAMP_MS = 2_000;
export const TTT_PULSE_MS = 3_000;
/** One pulse per second — the count follows from the two constants rather than
 *  being a third one to keep in step with them. */
export const TTT_PULSE_COUNT = TTT_PULSE_MS / 1_000;

export type TttFinaleStage = 'stamp' | 'line' | 'done';

/** Which beat the finale is on, `elapsedMs` after the winning tap. */
export function finaleStage(elapsedMs: number): TttFinaleStage {
  if (elapsedMs < TTT_STAMP_MS) return 'stamp';
  if (elapsedMs < TTT_STAMP_MS + TTT_PULSE_MS) return 'line';
  return 'done';
}

/**
 * Does this state deserve a finale at all?
 *
 * Only a real meta win does. A draw has no line to pulse, and the five-minute
 * cap ends the match with `winner: null` from wherever it had got to — holding
 * a celebration over either would be the game lying about what happened.
 */
export function finaleLine(state: TttState): readonly [number, number, number] | null {
  if (state.phase !== 'over' || state.winner === null || state.draw) return null;
  return tttWinningLine(state.meta);
}
