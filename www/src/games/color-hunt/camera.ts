/**
 * Open the rear camera. Spec: docs/specs/games/color-hunt.md §5
 *
 * A byte-for-byte duplicate of UFO Hunt's own `camera.ts`, which is itself one
 * of Ghost Hunt's `vision.ts` — game folders do not import from one another
 * (only `core/`, `shared/` and a game's own `art/` cross that line), so this
 * ~25-line function is the cheaper duplication, the same reasoning
 * `worker/ghostHunt.ts`'s own `separation()` states in full.
 *
 * Unlike the other two, this game actually READS the feed rather than using it
 * as scenery — see `sample.ts` — but opening it is the same operation either
 * way, so this stays unopinionated and simply returns null on any failure.
 */
export type Camera = {
  video: HTMLVideoElement;
  stop: () => void;
};

export async function startCamera(): Promise<Camera | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch {
    return null;
  }

  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }

  return {
    video,
    stop: () => {
      // Tracks are STOPPED, not merely paused: a paused track keeps the phone's
      // camera indicator lit, which reads as being spied on (spec §10).
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
