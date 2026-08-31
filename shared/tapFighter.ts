export const FIGHTER_ACTIONS = ['punch', 'kick', 'crouch', 'jump'] as const;
export type FighterAction = (typeof FIGHTER_ACTIONS)[number];
export type FighterSeat = 'blue' | 'green';

/**
 * The reveal between both plans locking in and the first beat actually landing: a VS
 * callout, a 3-2-1 count, then FIGHT. The client renders every step of it from
 * `startsAt` alone (`elapsed < 0` during the reveal), so the numbers below are the one
 * place the sequence is timed — the worker's `REVEAL_LEAD_MS` is their sum, which is
 * what makes the round's first real beat land exactly when the sequence finishes
 * rather than under it.
 */
export const FIGHT_VS_MS = 2_000;
export const FIGHT_VS_FADE_MS = 500;
export const FIGHT_COUNTDOWN_STEP_MS = 1_000;
export const FIGHT_COUNTDOWN_STEPS = 3;
export const FIGHT_FLASH_MS = 1_000;

/** Both plans are in to the first beat landing — long enough for the whole reveal above. */
export const REVEAL_LEAD_MS =
  FIGHT_VS_MS + FIGHT_VS_FADE_MS + FIGHT_COUNTDOWN_STEP_MS * FIGHT_COUNTDOWN_STEPS + FIGHT_FLASH_MS;

export type FighterResolution = { blue: boolean; green: boolean };

export function confront(blue: FighterAction, green: FighterAction): FighterResolution {
  const blueAttack = blue === 'punch' || blue === 'kick';
  const greenAttack = green === 'punch' || green === 'kick';
  const blueHit = greenAttack && !((green === 'punch' && blue === 'crouch') || (green === 'kick' && blue === 'jump'));
  const greenHit = blueAttack && !((blue === 'punch' && green === 'crouch') || (blue === 'kick' && green === 'jump'));
  return { blue: blueHit, green: greenHit };
}

export type FighterBeat = {
  blueAction: FighterAction;
  greenAction: FighterAction;
  blueHit: boolean;
  greenHit: boolean;
  blueHealth: number;
  greenHealth: number;
};

/** Both fighters start here; every landed hit costs this much (issue #3). */
export const FIGHTER_START_HEALTH = 100;
export const FIGHTER_HIT_DAMAGE = 20;

/** The fixed sequence length `validFighterPlan` requires of every locked plan. */
export const FIGHTER_BEAT_COUNT = 6;

export function resolveFight(blue: readonly FighterAction[], green: readonly FighterAction[]): {
  beats: FighterBeat[];
  winner: FighterSeat | null;
  draw: boolean;
} {
  let blueHealth = FIGHTER_START_HEALTH;
  let greenHealth = FIGHTER_START_HEALTH;
  const beats: FighterBeat[] = [];
  // Stops the instant either health hits zero rather than always playing all six
  // beats — a knockout ends the round there, it does not wait out the clock.
  for (let index = 0; index < FIGHTER_BEAT_COUNT; index += 1) {
    const impact = confront(blue[index] ?? 'crouch', green[index] ?? 'crouch');
    if (impact.blue) blueHealth = Math.max(0, blueHealth - FIGHTER_HIT_DAMAGE);
    if (impact.green) greenHealth = Math.max(0, greenHealth - FIGHTER_HIT_DAMAGE);
    beats.push({
      blueAction: blue[index] ?? 'crouch',
      greenAction: green[index] ?? 'crouch',
      blueHit: impact.blue,
      greenHit: impact.green,
      blueHealth,
      greenHealth,
    });
    if (blueHealth <= 0 || greenHealth <= 0) break;
  }
  const last = beats.at(-1);
  const winner: FighterSeat | null =
    !last || last.blueHealth === last.greenHealth ? null : last.blueHealth > last.greenHealth ? 'blue' : 'green';
  return { beats, winner, draw: winner === null };
}

export function validFighterPlan(value: unknown): value is FighterAction[] {
  return Array.isArray(value) && value.length === 6 && value.every((action) => typeof action === 'string' && FIGHTER_ACTIONS.includes(action as FighterAction));
}

/** Consecutive landed hits with none received earns the "Combo" callout (issue #9). */
export const COMBO_STREAK = 3;

/**
 * How many beats up to and including `uptoIndex` this seat has landed a hit on the
 * other without taking one back, counting backwards until the streak breaks. A pure
 * function of the already-resolved `beats` timeline, so both clients derive the
 * identical answer from the identical server data — nothing here is guessed ahead
 * of what the referee decided.
 */
export function comboStreak(beats: readonly FighterBeat[], uptoIndex: number, seat: FighterSeat): number {
  const landed = seat === 'blue' ? 'greenHit' : 'blueHit';
  const received = seat === 'blue' ? 'blueHit' : 'greenHit';
  let streak = 0;
  for (let index = uptoIndex; index >= 0; index -= 1) {
    const beat = beats[index];
    if (!beat || !beat[landed] || beat[received]) break;
    streak += 1;
  }
  return streak;
}
