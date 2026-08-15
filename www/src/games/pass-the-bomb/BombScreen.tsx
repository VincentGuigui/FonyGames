import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { BombMatch, Player, PlayerId } from '../../../../shared/protocol';
import { StatusBar } from '../../core/ui/StatusBar';
import { Scoreboard } from '../../core/ui/Scoreboard';
import { Blast } from './Blast';
import { BOOM_MS } from './shockwave';
import type { BombView } from './game';

/**
 * The round, on one phone. Spec: docs/specs/games/pass-the-bomb.md §4
 *
 * Four states, and which one you see is decided entirely by the referee's last frame:
 *
 * | | |
 * | --- | --- |
 * | **holder** | full-bleed accent, "PASS IT" across the middle of it |
 * | **watcher** | calm and dark, whose phone it is on |
 * | **boom** | the explosion, for everyone, naming the victim |
 * | **spectator** | you are out; who is left |
 *
 * All four carry the same small panel in the bottom right — who has it, who is clear — and
 * nothing else. It is deliberately not a thing to *read*: this is a physical game, and the
 * moment the screen becomes what you look at, everyone stops looking at each other and it
 * stops being fun (spec §4). One glance to see the bomb is two seats away is the whole job.
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
      <div class="bombscreen bombscreen--out" style={{ '--game-accent': accent, '--roster': String(players.length) } as JSX.CSSProperties}>
        <StatusBar
          status={"You're out — watching"}
          title={title}
          concept={concept}
          rules={rules}
        />

        {/*
          Bottom right, on every one of this game's screens, so the panel does not jump
          corners as the bomb changes hands. It is also the game's only readout of who is
          holding it — the holder's status bar used to say "You have it", which told you
          the one thing you already knew and nothing about anybody else.
        */}
        <Scoreboard rows={bombRows(players, state)} me={myId} unit="bomb" best="none" corner="bottom-right" />
        <p class="bombscreen__holder-avatar" aria-hidden="true">
          {avatar(state.holder)}
        </p>
        <p class="bombscreen__holder-name">{name(state.holder)} has it</p>
        <p class="bombscreen__still-in">{state.alive.length} still in</p>
      </div>
    );
  }

  if (iAmHolder) {
    const others = state.alive.filter((id) => id !== myId);

    return (
      <div class="bombscreen bombscreen--holder" style={{ '--game-accent': accent, '--roster': String(players.length) } as JSX.CSSProperties}>
        {/*
          The round, not "You have it". The screen is full-bleed accent with PASS IT across
          the middle of it — nothing else on this phone looks remotely like that — so a
          label saying you are holding the bomb spent the one always-visible slot on the
          fact the player is least in doubt about. Where you are in the match is the thing
          they cannot see from the colour.
        */}
        <StatusBar
          status={roundLabel(state.match)}
          title={title}
          concept={concept}
          rules={rules}
        />

        <Scoreboard rows={bombRows(players, state)} me={myId} unit="bomb" best="none" corner="bottom-right" />

        {/*
          PASS IT is the BUTTON, not a headline over one.
          
          It used to be a `<p>`, with the tap route folded into a `<details>` underneath
          reading "Pass with a tap instead" — so the biggest thing on the screen, the thing
          that says what to do, did nothing when you hit it, and the control that worked was
          a small underlined line below the fold. Every player taps the big words.

          It passes to a RANDOM other player rather than asking which one. Picking a name is
          a decision nobody wants while holding a lit bomb, and the physical game does not
          let you choose either — you turn and knock the nearest phone.
        */}
        <button
          class="btn bombscreen__shout"
          type="button"
          disabled={others.length === 0}
          onClick={() => {
            const to = others[Math.floor(Math.random() * others.length)];
            if (to) onPass(to);
          }}
        >
          <span class="bombscreen__icon" aria-hidden="true">
            💣
          </span>
          PASS IT
        </button>

        <p class="bombscreen__how">
          {others.length === 0
            ? 'Nobody to pass it to — this one is yours.'
            : muted
              ? 'Too much shaking — hold still a moment.'
              : canBump
                ? 'Knock your phone against someone else’s, or hit PASS IT.'
                : 'No motion sensor on this phone — hit PASS IT.'}
        </p>
      </div>
    );
  }

  return (
    <div class="bombscreen bombscreen--watching" style={{ '--game-accent': accent, '--roster': String(players.length) } as JSX.CSSProperties}>
      <StatusBar
        status={`${state.alive.length} still in`}
        title={title}
        concept={concept}
        rules={rules}
      />

      <Scoreboard rows={bombRows(players, state)} me={myId} unit="bomb" best="none" corner="bottom-right" />
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

/** How far through the match, for the status bar. */
function roundLabel(m: BombMatch): string {
  return m.rounds === null ? `Round ${m.round}` : `Round ${m.round}/${m.rounds}`;
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
