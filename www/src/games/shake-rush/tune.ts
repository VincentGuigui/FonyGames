import { noteFor } from './melody';

/**
 * One note per shake. Spec: docs/specs/games/shake-rush.md §5b
 *
 * The runner is not just counting to a hundred and twenty, they are playing a tune — and
 * the tune is the progress bar you can hear, which is the point of it: the screen is
 * unreadable while a phone is being shaken hard, so the ear takes over. The pitch climbs
 * through the track (`melody.ts`), so "nearly home" is audible without looking.
 *
 * ## Tone.js, and why it is loaded late
 *
 * `tone` is ~200 KB of synthesiser. Loading it in the page chunk would put it in front of
 * every player, including the ones who never get motion permission and the ones who only
 * came to watch. It is `import()`ed from the permission tap instead — the same gesture that
 * has to be there anyway for iOS — so it arrives while the lobby is still open and costs
 * nobody who does not race.
 *
 * ## The AudioContext needs the gesture too
 *
 * Every browser starts an AudioContext suspended and only `resume()`s it inside a user
 * gesture; `Tone.start()` is that resume. It is why `arm()` exists as a separate call from
 * `step()` rather than the first note starting the audio: the first note happens mid-shake,
 * which is not a gesture, and the whole tune would be silent.
 *
 * ## Timing
 *
 * Notes are fired the moment the shake is detected, not sequenced: a shake IS the beat, and
 * a runner shaking unevenly should hear it. The only scheduling rule is that each note is
 * strictly after the last — Tone throws on two `triggerAttackRelease` calls at the same
 * instant, and two axes crossing inside one millisecond is normal.
 */

/** Shortest gap between notes. Below this Tone complains and the ear hears one note anyway. */
const MIN_GAP_S = 0.03;

/** How long a note rings. Short: at eight shakes a second, anything longer is a chord. */
const NOTE_LEN = '16n';

/**
 * How far the local count may run from the server's before it is pulled back.
 *
 * Not zero. The phone counts its own shakes and the server confirms them a tenth of a
 * second later, so the two are ALWAYS a few apart mid-race — correcting to every frame
 * would drag the tune backwards ten times a second and it would stutter rather than play.
 * The tolerance is only there to catch a real divergence, which is a dropped frame or a
 * count the referee clipped.
 */
const RESYNC_SLACK = 6;

export type Tune = {
  /** From a user gesture: loads Tone and resumes the AudioContext. Safe to call twice. */
  arm: () => Promise<void>;
  /** Play the note for the next shake and advance. */
  step: () => void;
  /** The server's position for this runner; pulls the tune back if it has drifted. */
  seek: (at: number) => void;
  /** Back to the first note — a new race starts the tune again. */
  rewind: () => void;
  /** Silence without unloading: the toggle in the menu. */
  setMuted: (muted: boolean) => void;
  /** Release the audio graph. */
  stop: () => void;
};

/**
 * The tune for one race.
 *
 * Every method is safe before `arm()` and after `stop()` — the index keeps moving and
 * nothing is heard. That is what lets the caller wire `step()` to the shake detector
 * without knowing whether audio ever came up: a runner who declined, or whose browser has
 * no `AudioContext`, plays the same race in silence.
 */
export function createTune(): Tune {
  let index = 0;
  let muted = false;
  let dead = false;
  /** The Tone module and its synth, once loaded. `null` until then. */
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
          // Percussive: a plucked shape, so eight a second stay separate notes rather
          // than smearing into one held chord.
          envelope: { attack: 0.005, decay: 0.12, sustain: 0.05, release: 0.15 },
        }).toDestination();
        // Well under unity. Eight voices of a triangle wave at full volume clips, and a
        // phone held at arm's length is close to an ear.
        synth.volume.value = -12;
        audio = { tone, synth };
      } catch {
        // No audio is not a failed race. A blocked context, a browser without
        // `AudioContext`, a chunk that would not load — all of them leave the game
        // playable and only the tune missing, so none of them are worth an error.
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function play(note: string): void {
    if (!audio || muted || dead) return;
    // Strictly increasing, or Tone throws — see the docblock.
    const now = audio.tone.now();
    const at = Math.max(now, lastAt + MIN_GAP_S);
    lastAt = at;
    try {
      audio.synth.triggerAttackRelease(note, NOTE_LEN, at);
    } catch {
      // A voice-stealing or timing complaint from Tone must not take the shake loop
      // down with it; the next shake gets its own note.
    }
  }

  return {
    arm,

    step(): void {
      play(noteFor(index));
      index += 1;
    },

    seek(at: number): void {
      if (!Number.isFinite(at) || at < 0) return;
      const server = Math.floor(at);
      if (Math.abs(server - index) <= RESYNC_SLACK) return;
      index = server;
    },

    rewind(): void {
      index = 0;
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

const SOUND_KEY = 'fony.rush.sound';

/**
 * Whether the tune plays, remembered across races.
 *
 * `localStorage`, like the profile: someone who turns it off is in a quiet room or a
 * meeting, and that is still true for the next race and the race after. Defaults to on —
 * the sound is the feature, and a muted-by-default feature is one nobody finds.
 */
export function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    // Private mode, or storage blocked. The sound is not worth failing over.
    return true;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SOUND_KEY);
    else localStorage.setItem(SOUND_KEY, 'off');
  } catch {
    // As above — the toggle still works for this race, it just will not be remembered.
  }
}
