import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Player, PlayerId } from '../../../../shared/protocol';
import { STEADY_LIVES } from '../../../../shared/protocol';
import { opponentOf, StatusBar } from '../../core/ui/StatusBar';
import { meterFill, type SteadyView } from './game';

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
  now,
}: {
  state: SteadyView;
  players: Player[];
  myId: PlayerId | undefined;
  title: string;
  concept: string;
  rules: string[];
  /** Server time, for the settle countdown. */
  now: () => number;
}): JSX.Element {
  const name = (id: PlayerId): string => players.find((p) => p.id === id)?.name ?? 'Someone';
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
      <div class="steady steady--out">
        <StatusBar
          status={reason === 'parked' ? 'Phone put down' : reason === 'left' ? 'You dropped out' : 'You moved'}
          opponent={them(players, myId, state)}
          title={title}
          concept={concept}
          rules={rules}
        />

        <p class="steady__gone" aria-hidden="true">
          ✋
        </p>
        <p class="steady__gone-note">You're out — watching</p>

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
    <div class={`steady ${hit ? 'steady--hit' : ''}`}>
      <StatusBar
        status={`${state.alive.length} still in`}
        opponent={them(players, myId, state)}
        title={title}
        concept={concept}
        rules={rules}
      />

      {settling !== null ? (
        <>
          <p class="steady__settle-count" aria-hidden="true">
            {settling}
          </p>
          <p class="steady__settle">Get into position — hold it up and still</p>
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
            <span> of {state.tolerance.toFixed(2)}</span>
          </p>

          <p class="steady__lives">
            {/* Pips AND a number — never a count carried by shape alone. */}
            <span aria-hidden="true">
              {'●'.repeat(myLives)}
              {'○'.repeat(Math.max(0, STEADY_LIVES - myLives))}
            </span>
            <span class="steady__lives-n">
              {myLives} {myLives === 1 ? 'life' : 'lives'}
            </span>
          </p>

          {hit && (
            <p class="steady__hit-note" role="alert">
              {myLives} left
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
 * The other player's lives, in a two-player round.
 *
 * Lives rather than wobble: wobble is a live meter that already has a place on the
 * screen, while "how many mistakes are they allowed" is the thing you actually want
 * to know about the only person you are racing.
 */
function them(players: Player[], me: PlayerId | undefined, state: SteadyView) {
  const other = opponentOf(players, me);
  if (!other) return null;

  const lives = state.lives[other.id] ?? 0;
  return {
    avatar: other.avatar,
    name: other.name,
    value: lives > 0 ? '●'.repeat(lives) : 'out',
    dim: !state.alive.includes(other.id),
  };
}
