import squashSfxUrl from './art/squash.mp3?url&no-inline';

/**
 * Squash Mosquitoes' sound: the swarm's own ambient buzz, plus the one-shot squash
 * cue. Spec: docs/specs/games/squash-mosquitoes.md, issue #13.
 *
 * The buzz's own nodes and values — a sawtooth oscillator through a lowpass filter,
 * both wobbled on a `setInterval` rather than a second modulating oscillator — are
 * the maintainer's own reference implementation (issue #13), kept close to the
 * original rather than reworked into this codebase's other "second oscillator as
 * vibrato" idiom (`pass-the-bomb/heartbeat.ts`'s LFO): the random walk is what reads
 * as an erratic, alive flight rather than a steady tone.
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
  const arm = () => {
    const current = audio();
    if (current?.state === 'suspended') void current.resume();
    if (current) void loadSquashBuffer(current); // decode early — the first squash cannot wait on it
  };
  document.addEventListener('pointerdown', arm, { passive: true });
  document.addEventListener('keydown', arm);
}

const SOUND_KEY = 'fony.squash.sound';

/** Whether the buzz and squash cue play, remembered across rounds. Defaults to on. */
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

/* ------------------------------ the ambient buzz ------------------------------ */

const BUZZ_BASE_FREQUENCY_HZ = 500;
const BUZZ_FILTER_FREQUENCY_HZ = 1200;
const BUZZ_GAIN = 0.05;
const BUZZ_MODULATION_MS = 50;

let nodes: { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; interval: number } | null = null;

/** Starts the swarm's own buzz. Safe to call again — it is a no-op while already running. */
export function startBuzzLoop(): void {
  if (nodes) return;
  const current = audio();
  if (!current || current.state !== 'running' || !soundOn()) return;

  const osc = current.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(BUZZ_BASE_FREQUENCY_HZ, current.currentTime);

  const filter = current.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(BUZZ_FILTER_FREQUENCY_HZ, current.currentTime);

  const gain = current.createGain();
  gain.gain.setValueAtTime(BUZZ_GAIN, current.currentTime);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(current.destination);
  osc.start();

  // The random walk that makes it read as an erratic flight rather than a held
  // note: frequency and gain each nudged toward a new random target every 50ms.
  const interval = window.setInterval(() => {
    const now = current.currentTime;
    const randomFreq = 480 + Math.random() * 60 + Math.sin(now * 10) * 15;
    osc.frequency.linearRampToValueAtTime(randomFreq, now + 0.05);
    const randomGain = 0.02 + Math.random() * 0.05 + Math.sin(now * 2) * 0.02;
    gain.gain.linearRampToValueAtTime(randomGain, now + 0.05);
  }, BUZZ_MODULATION_MS);

  nodes = { osc, filter, gain, interval };
}

/** Stops the buzz — the round ended, the player was eliminated, or sound was turned off. */
export function stopBuzzLoop(): void {
  if (!nodes) return;
  const { osc, gain, interval } = nodes;
  window.clearInterval(interval);
  const current = audio();
  if (current) {
    // A quick fade rather than a hard cut, which would otherwise click.
    gain.gain.cancelScheduledValues(current.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, current.currentTime);
    gain.gain.linearRampToValueAtTime(0.0001, current.currentTime + 0.08);
    osc.stop(current.currentTime + 0.1);
  } else {
    osc.stop();
  }
  osc.disconnect();
  nodes = null;
}

/* --------------------------------- the squash cue --------------------------------- */

let squashBuffer: AudioBuffer | null = null;
let squashBufferPromise: Promise<AudioBuffer | null> | null = null;

function loadSquashBuffer(ctx: AudioContext): Promise<AudioBuffer | null> {
  if (squashBuffer) return Promise.resolve(squashBuffer);
  squashBufferPromise ??= fetch(squashSfxUrl)
    .then((res) => res.arrayBuffer())
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => {
      squashBuffer = buffer;
      return buffer;
    })
    .catch(() => null);
  return squashBufferPromise;
}

/** One squash, one shot — `art/squash.mp3` (issue #13), decoded once and replayed
 *  from a fresh `AudioBufferSourceNode` every time since a source node is one-shot
 *  by design and cannot be restarted. */
export function playSquashSound(): void {
  const current = audio();
  if (!current || current.state !== 'running' || !soundOn()) return;
  void loadSquashBuffer(current).then((buffer) => {
    if (!buffer) return;
    const source = current.createBufferSource();
    source.buffer = buffer;
    source.connect(current.destination);
    source.start();
  });
}
