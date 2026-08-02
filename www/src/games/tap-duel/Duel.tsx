import type { JSX } from 'preact';
import type { Player, PlayerId, RoundResult } from '../../../../shared/protocol';

/**
 * Tap Duel — `pistol` mode, presentational. Spec: docs/specs/games/tap-duel.md
 *
 * The whole viewport is the target: aiming is not the skill being measured,
 * and it keeps the game playable without looking for a button.
 */

export type DuelPhase = 'idle' | 'armed' | 'fire' | 'burned' | 'result';

export function Duel(props: {
  players: Player[];
  me: PlayerId | null;
  phase: DuelPhase;
  result: RoundResult | null;
  /** Called with the client's clock-corrected server time. */
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

    return (
      <div class="duel duel--result">
        <h2 class="duel__headline">{headline}</h2>
        <ol class="scoreline">
          {result.ranking.map((r) => (
            <li key={r.playerId} class={r.playerId === me ? 'scoreline__me' : ''}>
              <span class="scoreline__name">{nameOf(r.playerId)}</span>
              <span class="scoreline__time">
                {r.falseStart ? 'too early' : r.ms === null ? 'no tap' : `${r.ms} ms`}
              </span>
              <span class="scoreline__score">{result.scores[r.playerId] ?? 0}</span>
            </li>
          ))}
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
      aria-label={fire ? 'Tap now' : 'Wait for the signal'}
    >
      <span class="duel__word">{fire ? 'TAP' : 'WAIT'}</span>
      {!fire && <span class="duel__sub">Don’t move…</span>}
    </button>
  );
}
