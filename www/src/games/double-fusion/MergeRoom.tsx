import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  MERGE_MAX_PLAYERS,
  MERGE_MIN_PLAYERS,
  MERGE_BOT_ID,
  MERGE_CRESCENDO_LEVELS,
  MERGE_DEFAULT_TARGET,
  MERGE_MALUS_FROM,
  MERGE_MALUS_STOCK,
  MERGE_TARGET_ENDLESS,
  MERGE_REPORT_MS,
  MERGE_SIZE,
  MERGE_SWIPE_PX,
  type MergeEntry,
  type MergeMalus,
  type MergeOptions,
  type MergeRushState,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import {
  NO_STONE,
  applyMalus,
  bestLevel,
  bestTile,
  bigFusions,
  canMove,
  compareEntries,
  crescendoLevelOn,
  crescendoPuzzle,
  hasWon,
  malusTargets,
  mass,
  normaliseMergeOptions,
  slide,
  step,
  tileValue,
  tilesLeft,
  type Dir,
  type Game,
} from '../../../../shared/merge';
import { useGameRoom } from '../../core/room/useRoom';
import { useLobbyOptions } from '../../core/room/useLobbyOptions';
import { useSoloTesting } from '../../core/useSolo';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { SoundToggle } from '../../core/ui/SoundToggle';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { tileColor, tileTextColor } from './colors';
import { moveTiles, tilesFromBoard, type Tile } from './tiles';
import { formatDuration, timerTone } from './timer';
import { MergeOptionsPanel } from './MergeOptions';
import { modeName, targetLabel } from './modes';
import { MALUS_ICON, MALUS_NAME, MALUS_SHORT, fly } from './malus';
import { CLEAR, afflict, played, stoned, swallow, type Effects } from './effects';
import { BOT_MOVE_MS, newBot, receive as botReceive, turn as botTurn, type Bot } from './bot';
import { CLIMB_START, chimeOn, climb, playChime, prepareChime, setChimeOn } from './chime';
import './double-fusion.css';

/**
 * Double Fusion's room screen. Spec: docs/specs/games/double-fusion.md §4
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

/** How long a slide takes; double-fusion.css's `--slide` is the same number. */
const SLIDE_MS = 110;

const DEFAULT_MERGE_PANEL: MergeOptions = { mode: 'crescendo', target: MERGE_DEFAULT_TARGET, aggressive: false };

/** How long "Level n ✓" holds before the next Crescendo level is dealt. */
const LEVEL_BEAT_MS = 700;

/** What the host's panel shows: a race's settings are kept even in other modes,
 *  so switching back to a race does not forget them. */
