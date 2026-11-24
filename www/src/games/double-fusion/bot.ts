import {
  MERGE_CELLS,
  MERGE_FREEZE_MS,
  MERGE_MALUS_COOLDOWN_MS,
  MERGE_MALUS_FROM,
  MERGE_MALUS_KINDS,
  MERGE_MALUS_STOCK,
  MERGE_SIZE,
  MERGE_STONE_MS,
  type MergeMalus,
  type MergeMalusKind,
} from '../../../../shared/protocol';
import { DIRS, NO_STONE, applyMalus, bestLevel, bigFusions, canMove, slide, step, type Board, type Dir, type Game } from '../../../../shared/merge';

/**
 * The bot an admin's solo aggressive race plays against. Spec: docs/specs/games/double-fusion.md §3.1
 *
 * It lives on the phone only: one move a second on the room's own seed, so it
 * meets the same tiles as the player, and the same maluses — it unlocks them by
 * the same rule, sends them when it can, and takes the ones dropped on it. Pure:
 * the room feeds it time and luck and draws what comes back.
 */

export const BOT_MOVE_MS = 1000;

export type Bot = {
  game: Game;
  stone: number;
  stoneUntil: number;
  frozenUntil: number;
  stock: MergeMalusKind[];
  /** When it may next send a malus (room clock, ms). */
  readyAt: number;
};

export function newBot(start: Board, now: number): Bot {
  return { game: { board: start, score: 0, moves: 0 }, stone: NO_STONE, stoneUntil: 0, frozenUntil: 0, stock: [], readyAt: now };
}

/** How good a board is for a bot that keeps its big tile in a corner and its cells free. */
function value(board: Board): number {
  const empty = board.filter((e) => e === 0).length;
  const top = Math.max(...board);
  const corner = (MERGE_SIZE - 1) * MERGE_SIZE;
  let v = empty * 10 + (board[corner] === top ? 60 : 0) + (board[corner] as number) * 3 + (board[corner + 1] as number) * 2 + (board[corner - MERGE_SIZE] as number);
  // Neighbours that are equal are merges waiting to happen.
  for (let i = 0; i < MERGE_CELLS; i++) {
    const e = board[i] as number;
    if (e > 0 && i % MERGE_SIZE < MERGE_SIZE - 1 && board[i + 1] === e) v += 4;
    if (e > 0 && i + MERGE_SIZE < MERGE_CELLS && board[i + MERGE_SIZE] === e) v += 4;
  }
  return v;
}

/** Its next move: the one that leaves the best board, never "up" while another works. */
export function chooseMove(board: Board, stone = NO_STONE): Dir | null {
  let best: { dir: Dir; v: number } | null = null;
  for (const dir of DIRS) {
    const s = slide(board, dir, stone);
    if (!s.moved) continue;
    const v = value(s.board) + s.gained - (dir === 'up' ? 200 : dir === 'right' ? 40 : 0);
    if (!best || v > best.v) best = { dir, v };
  }
  return best?.dir ?? null;
}

export type Sent = { kind: MergeMalusKind; exp: number; r: number };

/**
 * One second of the bot's round: it moves (unless frozen or stuck), unlocks a
 * malus for each big merge, and sends one if it holds any and may.
 */
export function turn(b: Bot, seed: number, now: number, random: () => number): { bot: Bot; sent: Sent | null } {
  let bot: Bot = b;
  if (bot.stone !== NO_STONE && now >= bot.stoneUntil) bot = { ...bot, stone: NO_STONE };
  if (now >= bot.frozenUntil && canMove(bot.game.board)) {
    const dir = chooseMove(bot.game.board, bot.stone);
    if (dir) {
      const big = bigFusions(bot.game.board, dir, bot.stone);
      const r = step(bot.game, dir, seed, true, bot.stone);
      bot = { ...bot, game: r.game };
      if (big > 0 && bestLevel(r.game.board) >= MERGE_MALUS_FROM) {
        const stock = [...bot.stock];
        for (let n = big; n > 0 && stock.length < MERGE_MALUS_STOCK; n--) {
          stock.push(MERGE_MALUS_KINDS[Math.floor(random() * MERGE_MALUS_KINDS.length)] ?? 'add');
        }
        bot = { ...bot, stock };
      }
    }
  }
  if (bot.stock.length > 0 && now >= bot.readyAt) {
    const [kind, ...rest] = bot.stock as [MergeMalusKind, ...MergeMalusKind[]];
    return {
      bot: { ...bot, stock: rest, readyAt: now + MERGE_MALUS_COOLDOWN_MS },
      sent: { kind, exp: kind === 'add' ? 1 + Math.floor(random() * 3) : 0, r: random() },
    };
  }
  return { bot, sent: null };
}

/** A malus dropped on the bot. Fog means nothing to it. */
export function receive(b: Bot, m: Pick<MergeMalus, 'kind' | 'r' | 'exp'>, now: number): Bot {
  if (m.kind === 'freeze') return { ...b, frozenUntil: Math.max(b.frozenUntil, now + MERGE_FREEZE_MS) };
  if (m.kind === 'fog') return b;
  const res = applyMalus(b.game.board, m, b.stone);
  if (m.kind === 'stone') {
    if (res.cell === NO_STONE || b.stone !== NO_STONE) return b;
    return { ...b, stone: res.cell, stoneUntil: now + MERGE_STONE_MS };
  }
  return res.board === b.game.board ? b : { ...b, game: { ...b.game, board: res.board } };
}
