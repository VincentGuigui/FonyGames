import type { JSX } from 'preact';
import type { Player, PlayerId, RoundResult } from '../../../../shared/protocol';

/**
 * Tap Duel — `pistol` mode, presentational. Spec: docs/specs/games/tap-duel.md
 *
 * The whole viewport is the target: aiming is not the skill being measured,
 * and it keeps the game playable without looking for a button.
 */

export type DuelPhase = 'idle' | 'armed' | 'fire' | 'burned' | 'result';

/**
 * Rank colour: green for the fastest through to red for the slowest.
 *
 * Colour is **additive only** — the ranked order and the number itself already
 * carry the meaning, so nothing is lost when it cannot be seen
 * (docs/design/ui-guidelines.md §2).
 */
function rankColour(index: number, total: number): string {
  if (total <= 1) return 'hsl(140 70% 55%)';
  // 140° (green) → 0° (red), passing through orange on the way.
  const hue = 140 * (1 - index / (total - 1));
  return `hsl(${Math.round(hue)} 75% 55%)`;
}

export function Duel(props: {
  players: Player[];
  me: PlayerId | null;
  phase: DuelPhase;
  result: RoundResult | null;
  onTap: () => void;
  onAgain: () => void;
  /** Only the host may start the next duel. */
  isHost: boolean;
}): JSX.Element | null {
  const { players, me, phase, result, onTap, onAgain, isHost } = props;
  if (phase === 'idle') return null;

  const nameOf = (id: PlayerId): string =>
    players.find((p) => p.id === id)?.name ?? 'Someone';

  if (phase === 'result' && result) {
    const headline = result.noContest
      ? 'No contest'
      : result.winnerId === me
        ? 'You won'
        : `${nameOf(result.winnerId ?? '')} won`;

    // Only valid times take part in the gradient; a false start is not "slow".
    const scored = result.ranking.filter((r) => r.ms !== null);

    return (
      <div class="duel duel--result">
        <h2 class="duel__headline">{headline}</h2>
        <ol class="scoreline">
          {result.ranking.map((r) => {
            const rank = scored.findIndex((s) => s.playerId === r.playerId);
            const colour =
              rank === -1 ? 'var(--color-text-dim)' : rankColour(rank, scored.length);
            return (
              <li key={r.playerId} class={r.playerId === me ? 'scoreline__me' : ''}>
                <span class="scoreline__name">{nameOf(r.playerId)}</span>
                <span class="scoreline__time" style={{ color: colour }}>
                  {r.falseStart ? (
                    'too early'
                  ) : r.ms === null ? (
                    'no tap'
                  ) : (
                    <>
                      {r.ms}
                      <span class="scoreline__unit">ms</span>
                    </>
                  )}
                </span>
                <span class="scoreline__score">{result.scores[r.playerId] ?? 0}</span>
              </li>
            );
          })}
        </ol>
        {isHost ? (
          <button class="btn btn--primary btn--big" type="button" onClick={onAgain}>
            Again
          </button>
        ) : (
          <p class="duel__sub">Waiting for the host to start the next one…</p>
        )}
      </div>
    );
  }

  if (phase === 'burned') {
    return (
      <div class="duel duel--burned">
        <h2 class="duel__headline">Too early</h2>
        <p class="duel__sub">You’re out of this one. Watch the others suffer.</p>
      </div>
    );
  }

  const fire = phase === 'fire';
  return (
    <button
      class={`duel duel--target ${fire ? 'duel--fire' : 'duel--armed'}`}
      type="button"
      // pointerdown, not click: the reaction is measured at finger-down.
      onPointerDown={onTap}
      aria-label={fire ? 'Tap now' : 'Get ready, tap when the screen changes'}
    >
      <span class="duel__word">{fire ? 'TAP!' : 'GET READY'}</span>
      <span class="duel__sub">
        {fire ? 'Fastest thumb wins' : 'Tap the instant this screen changes'}
      </span>
    </button>
  );
}
