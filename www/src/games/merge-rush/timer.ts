/**
 * How urgent the clock looks. Spec: docs/specs/games/merge-rush.md §4
 *
 * Orange with half a minute left, red and blinking with fifteen seconds left.
 */
export const TIMER_WARN_S = 30;
export const TIMER_URGENT_S = 15;

/** A duration as `m:ss.t`, to the tenth — the form a Highlander solve is shown in. */
export function formatDuration(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

export type TimerTone = 'calm' | 'warn' | 'urgent';

export function timerTone(secondsLeft: number): TimerTone {
  if (secondsLeft <= TIMER_URGENT_S) return 'urgent';
  if (secondsLeft <= TIMER_WARN_S) return 'warn';
  return 'calm';
}
