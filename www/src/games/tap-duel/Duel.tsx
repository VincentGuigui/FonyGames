import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { Player, PlayerId, RoundResult } from '../../../../shared/protocol';
import { DUEL_MATCH_TARGET } from '../../../../shared/protocol';
import { GameMenu } from '../../core/ui/GameMenu';
import { GameOverScreen } from '../../core/ui/GameOver';
import { Scoreboard } from '../../core/ui/Scoreboard';
import { driftAt } from './drift';

/**
 * Tap Duel — `pistol` mode, presentational. Spec: docs/specs/games/tap-duel.md
 *
 * An **archer's target sits at a random spot on screen for the whole round**, and
 * only a tap on it counts. The position comes from the server, so it is the same
 * spot for everybody — drawn per client it would decide the round by luck.
 *
 * It is **visible while armed**, greyed out, so the round is speed plus a little
 * accuracy rather than a hunt: you get your thumb ready over a target you can
 * see. Hiding it until the signal made finding it most of the reaction time,
 * which is a different and worse game.
 *
 * While armed the whole viewport is still live, because the false-start rule has
 * not changed: jumping the gun anywhere burns you — including on the target,
 * which is why it does not take pointer events until the signal. After the signal
 * a tap that misses is simply a miss; it costs the time it took, which is
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

export function Duel(props: {
  players: Player[];
  /** Threaded through to the end panel's `GameOverScreen` — nowhere else needs it. */
  slug: string;
  /** The game's accent, for the end panel — the round screen sets it on its own root. */
  accent: string;
  me: PlayerId | null;
  phase: DuelPhase;
  result: RoundResult | null;
  onTap: () => void;
  onAgain: () => void;
  /** Where the target starts, as fractions of the viewport. From the server. */
  target: { x: number; y: number } | null;
  /**
   * The round's timing, for the drift: it runs from `startsAt` and freezes at
   * `fireAt`. Null outside a live round.
   */
  armed: { roundId: number; startsAt: number; fireAt: number; speed: number } | null;
  /**
   * The running match score, kept across rounds.
   *
   * Separate from `result` because that is cleared on every arm — it answers "what
   * happened in the round just finished", and goes away the moment a new one starts.
   * This answers "what is the score", which is true the whole time.
   */
  tally: Record<PlayerId, number>;
  /** Server-corrected clock. The drift is a function of server time, not local time. */
  now: () => number;
  /** Only the host may start the next duel. */
  isHost: boolean;
  title: string;
  concept: string;
  rules: string[];
}): JSX.Element | null {
  const { players, me, phase, result, tally, onTap, onAgain, isHost, title, concept, rules, target, accent, slug } =
    props;
  const { armed, now } = props;
  /*
   * The drift. Spec §4, maths in drift.ts.
   *
   * While the screen says GET READY the target wanders, so a thumb cannot be parked
   * on it in advance. It **freezes the instant the signal fires**, at the position
   * drift.ts gives for `fireAt` — which is the same position on every phone, because
   * the walk is a pure function of the round id and server time. Letting it keep
   * moving would hand the round to whoever's target happened to be nearest their
   * thumb, which is exactly what the server choosing the position prevents.
   *
   * Written straight to `style` from a rAF rather than through state: this component
   * renders the whole duel screen, and a 60 fps virtual-DOM diff for two numbers is
   * the thing docs/conventions/code-style.md tells games not to do.
   *
   * These two hooks sit **above every early return** in this component, including the
   * `phase === 'idle'` one. Placed lower they ran on an armed render and not on a
   * result render, so the hook order changed between renders and Preact quietly
   * stopped calling the effect at all — the target simply never moved, with no error.
   *
   * `prefers-reduced-motion` does **not** switch this off. The precedent is sling-puck
   * §13: motion that *is* the game stays, and only decoration goes. A still target
   * here is a different, easier game — and it would also put that player's target
   * somewhere nobody else's is.
   */
  const dot = useRef<HTMLSpanElement>(null);
  const start = target ?? { x: 0.5, y: 0.5 };
  // Through a ref, and *not* in the effect's dependencies: `now` is a fresh closure
  // on every render of the lobby, so as a dependency it tore the animation loop down
  // and rebuilt it on each render instead of leaving it to run.
  const clock = useRef(now);
  clock.current = now;
  useEffect(() => {
    const el = dot.current;
    if (!el || !armed) return;

    // `transform`, not left/top: composited, so a per-frame move costs no layout.
    // The -50% keeps the CSS's centring, which an inline transform would replace.
    //
    // The offset is in pixels but derived from a *fraction* difference, so the target
    // still lands on the same relative spot on every phone — which is the whole point
    // of drift.ts being deterministic.
    const place = (at: number): void => {
      const p = driftAt(start, armed.roundId, at - armed.startsAt, armed.speed);
      const dx = (p.x - start.x) * window.innerWidth;
      const dy = (p.y - start.y) * window.innerHeight;
      el.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
    };

    if (phase !== 'armed') {
      // Frozen where the signal caught it. Not `now()`: every phone must agree, and
      // they only agree on `fireAt`.
      place(armed.fireAt);
      return;
    }

    let raf = 0;
    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      // Absolute server time, not an accumulated delta: a backgrounded tab stops
      // getting frames, and on return this puts the target where it *should* be now
      // rather than resuming from wherever it froze.
      place(Math.min(clock.current(), armed.fireAt));
    };
    // Once now, outside the loop, because a hidden tab is served **no** animation
    // frames at all — so without this its target sits at the origin for the whole
    // armed window instead of where the drift has taken it, and snaps across the
    // screen the moment the tab comes back. It also removes the one-frame flash at
    // the origin on the way in.
    frame();
    return () => cancelAnimationFrame(raf);
  }, [armed, phase, start.x, start.y]);

  if (phase === 'idle') return null;

  /*
   * The one game with NO status bar, and it is deliberate.
   *
   * Every other game reuses `core/ui/StatusBar.tsx`. Tap Duel's round screen is a
   * bare tap target measuring a reaction in milliseconds: a bar across the top would
   * both steal taps at the edge and give the eye somewhere to be other than the
   * signal. The scores belong on its result screen, where they already are.
   *
   * Same gear, same corner, same contents as every other game. It sits outside the
   * tap target so opening the menu can never be scored as a tap.
   */
  const menu = (
    <div class="duel__menu">
      <GameMenu title={title} concept={concept} rules={rules} />
    </div>
  );

  /*
   * The session's running points, in the panel every game has.
   *
   * A duel has no score DURING a round — it is one tap — so what this shows is the
   * cumulative match total, which is the only number Tap Duel keeps.
   *
   * It reads `tally` and not `result.scores`, and that is the whole point: `result` is
   * cleared on every `arm`, so from the second duel onwards the panel showed **nil for
   * everyone** through the get-ready and the signal, and only remembered the score once
   * the round it was about had already finished. The comment here used to claim `result`
   * survived between rounds. It does not, and had not for as long as the panel existed.
   *
   * It cannot cost a reaction: the panel is `pointer-events: none`, so a tap over it
   * falls through to the target or the backdrop exactly as it did before, and the round
   * screen stays the bare tap target it is meant to be.
   */
  const scores = (
    <Scoreboard
      rows={players.map((p) => ({
        id: p.id,
        avatar: p.avatar,
        name: p.name,
        value: tally[p.id] ?? 0,
      }))}
      me={me}
      unit="points"
    />
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
        {scores}
        <h2 class="duel__headline">Got it</h2>
        <p class="duel__sub">Waiting for everyone else…</p>
      </div>
    );
  }

  if (phase === 'result' && result) {
    /*
     * Two different events, two different endings. Taking a duel is one point and the
     * match runs on, so the panel offers ONE button — the next duel — because that is the
     * only thing anybody wants at 6–4. Taking the MATCH is the end of the contest, and
     * that is the ending with "New match" and a way out.
     */
    const tookMatch = result.matchWinnerId !== null;

    const headline = result.noContest
      ? 'No contest'
      : tookMatch
        ? result.matchWinnerId === me
          ? `You win, ${DUEL_MATCH_TARGET}`
          : `${nameOf(result.matchWinnerId ?? '')} takes the match`
        : undefined;

    /*
     * The score in the column is the TALLY, not the reaction: mid-match "6" is what a
     * player wants from a glance, and the times are what the round was. So the times go on
     * one line underneath, where a false start can say so in words rather than as a
     * missing number.
     */
    const times = result.ranking
      .map((r) => {
        const said = r.falseStart ? 'too early' : r.ms === null ? 'no tap' : `${r.ms}ms`;
        return `${nameOf(r.playerId)} ${said}`;
      })
      .join(' · ');

    return (
      <GameOverScreen
        slug={slug}
        accent={accent}
        title={title}
        concept={concept}
        rules={rules}
        status={tookMatch ? 'Match over' : 'Duel over'}
        rows={result.ranking.map((r) => ({
          id: r.playerId,
          avatar: players.find((p) => p.id === r.playerId)?.avatar ?? '🙂',
          name: nameOf(r.playerId),
          value: result.scores[r.playerId] ?? 0,
          unit: 'points',
          ...(r.falseStart ? { out: true } : {}),
        }))}
        me={me}
        winner={result.matchWinnerId ?? result.winnerId}
        {...(headline === undefined ? {} : { headline })}
        note={
          tookMatch
            ? `${times}. First to ${DUEL_MATCH_TARGET} takes it — the next one is a new match.`
            : times
        }
        {...(tookMatch
          ? { onAgain, againLabel: 'New match' }
          : { onNext: onAgain, nextLabel: 'Next duel' })}
        canAct={isHost}
        waiting={
          tookMatch
            ? 'Waiting for the host to start a new match…'
            : 'Waiting for the host to start the next one…'
        }
      />
    );
  }

  if (phase === 'burned') {
    return (
      <div class="duel duel--burned">
        {menu}
        {scores}
        <h2 class="duel__headline">Too early</h2>
        <p class="duel__sub">You’re out of this one. Watch the others suffer.</p>
      </div>
    );
  }

  const fire = phase === 'fire';

  // The same target both before and after the signal — only its colour, whether it
  // takes taps, and whether it is still moving change.
  const bullseye = (
    <span
      ref={dot}
      class={`duel__bullseye ${fire ? 'duel__bullseye--live' : 'duel__bullseye--waiting'}`}
      style={{
        left: `${start.x * 100}%`,
        top: `${start.y * 100}%`,
      }}
    >
      {fire ? (
        <button
          class="duel__bullseye-hit"
          type="button"
          // pointerdown, not click: the reaction is measured at finger-down.
          onPointerDown={onTap}
          aria-label="Tap the target now"
        >
          {/* Rings are drawn in CSS so there is one element to hit, not five. */}
          <span class="duel__bullseye-rings" aria-hidden="true" />
        </button>
      ) : (
        // Not a button while armed: a tap here must fall through to the backdrop
        // and be scored as the false start it is.
        <span class="duel__bullseye-rings" aria-hidden="true" />
      )}
    </span>
  );

  if (fire) {
    // The backdrop is a plain div now: after the signal only the target scores,
    // so the rest of the screen must not be tappable at all rather than
    // tappable-and-ignored.
    return (
      <>
        <div class="duel duel--fire">
          <span class="duel__word duel__word--fire">NOW</span>
        </div>
        {bullseye}
        {menu}
        {scores}
      </>
    );
  }

  return (
    <>
      <button
        class="duel duel--target duel--armed"
        type="button"
        // Still the whole viewport while armed: an early tap anywhere — the
        // target included — is a false start, and that rule is what stops a
        // player spamming their way in.
        onPointerDown={onTap}
        aria-label="Get ready. Follow the target and tap it the moment it lights up"
      >
        <span class="duel__word">GET READY</span>
        <span class="duel__sub">Stay with the target. Tap it the moment it lights up</span>
      </button>
      {bullseye}
      {menu}
      {scores}
    </>
  );
}
