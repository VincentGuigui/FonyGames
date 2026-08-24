import { MELODY, noteFor } from './melody';

/**
 * One note per correct tap. Spec: docs/specs/games/tap-tap-music.md §5b
 *
 * Leaner than Shake Rush's own `tune.ts`, and can be: a shake is guessed locally and
 * corrected from the server a tenth of a second later, so that file has to reconcile
 * two counters. A tap here is never guessed — every cell this phone marks lit or gone
 * comes straight from the referee's own `taptap-progress` message (spec §6) — so
 * this file only ever has one number to play from: `seekTo(index)`, called whenever
 * that message's `index` changes.
 *
 * `index` moving up plays the notes gained, in order — usually one, since taps arrive
 * one at a time. `index` moving down is a checkpoint rewind (spec §2.2) and is
 * silent: the reset already has its own unmistakable visual beat (the board redrawing,
 * spec §4) and its own risk if the two disagree is nil, since the very next correct
 * tap sings exactly the note it would have sung before the miss (`noteFor` is indexed
 * by position, not by a running count).
 */

/** Shortest gap between notes. Below this Tone complains and the ear hears one note anyway. */
const MIN_GAP_S = 0.03;

/** The beat of the finishing cadence, in seconds — a walk, not a race. */
const FINISH_GAP_S = 0.22;

/** How long a note rings. */
const NOTE_LEN = '16n';

export type Tune = {
  /** From a user gesture: loads Tone and resumes the AudioContext. Safe to call twice. */
  arm: () => Promise<void>;
  /** The server's own progress index just changed. Advancing plays notes; rewinding is silent. */
  seekTo: (index: number) => void;
  /** The board is cleared: play whatever is left of the song, in time. Safe to call twice. */
  finish: () => void;
  /** Silence without unloading: the toggle in the menu. */
  setMuted: (muted: boolean) => void;
  /** Release the audio graph. */
  stop: () => void;
};

/**
 * The tune for one round.
 *
 * Every method is safe before `arm()` and after `stop()` — the index keeps moving and
 * nothing is heard, so the caller can wire `seekTo` to the server's own message
 * without knowing whether audio ever came up.
 */
export function createTune(): Tune {
  let index = 0;
  let muted = false;
  let dead = false;
  /** Set by `finish()`. Further calls are silent — the song is over, not paused. */
  let ended = false;
  let audio: { tone: typeof import('tone'); synth: import('tone').PolySynth } | null = null;
  let loading: Promise<void> | null = null;
  let lastAt = 0;

  async function arm(): Promise<void> {
    if (audio || dead) return;
    if (loading) return loading;
    loading = (async () => {
      try {
        const tone = await import('tone');
        await tone.start();
        if (dead) return;
        const synth = new tone.PolySynth(tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.005, decay: 0.12, sustain: 0.05, release: 0.15 },
        }).toDestination();
        synth.volume.value = -12;
        audio = { tone, synth };
      } catch {
        // No audio is not a failed round — same reasoning as Shake Rush's tune.
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function play(note: string, gap = MIN_GAP_S): void {
    if (!audio || muted || dead) return;
    const now = audio.tone.now();
    const at = Math.max(now, lastAt + gap);
    lastAt = at;
    try {
      audio.synth.triggerAttackRelease(note, NOTE_LEN, at);
    } catch {
      // A timing complaint from Tone must not take the tap loop down with it.
    }
  }

  return {
    arm,

    seekTo(next: number): void {
      if (ended) return;
      if (!Number.isFinite(next) || next < 0) return;
      const target = Math.floor(next);
      for (let i = index; i < target; i++) play(noteFor(i));
      index = target;
    },

    finish(): void {
      if (ended) return;
      ended = true;
      for (let i = index; i < MELODY.length; i++) play(MELODY[i] as string, FINISH_GAP_S);
      index = MELODY.length;
    },

    setMuted(next: boolean): void {
      muted = next;
    },

    stop(): void {
      dead = true;
      try {
        audio?.synth.dispose();
      } catch {
        // Disposing a graph that never came up is not worth reporting.
      }
      audio = null;
    },
  };
}

const SOUND_KEY = 'fony.taptap.sound';

/** Whether the tune plays, remembered across rounds. Defaults to on. */
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
    // As above — the toggle still works for this round, it just will not be remembered.
  }
}
