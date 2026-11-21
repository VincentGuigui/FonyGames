import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  MERGE_MAX_PLAYERS,
  MERGE_MIN_PLAYERS,
  MERGE_DEFAULT_TARGET,
  MERGE_TARGET_ENDLESS,
  MERGE_REPORT_MS,
  MERGE_SIZE,
  MERGE_SWIPE_PX,
  type MergeEntry,
  type MergeOptions,
  type MergeRushState,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { bestLevel, bestTile, canMove, compareEntries, hasWon, normaliseMergeOptions, step, tileValue, tilesLeft, type Dir, type Game } from '../../../../shared/merge';
import { useGameRoom } from '../../core/room/useRoom';
import { useLobbyOptions } from '../../core/room/useLobbyOptions';
import { useSoloTesting } from '../../core/useSolo';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { tileColor, tileTextColor } from './colors';
import { moveTiles, tilesFromBoard, type Tile } from './tiles';
import { formatDuration, timerTone } from './timer';
import { MergeOptionsPanel } from './MergeOptions';
import { modeName, targetLabel } from './modes';
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

/** How long a slide takes; merge-rush.css's `--slide` is the same number. */
const SLIDE_MS = 110;

const DEFAULT_MERGE_PANEL: MergeOptions = { mode: 'time-attack', target: MERGE_DEFAULT_TARGET };

/** What the host's panel shows: a race's target is kept even in other modes, so
 *  switching back to a race does not forget it. */
function normaliseMergeOptionsForPanel(raw: unknown): MergeOptions {
  const o = normaliseMergeOptions(raw);
  const target = typeof raw === 'object' && raw !== null ? normaliseMergeOptions({ mode: 'race', target: (raw as Record<string, unknown>)['target'] }).target : DEFAULT_MERGE_PANEL.target;
  return { mode: o.mode, target };
}

