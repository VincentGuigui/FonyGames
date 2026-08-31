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
 * How much bigger the ring's own fighters are drawn than the base geometry
 * `FightCanvas.tsx` computes from the stage width — feedback that the fight
 * itself read too small. One constant, so retuning it later does not mean
 * re-deriving the placement/lunge/overlap math that also scales from it
 * (`FightCanvas.tsx`'s `spriteSize`, and everything measured against it —
 * `idleGap`, `minimumSeparation`, `blueTarget`/`greenTarget`).
 */
export const FIGHTER_SPRITE_SCALE = 1.3;

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
export const FIGHTER_WINDUP_FRAME_MS = 250;
export const FIGHTER_WINDUP_MS = FIGHTER_WINDUP_FRAME_MS * 4;

/**
 * The action envelope after the wind-up: half holding the action pose (and its
 * canvas lunge), half playing the reaction — 500 ms each, per issue #11's fluid-
 * animation pass. `TapFighterRoom.tsx` derives `beatMs`/`halfBeat` from this, so
 * a beat lasts `FIGHTER_WINDUP_MS + ACTION_BEAT_MS` and contact lands exactly at
 * its midpoint.
 */
export const ACTION_BEAT_MS = 1_000;

/**
 * The canvas lunge's own envelope inside that action half (`FightCanvas.tsx`'s
 * `attackProgress`): ramps in, holds through contact, then fades back to idle.
 * `ACTION_LUNGE_FADE_END_MS` doubles as the instant `TapFighterRoom.tsx` treats a
 * fighter as no longer attacking, so the canvas and the room state can never
 * disagree about when the lunge is over.
 */
export const ACTION_LUNGE_RAMP_MS = 70;
export const ACTION_LUNGE_HOLD_UNTIL_MS = 600;
export const ACTION_LUNGE_FADE_END_MS = 700;

export function idleWindupPose(sinceBeatStart: number): number {
  const frame = Math.floor(sinceBeatStart / FIGHTER_WINDUP_FRAME_MS) % 2;
  return frame === 0 ? FIGHTER_POSES.idle1 : FIGHTER_POSES.idle2;
}
