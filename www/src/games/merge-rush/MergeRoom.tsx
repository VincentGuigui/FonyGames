import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  MERGE_MAX_PLAYERS,
  MERGE_MIN_PLAYERS,
  MERGE_REPORT_MS,
  MERGE_ROUND_MS,
  MERGE_SIZE,
  MERGE_SWIPE_PX,
  type MergeRushState,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { bestTile, canMove, newGame, step, tileValue, type Dir, type Game } from '../../../../shared/merge';
import { useGameRoom } from '../../core/room/useRoom';
import { useSoloTesting } from '../../core/useSolo';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { tileColor, tileTextColor } from './colors';
import './merge-rush.css';

/**
 * Merge Rush's room screen. Spec: docs/specs/games/merge-rush.md §4
 *
 * The rules are `shared/merge.ts` run from the room's seed; this holds them
 * together with the swipe, the thumbnails and the one thing that reaches
 * outside — the throttled board report (spec §6).
 */
export function MergeRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <MergeRoomInner game={card} code={code} />}</RoomGate>;
}

/** A 32×32 px board, one 8 px square a cell, colour and nothing else (spec §4). */
function Thumb({ board }: { board: readonly number[] }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const cell = 32 / MERGE_SIZE;
    board.forEach((e, i) => {
      ctx.fillStyle = tileColor(tileValue(e));
      ctx.fillRect((i % MERGE_SIZE) * cell, Math.floor(i / MERGE_SIZE) * cell, cell, cell);
    });
  }, [board]);
  return <canvas ref={ref} class="merge__thumb" width={32} height={32} aria-hidden="true" />;
}

const KEYS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const ARROWS: { dir: Dir; glyph: string; en: string; fr: string }[] = [
  { dir: 'left', glyph: '←', en: 'Slide left', fr: 'Glisser à gauche' },
  { dir: 'up', glyph: '↑', en: 'Slide up', fr: 'Glisser vers le haut' },
  { dir: 'down', glyph: '↓', en: 'Slide down', fr: 'Glisser vers le bas' },
  { dir: 'right', glyph: '→', en: 'Slide right', fr: 'Glisser à droite' },
];

function MergeRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<MergeRushState | null>(null);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'merge-rush') setState(msg.d);
  }, []);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const clientRef = useRef(room.client);
  clientRef.current = room.client;
  const myId = room.me?.id;

  const roundId = state?.roundId;
  const seed = state?.seed;
  const startsAt = state?.startsAt ?? 0;
  const playing = state?.phase === 'playing';

  const [game, setGame] = useState<Game | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [over, setOver] = useState(false);
  const overRef = useRef(false);
  const [left, setLeft] = useState(Math.ceil(MERGE_ROUND_MS / 1000));
  const [countdown, setCountdown] = useState(0);

  const sentAt = useRef(0);
  const pending = useRef<number | undefined>(undefined);
  const roundRef = useRef(roundId);
  roundRef.current = roundId;

  /** Send the latest board now; `done` says this phone is finished. */
  const send = useCallback((done: boolean) => {
    const g = gameRef.current;
    const id = roundRef.current;
    if (!g || id === undefined) return;
    window.clearTimeout(pending.current);
    pending.current = undefined;
    sentAt.current = performance.now();
    clientRef.current?.send({
      t: 'merge-board',
      d: { roundId: id, board: [...g.board], score: g.score, moves: g.moves, over: done },
    });
  }, []);

  /** At most one report per `MERGE_REPORT_MS`, and the last one always goes. */
  const report = useCallback(() => {
    if (pending.current !== undefined) return;
    const wait = Math.max(0, MERGE_REPORT_MS - (performance.now() - sentAt.current));
    pending.current = window.setTimeout(() => send(false), wait);
  }, [send]);

  // The board for a round, built once from the room's seed. A phone that comes
  // back mid-round resumes from the referee's copy: every spawn is a function of
  // the seed and the move count, so the next one lands exactly where it would have.
  const builtFor = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (roundId === undefined || seed === undefined || !playing || myId === undefined) return;
    if (builtFor.current === roundId) return;
    builtFor.current = roundId;
    const mine = state?.boards[myId];
    const g: Game = mine && mine.moves > 0 ? { board: mine.board, score: mine.score, moves: mine.moves } : newGame(seed);
    gameRef.current = g;
    overRef.current = mine?.over === true;
    setGame(g);
    setOver(overRef.current);
  }, [roundId, seed, playing, myId, state]);

  const finish = useCallback(() => {
    if (overRef.current) return;
    overRef.current = true;
    setOver(true);
    send(true);
  }, [send]);

  // The clock: the countdown, the seconds left, and the end of this phone's round.
  useEffect(() => {
    if (!playing) return;
    const tick = (): void => {
      const now = clientRef.current?.now() ?? Date.now();
      const into = now - startsAt;
      setCountdown(into < 0 ? Math.ceil(-into / 1000) : 0);
      setLeft(Math.max(0, Math.ceil((MERGE_ROUND_MS - Math.max(0, into)) / 1000)));
      if (into >= MERGE_ROUND_MS) finish();
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [playing, startsAt, finish]);

  const move = useCallback((dir: Dir) => {
    const g = gameRef.current;
    const now = clientRef.current?.now() ?? Date.now();
    if (!g || seed === undefined || overRef.current || now < startsAt) return;
    const r = step(g, dir, seed);
    if (!r.moved) return;
    gameRef.current = r.game;
    setGame(r.game);
    if (!canMove(r.game.board)) {
      finish();
      return;
    }
    report();
  }, [seed, startsAt, finish, report]);

  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent): void => {
      const dir = KEYS[e.key];
      if (!dir) return;
      e.preventDefault();
      move(dir);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, move]);

  // A swipe on the board: whichever axis went further, if it went far enough.
  const from = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: PointerEvent): void => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    from.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent): void => {
    const a = from.current;
    from.current = null;
    if (!a) return;
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < MERGE_SWIPE_PX) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  };

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  const start = useCallback(() => {
    clientRef.current?.send({ t: 'start', d: { mode: 'merge', solo } });
  }, [solo]);

  const canStart = room.isHost && enoughToStart(room.connected, [MERGE_MIN_PLAYERS, MERGE_MAX_PLAYERS], solo);

  if (state && state.phase === 'done') {
    const rows = Object.entries(state.boards)
      .sort((a, b) => b[1].score - a[1].score)
      .map(([id, e]) => ({
        id,
        avatar: avatarOf(id),
        name: nameOf(id),
        value: text({
          en: `${e.score} pts · best tile ${bestTile(e.board)}`,
          fr: `${e.score} pts · meilleure tuile ${bestTile(e.board)}`,
        }),
        out: false,
      }));
    return (
      <GameOverScreen
        room={room}
        screen={card.screen}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        note={text({
          en: 'A merge scores the tile it makes.',
          fr: 'Une fusion rapporte la tuile qu’elle crée.',
        })}
        rows={rows}
        me={myId}
        winner={state.winner}
        onAgain={start}
        canAct={canStart}
      />
    );
  }

  if (state) {
    const board = game?.board ?? state.boards[myId ?? '']?.board ?? [];
    const others = Object.entries(state.boards).filter(([id]) => id !== myId);

    return (
      <div class="merge" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={text({ en: `${left} s`, fr: `${left} s` })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
          screen={card.screen}
        />

        {others.length > 0 && (
          <ul class="merge__strip" aria-label={text({ en: 'The other players', fr: 'Les autres joueurs' })}>
            {others.map(([id, e]) => (
              <li key={id} class="merge__rival" title={nameOf(id)}>
                <Thumb board={e.board} />
                <span class="merge__rival-meta">
                  <span aria-hidden="true">{avatarOf(id)}</span>
                  <b>{e.score}</b>
                </span>
              </li>
            ))}
          </ul>
        )}

        <p class="merge__score">
          <b>{game?.score ?? 0}</b> {text({ en: 'points', fr: 'points' })}
        </p>

        <div
          class="merge__board"
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={() => { from.current = null; }}
          role="grid"
          aria-label={text({ en: 'Your board', fr: 'Votre plateau' })}
        >
          {board.map((e, i) => {
            const v = tileValue(e);
            return (
              <div
                key={i}
                role="gridcell"
                class={`merge__tile merge__tile--d${String(v).length}`}
                style={{ background: tileColor(v), color: tileTextColor(v) }}
              >
                {v > 0 ? v : ''}
              </div>
            );
          })}
        </div>

        <div class="merge__pad">
          {ARROWS.map((a) => (
            <button
              key={a.dir}
              type="button"
              class="merge__arrow"
              aria-label={text({ en: a.en, fr: a.fr })}
              disabled={over || countdown > 0}
              onClick={() => move(a.dir)}
            >
              {a.glyph}
            </button>
          ))}
        </div>

        {countdown > 0 && <p class="merge__overlay merge__overlay--count" aria-live="assertive">{countdown}</p>}
        {over && (
          <p class="merge__overlay" aria-live="polite">
            {canMove(board)
              ? text({ en: 'Time. Waiting for the rest.', fr: 'Temps écoulé. On attend les autres.' })
              : text({ en: 'No moves left. Waiting for the rest.', fr: 'Plus de coup. On attend les autres.' })}
          </p>
        )}
        <p class="visually-hidden" aria-live="polite">
          {text({ en: `${game?.score ?? 0} points`, fr: `${game?.score ?? 0} points` })}
        </p>
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
      canStart={canStart}
      startLabel={t.common.startRound}
      onStart={start}
    />
  );
}
