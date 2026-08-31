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

export function resolveFight(blue: readonly FighterAction[], green: readonly FighterAction[]): {
  beats: FighterBeat[];
  winner: FighterSeat | null;
  draw: boolean;
} {
  const impacts = blue.map((action, index) => confront(action, green[index] ?? 'crouch'));
  const blueHits = impacts.filter((impact) => impact.blue).length;
  const greenHits = impacts.filter((impact) => impact.green).length;
  const maxHits = Math.max(blueHits, greenHits);
  const damage = maxHits === 0 ? 0 : 100 / maxHits;
  let cumulativeBlue = 0;
  let cumulativeGreen = 0;
  const beats = impacts.map((impact, index) => {
    if (impact.blue) cumulativeBlue += 1;
    if (impact.green) cumulativeGreen += 1;
    return {
      blueAction: blue[index] ?? 'crouch',
      greenAction: green[index] ?? 'crouch',
      blueHit: impact.blue,
      greenHit: impact.green,
      blueHealth: Math.max(0, 100 - cumulativeBlue * damage),
      greenHealth: Math.max(0, 100 - cumulativeGreen * damage),
    };
  });
  return {
    beats,
    winner: blueHits === greenHits ? null : blueHits < greenHits ? 'blue' : 'green',
    draw: blueHits === greenHits,
  };
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
