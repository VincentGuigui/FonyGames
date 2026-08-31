/**
 * Squash Mosquitoes' ambient swarm buzz.
 *
 * Raw oscillators, `core/audio/outcome.ts`'s own pattern — a continuous whine is not a
 * one-shot cue or a note in a tune, so neither of this codebase's other two audio idioms
 * (Tone.js tunes, one-shot thuds) fits; it is one oscillator started once and left running
 * for the length of the round rather than retriggered.
 *
 * The "buzz" is a mid-pitched sawtooth wavering under a slow vibrato — a pure tone reads
 * as a test-tone beep, not an insect; the vibrato (a second, near-inaudible oscillator
 * modulating the first one's own frequency) is what makes it recognisable as a wingbeat
 * rather than a synth note.
 */

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  return context;
}

let listening = false;

/** Arm once from any ordinary tap in the room — same reasoning as Pass the Bomb's heartbeat: the
 *  buzz has to start the instant the round does, before this phone's own first squash. */
export function prepareBuzzAudio(): void {
  if (typeof document === 'undefined' || listening) return;
  listening = true;
  const arm = () => { const current = audio(); if (current?.state === 'suspended') void current.resume(); };
  document.addEventListener('pointerdown', arm, { passive: true });
  document.addEventListener('keydown', arm);
}

const SOUND_KEY = 'fony.squash.sound';

/** Whether the buzz plays, remembered across rounds. Defaults to on. */
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
    // Still works this round, just is not remembered.
  }
}

const BUZZ_FREQUENCY_HZ = 620;
const VIBRATO_RATE_HZ = 7;
const VIBRATO_DEPTH_HZ = 40;
const BUZZ_GAIN = 0.05;

let nodes: { osc: OscillatorNode; vibrato: OscillatorNode; gain: GainNode } | null = null;

/** Starts the swarm's own buzz. Safe to call again — it is a no-op while already running. */
export function startBuzzLoop(): void {
  if (nodes) return;
  const current = audio();
  if (!current || current.state !== 'running' || !soundOn()) return;

  const osc = current.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(BUZZ_FREQUENCY_HZ, current.currentTime);

  // The vibrato: a slow oscillator riding the main one's own frequency, which is what
  // turns a flat tone into something that sounds like a beating wing rather than a beep.
  const vibrato = current.createOscillator();
  vibrato.frequency.setValueAtTime(VIBRATO_RATE_HZ, current.currentTime);
  const vibratoDepth = current.createGain();
  vibratoDepth.gain.setValueAtTime(VIBRATO_DEPTH_HZ, current.currentTime);
  vibrato.connect(vibratoDepth).connect(osc.frequency);

  const gain = current.createGain();
  gain.gain.setValueAtTime(0.0001, current.currentTime);
  gain.gain.exponentialRampToValueAtTime(BUZZ_GAIN, current.currentTime + 0.3);

  osc.connect(gain).connect(current.destination);
  osc.start();
  vibrato.start();

  nodes = { osc, vibrato, gain };
}

/** Stops the buzz — the round ended, the player was eliminated, or sound was turned off. */
export function stopBuzzLoop(): void {
  if (!nodes) return;
  const { osc, vibrato, gain } = nodes;
  const current = audio();
  if (current) {
    // A quick fade rather than a hard cut, which would otherwise click.
    gain.gain.cancelScheduledValues(current.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, current.currentTime);
    gain.gain.linearRampToValueAtTime(0.0001, current.currentTime + 0.08);
    osc.stop(current.currentTime + 0.1);
    vibrato.stop(current.currentTime + 0.1);
  } else {
    osc.stop();
    vibrato.stop();
  }
  nodes = null;
}
