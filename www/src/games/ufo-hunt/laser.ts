/**
 * UFO Hunt's two one-shot cues. Spec: docs/specs/games/ufo-hunt.md §2
 *
 * Raw oscillators, `core/audio/outcome.ts`'s own pattern — Tone.js is for melodic
 * games (100 Taps' and Tap Tap Music's own `tune.ts`); a laser zap or an explosion
 * is a single one-shot cue, not a note in a tune.
 *
 * The laser plays locally, on your own tap, the instant you fire — no round trip
 * to wait for. The explosion is server-driven: it plays for everyone once a
 * broadcast reports the wave changed to a fresh `index` (spec §2.5).
 */

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  return context;
}

/** Arm from the same tap gesture that requests orientation and camera (spec §5.3). */
export function armLaserAudio(): void {
  const current = audio();
  if (current?.state === 'suspended') void current.resume();
}

const SOUND_KEY = 'fony.ufohunt.sound';

/** Whether the cues play, remembered across rounds. Defaults to on. */
export function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SOUND_KEY);
    else localStorage.setItem(SOUND_KEY, 'off');
  } catch {
    // The toggle still works for this round, it just will not be remembered.
  }
}

/** A laser zap: a fast descending sweep. */
export function playLaser(): void {
  const current = audio();
  if (!current || current.state !== 'running' || !soundOn()) return;

  const at = current.currentTime + 0.01;
  const oscillator = current.createOscillator();
  const gain = current.createGain();
  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(1400, at);
  oscillator.frequency.exponentialRampToValueAtTime(220, at + 0.12);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.09, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
  oscillator.connect(gain).connect(current.destination);
  oscillator.start(at);
  oscillator.stop(at + 0.15);
}

/** The missile launch: the same descending sweep as `playLaser`, lower and longer — the earned, heavier shot. */
export function playMissile(): void {
  const current = audio();
  if (!current || current.state !== 'running' || !soundOn()) return;

  const at = current.currentTime + 0.01;
  const oscillator = current.createOscillator();
  const gain = current.createGain();
  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(900, at);
  oscillator.frequency.exponentialRampToValueAtTime(90, at + 0.3);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
  oscillator.connect(gain).connect(current.destination);
  oscillator.start(at);
  oscillator.stop(at + 0.33);
}

/** The saucer's explosion: a burst of noise under a falling thud. */
export function playExplosion(): void {
  const current = audio();
  if (!current || current.state !== 'running' || !soundOn()) return;

  const at = current.currentTime + 0.01;

  const bufferSize = Math.floor(current.sampleRate * 0.3);
  const buffer = current.createBuffer(1, bufferSize, current.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = current.createBufferSource();
  noise.buffer = buffer;
  const lowpass = current.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.setValueAtTime(1800, at);
  lowpass.frequency.exponentialRampToValueAtTime(200, at + 0.3);
  const noiseGain = current.createGain();
  noiseGain.gain.setValueAtTime(0.18, at);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
  noise.connect(lowpass).connect(noiseGain).connect(current.destination);
  noise.start(at);
  noise.stop(at + 0.3);

  const thud = current.createOscillator();
  const thudGain = current.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(160, at);
  thud.frequency.exponentialRampToValueAtTime(40, at + 0.35);
  thudGain.gain.setValueAtTime(0.0001, at);
  thudGain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
  thud.connect(thudGain).connect(current.destination);
  thud.start(at);
  thud.stop(at + 0.4);
}
