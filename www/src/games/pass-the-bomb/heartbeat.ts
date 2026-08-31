/**
 * Pass the Bomb's rising heartbeat. Spec: docs/specs/games/pass-the-bomb.md §4 · issue #12
 *
 * Raw oscillators, the same pattern as `core/audio/outcome.ts` and `ufo-hunt/laser.ts` — a
 * "lub-dub" thud repeated on an interval is not a note in a tune, so Tone.js buys nothing here.
 *
 * ## Why this counts passes, not time
 *
 * `game.ts` has a hard rule against inferring the fuse from anything client-side — the whole
 * game is built on the holder not knowing when it goes off. A heartbeat driven by elapsed time
 * would be exactly that clock in disguise. Driving it from `state.passes` instead (issue #12:
 * "starting at 60, get 15 after each pass") only ever repeats a fact every phone in the room can
 * already see with their own eyes — the bomb has changed hands N times — so it adds tension
 * without adding information.
 */

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  return context;
}

let listening = false;

/**
 * Arm once from any ordinary tap in the room, `core/audio/outcome.ts`'s own pattern — unlike
 * the laser in UFO Hunt, there is no single button every player is guaranteed to press before
 * the heartbeat needs to start (a watching player never touches "Turn on bumping" or "PASS
 * IT"), so this listens for the first tap or key press anywhere rather than one call site.
 */
export function prepareHeartbeatAudio(): void {
  if (typeof document === 'undefined' || listening) return;
  listening = true;
  const arm = () => { const current = audio(); if (current?.state === 'suspended') void current.resume(); };
  document.addEventListener('pointerdown', arm, { passive: true });
  document.addEventListener('keydown', arm);
}

const SOUND_KEY = 'fony.passthebomb.sound';

/** Whether the heartbeat plays, remembered across rounds. Defaults to on. */
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

export const HEARTBEAT_START_BPM = 60;
export const HEARTBEAT_STEP_BPM = 15;

/** BPM after `passes` hand-offs this round (issue #12): 60, 75, 90, … */
export function heartbeatBpm(passes: number): number {
  return HEARTBEAT_START_BPM + Math.max(0, passes) * HEARTBEAT_STEP_BPM;
}

function triggerThud(ctx: AudioContext, time: number, pitch: number, duration: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(pitch, time);
  // Pitch drop for a realistic body thud.
  osc.frequency.exponentialRampToValueAtTime(10, time + duration);
  gain.gain.setValueAtTime(0.22, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + duration);
}

function playHeartbeat(ctx: AudioContext, at: number): void {
  // "Lub" — lower pitch, slightly longer.
  triggerThud(ctx, at, 100, 0.12);
  // "Dub" — higher pitch, shorter, delayed.
  triggerThud(ctx, at + 0.18, 130, 0.09);
}

let timer: number | null = null;

/** Restarts the loop at the given BPM — safe to call again on every pass to change tempo. */
export function startHeartbeatLoop(bpm: number): void {
  stopHeartbeatLoop();
  const current = audio();
  if (!current || current.state !== 'running' || !soundOn()) return;

  const intervalMs = (60 / bpm) * 1000;
  playHeartbeat(current, current.currentTime + 0.01);
  timer = window.setInterval(() => {
    const running = audio();
    if (running && running.state === 'running' && soundOn()) playHeartbeat(running, running.currentTime + 0.01);
  }, intervalMs);
}

export function stopHeartbeatLoop(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}
