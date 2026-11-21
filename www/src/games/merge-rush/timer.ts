/**
 * How urgent the clock looks. Spec: docs/specs/games/merge-rush.md §4
 *
 * Orange with half a minute left, red and blinking with fifteen seconds left.
 */
export const TIMER_WARN_S = 30;
export const TIMER_URGENT_S = 15;

export type TimerTone = 'calm' | 'warn' | 'urgent';

export function timerTone(secondsLeft: number): TimerTone {
  if (secondsLeft <= TIMER_URGENT_S) return 'urgent';
  if (secondsLeft <= TIMER_WARN_S) return 'warn';
  return 'calm';
}
