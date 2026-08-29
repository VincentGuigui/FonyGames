/**
 * Tap Fighter's visual pose and color contract.
 *
 * The seat keys (`blue`/`green`) are fixed labels from the wire protocol and CSS class
 * names, not a promise about the actual colour — the authored sprites now wear fuchsia
 * and blue, so the values below are the real swatches, sampled from the art itself.
 */
export const FIGHTER_COLORS = {
  blue: '#fb34e3',
  green: '#6d51dc',
} as const;

/** Columns in each fighter's sprite sheet — see `FIGHTER_SPRITE_MIRRORED` below. */
export const FIGHTER_SPRITE_COLUMNS = 4;

/**
 * `fighter2.png` was authored by mirroring `fighter1.png`'s whole file horizontally.
 * That correctly flips the character to face the other way, but it also reverses each
 * row's column order — player 1's row reads `idle1, idle2, punch, kick` left to right,
 * player 2's reads the same four poses right to left. Row order (top/bottom) is
 * untouched, since a horizontal flip only reverses columns.
 *
 * Every reader of the sheet (the CSS sprite and the canvas draw) has to undo that for
 * whichever seat this is true of, or player 2 shows the wrong pose for every action.
 */
export const FIGHTER_SPRITE_MIRRORED: Record<'blue' | 'green', boolean> = {
  blue: false,
  green: true,
};

export const FIGHTER_POSES = {
  idle1: 0,
  idle2: 1,
  punch: 2,
  kick: 3,
  jump: 4,
  crouch: 5,
  hit: 6,
  defeated: 7,
} as const;

export const ACTION_POSE = {
  punch: FIGHTER_POSES.punch,
  kick: FIGHTER_POSES.kick,
  jump: FIGHTER_POSES.jump,
  crouch: FIGHTER_POSES.crouch,
} as const;

/**
 * The wind-up before every beat's action lands: four frames, idle1→idle2→idle1→
 * idle2, `FIGHTER_WINDUP_FRAME_MS` each, before the action pose (and its canvas
 * lunge, `FightCanvas.tsx`'s `attackProgress`) takes over. A pure function of time
 * since the beat itself started, not a local timer/interval — like every other
 * beat of this fight (`TapFighterRoom.tsx`'s own `pose`), both phones have to
 * render the identical frame from the identical `elapsed` clock, not their own
 * independently-ticking one.
 */
export const FIGHTER_WINDUP_FRAME_MS = 150;
export const FIGHTER_WINDUP_MS = FIGHTER_WINDUP_FRAME_MS * 4;

export function idleWindupPose(sinceBeatStart: number): number {
  const frame = Math.floor(sinceBeatStart / FIGHTER_WINDUP_FRAME_MS) % 2;
  return frame === 0 ? FIGHTER_POSES.idle1 : FIGHTER_POSES.idle2;
}
