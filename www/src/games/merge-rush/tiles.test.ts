import { DIRS, newGame, slide, step, type Board, type Dir } from '../../../../shared/merge';
import { boardOf, moveTiles, settled, tilesFromBoard, type Tile } from './tiles';

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

const rows = (...r: number[][]): Board => r.flat().map((v) => (v === 0 ? 0 : Math.log2(v)));
const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((e, i) => e === b[i]);

function sliding(): void {
  console.log('\ntiles follow the move (§4)');
  const board = rows([2, 0, 0, 2], [0, 4, 0, 0], [0, 0, 0, 0], [8, 0, 0, 0]);
  const { tiles, nextId } = tilesFromBoard(board, 1);
  check('a board becomes one tile per number', tiles.length === 4 && nextId === 5);
  check('and back', same(boardOf(tiles), board));

  const slid = slide(board, 'right');
  const moved = moveTiles(tiles, 'right', slid.board, nextId).tiles;
  check('a tile that slides keeps its identity and ends against the wall', moved.some((t) => t.id === 3 && t.exp === 2 && t.r === 1 && t.c === 3), moved);
  check('a tile already at the wall stays put', moved.some((t) => t.id === 4 && t.r === 3 && t.c === 3));

  const pair = moved.filter((t) => t.gone);
  check('a merging pair both travel to the merge cell', pair.length === 2 && pair.every((t) => t.r === 0 && t.c === 3), pair);
  const made = moved.find((t) => t.born === 'merge');
  check('and a new tile of the double is born there', made?.exp === 2 && made.r === 0 && made.c === 3, made);
  check('the pair keeps their own ids', pair.map((t) => t.id).sort().join() === '1,2');
  check('with no spawn passed, nothing else appears', moved.every((t) => t.born !== 'spawn'));
  check('the tiles still on the board are the slid board', same(boardOf(moved), slid.board));
}

function spawning(): void {
  console.log('\nthe spawn is whatever the result holds that the slide did not (§2)');
  const board = rows([2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
  const { tiles, nextId } = tilesFromBoard(board, 1);
  const result = rows([0, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 0]);
  const moved = moveTiles(tiles, 'right', result, nextId).tiles;
  const fresh = moved.filter((t) => t.born === 'spawn');
  check('one tile is a spawn', fresh.length === 1 && fresh[0]?.r === 3 && fresh[0]?.c === 0, fresh);
  check('and the board matches the result', same(boardOf(moved), result));
}

function followsTheRules(): void {
  console.log('\nover whole games, it always agrees with the rules');
  let agree = true;
  let games = 0;
  let moves = 0;
  let firstBad = '';
  for (let seed = 1; seed <= 40; seed++) {
    let g = newGame(seed);
    let { tiles, nextId } = tilesFromBoard(g.board, 1);
    games++;
    for (let i = 0; i < 400; i++) {
      const dir = DIRS[(i * 5 + (i >> 1) + seed) % 4] as Dir;
      const r = step(g, dir, seed);
      if (!r.moved) continue;
      moves++;
      const next = moveTiles(settled(tiles), dir, r.game.board, nextId);
      if (!same(boardOf(next.tiles), r.game.board)) {
        agree = false;
        firstBad ||= `seed ${seed} move ${i}`;
      }
      const ids = next.tiles.map((t) => t.id);
      if (new Set(ids).size !== ids.length) {
        agree = false;
        firstBad ||= `duplicate ids, seed ${seed} move ${i}`;
      }
      g = r.game;
      tiles = next.tiles;
      nextId = next.nextId;
    }
  }
  check(`${games} games, ${moves} moves: tiles and board never disagree`, agree, firstBad);

  const t: Tile[] = tilesFromBoard(rows([2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]), 1).tiles;
  const after = moveTiles(t, 'left', rows([4, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]), 3).tiles;
  check('settling drops the tiles that merged away', settled(after).length === 1 && settled(after)[0]?.exp === 2);
  check('and the pop mark', settled(after).every((x) => x.born === undefined));
}

sliding();
spawning();
followsTheRules();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
