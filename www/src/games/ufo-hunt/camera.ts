/**
 * Open the rear camera. Spec: docs/specs/games/ufo-hunt.md §5.2
 *
 * A byte-for-byte duplicate of Ghost Hunt's own `vision.ts`'s `startCamera` — game
 * folders do not import from one another (only `core/`, `shared/` and a game's own
 * `art/` cross that line), so this ~25-line function is the cheaper duplication,
 * the same reasoning `worker/ghostHunt.ts`'s own `separation()` states in full.
 *
 * Unlike Ghost Hunt, this game does not degrade on a denial (spec §5.3) — but
 * opening the camera itself is the same operation either way, so this stays
 * unopinionated about that and simply returns null on any failure.
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
