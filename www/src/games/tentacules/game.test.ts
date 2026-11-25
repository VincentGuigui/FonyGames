import { TENT_HANG_MS, TENT_SQUAT_MS } from '../../../../shared/protocol';
import { MAX_PULL, REACH, place, startPegs, type Peg, type Point } from '../../../../shared/tentacules';
import { armToward, armed, drop, fresh, launch, reconcile, rest, tick, type Octo, type Send } from './game';

/** One phone's octopus. Module: tentacules/game.ts · spec §2 */

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

const nobody = () => null;
const peg = (id: number, x: number, y: number): Peg => ({ id, x, y });

function dropping(): void {
  console.log('\ndropping a tentacle (§2.1)');
  const o = fresh();
  const top = rest(o) as Point;
  const up = peg(101, top.x, top.y + REACH - 0.05);
  const r = drop(o, 3, { x: up.x + 0.03, y: up.y }, [up], nobody, 0);
  check('dropped near a peg in reach, it grabs it', r.ok && r.octo.holds[3]?.id === 101 && r.send.t === 'grab');
  const far = peg(102, top.x, top.y + REACH + 0.2);
  const f = drop(o, 3, far, [far], nobody, 0);
  check('out of reach, it springs back', !f.ok && f.reason === 'reach');
  const mine = drop(o, 3, startPegs()[0] as Peg, startPegs(), nobody, 0);
  check('on a peg it already holds, it springs back', !mine.ok && mine.reason === 'mine');
  const busy = (since: number) => () => ({ since });
  const t = drop(o, 3, up, [up], busy(0), TENT_SQUAT_MS - 1);
  check('on a rival\'s peg held under 3 s, it springs back', !t.ok && t.reason === 'taken');
  const w = drop(o, 3, up, [up], busy(0), TENT_SQUAT_MS);
  check('held 3 s or more, it takes it', w.ok && w.octo.holds[3]?.id === 101);
  const e = drop(o, 3, { x: 0.95, y: 3 }, [up], nobody, 0);
  check('on empty space, it lets go', e.ok && e.octo.holds[3] === null && e.send.t === 'let-go');
}

function slinging(): void {
  console.log('\nthe slingshot (§2.2)');
  const pair: Octo = { ...fresh(), holds: [peg(1, 0.3, 5), null, null, peg(2, 0.68, 5), null] };
  pair.body = rest(pair) as Point;
  check('two holds wide apart: armed', armed(pair));
  check('the starting star is not', !armed(fresh()));
  const l = launch(pair, { x: 0, y: -MAX_PULL });
  check('released, it flies up and lets go of both', l !== null && l.octo.mode === 'flying' && l.octo.vel.y > 0 && l.send.t === 'let-go' && (l.send as { arms: number[] }).arms.join() === '0,3');
  check('a short pull does nothing', launch(pair, { x: 0, y: -0.01 }) === null);

  let o = (l as { octo: Octo }).octo;
  const above = peg(9, 0.5, 6.1);
  const sent: Send[] = [];
  for (let t = 0; t < 2 && o.mode === 'flying'; t += 1 / 60) {
    const r = tick(o, 1 / 60, t * 1000, [above], nobody);
    o = r.octo;
    sent.push(...r.send);
  }
  check('on the way down it grabs the highest peg in reach by itself', o.mode === 'held' && o.holds.some((h) => h?.id === 9));
  check('and tells the referee', sent.some((s) => s.t === 'grab' && s.peg === 9));
  check('by the tentacle that points at it', armToward({ x: 0.5, y: 5 }, { x: 0.5, y: 6 }) === 0);
}

function falling(): void {
  console.log('\nhanging and falling (§2.3)');
  let o: Octo = { ...fresh(), holds: [peg(1, 0.5, 3), null, null, null, null], oneSince: 1000 };
  o.body = rest(o) as Point;
  let r = tick(o, 1 / 60, 1000 + TENT_HANG_MS - 1, [], nobody);
  check('hanging by one under 3 s, it holds on', r.octo.mode === 'held');
  r = tick(o, 1 / 60, 1000 + TENT_HANG_MS, [], nobody);
  check('at 3 s it lets go and falls', r.octo.mode === 'falling' && r.send.some((s) => s.t === 'let-go'));
  o = r.octo;
  const sent: Send[] = [];
  for (let i = 0; i < 600 && !sent.some((x) => x.t === 'reset'); i++) {
    const s = tick(o, 1 / 60, 5000 + i * 16, [], nobody);
    o = s.octo;
    sent.push(...s.send);
  }
  check('a fall past the bottom puts it back on its starting pegs', sent.some((s) => s.t === 'reset') && o.holds.every((h, i) => h?.id === -(i + 1)));
  const falling2: Octo = { ...fresh(), holds: [null, null, null, null, null], mode: 'falling', body: { x: 0.5, y: 4 }, vel: { x: 0, y: -1 } };
  const c = peg(50, 0.55, 3.9);
  const caught = drop(falling2, 2, c, [c], nobody, 0);
  check('falling, a tentacle dropped on a peg in reach catches it', caught.ok && caught.octo.mode === 'held');
  check('a falling octopus does not grab by itself', tick(falling2, 1 / 60, 0, [c], nobody).octo.mode === 'falling');
}

