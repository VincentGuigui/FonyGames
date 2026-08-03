import type { JSX } from 'preact';
import type { Player, PlayerId, RoundResult } from '../../../../shared/protocol';
import { GameMenu } from '../../core/ui/GameMenu';

/**
 * Tap Duel — `pistol` mode, presentational. Spec: docs/specs/games/tap-duel.md
 *
 * On the signal an **archer's target appears somewhere on screen** and only a tap
 * on it counts. The position comes from the server, so it is the same spot for
 * everybody — drawn per client it would decide the round by luck.
 *
 * While armed the whole viewport is still live, because the false-start rule has
 * not changed: jumping the gun anywhere burns you. After the signal a tap that
 * misses the target is simply a miss — it costs the time it took, which is
 * punishment enough and is self-limiting.
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
  /** Where the target sits, as fractions of the viewport. From the server. */
  target: { x: number; y: number } | null;
  /** Only the host may start the next duel. */
  isHost: boolean;
  title: string;
  concept: string;
  rules: string[];
}): JSX.Element | null {
  const { players, me, phase, result, onTap, onAgain, isHost, title, concept, rules, target } =
    props;
  if (phase === 'idle') return null;

  // Same gear, same corner, same contents as every other game. It sits outside
  // the tap target so opening the menu can never be scored as a tap.
  const menu = (
    <div class="duel__menu">
      <GameMenu title={title} concept={concept} rules={rules} />
    </div>
  );

  const nameOf = (id: PlayerId): string =>
    players.find((p) => p.id === id)?.name ?? 'Someone';

  /*
   * Tapped, waiting for the server to say what that was worth.
   *
   * `tap()` moves to `result` the instant a finger lands, because the alternative
   * is a live-looking target after you have already hit it. Until the result
   * arrives there is nothing to rank, and without this branch the component fell
   * through to the *armed* screen — telling a player who has just tapped to get
   * ready.
   */
  if (phase === 'result' && !result) {
    return (
      <div class="duel duel--waiting">
        {menu}
        <h2 class="duel__headline">Got it</h2>
        <p class="duel__sub">Waiting for everyone else…</p>
      </div>
    );
  }

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
        {menu}
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
        {menu}
        <h2 class="duel__headline">Too early</h2>
        <p class="duel__sub">You’re out of this one. Watch the others suffer.</p>
      </div>
    );
  }

  if (phase === 'fire') {
    // The backdrop is a plain div, not a button: after the signal only the target
    // scores, so the rest of the screen must not be tappable at all rather than
    // tappable-and-ignored.
    return (
      <>
        <div class="duel duel--fire">
          <span class="duel__word duel__word--fire">TAP THE TARGET</span>
        </div>
        <button
          class="duel__bullseye"
          type="button"
          style={{
            left: `${(target?.x ?? 0.5) * 100}%`,
            top: `${(target?.y ?? 0.5) * 100}%`,
          }}
          // pointerdown, not click: the reaction is measured at finger-down.
          onPointerDown={onTap}
          aria-label="Tap the target now"
        >
          {/* Rings are drawn in CSS so there is one element to hit, not five. */}
          <span class="duel__bullseye-rings" aria-hidden="true" />
        </button>
        {menu}
      </>
    );
  }

  return (
    <>
      <button
        class="duel duel--target duel--armed"
        type="button"
        // Still the whole viewport while armed: an early tap anywhere is a false
        // start, and that rule is what stops a player spamming their way in.
        onPointerDown={onTap}
        aria-label="Get ready, a target will appear"
      >
        <span class="duel__word">GET READY</span>
        <span class="duel__sub">A target will appear — tap it, and nothing before it</span>
      </button>
      {menu}
    </>
  );
}
