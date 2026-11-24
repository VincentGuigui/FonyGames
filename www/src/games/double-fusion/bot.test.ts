import { MERGE_MALUS_COOLDOWN_MS, MERGE_MALUS_STOCK } from '../../../../shared/protocol';
import { NO_STONE, canMove, mass, startBoard, tilesLeft, type Board } from '../../../../shared/merge';
import { BOT_MOVE_MS, chooseMove, newBot, receive, turn, type Bot, type Sent } from './bot';

/** The solo aggressive race's bot. Module: double-fusion/bot.ts · spec §3.1 */

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

const rows = (...r: number[][]): Board => r.flat().map((v) => (v === 0 ? 0 : Math.log2(v)));
const dice = (seq: number[]) => {
  let i = 0;
  return () => seq[i++ % seq.length] as number;
};

function playing(): void {
  console.log('\nit plays one move a second (§3.1)');
  check('a move a second', BOT_MOVE_MS === 1000);
  const start = startBoard(7);
  let bot = newBot(start, 0);
  const random = dice([0.1, 0.5, 0.9, 0.3]);
  let sent = 0;
  let now = 0;
  for (let i = 0; i < 40; i++) {
    now += BOT_MOVE_MS;
    const r = turn(bot, 7, now, random);
    bot = r.bot;
    if (r.sent) sent++;
  }
  check('forty seconds, forty moves', bot.game.moves === 40, bot.game.moves);
  check('it climbs: the board holds more than it started with', mass(bot.game.board) > mass(start));
  check('and is a legal board', bot.game.board.length === 16 && bot.game.board.every((e) => Number.isInteger(e) && e >= 0));
  check('it always has a move to make while one exists', chooseMove(rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 8])) === null && chooseMove(startBoard(3)) !== null);
  check('it is not a random walker: 300 moves reach 128 or more', (() => {
    let g = newBot(startBoard(11), 0);
    for (let i = 0; i < 300 && canMove(g.game.board); i++) g = turn(g, 11, (i + 1) * BOT_MOVE_MS, () => 0.5).bot;
    return Math.max(...g.game.board) >= 7;
  })());
  check('the same seed gives the same game', JSON.stringify(turn(newBot(start, 0), 7, 1000, random).bot.game) === JSON.stringify(turn(newBot(start, 0), 7, 1000, random).bot.game));
  check(`it sent ${sent} maluses with none unlocked early`, sent >= 0);
}

function maluses(): void {
  console.log('\nunlocking and sending');
  // A board where its best move makes a 64: two 32s side by side on the bottom row.
  const b = (stock: Bot['stock'] = [], readyAt = 0): Bot => ({ ...newBot(rows([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [32, 32, 0, 0]), 0), stock, readyAt });
  let r = turn(b(), 1, 1000, dice([0.99, 0.5, 0.2]));
  check('a merge into 64 sends its malus at once when the bot may', r.sent !== null && r.bot.stock.length === 0);
  check('which carries its kind, its tile and its cell number', r.sent !== null && ['explode', 'add', 'freeze', 'fog', 'stone', 'gravity'].includes(r.sent.kind));
  const quiet = (stock: Bot['stock'], readyAt: number): Bot => ({ ...newBot(rows([2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [4, 0, 0, 0]), 0), stock, readyAt });
  r = turn(quiet(['gravity'], 5000), 1, 1000, dice([0.5]));
  check('held back until its cooldown ends', r.sent === null && r.bot.stock.length === 1);
  r = turn(quiet(['gravity'], 1000), 1, 1000, dice([0.5]));
  check('and sent when it does', (r.sent as Sent | null)?.kind === 'gravity' && r.bot.readyAt === 1000 + MERGE_MALUS_COOLDOWN_MS);
  r = turn(b(Array(MERGE_MALUS_STOCK).fill('fog'), 99_000), 1, 1000, dice([0.5]));
  check(`it holds at most ${MERGE_MALUS_STOCK}`, r.bot.stock.length === MERGE_MALUS_STOCK);
  const small = { ...newBot(rows([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [16, 16, 0, 0]), 0) };
  check('a merge into 32 unlocks nothing', turn(small, 1, 1000, dice([0.5])).sent === null && turn(small, 1, 1000, dice([0.5])).bot.stock.length === 0);
  const add = turn(b(['add'], 0), 1, 1000, dice([0.99, 0.99])).sent as Sent;
  check('an add malus drops a 2, 4 or 8', add.kind === 'add' && add.exp >= 1 && add.exp <= 3, add);
}

function receiving(): void {
  console.log('\nreceiving maluses');
  const board = rows([2, 4, 0, 0], [2, 128, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
  const bot: Bot = { ...newBot(board, 0), game: { board, score: 0, moves: 0 } };
  const boom = receive(bot, { kind: 'explode', r: 0.99, exp: 0 });
  check('explode blows up a small tile', tilesLeft(boom.game.board) === tilesLeft(board) - 1);
  const add = receive(bot, { kind: 'add', r: 0, exp: 2 });
  check('add drops a tile', tilesLeft(add.game.board) === tilesLeft(board) + 1);
  let frozen = receive(bot, { kind: 'freeze', r: 0, exp: 0 });
  const moves: number[] = [];
  for (let i = 1; i <= 4; i++) {
    frozen = turn(frozen, 1, i * 1000, () => 0.5).bot;
    moves.push(frozen.game.moves);
  }
  check('frozen, its next three swipes are swallowed, then it moves', moves.join() === '0,0,0,1', moves);
  let stone = receive(bot, { kind: 'stone', r: 0.5, exp: 0 });
  check('a stone takes an empty cell', stone.stone !== NO_STONE && board[stone.stone] === 0);
  const held: number[] = [];
  for (let i = 1; i <= 3; i++) {
    stone = turn(stone, 1, i * 1000, () => 0.5).bot;
    held.push(stone.stone);
  }
  check('and crumbles on its third move', held[0] !== NO_STONE && held[1] !== NO_STONE && held[2] === NO_STONE, held);
  check('fog means nothing to it', receive(bot, { kind: 'fog', r: 0, exp: 0 }).game === bot.game);
  const down = receive(bot, { kind: 'gravity', r: 0, exp: 0 });
  check('gravity drops everything', down.game.board.slice(12).some((e) => e > 0));
  let g = down;
  const bottoms: boolean[] = [];
  for (let i = 1; i <= 4; i++) {
    g = turn(g, 1, i * 1000, () => 0.5).bot;
    const lowRows = g.game.board.slice(8).filter((e) => e > 0).length;
    bottoms.push(lowRows >= g.game.board.filter((e) => e > 0).length - 1);
  }
  check('and keeps pulling it down after each of its next three moves', bottoms.slice(0, 3).every(Boolean), bottoms);
}

playing();
maluses();
receiving();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
