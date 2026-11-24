/**
 * Double Fusion's merge note. Spec: docs/specs/games/double-fusion.md §4
 *
 * A breathy note, like blowing across a bottle, that climbs a semitone with
 * every merging move in a row — forever. It is a Shepard tone: each note is the
 * same pitch class in seven octaves at once, loud in the middle and fading out
 * at both ends, so a step up from the top of the scale lands on what sounds like
 * the bottom again, one step higher still. Three moves without a merge and the
 * climb starts again from the low note.
 *
 * Raw oscillators and a noise burst, the same pattern as `core/audio/outcome.ts`:
 * it is a cue, not a tune.
 */

/** Semitones in one turn of the scale. */
export const CHIME_STEPS = 12;
/** Moves without a merge before the climb starts over. */
export const CHIME_RESET_AFTER = 3;

/** The lowest of the seven octaves, and where the loudness peaks. */
const LOWEST_HZ = 55;
const OCTAVES = 7;
const PEAK_HZ = 392;
const SPREAD_OCTAVES = 0.9;

export type Climb = { step: number; idle: number };
export const CLIMB_START: Climb = { step: 0, idle: 0 };

/**
 * After one move: a merge plays the next step up, and the note it plays is the
 * returned `step`; anything else counts towards starting over.
 */
export function climb(c: Climb, merged: boolean): Climb {
  if (merged) return { step: c.idle >= CHIME_RESET_AFTER ? 0 : c.step + 1, idle: 0 };
  return { step: c.step, idle: c.idle + 1 };
}

/** The note for a step: every octave of its pitch class, and how loud each is (summing to 1). */
export function partials(step: number): { hz: number; gain: number }[] {
  const turn = (((step % CHIME_STEPS) + CHIME_STEPS) % CHIME_STEPS) / CHIME_STEPS;
  const out = Array.from({ length: OCTAVES }, (_, k) => {
    const hz = LOWEST_HZ * 2 ** (k + turn);
    const away = Math.log2(hz / PEAK_HZ) / SPREAD_OCTAVES;
    return { hz, gain: Math.exp(-0.5 * away * away) };
  });
  const total = out.reduce((s, p) => s + p.gain, 0);
  return out.map((p) => ({ hz: p.hz, gain: p.gain / total }));
}

const SOUND_KEY = 'double-fusion:sound';

/** Remembered on this phone; on unless turned off, as Shake Rush's tune is. */
export function chimeOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setChimeOn(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SOUND_KEY);
    else localStorage.setItem(SOUND_KEY, 'off');
  } catch {
    // Not remembered, but the toggle still works for this round.
  }
}

let context: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let listening = false;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  return context;
}

/** Arm once from any tap or key, so the first merge may sound. */
export function prepareChime(): void {
  if (typeof document === 'undefined' || listening) return;
  listening = true;
  const arm = (): void => {
    const current = audio();
    if (current?.state === 'suspended') void current.resume();
  };
  document.addEventListener('pointerdown', arm, { passive: true });
  document.addEventListener('keydown', arm);
}

const VOLUME = 0.22;
const ATTACK_S = 0.05;
const LENGTH_S = 0.55;

export function playChime(step: number): void {
  const ctx = audio();
  if (!ctx || ctx.state !== 'running') return;
  const at = ctx.currentTime + 0.01;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(VOLUME, at + ATTACK_S);
  out.gain.exponentialRampToValueAtTime(0.0001, at + LENGTH_S);
  out.connect(ctx.destination);

  const notes = partials(step);
  for (const p of notes) {
    if (p.gain < 0.01) continue;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.hz * 0.985, at);
    // The little scoop up into pitch a blown bottle makes.
    osc.frequency.exponentialRampToValueAtTime(p.hz, at + ATTACK_S * 1.5);
    g.gain.value = p.gain;
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + LENGTH_S + 0.05);
  }

  // The breath: noise through a narrow band at the loudest octave.
  if (!noise) {
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * LENGTH_S), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const loudest = notes.reduce((a, b) => (b.gain > a.gain ? b : a));
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = loudest.hz;
  band.Q.value = 6;
  const breath = ctx.createGain();
  breath.gain.setValueAtTime(0.0001, at);
  breath.gain.exponentialRampToValueAtTime(0.5, at + 0.03);
  breath.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
  src.connect(band).connect(breath).connect(out);
  src.start(at);
}
