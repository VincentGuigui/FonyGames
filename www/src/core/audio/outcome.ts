export type OutcomeKind = 'win' | 'lose';
export type OutcomeCue = (context: AudioContext, at: number) => void;
export type OutcomeSounds = Partial<Record<OutcomeKind, OutcomeCue>>;

let context: AudioContext | null = null;
let listening = false;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  return context;
}

/** Arm once from any ordinary game tap so the later result cue may autoplay. */
export function prepareOutcomeAudio(): void {
  if (typeof document === 'undefined' || listening) return;
  listening = true;
  const arm = () => { const current = audio(); if (current?.state === 'suspended') void current.resume(); };
  document.addEventListener('pointerdown', arm, { passive: true });
  document.addEventListener('keydown', arm);
}

function notes(context: AudioContext, at: number, frequencies: number[]): void {
  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = at + index * .12;
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(.11, start + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, start + .18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + .2);
  });
}

export const defaultWinCue: OutcomeCue = (context, at) => notes(context, at, [523.25, 659.25, 783.99, 1046.5]);
export const defaultLoseCue: OutcomeCue = (context, at) => notes(context, at, [392, 329.63, 261.63]);

export function playOutcomeSound(kind: OutcomeKind, override?: OutcomeCue): void {
  const current = audio();
  if (!current || current.state !== 'running') return;
  (override ?? (kind === 'win' ? defaultWinCue : defaultLoseCue))(current, current.currentTime + .02);
}
