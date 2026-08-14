import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Player, PlayerId } from '../../../../shared/protocol';
import { StatusBar } from '../../core/ui/StatusBar';
import { Scoreboard } from '../../core/ui/Scoreboard';
import { Blast } from './Blast';
import { BOOM_MS } from './shockwave';
import type { BombView } from './game';

/** How long the explosion holds the screen before the next bomb view returns. */


/**
 * The round, on one phone. Spec: docs/specs/games/pass-the-bomb.md §4
 *
 * Four states, and which one you see is decided entirely by the referee's last frame:
 *
 * | | |
 * | --- | --- |
 * | **holder** | full-bleed accent, "PASS IT", no player list — you look at real people |
 * | **watcher** | calm and dark, whose phone it is on |
 * | **boom** | the explosion, for everyone, naming the victim |
 * | **spectator** | you are out; who is left |
 *
 * The holder's screen deliberately shows **no list of who is near you** (spec §4). It is a
 * physical game; the moment the screen becomes the thing you look at, everyone stops looking at
 * each other and it stops being fun.
 *
 * Nothing here counts anything down. See `game.ts` for why that is load-bearing.
 */
export function BombScreen({
  state,
  players,
  myId,
  title,
  concept,
  rules,
  accent,
  onPass,
  canBump,
  muted,
}: {
  state: BombView;
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
  /** Tap fallback — always offered, not only when motion is denied (spec §11). */
  onPass: (to: PlayerId) => void;
  /** False when this phone has no usable motion sensor, so the copy stops promising bumps. */
  canBump: boolean;
  /** Bumps are being ignored for spamming (spec §8). */
  muted: boolean;
}): JSX.Element {
  const name = (id: PlayerId): string => players.find((p) => p.id === id)?.name ?? 'Someone';
  const avatar = (id: PlayerId): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  const boom = useFreshBoom(state);
  const iAmHolder = state.holder === myId;
  const iAmOut = !!myId && !state.alive.includes(myId);

  if (boom) {
    return (
      <div class="boom" role="alert" style={{ '--game-accent': accent } as JSX.CSSProperties}>
        {/*
          The bomb, coming apart. Keyed on the victim so a second boom in the same round
          re-mounts it and runs again — without the key it would play once and then sit
          there as a cleared canvas for every explosion after the first.
        */}
        <Blast key={boom.victim} />
        <p class="boom__who">
          {boom.victim === myId ? 'It went off on you' : `${name(boom.victim)} is out`}
        </p>
        <p class="boom__left">
          {state.phase === 'over'
            ? state.winner
              ? `${name(state.winner)} wins`
              : 'Nobody left'
            : `${state.alive.length} still in`}
        </p>
      </div>
    );
  }

  if (iAmOut) {
    return (
      <div class="bombscreen bombscreen--out" style={{ '--game-accent': accent } as JSX.CSSProperties}>
        <StatusBar
          status={"You're out — watching"}
          title={title}
          concept={concept}
          rules={rules}
        />

        {/*
          Top left, not the default bottom left: the holder's screen keeps the tap-to-pass
          buttons down there, and they are how a player without a motion sensor plays at
          all. Set on every one of this game's screens rather than only that one, so the
          panel does not jump corners as the bomb changes hands.
        */}
        <Scoreboard rows={bombRows(players, state)} me={myId} unit="bomb" best="none" corner="top-left" />
        <p class="bombscreen__holder-avatar" aria-hidden="true">
          {avatar(state.holder)}
        </p>
        <p class="bombscreen__holder-name">{name(state.holder)} has it</p>
        <p class="bombscreen__still-in">{state.alive.length} still in</p>
      </div>
    );
  }

  if (iAmHolder) {
    return (
      <div class="bombscreen bombscreen--holder" style={{ '--game-accent': accent } as JSX.CSSProperties}>
        <StatusBar
          status={"You have it"}
          title={title}
          concept={concept}
          rules={rules}
        />

        <Scoreboard rows={bombRows(players, state)} me={myId} unit="bomb" best="none" corner="top-left" />

        <p class="bombscreen__icon" aria-hidden="true">
          💣
        </p>
        <p class="bombscreen__shout">PASS IT</p>
        <p class="bombscreen__how">
          {muted
            ? 'Too much shaking — hold still a moment.'
            : canBump
              ? 'Knock your phone gently against someone else’s.'
              : 'No motion sensor on this phone — pass with a tap.'}
        </p>

        {/*
          The tap route is always here, for anyone (spec §11 makes it the accessible mode
          rather than a consolation for a denied permission). It is folded away by default so
          it does not become what the holder stares at.
        */}
        <details class="bombscreen__tap">
          <summary class="bombscreen__tap-summary">Pass with a tap instead</summary>
          <ul class="bombscreen__targets">
            {state.alive
              .filter((id) => id !== myId)
              .map((id) => (
                <li key={id}>
                  <button class="btn bombscreen__target" type="button" onClick={() => onPass(id)}>
                    <span aria-hidden="true">{avatar(id)}</span> {name(id)}
                  </button>
                </li>
              ))}
          </ul>
        </details>
      </div>
    );
  }

  return (
    <div class="bombscreen bombscreen--watching" style={{ '--game-accent': accent } as JSX.CSSProperties}>
      <StatusBar
        status={`${state.alive.length} still in`}
        title={title}
        concept={concept}
        rules={rules}
      />

      <Scoreboard rows={bombRows(players, state)} me={myId} unit="bomb" best="none" corner="top-left" />
      <p class="bombscreen__holder-avatar" aria-hidden="true">
        {avatar(state.holder)}
      </p>
      <p class="bombscreen__holder-name">{name(state.holder)} has it</p>
      <p class="bombscreen__how">
        {canBump
          ? 'Stay close — they have to knock a phone to get rid of it.'
          : 'Waiting. This phone has no motion sensor, so they will pass by tap.'}
      </p>
    </div>
  );
}

/**
 * The explosion, but only while it is fresh.
 *
 * The referee's `boom` stays in the state for the rest of the round — that is what names the
 * victim — so "is there a boom" cannot be the same question as "show the explosion". This
 * answers the second one, and re-arms itself for each new victim rather than firing once.
 *
 * On a round-ending boom it never expires: the explosion holds until the room starts again,
 * which is also the results screen.
 */
function useFreshBoom(state: BombView): { victim: PlayerId } | null {
  const [, tick] = useState(0);
  const at = state.lastBoom?.at ?? null;
  const over = state.phase === 'over';

  useEffect(() => {
    if (at === null || over) return;
    const left = BOOM_MS - (Date.now() - at);
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [at, over]);

  if (!state.lastBoom) return null;
  if (!over && Date.now() - state.lastBoom.at > BOOM_MS) return null;

  return { victim: state.lastBoom.victim };
}

/**
 * Who has the bomb, for the panel.
 *
 * **Not a score.** Pass the Bomb has none until somebody is out, and what a player wants
 * to know about everyone else is whether the thing is in their hands. So the value is a
 * word, and `best: 'none'` — there is nothing to be ahead in, and a bold row would be
 * inventing a leader.
 */
function bombRows(players: Player[], state: BombView) {
  return players.map((p) => ({
    id: p.id,
    avatar: p.avatar,
    name: p.name,
    value: state.holder === p.id ? 'has it' : 'clear',
    ...(state.alive.includes(p.id) ? {} : { out: true }),
  }));
}
