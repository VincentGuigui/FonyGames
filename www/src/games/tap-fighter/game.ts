/** Tap Fighter's visual pose and color contract. */
export const FIGHTER_COLORS = {
  blue: '#2563eb',
  green: '#22c55e',
} as const;

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

export const RHYTHM_POSES = [FIGHTER_POSES.idle1, FIGHTER_POSES.idle2] as const;

export const ACTION_POSE = {
  punch: FIGHTER_POSES.punch,
  kick: FIGHTER_POSES.kick,
  jump: FIGHTER_POSES.jump,
  crouch: FIGHTER_POSES.crouch,
} as const;