function normaliseMergeOptionsForPanel(raw: unknown): MergeOptions {
  const o = normaliseMergeOptions(raw);
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const race = normaliseMergeOptions({ mode: 'race', target: r['target'], aggressive: r['aggressive'] });
  return { mode: o.mode, target: race.target, aggressive: race.aggressive };
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

/** Arrow keys play on a desktop; a phone swipes. */
const KEYS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function MergeRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<MergeRushState | null>(null);
  const [spy, setSpy] = useState<string | null>(null);
  const spyRef = useRef<string | null>(null);
  spyRef.current = spy;

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'double-fusion') setState(msg.d);
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
  const mode = state?.mode ?? 'crescendo';
  const target = state?.target ?? 0;
  const hasBot = state?.bot === true;
  const aggressive = state?.aggressive === true && (!state.solo || hasBot);
  const roundMs = state?.roundMs ?? 0;
  const startBoard = state?.start;

  const [game, setGame] = useState<Game | null>(null);
  const gameRef = useRef<Game | null>(null);
  /** Crescendo: the level being played, from 1; and the beat between two levels. */
  const [level, setLevel] = useState(1);
  const levelRef = useRef(1);
  const [beat, setBeat] = useState<number | null>(null);
  const beatRef = useRef(false);
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
      }, next.some((t) => t.boom) ? 320 : SLIDE_MS + 30);
    }
  }, []);

  /* Aggressive race (spec §3.1): what has landed on this board, and what this
     phone has sent. Times are `performance.now()`. */
  const [stone, setStone] = useState(NO_STONE);
  const stoneRef = useRef(NO_STONE);
  /** What the maluses on this board still do, in moves (effects.ts). */
  const fx = useRef<Effects>(CLEAR);
  const [frozen, setFrozen] = useState(false);
  const [fog, setFog] = useState(false);
  const fallPending = useRef(false);
  const syncFx = (): void => {
    setFrozen(fx.current.frozen > 0);
    setFog(fx.current.fog > 0);
  };
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const fusions = useRef(0);
  const fusionCell = useRef(NO_STONE);
  const seenMalus = useRef(0);
  const seenStock = useRef(0);
  const boardEl = useRef<HTMLDivElement>(null);
  /** The merge note's endless climb (chime.ts), and whether it sounds at all. */
  const climbRef = useRef(CLIMB_START);
  const [sound, setSound] = useState(chimeOn);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  useEffect(() => prepareChime(), []);
  const timers = useRef<number[]>([]);
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);
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
      d: { roundId: id, board: [...g.board], score: g.score, moves: g.moves, over: done, level: levelRef.current, fusions: fusions.current },
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
    let g: Game = mine && mine.moves > 0 ? { board: mine.board, score: mine.score, moves: mine.moves } : { board: startBoard, score: 0, moves: 0 };
    if (state?.mode === 'crescendo' && seed !== undefined) {
      // Back on the level after the last one the referee counted, on its copy of
      // the board if that copy is this level's, else the level as dealt.
      const on = Math.min(MERGE_CRESCENDO_LEVELS, (mine?.level ?? 0) + 1);
      const dealt = crescendoPuzzle(seed, on).board;
      levelRef.current = on;
      setLevel(on);
      g = { board: mine && mass(mine.board) === mass(dealt) ? mine.board : dealt, score: mine?.level ?? 0, moves: mine?.moves ?? 0 };
    }
    gameRef.current = g;
    overRef.current = mine?.over === true;
    // A fresh round: nothing has landed yet, and maluses sent before this phone
    // was here are not replayed.
    fusions.current = 0;
    seenMalus.current = Math.max(0, ...(state?.maluses ?? []).map((m) => m.id));
    seenStock.current = Math.max(0, ...(state?.stock?.[myId] ?? []).map((m) => m.id));
    if (state?.bot) showBot(newBot(startBoard, clientRef.current?.now() ?? Date.now()));
    else {
      botRef.current = null;
      setBotEntry(null);
    }
    stoneRef.current = NO_STONE;
    setStone(NO_STONE);
    fx.current = CLEAR;
    fallPending.current = false;
    setFrozen(false);
    setFog(false);
    setGame(g);
    setOver(overRef.current);
    const built = tilesFromBoard(g.board, nextTileId.current);
    nextTileId.current = built.nextId;
    showTiles(built.tiles);
  }, [roundId, startBoard, playing, myId, state, seed, showTiles]);

  /* The admin's solo test: a local rival, one move a second (bot.ts). Its board is
     the only part React draws; the rest of it lives in a ref. */
  const botRef = useRef<Bot | null>(null);
  const [botEntry, setBotEntry] = useState<MergeEntry | null>(null);
  const showBot = useCallback((b: Bot) => {
    botRef.current = b;
    setBotEntry({ board: [...b.game.board], score: b.game.score, moves: b.game.moves, over: !canMove(b.game.board) });
  }, []);

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


  /** Put a board on screen as dealt: no slide, fresh tiles. Moves keep counting. */
  const deal = useCallback((board: readonly number[], score: number) => {
    const g = gameRef.current;
    const next: Game = { board, score, moves: g?.moves ?? 0 };
    gameRef.current = next;
    setGame(next);
    const built = tilesFromBoard(next.board, nextTileId.current);
    nextTileId.current = built.nextId;
    showTiles(built.tiles);
  }, [showTiles]);

  /** The puzzle back to how it was dealt: Highlander's, or this Crescendo level. */
  const restart = useCallback(() => {
    const g = gameRef.current;
    if (!g || !startBoard || seed === undefined || overRef.current || beatRef.current) return;
    deal(mode === 'crescendo' ? crescendoPuzzle(seed, levelRef.current).board : startBoard, g.score);
    report();
  }, [startBoard, seed, mode, deal, report]);

  /**
   * A Crescendo level down to one tile: told to the room at once, then a beat
   * to see it, then the next level — or, after the last, this phone is done.
   */
  const completeLevel = useCallback(() => {
    const done = levelRef.current;
    if (gameRef.current) gameRef.current = { ...gameRef.current, score: done };
    send(false);
    if (done >= MERGE_CRESCENDO_LEVELS) {
      finish();
      return;
    }
    beatRef.current = true;
    setBeat(done);
    window.setTimeout(() => {
      beatRef.current = false;
      setBeat(null);
      if (overRef.current || seed === undefined) return;
      levelRef.current = done + 1;
      setLevel(done + 1);
      deal(crescendoPuzzle(seed, done + 1).board, done);
      report();
    }, LEVEL_BEAT_MS);
  }, [send, finish, seed, deal, report]);

  const move = useCallback((dir: Dir) => {
    const g = gameRef.current;
    const now = clientRef.current?.now() ?? Date.now();
    if (!g || seed === undefined || overRef.current || now < startsAt || spyRef.current || beatRef.current) return;
    if (fallPending.current) return;
    const held = swallow(fx.current);
    if (held.swallowed) {
      fx.current = held.effects;
      syncFx();
      return;
    }
    // Only a race spawns: Highlander and Crescendo are puzzles.
    const big = aggressive ? bigFusions(g.board, dir, stoneRef.current) : 0;
    const r = step(g, dir, seed, mode === 'race', stoneRef.current);
    if (!r.moved) return;
    gameRef.current = r.game;
    setGame(r.game);
    const moved = moveTiles(tilesRef.current, dir, r.game.board, nextTileId.current, stoneRef.current);
    nextTileId.current = moved.nextId;
    showTiles(moved.tiles);
    const merged = moved.tiles.some((t) => t.born === 'merge');
    climbRef.current = climb(climbRef.current, merged);
    if (merged && soundRef.current) playChime(climbRef.current.step);
    const after = played(fx.current);
    fx.current = after.effects;
    syncFx();
    if (after.crumbled) {
      stoneRef.current = NO_STONE;
      setStone(NO_STONE);
    }
    if (big > 0) {
      fusions.current += big;
      const made = moved.tiles.filter((t) => t.born === 'merge' && t.exp >= MERGE_MALUS_FROM).pop();
      if (made) fusionCell.current = made.r * MERGE_SIZE + made.c;
    }
    if (mode === 'crescendo' && tilesLeft(r.game.board) === 1) {
      completeLevel();
      return;
    }
    // Reaching the goal is sent at once, not on the throttle: in a race the
    // first report to arrive wins. A puzzle never runs out of moves for good —
    // ↺ is always there — so only a race ends on being stuck.
    if (hasWon(mode, target, r.game.board) || (mode === 'race' && !canMove(r.game.board))) {
      finish();
      return;
    }
    // Gravity pulls everything down again once the slide has settled; swipes wait for it.
    if (after.fall) {
      fallPending.current = true;
      later(SLIDE_MS + 40, () => {
        fallPending.current = false;
        const cur = gameRef.current;
        if (!cur || overRef.current) return;
        const fell = slide(cur.board, 'down', stoneRef.current);
        if (!fell.moved) return;
        const tl = moveTiles(tilesRef.current, 'down', fell.board, nextTileId.current, stoneRef.current);
        nextTileId.current = tl.nextId;
        showTiles(tl.tiles);
        gameRef.current = { ...cur, board: fell.board };
        setGame(gameRef.current);
        if (!canMove(fell.board)) finish();
        else report();
      });
    }
    // A big merge goes at once: its malus should not wait for the throttle.
    if (big > 0) send(false);
    else report();
  }, [seed, startsAt, mode, target, aggressive, finish, report, send, showTiles, completeLevel, later]);

  /** A malus reaching this board: its effect, shown, then reported. */
  const land = useCallback((m: MergeMalus) => {
    const g = gameRef.current;
    if (!g || overRef.current) return;
    // Just the icon and its name, for a second.
    setNotice({ id: m.id, text: `${MALUS_ICON[m.kind]} ${text(MALUS_SHORT[m.kind])}` });
    later(1000, () => setNotice((n) => (n?.id === m.id ? null : n)));
    fx.current = afflict(fx.current, m.kind);
    syncFx();
    if (m.kind === 'freeze' || m.kind === 'fog') return;
    const res = applyMalus(g.board, m, stoneRef.current);
    if (m.kind === 'stone') {
      if (res.cell === NO_STONE || stoneRef.current !== NO_STONE) return;
      stoneRef.current = res.cell;
      fx.current = stoned(fx.current);
      setStone(res.cell);
      return;
    }
    if (res.board === g.board) return;
    const at = { r: Math.floor(res.cell / MERGE_SIZE), c: res.cell % MERGE_SIZE };
    let next: Tile[];
    if (m.kind === 'gravity') {
      const moved = moveTiles(tilesRef.current, 'down', res.board, nextTileId.current, stoneRef.current);
      nextTileId.current = moved.nextId;
      next = moved.tiles;
    } else if (m.kind === 'swap') {
      const cells = res.board.flatMap((e, i) => (e !== g.board[i] ? [i] : []));
      const [a, b] = cells as [number, number];
      const pos = (cell: number) => ({ r: Math.floor(cell / MERGE_SIZE), c: cell % MERGE_SIZE });
      next = tilesRef.current
        .filter((t) => !t.gone)
        .map((t) => {
          const cell = t.r * MERGE_SIZE + t.c;
          // The two tiles travel: each keeps its number and takes the other's place.
          if (cell === a) return { ...t, ...pos(b) };
          if (cell === b) return { ...t, ...pos(a) };
          return t;
        });
    } else if (m.kind === 'explode') {
      next = tilesRef.current.filter((t) => !t.gone).map((t) => (t.r === at.r && t.c === at.c ? { ...t, gone: true, boom: true } : t));
    } else {
      next = [...tilesRef.current.filter((t) => !t.gone), { id: nextTileId.current++, exp: res.board[res.cell] as number, ...at, born: 'spawn' }];
    }
    showTiles(next);
    const after: Game = { ...g, board: res.board };
    gameRef.current = after;
    setGame(after);
    if (!canMove(after.board)) finish();
    else report();
  }, [text, later, showTiles, finish, report]);

  const thumb = (id: string): Element | null => document.querySelector(`[data-rival="${CSS.escape(id)}"] .merge__thumb`);
  const cellEl = (cell: number): Element | null => boardEl.current?.querySelectorAll('.merge__cell')[cell] ?? boardEl.current ?? null;

  // A malus just unlocked flies from the tile whose merge earned it to its slot.
  const myStock = (myId !== undefined ? state?.stock?.[myId] : undefined) ?? [];
  const stockKey = myStock.map((m) => m.id).join();
  useEffect(() => {
    const fresh = myStock.filter((m) => m.id > seenStock.current);
    seenStock.current = Math.max(seenStock.current, ...myStock.map((m) => m.id));
    for (const m of fresh) fly(cellEl(fusionCell.current), document.querySelector(`[data-slot="${m.id}"]`), MALUS_ICON[m.kind], () => undefined);
  }, [stockKey]);

  // Maluses the referee has sent since this phone last looked: the ones aimed
  // at it fly from their sender's thumbnail to where they land.
  const maluses = state?.maluses;
  useEffect(() => {
    if (!maluses || builtFor.current !== roundId || myId === undefined) return;
    for (const m of maluses) {
      if (m.id <= seenMalus.current) continue;
      seenMalus.current = m.id;
      if (m.to === myId) {
        const g = gameRef.current;
        const aim = g ? applyMalus(g.board, m, stoneRef.current).cell : NO_STONE;
        fly(thumb(m.from), aim === NO_STONE ? boardEl.current : cellEl(aim), MALUS_ICON[m.kind], () => land(m));
      } else if (m.to === MERGE_BOT_ID && botRef.current) {
        fly(boardEl.current, thumb(MERGE_BOT_ID), MALUS_ICON[m.kind], () => {
          if (botRef.current) showBot(botReceive(botRef.current, m));
        });
      }
    }
  }, [maluses, roundId, myId, land, showBot]);

  // The bot's second: it moves, and may send a malus, which flies from its
  // thumbnail to this board like a rival's.
  const botSeq = useRef(0);
  // Read through a ref: `land` is a new function on most renders, and an interval
  // that restarted with it would never reach its second.
  const landRef = useRef(land);
  landRef.current = land;
  useEffect(() => {
    if (!playing || !hasBot || seed === undefined || myId === undefined) return;
    const id = window.setInterval(() => {
      const at = clientRef.current?.now() ?? Date.now();
      if (at < startsAt || !botRef.current || overRef.current) return;
      const r = botTurn(botRef.current, seed, at, Math.random);
      showBot(r.bot);
      if (r.sent) {
        const m: MergeMalus = { id: -(++botSeq.current), kind: r.sent.kind, from: MERGE_BOT_ID, to: myId, r: r.sent.r, exp: r.sent.exp };
        const g = gameRef.current;
        const aim = g ? applyMalus(g.board, m, stoneRef.current).cell : NO_STONE;
        fly(thumb(MERGE_BOT_ID), aim === NO_STONE ? boardEl.current : cellEl(aim), MALUS_ICON[m.kind], () => landRef.current(m));
      }
    }, BOT_MOVE_MS);
    return () => window.clearInterval(id);
  }, [playing, hasBot, seed, myId, startsAt, showBot]);

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

  // Dragging an unlocked malus: a copy of its icon follows the finger, and
  // letting go over a rival's thumbnail sends it — if that rival can take it.
  const [held, setHeld] = useState<{ id: number; over: string | null } | null>(null);
  const ghost = useRef<HTMLElement | null>(null);
  const rivalAt = (x: number, y: number): string | null =>
    (document.elementFromPoint(x, y)?.closest('[data-rival]') as HTMLElement | null)?.dataset['rival'] ?? null;
  const grab = (e: PointerEvent, id: number, icon: string): void => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const g = document.createElement('span');
    g.className = 'merge__ghost';
    g.textContent = icon;
    g.style.left = `${e.clientX}px`;
    g.style.top = `${e.clientY}px`;
    document.body.appendChild(g);
    ghost.current = g;
    setHeld({ id, over: null });
  };
  const drag = (e: PointerEvent): void => {
    if (!ghost.current || !held) return;
    ghost.current.style.left = `${e.clientX}px`;
    ghost.current.style.top = `${e.clientY}px`;
    const over = rivalAt(e.clientX, e.clientY);
    if (over !== held.over) setHeld({ id: held.id, over });
  };
  const drop = (e: PointerEvent | null, allowed: readonly string[]): void => {
    const g = ghost.current;
    ghost.current = null;
    const to = e ? rivalAt(e.clientX, e.clientY) : null;
    const id = held?.id;
    setHeld(null);
    if (!g) return;
    if (to && id !== undefined && allowed.includes(to) && roundRef.current !== undefined) {
      clientRef.current?.send({ t: 'merge-malus', d: { roundId: roundRef.current, id, to } });
      g.animate([{ scale: '1', opacity: 1 }, { scale: '0.2', opacity: 0 }], { duration: 220, easing: 'ease-in' }).onfinish = () => g.remove();
    } else {
      g.remove();
    }
  };
  useEffect(() => () => ghost.current?.remove(), []);

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string =>
    id === MERGE_BOT_ID ? 'Bot' : (players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' }));
  const avatarOf = (id: string): string => (id === MERGE_BOT_ID ? '🤖' : (players.find((p) => p.id === id)?.avatar ?? '🙂'));

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
    // The level they are on, as their own screen says, not the ones they have finished.
    const on = crescendoLevelOn(e.level ?? 0);
    return { en: `Lvl ${on}`, fr: `Niv. ${on}` };
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
            state.mode === 'crescendo'
              ? (e.level ?? 0) > 0 && e.levelMs !== undefined
                ? {
                    en: `${e.level} ${e.level === 1 ? 'level' : 'levels'} · ${formatDuration(e.levelMs)}`,
                    fr: `${e.level} ${e.level === 1 ? 'niveau' : 'niveaux'} · ${formatDuration(e.levelMs)}`,
                  }
                : { en: '0 levels', fr: '0 niveau' }
              : state.mode === 'highlander'
              ? e.solvedMs !== undefined
                ? { en: formatDuration(e.solvedMs), fr: formatDuration(e.solvedMs) }
                : { en: `${left} ${left === 1 ? 'tile' : 'tiles'} left`, fr: `${left} ${left === 1 ? 'tuile restante' : 'tuiles restantes'}` }
              : { en: `${e.score} pts · lvl ${bestLevel(e.board)}`, fr: `${e.score} pts · niv. ${bestLevel(e.board)}` },
          ),
          out: false,
        };
      });
    const note =
      state.mode === 'crescendo'
        ? {
            en: `${MERGE_CRESCENDO_LEVELS} levels, a tile more every two. Most levels wins, then whoever got there first.`,
            fr: `${MERGE_CRESCENDO_LEVELS} niveaux, une tuile de plus tous les deux. Le plus de niveaux gagne, puis le premier arrivé.`,
          }
        : state.mode === 'highlander'
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
    const others: [string, MergeEntry][] = [
      ...Object.entries(state.boards).filter(([id]) => id !== myId),
      ...(hasBot && botEntry ? ([[MERGE_BOT_ID, botEntry]] as [string, MergeEntry][]) : []),
    ];
    const watched = spy === MERGE_BOT_ID ? (botEntry ?? undefined) : spy ? state.boards[spy] : undefined;
    const mm = `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, '0')}`;
    const clockText = roundMs > 0 ? `${clock} s` : mm;
    const solvedOrWon = hasWon(mode, target, board);
    // Who an unlocked malus can go to now, and how long before the next may go.
    const stillPlaying = [...Object.entries(state.boards).filter(([, e]) => !e.over).map(([id]) => id), ...(hasBot ? [MERGE_BOT_ID] : [])];
    const targets = myId !== undefined ? malusTargets(stillPlaying, myId, state.lastTarget ?? null) : [];
    const now = clientRef.current?.now() ?? Date.now();
    const cooling = Math.max(0, Math.ceil(((state.readyAt?.[myId ?? ''] ?? 0) - now) / 1000));

    return (
      <div class="merge" data-tone={roundMs > 0 ? timerTone(clock) : 'calm'} style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={mode === 'crescendo' ? undefined : text({ en: clockText, fr: clockText })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
          screen={card.screen}
        >
          <SoundToggle
            on={sound}
            onChange={(on) => {
              setSound(on);
              setChimeOn(on);
            }}
            heading={text({ en: 'Sound', fr: 'Son' })}
            onLabel={text({ en: 'Sound effects', fr: 'Effets sonores' })}
            offLabel={text({ en: 'Silent', fr: 'Silencieux' })}
            className="merge__sound"
            activeClassName="merge__sound--on"
          />
        </StatusBar>

        <div class="merge__head">
        {mode !== 'race' && (
          <button
            type="button"
            class="merge__restart"
            aria-label={text({ en: 'Start the puzzle again', fr: 'Recommencer le puzzle' })}
            disabled={over || countdown > 0 || beat !== null}
            onClick={restart}
          >
            ↺
          </button>
        )}
        <p class="merge__score">
          {mode === 'crescendo' ? (
            <>
              {text({ en: 'Level', fr: 'Niveau' })} <b>{level}</b>/{MERGE_CRESCENDO_LEVELS}
            </>
          ) : mode === 'highlander' ? (
            <>
              <b>{tilesLeft(board)}</b> {tilesLeft(board) === 1 ? text({ en: 'tile left', fr: 'tuile restante' }) : text({ en: 'tiles left', fr: 'tuiles restantes' })}
            </>
          ) : (
            <>
              <b>{bestTile(board)}</b> / {targetLabel(target)}
              {aggressive && ' 😈'}
            </>
          )}
        </p>
        {mode !== 'race' && (
          <p class="merge__goal">
            {text(modeName(mode, target))}
            {mode === 'crescendo' && ` · ${tilesLeft(board)} ${text({ en: 'tiles', fr: 'tuiles' })}`}
          </p>
        )}
        </div>

        <div
          ref={boardEl}
          class={`merge__board${fog ? ' merge__board--fog' : ''}${frozen ? ' merge__board--frozen' : ''}${countdown > 0 ? ' merge__board--wait' : ''}`}
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
                  class={`merge__tile merge__tile--d${String(v).length}${t.born ? ` merge__tile--${t.born}` : ''}${t.gone ? ' merge__tile--gone' : ''}${t.boom ? ' merge__tile--boom' : ''}`}
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
            {stone !== NO_STONE && (
              <div
                class="merge__stone"
                style={{ '--r': Math.floor(stone / MERGE_SIZE), '--c': stone % MERGE_SIZE } as JSX.CSSProperties}
                aria-label={text({ en: 'Stone', fr: 'Pierre' })}
              >
                🪨
              </div>
            )}
          </div>
        </div>

        {aggressive && (
          <div class="merge__tray">
            <div class="merge__slots">
              {Array.from({ length: MERGE_MALUS_STOCK }, (_, i) => {
                const m = myStock[i];
                if (!m) return <span key={`empty-${i}`} class="merge__slot merge__slot--empty" aria-hidden="true" />;
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-slot={m.id}
                    class={`merge__slot${cooling > 0 ? ' merge__slot--cooling' : ''}${held?.id === m.id ? ' merge__slot--held' : ''}`}
                    aria-label={text(MALUS_NAME[m.kind])}
                    onPointerDown={(e) => {
                      if (cooling === 0 && targets.length > 0) grab(e, m.id, MALUS_ICON[m.kind]);
                    }}
                    onPointerMove={drag}
                    onPointerUp={(e) => drop(e, targets)}
                    onPointerCancel={() => drop(null, targets)}
                  >
                    <span class="merge__slot-icon" aria-hidden="true">{MALUS_ICON[m.kind]}</span>
                    {text(MALUS_SHORT[m.kind])}
                  </button>
                );
              })}
            </div>
            <p class="merge__tray-hint">
              {myStock.length === 0
                ? text({ en: 'Merge into 64 or more to unlock a malus', fr: 'Fusionnez en 64 ou plus pour débloquer un malus' })
                : cooling > 0
                  ? text({ en: `Next malus in ${cooling} s`, fr: `Prochain malus dans ${cooling} s` })
                  : text({ en: 'Drag a malus onto a rival', fr: 'Glissez un malus sur un adversaire' })}
            </p>
          </div>
        )}

        {others.length > 0 && (
          <ul class="merge__strip" aria-label={text({ en: 'The other players', fr: 'Les autres joueurs' })}>
            {others.map(([id, e]) => (
              <li key={id}>
                <button
                  type="button"
                  data-rival={id}
                  class={`merge__rival${held ? (targets.includes(id) ? ` merge__rival--target${held.over === id ? ' merge__rival--hover' : ''}` : ' merge__rival--blocked') : ''}`}
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
        {notice && (
          <p key={notice.id} class="merge__notice" aria-live="assertive">
            {notice.text}
          </p>
        )}
        {beat !== null && (
          <p class="merge__overlay merge__overlay--level" aria-live="assertive">
            {text({ en: `Level ${beat} ✓`, fr: `Niveau ${beat} ✓` })}
          </p>
        )}
        {over && (
          <p class="merge__overlay" aria-live="polite">
            {mode === 'crescendo' && (state.boards[myId ?? '']?.level ?? 0) >= MERGE_CRESCENDO_LEVELS
              ? text({ en: `All ${MERGE_CRESCENDO_LEVELS} levels!`, fr: `Les ${MERGE_CRESCENDO_LEVELS} niveaux !` })
              : solvedOrWon
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
          {mode === 'crescendo'
            ? text({ en: `Level ${level} of ${MERGE_CRESCENDO_LEVELS}`, fr: `Niveau ${level} sur ${MERGE_CRESCENDO_LEVELS}` })
            : mode === 'highlander'
            ? text({ en: `${tilesLeft(board)} tiles left`, fr: `${tilesLeft(board)} tuiles restantes` })
            : text({ en: `Best tile ${bestTile(board)} of ${targetLabel(target)}`, fr: `Meilleure tuile ${bestTile(board)} sur ${targetLabel(target)}` })}
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
