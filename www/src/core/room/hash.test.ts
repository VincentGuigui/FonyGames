import { roomFromHash } from './useRoom';

/**
 * What the URL hash means.
 * Spec: docs/specs/join.md §Landing on a game page
 *
 * The three-way answer decides which of three screens a player gets, and two of the three
 * have been wrong before: an empty hash used to mint a code and connect on arrival, and a
 * damaged one used to mint a *different* code and erase the evidence. So the distinction is
 * asserted rather than trusted to the shape of an `if`.
 *
 * `roomFromHash` is pure for exactly this reason — there is no DOM test runner here, so
 * anything that reads `location` cannot be tested from node.
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

function group(name: string): void {
  console.log(`\n${name}`);
}

group('an empty hash means "nothing chosen yet"');

check('no hash at all', roomFromHash('').kind === 'empty');
check('a bare #', roomFromHash('#').kind === 'empty');
// A copy-paste can pick up a trailing space. That is still "nothing chosen", not a damaged
// link, and calling it damaged would show a dead end to somebody who just opened the page.
check('# and a space', roomFromHash('# ').kind === 'empty');
check('whitespace only', roomFromHash('#   ').kind === 'empty');

group('a valid code is used as-is');

const four = roomFromHash('#AB2C');
check('four legal characters', four.kind === 'code' && four.code === 'AB2C', four);

// The hash is not ours: it is whatever a human typed, a chat app forwarded, or a QR encoded.
const lower = roomFromHash('#ab2c');
check('lowercase is normalised up', lower.kind === 'code' && lower.code === 'AB2C', lower);

const spaced = roomFromHash('#  AB2C  ');
check('surrounding space is trimmed', spaced.kind === 'code' && spaced.code === 'AB2C', spaced);

group('a damaged hash is reported, never repaired');

// THE regression this file exists for: each of these used to mint a fresh code and rewrite
// the URL, so the player landed alone in a different room with nothing left to compare.
check('three characters — a code copied one short', roomFromHash('#AB2').kind === 'invalid');
check('five characters', roomFromHash('#AB2CD').kind === 'invalid');
check('punctuation', roomFromHash('#AB-C').kind === 'invalid');
check('a word', roomFromHash('#lobby').kind === 'invalid');

/*
 * The excluded glyphs. The alphabet leaves out O/0 and I/1 so a code shouted across a noisy
 * room survives, and `normaliseRoomCode` does NOT fold them into their look-alikes — a code
 * containing one cannot have come from `generateRoomCode`, so it is a damaged link and
 * guessing which character was meant would be inventing a room.
 */
check('a zero is not folded into O', roomFromHash('#AB0C').kind === 'invalid');
check('and a one is not folded into I', roomFromHash('#AB1C').kind === 'invalid');

// `throw`, not `process.exit`: this project ships no `@types/node` on purpose, so `process`
// is not a name TypeScript knows here. A thrown error still exits non-zero under node, which
// is all the npm script needs. Same shape as the other .test.ts files.
if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
