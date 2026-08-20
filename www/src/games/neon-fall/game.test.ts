import { NEON_BOLT_MS } from '../../../../shared/protocol';
import { blinking, boltProgress, makeStars, NeonGame, stepStars } from './game';

/**
 * Neon Fall's client-side pure helpers.
 * Spec: docs/specs/games/neon-fall.md
 */

let failures = 0;
let checks = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  checks++;
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

console.log('\nNeonGame just remembers the latest frame');
{
  const g = new NeonGame();
  check('nothing yet', g.state === null);

  g.apply({ t: 'presence', s: 1, d: { code: 'ABCDEF', players: [], hostId: null } });
  check('a different frame type is ignored', g.state === null);

  const frame = {
    t: 'neon' as const,
    s: 1,
    d: {
      roundId: 1,
      startsAt: 0,
      endsAt: 90_000,
      gliderId: 'a',
      protectorId: 'b',
      lane: 2,
      y: 0.1,
      lives: 3,
      bounceUntil: 0,
      ammo: 3,
      cooldownUntil: 0,
      bolts: [],
      winner: null,
      phase: 'running' as const,
    },
  };
  g.apply(frame);
  check('a neon frame is kept', g.state === frame.d);
  check('the glider is identified', g.isGlider('a') && !g.isGlider('b'));
  check('the protector is identified', g.isProtector('b') && !g.isProtector('a'));
}

console.log('\na bolt telegraphs from 0 to 1 over its flight');
{
  check('the instant it fires', boltProgress(1_000, 0) === 0);
  check('halfway through its flight', boltProgress(1_000, 1_000 - NEON_BOLT_MS / 2) === 0.5);
  check('right as it resolves', boltProgress(1_000, 1_000) === 1);
  check('never negative for a bolt not yet fired by this clock', boltProgress(1_000, -500) === 0);
  check('never past 1 once it has resolved', boltProgress(1_000, 5_000) === 1);
}

console.log('\nblinking is a square wave, bounded to the bounce window');
{
  check('nothing to blink with no bounce', !blinking(0, 1_000));
  check('on for the first half-period', blinking(1_000, 0, 150));
  check('off for the next half-period', !blinking(1_000, 150, 150));
  check('and never blinking once the bounce is over', !blinking(1_000, 1_000));
}

console.log('\nstars: decorative, bounded, and they wrap');
{
  const stars = makeStars(20, (() => {
    let i = 0;
    const seq = [0.1, 0.9, 0.5];
    return () => seq[i++ % seq.length]!;
  })());
  check('the right count', stars.length === 20);
  check('every one is on the board', stars.every((s) => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1));
  check('depth stays in its own band', stars.every((s) => s.depth >= 0.3 && s.depth <= 1));

  const one = [{ x: 0.5, y: 0.5, depth: 1 }];
  stepStars(one, 0.1, 0.2);
  check('a star drifts upward (y decreases)', one[0]!.y < 0.5 && one[0]!.y > 0, one[0]);

  const wrapping = [{ x: 0.5, y: 0.01, depth: 1 }];
  stepStars(wrapping, 1, 0.2);
  // 0.01 - 0.2 = -0.19, wrapped by +1 = 0.81 — back near the bottom, not negative.
  check('and wraps back to the bottom rather than going negative', Math.abs(wrapping[0]!.y - 0.81) < 1e-9, wrapping[0]);
}

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
