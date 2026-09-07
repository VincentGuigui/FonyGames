import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  DARK_MAX_PLAYERS,
  DARK_MIN_PLAYERS,
  DARK_TURN_MS,
  type DarkState,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { DARK_DIRS, type DarkDir } from '../../../../shared/darkMap';
import { useGameRoom } from '../../core/room/useRoom';
import { useSoloTesting } from '../../core/useSolo';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import './together-in-the-dark.css';

/**
 * Together in the Dark's room screen. Spec: docs/specs/games/together-in-the-dark.md §4
 *
 * Most of the screen is black, which is a genuine **budget advantage**: this
 * needs a fraction of the art of a game like Goat Siege, and the whole board is
 * a CSS grid of cells rather than a canvas.
 *
 * Two things this screen has to get right:
 *
 * 1. **The layout never jumps.** Everybody sees the same footprint — the
 *    current player gets two D-pads in it, everybody else gets whose turn it is
 *    in the same space. A screen that reflowed when the turn passed would be
 *    unreadable in a room that is arguing.
 * 2. **The turn log is the accessible version of the map** (§11). Every reveal
 *    is announced as text, so a low-vision player can follow the whole run
 *    through it and argue as well as anyone — which is the entire game.
 */
export function DarkRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <DarkRoomInner game={card} code={code} />}</RoomGate>;
}

/** How many cells either side of the character the viewport shows. The grid can
 *  be far larger than the screen with no zoom and no pan (spec §4). */
const VIEW = 4;

function DarkRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<DarkState | null>(null);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'dark') setState(msg.d);
  }, []);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;
  const clientRef = useRef(client);
  clientRef.current = client;

  /** Sent this turn already? Held locally because the referee's next frame is
   *  the only other confirmation, and it arrives a round-trip later. */
  const [acted, setActed] = useState(false);
  useEffect(() => {
    setActed(false);
  }, [state?.turn, state?.roundId]);

  const act = useCallback(
    (action: 'walk' | 'light', dir: DarkDir) => {
      const s = state;
      if (!s || s.phase !== 'playing' || s.who !== myId || acted) return;
      setActed(true);
      clientRef.current?.send({ t: 'dark-act', d: { roundId: s.roundId, turn: s.turn, action, dir } });
    },
    [state?.roundId, state?.turn, state?.phase, state?.who, myId, acted],
  );

  // The turn timer, straight into the DOM. One rAF loop, no re-render.
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = state;
    if (!s || s.phase !== 'playing') return;
    let frame = 0;
    const loop = (): void => {
      const el = barRef.current;
      if (el) {
        const now = clientRef.current?.now() ?? Date.now();
        const left = Math.max(0, Math.min(1, (s.turnEndsAt - now) / DARK_TURN_MS));
        el.style.transform = `scaleX(${left.toFixed(4)})`;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [state?.roundId, state?.turn, state?.phase, state?.turnEndsAt]);

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });

  const start = useCallback(() => {
    clientRef.current?.send({ t: 'start', d: { mode: 'dark', solo } });
  }, [solo]);

  if (state && state.phase === 'done') {
    return (
      <GameOverScreen
        room={room}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        headline={state.won
          ? text({ en: 'Out of the woods', fr: 'Sortis du bois' })
          : text({ en: 'The forest kept him', fr: 'La forêt l’a gardé' })}
        note={state.won
          ? text({ en: `${state.turns} turns, ${state.lives} lives left. A record to beat.`, fr: `${state.turns} tours, ${state.lives} vies restantes. Un record à battre.` })
          : text({ en: `${state.turns} turns, and the lives ran out.`, fr: `${state.turns} tours, et les vies sont épuisées.` })}
        /*
         * No rows, and no winner. Co-op: the room wins or loses together, and
         * nobody's individual turn is scored — that would turn a discussion
         * into a blame (spec §2).
         */
        rows={[]}
        me={myId}
        winner={null}
        onAgain={start}
        canAct={room.isHost && enoughToStart(room.connected, [DARK_MIN_PLAYERS, DARK_MAX_PLAYERS], solo)}
      />
    );
  }

  if (state) {
    const mine = state.who === myId;
    // Everything the room knows, as one lookup — `lit` wins over `seen`,
    // because this turn's light is the truth and memory is only a memory.
    const known = new Map<string, string>();
    for (const cell of state.seen) known.set(`${cell.x},${cell.y}`, cell.kind);
    const litNow = new Set<string>();
    for (const cell of state.lit) {
      known.set(`${cell.x},${cell.y}`, cell.kind);
      litNow.add(`${cell.x},${cell.y}`);
    }

    const cells: JSX.Element[] = [];
    for (let dy = -VIEW; dy <= VIEW; dy++) {
      for (let dx = -VIEW; dx <= VIEW; dx++) {
        const x = state.at.x + dx;
        const y = state.at.y + dy;
        const outside = x < 0 || y < 0 || x >= state.cols || y >= state.rows;
        const k = `${x},${y}`;
        const kind = known.get(k);
        const here = dx === 0 && dy === 0;
        // The lit circle: the character and one cell in every direction is the
        // only fully-drawn part of the board (spec §4).
        const inCircle = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
        const isEscape = state.escape !== null && state.escape.x === x && state.escape.y === y;

        cells.push(
          <div
            key={k}
            class={
              'dark__cell'
              + (outside ? ' dark__cell--edge' : '')
              + (inCircle ? ' dark__cell--circle' : '')
              + (litNow.has(k) ? ' dark__cell--lit' : '')
              + (kind !== undefined && !litNow.has(k) ? ' dark__cell--seen' : '')
            }
          >
            {/* Shapes, not colours: a trap and a monster differ in silhouette,
                so red/green vision does not change the game (spec §11). */}
            {here ? <span class="dark__him" aria-hidden="true">🧍</span>
              : isEscape ? <span aria-hidden="true">🚪</span>
              : kind === 'trap' ? <span aria-hidden="true">✕</span>
              : kind === 'monster' ? <span aria-hidden="true">👁</span>
              : kind === 'tree' ? <span aria-hidden="true">▲</span>
              : null}
          </div>,
        );
      }
    }

    return (
      <div class="dark" style={{ '--game-accent': card.accent, '--dark-span': String(VIEW * 2 + 1) } as JSX.CSSProperties}>
        <StatusBar
          status={text({
            en: `Turn ${state.turns + 1} · ${'♥'.repeat(state.lives)}`,
            fr: `Tour ${state.turns + 1} · ${'♥'.repeat(state.lives)}`,
          })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
        />

        <div class="dark__board" aria-hidden="true">{cells}</div>

        {/* Three lines, the shared memory the arguing runs on — and the
            accessible version of the whole board (spec §4, §11). */}
        <ul class="dark__log" aria-live="polite" aria-label={text({ en: 'What just happened', fr: 'Ce qui vient de se passer' })}>
          {state.log.map((line, i) => <li key={`${i}-${line}`}>{line}</li>)}
        </ul>

        <div class="dark__timer" aria-hidden="true">
          <div ref={barRef} class="dark__timer-fill" />
        </div>

        {/*
          The same footprint for everybody: two D-pads for the player on turn,
          and whose turn it is in the same space for everyone else, so the
          layout never jumps (spec §4).
        */}
        <div class="dark__controls">
          {mine && !acted ? (
            <>
              <Pad label={text({ en: 'Walk', fr: 'Marcher' })} kind="walk" onPick={(dir) => act('walk', dir)} />
              <Pad label={text({ en: 'Light', fr: 'Éclairer' })} kind="light" onPick={(dir) => act('light', dir)} />
            </>
          ) : (
            <p class="dark__waiting">
              {mine
                ? text({ en: 'Your move is in. Waiting for the room', fr: 'Votre coup est joué. En attente de la salle' })
                : state.who
                  ? text({ en: `${nameOf(state.who)} is deciding`, fr: `${nameOf(state.who)} réfléchit` })
                  : text({ en: 'Waiting', fr: 'En attente' })}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <GameLobby
      card={card}
      code={code}
      joinUrl={joinUrl}
      room={room}
      copied={copied}
      showQr={showQr}
      onShare={share}
      onToggleQr={toggleQr}
      canStart={room.isHost && enoughToStart(room.connected, [DARK_MIN_PLAYERS, DARK_MAX_PLAYERS], solo)}
      startLabel={t.common.startRound}
      onStart={start}
      aside={
        /*
         * The primer is where the central dilemma has to be explained: a player
         * who does not understand that light costs a turn will not understand
         * the game at all (spec §4).
         */
        <p class="howto__aside">
          {text({
            en: 'One action each turn, for the whole team: a step, or a light one cell. Never both. Everything you light is announced to the room — the arguing is the game.',
            fr: 'Une action par tour, pour toute l’équipe : un pas, ou une lumière sur une case. Jamais les deux. Tout ce que vous éclairez est annoncé à la salle — c’est la discussion qui fait le jeu.',
          })}
        </p>
      }
    />
  );
}

/**
 * A D-pad. Two of them, and they differ only in colour and label — because the
 * choice between them is the game, and making them look like two different
 * kinds of control would suggest one is the real one.
 */
function Pad({
  label,
  kind,
  onPick,
}: {
  label: string;
  kind: 'walk' | 'light';
  onPick: (dir: DarkDir) => void;
}): JSX.Element {
  const glyph: Record<DarkDir, string> = { N: '↑', E: '→', S: '↓', W: '←' };
  const at: Record<DarkDir, string> = { N: 'n', E: 'e', S: 's', W: 'w' };
  return (
    <div class={`dark__pad dark__pad--${kind}`}>
      <span class="dark__pad-label">{label}</span>
      <div class="dark__pad-grid">
        {DARK_DIRS.map((dir) => (
          <button
            key={dir}
            type="button"
            class={`dark__key dark__key--${at[dir]}`}
            aria-label={`${label} ${dir}`}
            onClick={() => onPick(dir)}
          >
            <span aria-hidden="true">{glyph[dir]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
