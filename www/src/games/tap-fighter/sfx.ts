import kick1Url from './art/kick1.mp3?url&no-inline';
import kick2Url from './art/kick2.mp3?url&no-inline';
import impact1Url from './art/impact1.mp3?url&no-inline';
import impact2Url from './art/impact2.mp3?url&no-inline';
import avoidUrl from './art/avoid.mp3?url&no-inline';
import musicUrl from './art/music.mp3?url&no-inline';

/**
 * Tap Fighter's per-beat sound effects: the attack swing, the hit landing, and a
 * dodge — decoded once and replayed from a fresh `AudioBufferSourceNode` every
 * time, the same reasoning `squash-mosquitoes/buzz.ts`'s squash cue already
 * established (a source node is one-shot and cannot be restarted).
 *
 * `kick`/`impact` each have two takes (issue #14's recordings) so six identical
 * beats in a row do not all sound the same; `avoid` has one. Contact — never the
 * start of a beat — is the one instant both phones already agree on without a
 * message (`TapFighterRoom.tsx`'s own `contact`), so it is also the instant a cue
 * fires: playing on the swing itself, before either phone knows the outcome,
 * would fire even for the still-locked half of the wind-up.
 */

export type FighterCue = 'kick' | 'impact' | 'avoid';

const SOURCES: Record<FighterCue, string[]> = {
  kick: [kick1Url, kick2Url],
  impact: [impact1Url, impact2Url],
  avoid: [avoidUrl],
};

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  return context;
}

let listening = false;

/** Arm once from any ordinary tap in the room — the first beat's own cue cannot
 *  wait on a decode that only started once it needed to play. */
export function prepareFighterSfx(): void {
  if (typeof document === 'undefined' || listening) return;
  listening = true;
  const arm = () => {
    const current = audio();
    if (current?.state === 'suspended') void current.resume();
    if (current) for (const urls of Object.values(SOURCES)) for (const url of urls) void loadBuffer(current, url);
    if (current) void loadBuffer(current, musicUrl);
  };
  document.addEventListener('pointerdown', arm, { passive: true });
  document.addEventListener('keydown', arm);
}

const buffers = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer | null>>();

function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(url);
  if (cached) return Promise.resolve(cached);
  let promise = pending.get(url);
  if (!promise) {
    promise = fetch(url)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        buffers.set(url, buffer);
        return buffer;
      })
      .catch(() => null);
    pending.set(url, promise);
  }
  return promise;
}

/** One cue, picked at random among its takes when it has more than one. */
export function playFighterCue(cue: FighterCue): void {
  const current = audio();
  if (!current || current.state !== 'running') return;
  const takes = SOURCES[cue];
  const url = takes[Math.floor(Math.random() * takes.length)] ?? takes[0];
  if (!url) return;
  void loadBuffer(current, url).then((buffer) => {
    if (!buffer) return;
    const source = current.createBufferSource();
    source.buffer = buffer;
    source.connect(current.destination);
    source.start();
  });
}

/* -------------------------------- match music -------------------------------- */

const MUSIC_GAIN = 0.35;
const MUSIC_FADE_S = 0.6;

let musicSource: AudioBufferSourceNode | null = null;
let musicGain: GainNode | null = null;

/**
 * Starts the match's own loop. A no-op while already playing, so calling it again
 * on every round's `phase` change (planning → fighting → round-over → …) just lets
 * the same loop keep going instead of restarting it beat to beat.
 */
export function startFighterMusic(): void {
  if (musicSource) return;
  const current = audio();
  if (!current || current.state !== 'running') return;
  void loadBuffer(current, musicUrl).then((buffer) => {
    if (!buffer || musicSource) return; // stopped, or started again, while this decoded
    const source = current.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = current.createGain();
    gain.gain.setValueAtTime(0, current.currentTime);
    gain.gain.linearRampToValueAtTime(MUSIC_GAIN, current.currentTime + MUSIC_FADE_S);
    source.connect(gain);
    gain.connect(current.destination);
    source.start();
    musicSource = source;
    musicGain = gain;
  });
}

/** Stops the match loop — a fade rather than a hard cut, which would otherwise click. */
export function stopFighterMusic(): void {
  if (!musicSource || !musicGain) return;
  const source = musicSource;
  const gain = musicGain;
  musicSource = null;
  musicGain = null;
  const current = audio();
  if (current) {
    gain.gain.cancelScheduledValues(current.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, current.currentTime);
    gain.gain.linearRampToValueAtTime(0.0001, current.currentTime + MUSIC_FADE_S);
    source.stop(current.currentTime + MUSIC_FADE_S + 0.05);
  } else {
    source.stop();
  }
}
