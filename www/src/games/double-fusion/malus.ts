import type { MergeMalusKind } from '../../../../shared/protocol';

/** An aggressive race's maluses, as a player sees them. Spec: docs/specs/games/double-fusion.md §3.1 */

export const MALUS_ICON: Record<MergeMalusKind, string> = {
  explode: '💥',
  add: '➕',
  freeze: '❄️',
  fog: '🌫️',
  stone: '🪨',
  gravity: '⬇️',
};

/** The label under an unlocked malus's icon: a word or two, to read at a glance. */
export const MALUS_SHORT: Record<MergeMalusKind, { en: string; fr: string }> = {
  explode: { en: 'Boom', fr: 'Boum' },
  add: { en: '+1 tile', fr: '+1 tuile' },
  freeze: { en: 'Freeze', fr: 'Gel' },
  fog: { en: 'Fog', fr: 'Brouillard' },
  stone: { en: 'Stone', fr: 'Pierre' },
  gravity: { en: 'Gravity', fr: 'Gravité' },
};

export const MALUS_NAME: Record<MergeMalusKind, { en: string; fr: string }> = {
  explode: { en: 'Boom: a small tile blown up', fr: 'Boum : une petite tuile explose' },
  add: { en: 'An extra tile', fr: 'Une tuile en plus' },
  freeze: { en: 'Frozen for 3 s', fr: 'Gelé pendant 3 s' },
  fog: { en: 'Fog: no numbers for 5 s', fr: 'Brouillard : plus de nombres pendant 5 s' },
  stone: { en: 'A stone for 10 s', fr: 'Une pierre pendant 10 s' },
  gravity: { en: 'Gravity: everything falls', fr: 'Gravité : tout tombe' },
};

const FLIGHT_MS = 600;

/**
 * Sends the malus's icon flying from one element's centre to another's, then
 * calls `landed`. Drawn on top of everything, so it can cross from the board to
 * the strip of thumbnails; with reduced motion it lands at once.
 */
export function fly(from: Element | null, to: Element | null, icon: string, landed: () => void): void {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!from || !to || reduced) {
    landed();
    return;
  }
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const shot = document.createElement('span');
  shot.className = 'merge__shot';
  shot.textContent = icon;
  shot.setAttribute('aria-hidden', 'true');
  shot.style.left = `${a.left + a.width / 2}px`;
  shot.style.top = `${a.top + a.height / 2}px`;
  document.body.appendChild(shot);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const flight = shot.animate(
    [
      { translate: '-50% -50%', scale: '0.6', opacity: 0.4 },
      { translate: `calc(-50% + ${dx / 2}px) calc(-50% + ${dy / 2 - 40}px)`, scale: '1.5', opacity: 1, offset: 0.5 },
      { translate: `calc(-50% + ${dx}px) calc(-50% + ${dy}px)`, scale: '1', opacity: 1 },
    ],
    { duration: FLIGHT_MS, easing: 'ease-in-out' },
  );
  flight.onfinish = () => {
    shot.remove();
    landed();
  };
  flight.oncancel = flight.onfinish;
}