function reconciling(): void {
  console.log('\nthe referee has the last word (§6)');
  const pegs = new Map(startPegs().map((p) => [p.id, p] as const));
  const up = peg(101, 0.5, 0.9);
  pegs.set(101, up);
  const pegOf = (id: number) => pegs.get(id) ?? null;
  const o: Octo = { ...fresh(), holds: [...startPegs().slice(0, 4), up] };
  const pending = new Map([[4, { peg: 101 as number | null, at: 1000 }]]);
  const early = reconcile(o, [-1, -2, -3, -4, -5], pending, pegOf, 1200);
  check('a grab still on its way is not undone by an older state', early.holds[4]?.id === 101);
  const late = reconcile(o, [-1, -2, -3, -4, -5], pending, pegOf, 3000);
  check('refused, it springs back to what the referee says', late.holds[4]?.id === -5 && pending.size === 0);
  const ok = new Map([[4, { peg: 101 as number | null, at: 1000 }]]);
  reconcile(o, [-1, -2, -3, -4, 101], ok, pegOf, 1100);
  check('agreed, the send is settled', ok.size === 0);
  const knocked = reconcile(fresh(), [-1, -2, -3, -4, null], new Map(), pegOf, 0);
  check('knocked off by a rival, that tentacle lets go', knocked.holds[4] === null);
  check('the body stays held while others hold', knocked.mode === 'held' && place(knocked.holds.filter((h): h is Peg => h !== null)) !== null);
}

function hanging(): void {
  console.log('\nthe body hangs, sags and wobbles (§2.1)');
  const swing = (holds: (Peg | null)[], calm: boolean, from: Point) => {
    let o: Octo = { ...fresh(), holds, body: from, vel: { x: 0, y: 0 }, mode: 'held', oneSince: null };
    const target = rest(o) as Point;
    const path: Point[] = [];
    for (let i = 0; i < 360; i++) {
      o = tick(o, 1 / 60, 10_000 + i * 16.7, [], nobody, calm).octo;
      path.push({ ...o.body });
    }
    return { o, target, path };
  };
  const one = [peg(1, 0.5, 3), null, null, null, null];
  const five = startPegs();
  const t1 = place([peg(1, 0.5, 3)]) as Point;
  const r1 = swing(one, false, { x: t1.x, y: t1.y + 0.3 });
  check('dropped into place by one tentacle, the body swings past where it settles', r1.path.some((p) => p.y < r1.target.y - 0.045) && r1.path.some((p) => p.y > r1.target.y - 0.02), r1.target);
  check('and settles, a little lower than its holds put it: gravity sags it', Math.abs(r1.o.body.y - (r1.target.y - 0.04)) < 0.02 && r1.o.body.y < r1.target.y);
  check('hanging by one tentacle it keeps swaying side to side', Math.max(...r1.path.slice(240).map((p) => p.x)) - Math.min(...r1.path.slice(240).map((p) => p.x)) > 0.01);
  const rest5 = place(five) as Point;
  const r5 = swing(five, false, { x: rest5.x, y: rest5.y + 0.2 });
  check('five tentacles hold it almost still, and level with its holds', Math.abs(r5.o.body.y - rest5.y) < 0.005 && Math.max(...r5.path.slice(240).map((p) => p.x)) - Math.min(...r5.path.slice(240).map((p) => p.x)) < 0.002);
  const calm = swing(one, true, { x: t1.x, y: t1.y + 0.3 });
  check('with reduced motion it just arrives: no overshoot, no sag, no sway', calm.path.every((p) => p.y >= calm.target.y - 0.005) && Math.abs(calm.o.body.y - calm.target.y) < 0.005);
  check('and the rules are untouched: where the holds put it is still `rest`', JSON.stringify(rest({ ...fresh(), holds: one })) === JSON.stringify(place([peg(1, 0.5, 3)])));
  check('numerically steady for six seconds', r1.path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) && Math.abs(r1.path[359]?.y ?? 99) < 5);
}

dropping();
hanging();
slinging();
falling();
reconciling();

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
