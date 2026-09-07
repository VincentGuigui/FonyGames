import {
  nextDeadline,
  onAct,
  onPlayerGone,
  startDark,
  tick,
  toState,
  type Ctx,
  type Dark,
} from './togetherInTheDark';
import {
  DARK_LIVES,
  DARK_MONSTER_PATIENCE,
  DARK_MONSTER_TURNS,
  DARK_TURN_MS,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol';
import { stepIn, type Cell } from '../shared/darkMap';

/**
 * Together in the Dark's referee.
 * Spec: docs/specs/games/together-in-the-dark.md
 *
 * The map roller is `shared/darkMap.test.ts`'s business. What matters here is
 * the thing no other referee in this codebase has to do: **keep a secret**.
 *
 * - **the map is never on the wire.** This is the one architectural decision
 *   the spec says would be painful to retrofit (§6), and it is the first thing
 *   checked: a modified client must have nothing to read.
 * - **monsters are never remembered**, only terrain (§2.2) — stale monster
 *   information that quietly became a lie is the intended cruelty.
 * - **one action per turn**, and a stale turn index cannot spend a second one.
 * - **a trap costs the turn, a monster costs a life**, and neither kills.
 * - and a monster walks toward **where it was lit**, so it can be baited.
 */

let failures = 0;
let checks = 0;
function check(what: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${what}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${what}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

const A = 'a' as PlayerId;
const B = 'b' as PlayerId;
const C = 'c' as PlayerId;
const T0 = 1_000_000;

function harness(at = T0) {
  let now = at;
  let seq = 0;
  let stored: Dark | null = null;
  const sent: ServerMessage[] = [];
  let alarm = 0;
  let h = 0xDA2C;
  const rand = (): number => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 4294967296;
  };

  const ctx: Ctx = {
    now: () => now,
    nextSeq: () => ++seq,
    broadcast: (m) => sent.push(m),
    load: async () => stored,
    save: async (s) => {
      stored = s;
    },
    setAlarm: async (a) => {
      alarm = a;
    },
    random: rand,
  };

  return {
    ctx,
    sent,
    get state(): Dark {
      if (!stored) throw new Error('no state');
      return stored;
    },
    get alarm(): number {
      return alarm;
    },
    at: (t: number) => {
      now = t;
    },
    advance: (ms: number) => {
      now += ms;
    },
    get last() {
      const frames = sent.filter((m) => m.t === 'dark');
      const frame = frames[frames.length - 1];
      if (!frame || frame.t !== 'dark') throw new Error('no dark frame');
      return frame.d;
    },
  };
}

/** A room, mid-run. */
async function playing(ids: PlayerId[] = [A, B], solo = false): Promise<ReturnType<typeof harness>> {
  const h = harness();
  await startDark(h.ctx, 1, ids, solo);
  return h;
}

/** Whose turn is it, on the referee's own reckoning? */
const whose = (h: ReturnType<typeof harness>): PlayerId | null => h.last.who;

/** Put the character somewhere with a known empty neighbour, so a walk test
 *  is about the walk rather than about whatever the roll happened to put there. */
function clearAround(h: ReturnType<typeof harness>, at: Cell): void {
  const s = h.state;
  s.at = at;
  s.cameFrom = at;
  const around = [at, ...['N', 'E', 'S', 'W'].map((d) => stepIn(at, d as 'N'))];
  s.map.traps = s.map.traps.filter((c) => !around.some((a) => a.x === c.x && a.y === c.y));
  s.map.trees = s.map.trees.filter((c) => !around.some((a) => a.x === c.x && a.y === c.y));
  s.monsters = s.monsters.filter((m) => !around.some((a) => a.x === m.at.x && a.y === m.at.y));
}

async function starting(): Promise<void> {
  console.log('\nstarting a run (§2)');

  const h = await playing([A, B, C]);
  check('a room of three starts', h.state.phase === 'playing');
  check(`everybody has ${DARK_LIVES} lives between them`, h.last.lives === DARK_LIVES);
  check('turn order is join order', whose(h) === A);
  check('the first turn is index 0', h.last.turn === 0);
  check(`the turn deadline is ${DARK_TURN_MS} ms out`, h.state.turnEndsAt === T0 + DARK_TURN_MS);
  check('and the alarm is it', h.alarm === h.state.turnEndsAt);
  check('the character is on the map start', h.state.at.x === h.state.map.start.x);
  check('nothing is lit yet', h.last.lit.length === 0);
  check('and nothing is remembered', h.last.seen.length === 0);

  // Solo works, and turns this into a puzzle rather than a social game — worth
  // having, since almost nothing else in the catalogue has a single-player life
  // (spec §7).
  const alone = await playing([A]);
  check('one player is a legitimate room', alone.state.phase === 'playing');
  check('and they take every turn', alone.last.who === A);

  const crowd = harness();
  check('nine cannot start', !(await startDark(crowd.ctx, 1, [A, B, C, 'd', 'e', 'f', 'g', 'h', 'i'] as PlayerId[])));
}

async function theMapIsNotOnTheWire(): Promise<void> {
  console.log('\nthe map is never on the wire (§6)');

  const h = await playing([A, B]);
  const frame = h.last;
  const json = JSON.stringify(frame);

  /*
   * The one architectural decision the spec says would be painful to
   * retrofit. Checked as an absence, and by content rather than by field name:
   * no trap, tree or monster the map holds may appear anywhere in the frame
   * before it has been lit.
   */
  const hidden = [...h.state.map.traps, ...h.state.map.trees, ...h.state.map.monsters.map(() => ({ x: -1, y: -1 }))];
  check('the frame carries no trap or tree positions', !h.state.map.traps.some((c) => json.includes(`"x":${c.x},"y":${c.y},"kind":"trap"`)), hidden.length);
  check('nor the escape, before anybody has seen it', frame.escape === null);
  check('nor the guaranteed path', !('path' in (frame as unknown as Record<string, unknown>)));
  check('nor the monsters', !('monsters' in (frame as unknown as Record<string, unknown>)));
  check('only the grid size, so a phone can draw a viewport', frame.cols > 0 && frame.rows > 0);
  check('and where the character is, which everyone is guiding', frame.at.x === h.state.at.x);

  // Lighting the escape is what puts it on the wire, and not before.
  const s = h.state;
  s.at = { x: s.map.escape.x, y: s.map.escape.y + 1 };
  s.cameFrom = s.at;
  await onAct(h.ctx, A, 1, s.turn, 'light', 'N');
  check('lighting the escape reveals it', h.last.escape !== null);
  check('and remembers it', h.last.seen.some((c) => c.kind === 'escape'));
}

async function oneActionPerTurn(): Promise<void> {
  console.log('\none action, and only the player whose turn it is (§2, §8)');

  const h = await playing([A, B]);
  clearAround(h, { x: 5, y: 8 });

  await onAct(h.ctx, B, 1, 0, 'walk', 'N');
  check("a player whose turn it is not is ignored", h.state.turn === 0 && h.state.at.y === 8);

  await onAct(h.ctx, A, 1, 5, 'walk', 'N');
  check('a stale turn index is ignored', h.state.turn === 0);

  await onAct(h.ctx, A, 99, 0, 'walk', 'N');
  check('another round is ignored', h.state.turn === 0);

  await onAct(h.ctx, A, 1, 0, 'sprint' as unknown as 'walk', 'N');
  check('an unknown action is refused', h.state.turn === 0);

  await onAct(h.ctx, A, 1, 0, 'walk', 'NE');
  check('a diagonal is refused — both reach exactly one cell', h.state.turn === 0);

  await onAct(h.ctx, A, 1, 0, 'walk', 'N');
  check('a legal action is taken', h.state.at.y === 7);
  check('and the turn passes', h.state.turn === 1);
  check('to the next player in join order', whose(h) === B);

  // The double-tap: the same turn index cannot be spent twice.
  await onAct(h.ctx, A, 1, 0, 'walk', 'N');
  check('the same turn cannot be spent again', h.state.turn === 1 && h.state.at.y === 7);

  check('the deadline moved with the turn', h.state.turnEndsAt === T0 + DARK_TURN_MS);
}

async function lightAndMemory(): Promise<void> {
  console.log('\nlight buys knowledge, and what is remembered (§2, §2.2)');

  const h = await playing([A, B]);
  clearAround(h, { x: 6, y: 9 });
  // A trap due north, so lighting it is a known outcome.
  h.state.map.traps.push({ x: 6, y: 8 });

  await onAct(h.ctx, A, 1, 0, 'light', 'N');
  check('the lit cell is on the wire', h.last.lit.length === 1);
  check('and says what it held', h.last.lit[0]?.kind === 'trap');
  check('the character did not move — light buys no progress', h.state.at.y === 9);
  check('but the turn was still spent', h.state.turn === 1);
  check('terrain is remembered', h.last.seen.some((c) => c.x === 6 && c.y === 8 && c.kind === 'trap'));
  check('and the room was told', h.last.log.some((l) => l.includes('trap')));

  // Next turn, the light has gone out but the memory has not.
  await onAct(h.ctx, B, 1, 1, 'light', 'E');
  check('last turn’s light is out', !h.last.lit.some((c) => c.x === 6 && c.y === 8));
  check('but the trap is still remembered', h.last.seen.some((c) => c.x === 6 && c.y === 8));

  /*
   * Monsters are never remembered (spec §2.2). Without any memory the team
   * screenshots the screen; with monster memory the danger becomes a solved
   * map. Stale monster information that quietly became a lie is the point.
   */
  const mh = await playing([A, B]);
  clearAround(mh, { x: 6, y: 9 });
  mh.state.monsters.push({ at: { x: 6, y: 8 }, awake: false, toward: { x: 6, y: 8 }, movesAt: 0, waited: 0 });
  await onAct(mh.ctx, A, 1, 0, 'light', 'N');
  check('a lit monster IS shown this turn', mh.last.lit[0]?.kind === 'monster');
  check('but never remembered', !mh.last.seen.some((c) => c.x === 6 && c.y === 8));
  check('and lighting it woke it', mh.state.monsters.some((m) => m.awake));
  check('heading for where it was lit, not where the character is', mh.state.monsters.some((m) => m.awake && m.toward.x === 6 && m.toward.y === 8));
}

async function trapsAndMonsters(): Promise<void> {
  console.log('\nwhat the dark costs (§2.2)');

  // A trap costs the TURN and a cell of ground, not a life.
  const h = await playing([A, B]);
  clearAround(h, { x: 6, y: 9 });
  h.state.cameFrom = { x: 6, y: 10 };
  h.state.map.traps.push({ x: 6, y: 8 });
  await onAct(h.ctx, A, 1, 0, 'walk', 'N');
  check('walking onto an unlit trap costs no life', h.state.lives === DARK_LIVES);
  check('but shoves the character back the way he came', h.state.at.y === 10);
  check('and the turn is gone', h.state.turn === 1);
  check('the trap is now known', h.last.seen.some((c) => c.x === 6 && c.y === 8 && c.kind === 'trap'));

  // A monster costs a life and shoves back; it does not kill.
  const m = await playing([A, B]);
  clearAround(m, { x: 6, y: 9 });
  m.state.cameFrom = { x: 6, y: 10 };
  m.state.monsters.push({ at: { x: 6, y: 8 }, awake: false, toward: { x: 6, y: 8 }, movesAt: 0, waited: 0 });
  await onAct(m.ctx, A, 1, 0, 'walk', 'N');
  check('walking into a monster costs a life', m.state.lives === DARK_LIVES - 1);
  check('and shoves the character back', m.state.at.y === 10);
  check('rather than ending the run', m.state.phase === 'playing');
  check('and it goes back to sleep', !m.state.monsters.some((x) => x.awake));

  // A tree is scenery: it blocks, and costs only the turn.
  const t = await playing([A, B]);
  clearAround(t, { x: 6, y: 9 });
  t.state.map.trees.push({ x: 6, y: 8 });
  await onAct(t.ctx, A, 1, 0, 'walk', 'N');
  check('a tree blocks the step', t.state.at.y === 9);
  check('costs no life', t.state.lives === DARK_LIVES);
  check('and is remembered', t.last.seen.some((c) => c.x === 6 && c.y === 8 && c.kind === 'tree'));

  // The edge of the board is not an error.
  const e = await playing([A, B]);
  clearAround(e, { x: 0, y: 0 });
  await onAct(e.ctx, A, 1, 0, 'walk', 'W');
  check('walking off the board does nothing but spend the turn', e.state.at.x === 0 && e.state.turn === 1);
  check('and says so', e.last.log.some((l) => l.includes('edge')));
}

async function baiting(): Promise<void> {
  console.log('\na monster can be baited (§2.2)');

  const h = await playing([A, B]);
  clearAround(h, { x: 6, y: 10 });
  // A monster three cells east, woken by a light, heading for where it was lit.
  const monster = { at: { x: 9, y: 10 }, awake: false, toward: { x: 9, y: 10 }, movesAt: 0, waited: 0 };
  h.state.monsters = [monster];
  h.state.map.trees = [];
  h.state.map.traps = [];
  h.state.at = { x: 8, y: 10 };
  h.state.cameFrom = { x: 7, y: 10 };

  await onAct(h.ctx, A, 1, 0, 'light', 'E');
  const woken = h.state.monsters[0];
  check('lighting it wakes it', woken?.awake === true);
  check('and it aims at the cell it was lit at', woken?.toward.x === 9 && woken?.toward.y === 10);
  check('it does not move on the turn it woke', woken?.at.x === 9);

  /*
   * It is already standing on the cell it was heading for, so it waits there —
   * and gives up after `DARK_MONSTER_PATIENCE` of its own moves. That is what
   * makes "light it, walk away" a real play rather than a way to remove one
   * permanently.
   */
  let turn = h.state.turn;
  for (let i = 0; i < DARK_MONSTER_TURNS * (DARK_MONSTER_PATIENCE + 1); i++) {
    const who = h.last.who as PlayerId;
    await onAct(h.ctx, who, 1, turn, 'light', 'W');
    turn = h.state.turn;
    if (h.state.phase === 'done') break;
  }
  check(`it went back to sleep after ${DARK_MONSTER_PATIENCE} patient moves`, !h.state.monsters[0]?.awake, h.state.monsters[0]);

  // And it really does walk, when its target is elsewhere.
  const w = await playing([A, B]);
  w.state.map.trees = [];
  w.state.map.traps = [];
  w.state.monsters = [{ at: { x: 2, y: 5 }, awake: true, toward: { x: 8, y: 5 }, movesAt: 0, waited: 0 }];
  clearAround(w, { x: 6, y: 12 });
  await onAct(w.ctx, A, 1, w.state.turn, 'light', 'N');
  check('an awake monster whose target is elsewhere walks toward it', (w.state.monsters[0]?.at.x ?? 0) === 3, w.state.monsters[0]?.at);
  check('one cell, not two', Math.abs((w.state.monsters[0]?.at.x ?? 0) - 2) === 1);
  check(`and not again for ${DARK_MONSTER_TURNS} turns`, (w.state.monsters[0]?.movesAt ?? 0) >= w.state.turn + DARK_MONSTER_TURNS - 1);
}

async function theDeadline(): Promise<void> {
  console.log('\na silent player (§2, §7)');

  const h = await playing([A, B]);
  clearAround(h, { x: 6, y: 9 });
  h.state.cameFrom = { x: 6, y: 10 };

  check('an early tick does nothing', (await tick(h.ctx)) === false && h.state.turn === 0);

  h.at(h.state.turnEndsAt);
  await tick(h.ctx);
  check('the deadline spends the turn', h.state.turn === 1);
  /*
   * As a LIGHT in the direction of travel, not a skip — friendlier, and it
   * never wastes the team's turn (spec §2).
   */
  check('as a light, not a skip', h.last.log.some((l) => l.includes('light')));
  check('in the direction of travel', h.last.lit.length === 1 && h.last.lit[0]?.y === 8);
  check('so the character did not move', h.state.at.y === 9);
  check('and the turn passed to the next player', whose(h) === B);
}

async function endings(): Promise<void> {
  console.log('\nhow a run ends (§2)');

  // The escape: everybody wins, and there is no ranking.
  const won = await playing([A, B]);
  const s = won.state;
  s.map.traps = [];
  s.map.trees = [];
  s.monsters = [];
  s.at = { x: s.map.escape.x, y: s.map.escape.y + 1 };
  s.cameFrom = s.at;
  const over = await onAct(won.ctx, A, 1, s.turn, 'walk', 'N');
  check('reaching the escape ends the run', over && won.state.phase === 'done');
  check('and everybody wins', won.last.won === true);
  check('with the turns taken as the record', typeof won.last.turns === 'number');
  check('a tick after the end does nothing', (await tick(won.ctx)) === false);
  check('and nextDeadline is never', nextDeadline(won.state) === Infinity);
  check('an action after the end is ignored', (await onAct(won.ctx, A, 1, won.state.turn, 'walk', 'N')) === false);

  // All the lives: everybody loses.
  const lost = await playing([A, B]);
  clearAround(lost, { x: 6, y: 9 });
  lost.state.lives = 1;
  lost.state.cameFrom = { x: 6, y: 10 };
  lost.state.monsters.push({ at: { x: 6, y: 8 }, awake: false, toward: { x: 6, y: 8 }, movesAt: 0, waited: 0 });
  const done = await onAct(lost.ctx, A, 1, 0, 'walk', 'N');
  check('the last life ends the run', done && lost.state.phase === 'done');
  check('and nobody won', lost.last.won === false);
  check('the log says what happened', lost.last.log.some((l) => l.length > 0));
}

async function leaving(): Promise<void> {
  console.log('\na player leaves (§7)');

  const h = await playing([A, B, C]);
  await onPlayerGone(h.ctx, B);
  check('they are dropped from the turn order', !h.state.order.includes(B));
  check('and the run continues', h.state.phase === 'playing');
  check('the controls are still with somebody who is here', h.state.order.includes(h.last.who as PlayerId));

  await onPlayerGone(h.ctx, 'nobody' as PlayerId);
  check('a stranger leaving is harmless', h.state.order.length === 2);

  // Everybody leaving stops the run rather than ticking on with nobody in it.
  await onPlayerGone(h.ctx, A);
  await onPlayerGone(h.ctx, C);
  check('everybody leaving ends it', h.state.phase === 'done');

  /*
   * The index shift. Removing an EARLIER player moves everyone along, so the
   * turn index has to move with them or the wrong phone gets the controls —
   * the kind of off-by-one that shows up as "it is my turn but I cannot do
   * anything".
   */
  const shift = await playing([A, B, C]);
  clearAround(shift, { x: 6, y: 9 });
  await onAct(shift.ctx, A, 1, 0, 'light', 'N');
  check('turn 1 belongs to B', whose(shift) === B);
  await onPlayerGone(shift.ctx, A);
  check('A leaving leaves the controls with B, not C', whose(shift) === B, { who: shift.last.who, order: shift.state.order });
}

async function theWire(): Promise<void> {
  console.log('\nwhat a phone joining mid-run gets (§6)');

  const h = await playing([A, B]);
  clearAround(h, { x: 6, y: 9 });
  h.state.map.traps.push({ x: 6, y: 8 });
  await onAct(h.ctx, A, 1, 0, 'light', 'N');

  const fresh = toState(h.state);
  check('the terrain the room has learned', fresh.seen.length > 0);
  check('but not this turn’s light, once the turn has passed', fresh.lit.length === 1);
  check('whose turn it is', fresh.who === B);
  check('the deadline, as an absolute time', fresh.turnEndsAt === h.state.turnEndsAt);
  check('the lives', fresh.lives === DARK_LIVES);
  check('the log', fresh.log.length > 0);
  check('and still nothing about the rest of the map', fresh.seen.every((c) => c.x === 6 && c.y === 8));
}

async function main(): Promise<void> {
  await starting();
  await theMapIsNotOnTheWire();
  await oneActionPerTurn();
  await lightAndMemory();
  await trapsAndMonsters();
  await baiting();
  await theDeadline();
  await endings();
  await leaving();
  await theWire();

  if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
  console.log(`\nall ${checks} passed`);
}

await main();
