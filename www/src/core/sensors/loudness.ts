import { SCREAM_SAMPLE_MS } from '../../../../shared/protocol';
import { SCREAM_DB_FLOOR, rmsToDbfs } from '../../../../shared/scream';

/**
 * Microphone level, as a run of dBFS samples.
 * Rules: docs/device-capabilities.md §1, §2, §6 · spec: scream-meter.md §5
 *
 * The **sixth** interpreter of a device sensor, beside `bump.ts`, `shake.ts`,
 * `steady.ts`, `orientation.ts` and `steer.ts` — and the first one in the
 * catalogue to touch the microphone at all, which is why the privacy rule is
 * restated here rather than left to the spec:
 *
 * **Only the level is ever read, and no audio is kept.** `getByteTimeDomainData`
 * copies the analyser's current window into a scratch array that is reused every
 * sample; nothing is accumulated, nothing is written to storage, and no
 * `MediaRecorder` is ever constructed. What leaves this module is a number per
 * sample. What leaves the phone is three numbers per round
 * (docs/device-capabilities.md §6).
 *
 * ## Why the gain controls are all off
 *
 * `echoCancellation`, `noiseSuppression` and `autoGainControl` are each set
 * `false`. Automatic gain is the one thing that would flatten the very
 * differences being measured — it exists to make a quiet voice and a loud one
 * sound the same, which is precisely the opposite of this game (spec §5).
 *
 * ## Why a timer and not `requestAnimationFrame`
 *
 * `loudestWindow` in shared/scream.ts assumes evenly spaced samples, and a
 * frame callback is not: it stops entirely in a backgrounded tab and varies
 * with whatever else is drawing. A `setInterval` at `SCREAM_SAMPLE_MS` is what
 * makes the spacing a property of the code rather than of the device's mood.
 */

export type LoudnessSupport = 'unsupported' | 'available';

export function loudnessSupport(): LoudnessSupport {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'unsupported';
  // Safari still only has the prefixed constructor.
  const audio = typeof AudioContext !== 'undefined'
    || typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined';
  return audio ? 'available' : 'unsupported';
}

export type LoudnessTracker = {
  /** Every sample since `reset()`, in dBFS, evenly spaced by `SCREAM_SAMPLE_MS`. */
  samples: () => readonly number[];
  /** The most recent sample, for the live meter. */
  level: () => number;
  /** Drop everything collected so far and start a fresh run. */
  reset: () => void;
  /** Has a real sample arrived yet? */
  ready: () => boolean;
  /** Stop sampling, close the context and **release the microphone**. */
  stop: () => void;
};

/**
 * Ask for the microphone and start sampling.
 *
 * Must be called from a user gesture (Ready or Start — spec §5, and
 * device-capabilities.md §2 for why it is those and not a button of its own).
 * Resolves null when the permission is refused or there is no working
 * microphone, which the caller shows as a refusal rather than a dead screen.
 */
export async function trackLoudness(): Promise<LoudnessTracker | null> {
  if (loudnessSupport() === 'unsupported') return null;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // See this module's own header: automatic gain would flatten exactly
        // what the game measures.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch {
    // Refused, dismissed, or no device. Indistinguishable from here, and the
    // player is told the same thing either way.
    return null;
  }

  const Ctor = AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    for (const track of stream.getTracks()) track.stop();
    return null;
  }
  const context = new Ctor();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  // 1024 samples is ~23 ms at 44.1 kHz — a shade under the sample interval, so
  // consecutive reads barely overlap and none of the window is missed.
  analyser.fftSize = 1024;
  source.connect(analyser);
  /*
   * Deliberately NOT connected to `context.destination`: the game never plays
   * the microphone back, which is what makes a feedback loop impossible (spec
   * §9). An analyser runs perfectly well as a leaf.
   */

  const scratch = new Uint8Array(analyser.fftSize);
  let collected: number[] = [];
  let latest = SCREAM_DB_FLOOR;
  let count = 0;

  const read = (): void => {
    analyser.getByteTimeDomainData(scratch);
    // Time-domain bytes are centred on 128; RMS of the deviation is the level.
    let sum = 0;
    for (let i = 0; i < scratch.length; i++) {
      const deviation = ((scratch[i] as number) - 128) / 128;
      sum += deviation * deviation;
    }
    const db = rmsToDbfs(Math.sqrt(sum / scratch.length));
    latest = db;
    collected.push(db);
    count += 1;
  };

  const timer = setInterval(read, SCREAM_SAMPLE_MS);

  return {
    samples: () => collected,
    level: () => latest,
    reset: () => {
      collected = [];
    },
    ready: () => count > 0,
    stop: () => {
      clearInterval(timer);
      source.disconnect();
      // The microphone is released here and the indicator in the browser's own
      // chrome goes out — which matters more than the memory does.
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}
