export const FIGHTER_ACTIONS = ['punch', 'kick', 'jump', 'crouch'] as const;
export type FighterAction = (typeof FIGHTER_ACTIONS)[number];
export type FighterSeat = 'blue' | 'green';

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
