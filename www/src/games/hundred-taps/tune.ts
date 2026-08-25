/**
 * One note per correct tap, rising in pitch. Spec: docs/specs/games/100-taps.md §5b
 *
 * Leaner than Tap Tap Music's own `tune.ts`, for the same reason that file gives:
 * a tap here is never guessed locally, every cell this phone marks gone comes
 * straight from the referee's own `taps100-progress` message — so this file only
 * ever has one number to play from: `seekTo(index)`.
 *
 * Unlike Tap Tap Music, there is no fixed melody to index into. `frequencyFor(i)`
 * is a formula: a low base note raised by a small, constant number of semitones
 * per tap, so a clean run climbs smoothly from a low, hollow opening note toward a
 * noticeably higher one by the 100th. Because it is a pure function of the tap
 * index rather than an independently advancing counter, a checkpoint rewind
 * (spec §2.2) naturally drops the next note back down with it — the same
 * "indexed by position, not by a running count" property Tap Tap Music's
 * `melody.ts` documents for its own notes.
 */

/** The opening note — low, per the brief. A3. */
const BASE_FREQ = 220;

/** Semitones climbed per tap. 100 taps × this ≈ 3 octaves by the last cell. */
const SEMITONES_PER_TAP = 0.36;

/** The note for tap index `i` (0-based) — a smooth, ever-rising curve, not a lookup. */
export function frequencyFor(i: number): number {
  const n = Number.isFinite(i) && i > 0 ? i : 0;
  return BASE_FREQ * 2 ** ((n * SEMITONES_PER_TAP) / 12);
}

/** A short victory arpeggio above the final pitch — ratios, not a melody array. */
const FINISH_RATIOS = [1, 1.25, 1.5, 2];

/** Shortest gap between notes. Below this Tone complains and the ear hears one note anyway. */
const MIN_GAP_S = 0.03;

/** The beat of the finishing flourish, in seconds — a walk, not a race. */
const FINISH_GAP_S = 0.16;

/** How long a note rings. */
const NOTE_LEN = '16n';

export type Tune = {
  /** From a user gesture: loads Tone and resumes the AudioContext. Safe to call twice. */
  arm: () => Promise<void>;
  /** The server's own progress index just changed. Advancing plays notes; rewinding is silent. */
  seekTo: (index: number) => void;
  /** The board is cleared: play the finishing flourish. Safe to call twice. */
  finish: () => void;
  /** Silence without unloading: the toggle in the menu. */
  setMuted: (muted: boolean) => void;
  /** Release the audio graph. */
  stop: () => void;
};

/**
 * The synth for one round.
 *
 * Every method is safe before `arm()` and after `stop()`, so the caller can wire
 * `seekTo` to the server's own message without knowing whether audio ever came up.
 */
export function createTune(): Tune {
  let index = 0;
  let muted = false;
  let dead = false;
  /** Set by `finish()`. Further calls are silent — the run is over, not paused. */
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
        // A hollow, bell/crystal-ish voice: FM synthesis rather than a plain
        // oscillator, sine carrier and modulator, fast attack, short decay, low
        // sustain — a strike, not a held tone.
        const synth = new tone.PolySynth(tone.FMSynth, {
          harmonicity: 3,
          modulationIndex: 8,
          oscillator: { type: 'sine' },
          modulation: { type: 'sine' },
          envelope: { attack: 0.004, decay: 0.22, sustain: 0.04, release: 0.25 },
          modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.2 },
        }).toDestination();
        synth.volume.value = -14;
        audio = { tone, synth };
      } catch {
        // No audio is not a failed round — same reasoning as every other game's tune.
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function play(freq: number, gap = MIN_GAP_S): void {
    if (!audio || muted || dead) return;
    const now = audio.tone.now();
    const at = Math.max(now, lastAt + gap);
    lastAt = at;
    try {
      audio.synth.triggerAttackRelease(freq, NOTE_LEN, at);
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
      for (let i = index; i < target; i++) play(frequencyFor(i));
      index = target;
    },

    finish(): void {
      if (ended) return;
      ended = true;
      const top = frequencyFor(Math.max(0, index - 1));
      for (const ratio of FINISH_RATIOS) play(top * ratio, FINISH_GAP_S);
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

const SOUND_KEY = 'fony.taps100.sound';

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
