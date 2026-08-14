import { roomFromHash } from './useRoom';
import {
  formatRoomCode,
  generateRoomCode,
  isRoomCode,
  normaliseRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_GROUP,
  ROOM_CODE_LENGTH,
} from './code';

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

const six = roomFromHash('#AB2CDE');
check('six legal characters', six.kind === 'code' && six.code === 'AB2CDE', six);

// The hash is not ours: it is whatever a human typed, a chat app forwarded, or a QR encoded.
const lower = roomFromHash('#ab2cde');
check('lowercase is normalised up', lower.kind === 'code' && lower.code === 'AB2CDE', lower);

const spaced = roomFromHash('#  AB2CDE  ');
check('surrounding space is trimmed', spaced.kind === 'code' && spaced.code === 'AB2CDE', spaced);

/*
 * The grouping dash, in exactly the position the code card prints it. Somebody typing
 * what they can see is not sending a damaged link — there is one code `AB2-CDE` can
 * mean — and the bare form is what comes back out, because that is what goes on a wire.
 */
const dashed = roomFromHash('#AB2-CDE');
check('the printed grouped form is understood', dashed.kind === 'code' && dashed.code === 'AB2CDE', dashed);
const dashedLower = roomFromHash('#ab2-cde');
check('in either case', dashedLower.kind === 'code' && dashedLower.code === 'AB2CDE', dashedLower);

group('a damaged hash is reported, never repaired');

// THE regression this file exists for: each of these used to mint a fresh code and rewrite
// the URL, so the player landed alone in a different room with nothing left to compare.
check('five characters — a code copied one short', roomFromHash('#AB2CD').kind === 'invalid');
check('seven characters', roomFromHash('#AB2CDEF').kind === 'invalid');
check('the old four-character length is no longer a code', roomFromHash('#AB2C').kind === 'invalid');
check('a word', roomFromHash('#lobby').kind === 'invalid');

/*
 * A dash ANYWHERE ELSE is still damage. Accepting only the position we print keeps this
 * a reading of the code rather than a repair of it — the distinction the whole file
 * exists to hold.
 */
check('a dash in the wrong place', roomFromHash('#AB-CDEF').kind === 'invalid');
check('a dash and the wrong length', roomFromHash('#AB-C').kind === 'invalid');
check('a trailing dash', roomFromHash('#AB2CDE-').kind === 'invalid');
check('two dashes', roomFromHash('#AB-2C-DE').kind === 'invalid');
check('a dash on its own', roomFromHash('#-').kind === 'invalid');

/*
 * The excluded glyphs. The alphabet leaves out O/0 and I/1 so a code shouted across a noisy
 * room survives, and `normaliseRoomCode` does NOT fold them into their look-alikes — a code
 * containing one cannot have come from `generateRoomCode`, so it is a damaged link and
 * guessing which character was meant would be inventing a room.
 */
check('a zero is not folded into O', roomFromHash('#AB0CDE').kind === 'invalid');
check('and a one is not folded into I', roomFromHash('#AB1CDE').kind === 'invalid');

group('the code itself');

check('a code is six characters', ROOM_CODE_LENGTH === 6);
check('shown as two groups of three', ROOM_CODE_LENGTH / ROOM_CODE_GROUP === 2);
// A formatter that could not divide the length evenly would print a ragged group.
check('and the grouping divides the length', ROOM_CODE_LENGTH % ROOM_CODE_GROUP === 0);

// A thousand codes, because "uniformly over the alphabet" is the sort of claim that is
// wrong by one character and never noticed.
{
  let bad = 0;
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const code = generateRoomCode();
    if (!isRoomCode(code)) bad++;
    seen.add(code);
  }
  check('every generated code is a valid one', bad === 0, bad);
  // 32^6 is a billion, so a thousand draws colliding would mean the generator is broken
  // rather than unlucky.
  check('and they are not all the same', seen.size > 990, seen.size);
}

group('grouping is presentation, and only presentation');

check('a full code is grouped', formatRoomCode('AB2CDE') === 'AB2-CDE');
// While somebody is still typing. It must not pad, or the field shows a code that
// does not exist yet.
check('a partial code is not padded', formatRoomCode('AB') === 'AB');
check('nor is an empty one', formatRoomCode('') === '');
check('the dash appears with the fourth character', formatRoomCode('AB2C') === 'AB2-C');

// The round trip that matters: what we print can always be read back.
{
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const code = generateRoomCode();
    if (normaliseRoomCode(formatRoomCode(code)) !== code) bad++;
  }
  check('and a printed code always normalises back to itself', bad === 0, bad);
}

check('a pasted dash is dropped, not counted', normaliseRoomCode('AB2-CDE') === 'AB2CDE');
check('and so are spaces', normaliseRoomCode('ab2 cde') === 'AB2CDE');
// The truncation is what stops a long paste from becoming a different room.
check('anything past the length is discarded', normaliseRoomCode('AB2CDEFGH') === 'AB2CDE');
check('the alphabet still excludes the ambiguous glyphs',
  !ROOM_CODE_ALPHABET.includes('O') && !ROOM_CODE_ALPHABET.includes('0') &&
    !ROOM_CODE_ALPHABET.includes('I') && !ROOM_CODE_ALPHABET.includes('1'));
// 256 / 32 is exact, which is what makes the generator's modulo uniform without
// rejection sampling. A change here silently biases every code.
check('and is a length that divides 256', 256 % ROOM_CODE_ALPHABET.length === 0, ROOM_CODE_ALPHABET.length);

// `throw`, not `process.exit`: this project ships no `@types/node` on purpose, so `process`
// is not a name TypeScript knows here. A thrown error still exits non-zero under node, which
// is all the npm script needs. Same shape as the other .test.ts files.
if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