/** Another player's board, full size and live, while you watch it (spec §4). */
function Spy({ board }: { board: readonly number[] }): JSX.Element {
  return (
    <div class="merge__spy-board">
      {board.map((e, i) => {
        const v = tileValue(e);
        return (
          <div key={i} class={`merge__spy-cell merge__tile--d${String(v).length}`} style={{ background: tileColor(v), color: tileTextColor(v) }}>
            {v > 0 ? v : ''}
          </div>
        );
      })}
    </div>
  );
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
  const [spy, setSpy] = useState<string | null>(null);
  const spyRef = useRef<string | null>(null);
  spyRef.current = spy;

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'merge-rush') setState(msg.d);
  }, []);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const clientRef = useRef(room.client);
  clientRef.current = room.client;
  const myId = room.me?.id;
  const [options, setOptions] = useLobbyOptions<MergeOptions>(room, normaliseMergeOptionsForPanel, DEFAULT_MERGE_PANEL);

  const roundId = state?.roundId;
  const seed = state?.seed;
  const startsAt = state?.startsAt ?? 0;
  const playing = state?.phase === 'playing';
  const mode = state?.mode ?? 'time-attack';
  const target = state?.target ?? 0;
  const roundMs = state?.roundMs ?? 0;
  const startBoard = state?.start;

  const [game, setGame] = useState<Game | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const tilesRef = useRef<Tile[]>([]);
  const nextTileId = useRef(1);
  const clearGone = useRef<number | undefined>(undefined);

  /** Show a new set of tiles; the ones that merged away are dropped once they land. */
  const showTiles = useCallback((next: Tile[]) => {
    tilesRef.current = next;
    setTiles(next);
    window.clearTimeout(clearGone.current);
    if (next.some((t) => t.gone)) {
      clearGone.current = window.setTimeout(() => {
        tilesRef.current = tilesRef.current.filter((t) => !t.gone);
        setTiles(tilesRef.current);
      }, SLIDE_MS + 30);
    }
  }, []);
  const [over, setOver] = useState(false);
  const overRef = useRef(false);
  /** Seconds left on a countdown; seconds gone in a race, which counts up. */
  const [clock, setClock] = useState(0);
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

  // The board for a round, built once from the room's starting board. A phone that
  // comes back mid-round resumes from the referee's copy: every spawn is a function
  // of the seed and the move count, so the next one lands exactly where it would have.
  const builtFor = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (roundId === undefined || startBoard === undefined || !playing || myId === undefined) return;
    if (builtFor.current === roundId) return;
    builtFor.current = roundId;
    const mine = state?.boards[myId];
    const g: Game = mine && mine.moves > 0 ? { board: mine.board, score: mine.score, moves: mine.moves } : { board: startBoard, score: 0, moves: 0 };
    gameRef.current = g;
    overRef.current = mine?.over === true;
    setGame(g);
    setOver(overRef.current);
    const built = tilesFromBoard(g.board, nextTileId.current);
    nextTileId.current = built.nextId;
    showTiles(built.tiles);
  }, [roundId, startBoard, playing, myId, state, showTiles]);

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
      if (roundMs > 0) {
        setClock(Math.max(0, Math.ceil((roundMs - Math.max(0, into)) / 1000)));
        if (into >= roundMs) finish();
      } else {
        setClock(Math.max(0, Math.floor(into / 1000)));
      }
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [playing, startsAt, roundMs, finish]);

  const move = useCallback((dir: Dir) => {
    const g = gameRef.current;
    const now = clientRef.current?.now() ?? Date.now();
    if (!g || seed === undefined || overRef.current || now < startsAt || spyRef.current) return;
    const r = step(g, dir, seed, mode !== 'highlander');
    if (!r.moved) return;
    gameRef.current = r.game;
    setGame(r.game);
    const moved = moveTiles(tilesRef.current, dir, r.game.board, nextTileId.current);
    nextTileId.current = moved.nextId;
    showTiles(moved.tiles);
    // Reaching the goal is sent at once, not on the throttle: in a race the
    // first report to arrive wins.
    if (hasWon(mode, target, r.game.board) || !canMove(r.game.board)) {
      finish();
      return;
    }
    report();
  }, [seed, startsAt, mode, target, finish, report, showTiles]);

  /** Highlander only: the puzzle back to its start. Moves keep counting. */
  const restart = useCallback(() => {
    const g = gameRef.current;
    if (!g || !startBoard || overRef.current) return;
    const next: Game = { board: startBoard, score: g.score, moves: g.moves };
    gameRef.current = next;
    setGame(next);
    const built = tilesFromBoard(next.board, nextTileId.current);
    nextTileId.current = built.nextId;
    showTiles(built.tiles);
    report();
  }, [startBoard, showTiles, report]);

  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent): void => {
      if (spyRef.current) {
        if (e.key === 'Escape' || KEYS[e.key]) e.preventDefault();
        if (e.key === 'Escape') setSpy(null);
        return;
      }
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
    clientRef.current?.send({ t: 'start', d: { mode: 'merge', solo, merge: { ...options } } });
  }, [solo, options]);

  const canStart = room.isHost && enoughToStart(room.connected, [MERGE_MIN_PLAYERS, MERGE_MAX_PLAYERS], solo);

  /** The number beside a player in the strip and on the results: what the mode is won on. */
  const standing = (e: MergeEntry, m: typeof mode): { en: string; fr: string } => {
    if (m === 'highlander') {
      const left = tilesLeft(e.board);
      return { en: `${left} ${left === 1 ? 'tile' : 'tiles'}`, fr: `${left} ${left === 1 ? 'tuile' : 'tuiles'}` };
    }
    if (m === 'race') return { en: String(bestTile(e.board)), fr: String(bestTile(e.board)) };
    return { en: String(e.score), fr: String(e.score) };
  };

  if (state && state.phase === 'done') {
    const ahead = compareEntries(state.mode);
    const rows = Object.entries(state.boards)
      .sort((a, b) => (a[0] === state.winner ? -1 : b[0] === state.winner ? 1 : ahead(a[1], b[1])))
      .map(([id, e]) => {
        const left = tilesLeft(e.board);
        return {
          id,
          avatar: avatarOf(id),
          name: nameOf(id),
          // Whoever solved it is shown their time; a solved board is always one tile,
          // so the count is only worth printing for a player who did not finish.
          value: text(
            state.mode === 'highlander'
              ? e.solvedMs !== undefined
                ? { en: formatDuration(e.solvedMs), fr: formatDuration(e.solvedMs) }
                : { en: `${left} ${left === 1 ? 'tile' : 'tiles'} left`, fr: `${left} ${left === 1 ? 'tuile restante' : 'tuiles restantes'}` }
              : { en: `${e.score} pts · lvl ${bestLevel(e.board)}`, fr: `${e.score} pts · niv. ${bestLevel(e.board)}` },
          ),
          out: false,
        };
      });
    const note =
      state.mode === 'highlander'
        ? {
            en: 'First down to one tile wins; otherwise the fewest tiles left. The time counts every restart.',
            fr: 'Le premier à une seule tuile gagne ; sinon, le moins de tuiles restantes. Le temps compte chaque recommencement.',
          }
        : state.mode === 'race'
          ? state.target === MERGE_TARGET_ENDLESS
            ? {
                en: 'No finish line: the biggest tile when everyone is stuck wins. Level n is the 2ⁿ tile.',
                fr: 'Pas de ligne d’arrivée : la plus grosse tuile quand tout le monde est bloqué gagne. Niveau n = la tuile 2ⁿ.',
              }
            : {
                en: `First to make ${targetLabel(state.target)} wins. Level n is the 2ⁿ tile.`,
                fr: `Le premier à faire ${targetLabel(state.target)} gagne. Niveau n = la tuile 2ⁿ.`,
              }
          : { en: 'A merge scores the tile it makes. Level n is the 2ⁿ tile.', fr: 'Une fusion rapporte la tuile qu’elle crée. Niveau n = la tuile 2ⁿ.' };
    return (
      <GameOverScreen
        room={room}
        screen={card.screen}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        status={text(modeName(state.mode, state.target))}
        headline={state.solo ? text({ en: 'Well played!', fr: 'Bravo !' }) : undefined}
        note={text(note)}
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
    const watched = spy ? state.boards[spy] : undefined;
    const mm = `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, '0')}`;
    const clockText = roundMs > 0 ? `${clock} s` : mm;
    const solvedOrWon = hasWon(mode, target, board);

    return (
      <div class="merge" data-tone={roundMs > 0 ? timerTone(clock) : 'calm'} style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={text({ en: clockText, fr: clockText })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
          screen={card.screen}
        />

        <p class="merge__score">
          {mode === 'highlander' ? (
            <>
              <b>{tilesLeft(board)}</b> {tilesLeft(board) === 1 ? text({ en: 'tile left', fr: 'tuile restante' }) : text({ en: 'tiles left', fr: 'tuiles restantes' })}
            </>
          ) : (
            <>
              <b>{game?.score ?? 0}</b> {text({ en: 'points', fr: 'points' })}
            </>
          )}
        </p>
        <p class="merge__goal">
          {text(modeName(mode, target))}
          {mode === 'race' && ` · ${text({ en: 'best', fr: 'record' })} ${bestTile(board)}`}
        </p>

        <div
          class="merge__board"
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={() => { from.current = null; }}
          role="group"
          aria-label={text({ en: 'Your board', fr: 'Votre plateau' })}
        >
          {Array.from({ length: MERGE_SIZE * MERGE_SIZE }, (_, i) => (
            <div key={i} class="merge__cell" />
          ))}
          <div class="merge__tiles">
            {tiles.map((t) => {
              const v = tileValue(t.exp);
              return (
                <div
                  key={t.id}
                  class={`merge__tile merge__tile--d${String(v).length}${t.born ? ` merge__tile--${t.born}` : ''}${t.gone ? ' merge__tile--gone' : ''}`}
                  style={
                    {
                      '--r': t.r,
                      '--c': t.c,
                      background: tileColor(v),
                      color: tileTextColor(v),
                      // A merged tile starts as the colour of the pair it came from and
                      // settles into its own.
                      ...(t.born === 'merge' ? { '--from': tileColor(v / 2), '--from-text': tileTextColor(v / 2) } : {}),
                    } as JSX.CSSProperties
                  }
                  aria-label={t.gone ? undefined : String(v)}
                >
                  {v}
                </div>
              );
            })}
          </div>
        </div>

        <div class={`merge__pad${mode === 'highlander' ? ' merge__pad--restart' : ''}`}>
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
          {mode === 'highlander' && (
            <button
              type="button"
              class="merge__arrow merge__restart"
              aria-label={text({ en: 'Start the puzzle again', fr: 'Recommencer le puzzle' })}
              disabled={over || countdown > 0}
              onClick={restart}
            >
              ↺
            </button>
          )}
        </div>

        {others.length > 0 && (
          <ul class="merge__strip" aria-label={text({ en: 'The other players', fr: 'Les autres joueurs' })}>
            {others.map(([id, e]) => (
              <li key={id}>
                <button
                  type="button"
                  class="merge__rival"
                  aria-label={text({ en: `Watch ${nameOf(id)}’s board`, fr: `Voir le plateau de ${nameOf(id)}` })}
                  onClick={() => setSpy(id)}
                >
                  <span class="merge__rival-avatar" aria-hidden="true">{avatarOf(id)}</span>
                  <b class="merge__rival-score">{text(standing(e, mode))}</b>
                  <Thumb board={e.board} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {countdown > 0 && <p class="merge__overlay merge__overlay--count" aria-live="assertive">{countdown}</p>}
        {over && (
          <p class="merge__overlay" aria-live="polite">
            {solvedOrWon
              ? mode === 'highlander'
                ? text({ en: 'Solved!', fr: 'Résolu !' })
                : text({ en: `You made ${targetLabel(target)}!`, fr: `Vous avez fait ${targetLabel(target)} !` })
              : canMove(board)
                ? text({ en: 'Time. Waiting for the rest.', fr: 'Temps écoulé. On attend les autres.' })
                : text({ en: 'No moves left. Waiting for the rest.', fr: 'Plus de coup. On attend les autres.' })}
          </p>
        )}

        {spy && watched && (
          <div
            class="merge__spy"
            role="dialog"
            aria-label={text({ en: `${nameOf(spy)}’s board`, fr: `Plateau de ${nameOf(spy)}` })}
            onClick={() => setSpy(null)}
          >
            <p class="merge__spy-who">
              <span aria-hidden="true">{avatarOf(spy)}</span> {nameOf(spy)} · <b>{text(standing(watched, mode))}</b>
            </p>
            <Spy board={watched.board} />
            <p class="merge__spy-hint">{text({ en: 'Tap anywhere to close', fr: 'Touchez n’importe où pour fermer' })}</p>
          </div>
        )}

        <p class="visually-hidden" aria-live="polite">
          {mode === 'highlander'
            ? text({ en: `${tilesLeft(board)} tiles left`, fr: `${tilesLeft(board)} tuiles restantes` })
            : text({ en: `${game?.score ?? 0} points`, fr: `${game?.score ?? 0} points` })}
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
      extras={<MergeOptionsPanel value={options} onChange={setOptions} editable={room.isHost} />}
    />
  );
}
