import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Player, PlayerId } from '../../../../shared/protocol';
import { STEADY_LIVES } from '../../../../shared/protocol';
import { StatusBar } from '../../core/ui/StatusBar';
import { Scoreboard } from '../../core/ui/Scoreboard';
import { useT } from '../../core/i18n/strings';
import { meterFill, type SteadyView } from './game';
import { useGameText } from '../../core/i18n/gameText';

/** How long the "you lost a life" beat holds. Shorter than the grace window on purpose. */
const HIT_MS = 700;

/**
 * The round, on one phone. Spec: docs/specs/games/steady-hand.md §4
 *
 * The meter is the whole interface. It has to be readable **without moving your eyes**,
 * because looking around is itself a wobble — so it is large, central, and says the same
 * thing three ways: how full it is, what colour it is, and a number.
 *
 * Four states: settling, holding, just lost a life, and out.
 */
export function SteadyScreen({
  state,
  players,
  myId,
  title,
  concept,
  rules,
  accent,
  now,
}: {
  state: SteadyView;
  players: Player[];
  myId: PlayerId | undefined;
  title: string;
  concept: string;
  rules: string[];
  /**
   * The game's accent, set as `--game-accent` on the round screen's own root.
   *
   * The lobby template sets it for its screens and the round screen is not inside it,
   * so without this every accented thing here — the status bar's number, the score
   * panel's values — fell back to the SITE accent. That is how Ghost Hunt shipped a
   * green game with an orange radar.
   */
  accent: string;
  /** Server time, for the settle countdown. */
  now: () => number;
}): JSX.Element {
  const t = useT();
  const text = useGameText();
  const name = (id: PlayerId): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatar = (id: PlayerId): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  const iAmOut = !!myId && !state.alive.includes(myId);
  const myW = myId ? (state.w[myId] ?? 0) : 0;
  const myLives = myId ? (state.lives[myId] ?? 0) : 0;
  const fill = meterFill(myW, state.tolerance);
  const hit = useFreshHit(state, myId);
  const settling = useSettle(state, now);

  if (iAmOut) {
    const reason = state.lastOut?.victim === myId ? state.lastOut.reason : 'moved';
    return (
      <div class="steady steady--out" style={{ '--game-accent': accent } as JSX.CSSProperties}>
        <StatusBar
          status={reason === 'parked' ? text({ en: 'Phone put down', fr: 'Téléphone posé' }) : reason === 'left'
            ? text({ en: 'You dropped out', fr: 'Vous avez quitté la manche' }) : text({ en: 'You moved', fr: 'Vous avez bougé' })}
          title={title}
          concept={concept}
          rules={rules}
        />

        <Scoreboard rows={livesRows(players, state)} me={myId} unit={t.common.lives} best="none" />

        <p class="steady__gone" aria-hidden="true">
          ✋
        </p>
        <p class="steady__gone-note">{text({ en: "You're out — watching", fr: 'Vous êtes éliminé — regardez' })}</p>

        {/* The best seat in the house: everyone else's meters, live. */}
        <ul class="steady__others">
          {state.alive.map((id) => (
            <li key={id} class="steady__other">
              <span class="steady__other-who">
                <span aria-hidden="true">{avatar(id)}</span> {name(id)}
              </span>
              <Meter fill={meterFill(state.w[id] ?? 0, state.tolerance)} />
              <span class="steady__other-lives">{'●'.repeat(state.lives[id] ?? 0)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      class={`steady ${hit ? 'steady--hit' : ''}`}
      style={{ '--game-accent': accent } as JSX.CSSProperties}
    >
      <StatusBar
        status={text({ en: `${state.alive.length} still in`, fr: `${state.alive.length} encore en jeu` })}
        title={title}
        concept={concept}
        rules={rules}
      />

      <Scoreboard rows={livesRows(players, state)} me={myId} unit={t.common.lives} best="none" />

      {settling !== null ? (
        <>
          <p class="steady__settle-count" aria-hidden="true">
            {settling}
          </p>
          <p class="steady__settle">{text({ en: 'Get into position — hold it up and still', fr: 'Mettez-vous en position — tenez-le levé et immobile' })}</p>
        </>
      ) : (
        <>
          {/*
            `aria-hidden` on the dial and a live region for the number: a screen reader
            announcing a bar 5 times a second is unusable, while the number alone is
            enough to play (spec §11).
          */}
          <div class="steady__dial" aria-hidden="true">
            <Meter fill={fill} big />
          </div>
          <p class="steady__reading" role="status" aria-live="polite">
            <strong>{myW.toFixed(2)}</strong>
            <span> {text({ en: 'of', fr: 'sur' })} {state.tolerance.toFixed(2)}</span>
          </p>

          <p class="steady__lives">
            {/* Pips AND a number — never a count carried by shape alone. */}
            <span aria-hidden="true">
              {'●'.repeat(myLives)}
              {'○'.repeat(Math.max(0, STEADY_LIVES - myLives))}
            </span>
            <span class="steady__lives-n">
              {myLives} {t.common.lives}
            </span>
          </p>

          {hit && (
            <p class="steady__hit-note" role="alert">
              {text({ en: `${myLives} left`, fr: `${myLives} restantes` })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Meter({ fill, big = false }: { fill: number; big?: boolean }): JSX.Element {
  // Colour AND width, because colour alone is never allowed to carry a state.
  const level = fill > 0.85 ? 'danger' : fill > 0.6 ? 'warn' : 'calm';
  return (
    <div class={`meter ${big ? 'meter--big' : ''} meter--${level}`}>
      <div class="meter__fill" style={{ width: `${Math.round(fill * 100)}%` }} />
    </div>
  );
}

/**
 * The "you lost a life" beat, but only while it is fresh.
 *
 * `lastHit` stays in the state for the rest of the round — that is what names the
 * victim — so "is there a hit" is not the same question as "flash now". This answers
 * the second, and only for *my* lives: somebody else's flinch is not my emergency.
 */
function useFreshHit(state: SteadyView, myId: PlayerId | undefined): boolean {
  const [, tick] = useState(0);
  const mine = state.lastHit && state.lastHit.victim === myId ? state.lastHit : null;
  const at = mine?.at ?? null;

  useEffect(() => {
    if (at === null) return;
    const left = HIT_MS - (Date.now() - at);
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [at]);

  return at !== null && Date.now() - at <= HIT_MS;
}

/**
 * Seconds left in the settle window, or null once counting has started.
 *
 * Its own ticking state so the countdown re-renders one number rather than the whole
 * screen — and it stops entirely the moment the round is live, because a timer running
 * behind the meter is exactly the sort of thing that costs a frame at the worst moment.
 */
function useSettle(state: SteadyView, now: () => number): number | null {
  const [left, setLeft] = useState(() => Math.ceil((state.startsAt - now()) / 1000));

  useEffect(() => {
    if (state.startsAt - now() <= 0) {
      setLeft(0);
      return;
    }
    const timer = setInterval(() => {
      const secs = Math.ceil((state.startsAt - now()) / 1000);
      setLeft(secs);
      if (secs <= 0) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, [state.startsAt, now]);

  return left > 0 ? left : null;
}

/**
 * Everyone's lives, for the panel.
 *
 * Lives rather than wobble: wobble is a live meter that already has a place on the
 * screen, while "how many mistakes are they allowed" is the thing you actually want to
 * know about the people you are racing.
 *
 * The value is pips and not a digit — three lives reads as ●●● across the table — so
 * there is nothing here to rank and the panel bolds nobody (`best: 'none'`). Ranking on
 * lives would be wrong anyway: this game is won by lasting longest, not by finishing
 * with the most left.
 */
function livesRows(players: Player[], state: SteadyView) {
  return players.map((p) => {
    const lives = state.lives[p.id] ?? 0;
    return {
      id: p.id,
      avatar: p.avatar,
      name: p.name,
      value: lives > 0 ? '●'.repeat(lives) : 'out',
      ...(state.alive.includes(p.id) ? {} : { out: true }),
    };
  });
}
