import { roomFromHash } from './useRoom';
import {
  formatRoomCode,
  generateRoomCode,
  isRoomCode,
  normaliseRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_CONSONANTS,
  ROOM_CODE_GROUP,
  ROOM_CODE_LENGTH,
  ROOM_CODE_VOWELS,
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

const six = roomFromHash('#FONGAM');
check('six legal characters', six.kind === 'code' && six.code === 'FONGAM', six);

// The hash is not ours: it is whatever a human typed, a chat app forwarded, or a QR encoded.
const lower = roomFromHash('#fongam');
check('lowercase is normalised up', lower.kind === 'code' && lower.code === 'FONGAM', lower);

const spaced = roomFromHash('#  FONGAM  ');
check('surrounding space is trimmed', spaced.kind === 'code' && spaced.code === 'FONGAM', spaced);

/*
 * The grouping dash, in exactly the position the code card prints it. Somebody typing
 * what they can see is not sending a damaged link — there is one code `FON-GAM` can
 * mean — and the bare form is what comes back out, because that is what goes on a wire.
 */
const dashed = roomFromHash('#FON-GAM');
check('the printed grouped form is understood', dashed.kind === 'code' && dashed.code === 'FONGAM', dashed);
const dashedLower = roomFromHash('#fon-gam');
check('in either case', dashedLower.kind === 'code' && dashedLower.code === 'FONGAM', dashedLower);

group('a damaged hash is reported, never repaired');

// THE regression this file exists for: each of these used to mint a fresh code and rewrite
// the URL, so the player landed alone in a different room with nothing left to compare.
check('five characters — a code copied one short', roomFromHash('#FONGA').kind === 'invalid');
check('seven characters', roomFromHash('#FONGAME').kind === 'invalid');
check('the old four-character length is no longer a code', roomFromHash('#FONG').kind === 'invalid');
check('a word', roomFromHash('#lobby').kind === 'invalid');

/*
 * A dash ANYWHERE ELSE is still damage. Accepting only the position we print keeps this
 * a reading of the code rather than a repair of it — the distinction the whole file
 * exists to hold.
 */
check('a dash in the wrong place', roomFromHash('#TA-KOBE').kind === 'invalid');
check('a dash and the wrong length', roomFromHash('#TA-K').kind === 'invalid');
check('a trailing dash', roomFromHash('#FONGAM-').kind === 'invalid');
check('two dashes', roomFromHash('#TA-KO-BE').kind === 'invalid');
check('a dash on its own', roomFromHash('#-').kind === 'invalid');

/*
 * Digits. There are none in a code any more, and `normaliseRoomCode` does NOT fold them
 * into the letters they resemble — a hash containing one cannot have come from
 * `generateRoomCode`, so it is a damaged link, and reading the `0` as the `O` somebody
 * probably meant would be inventing a room out of a guess.
 */
check('a zero is not folded into O', roomFromHash('#TAK0BE').kind === 'invalid');
check('and a one is not folded into I', roomFromHash('#TAK1BE').kind === 'invalid');

/*
 * THE new rule. Six letters is no longer enough: a code is two sayable triplets, and a
 * string that is not one cannot have been minted here. Every check below is six letters
 * and every one of them is a damaged link.
 */
check('six letters in the wrong shape is not a code', roomFromHash('#TKAOBE').kind === 'invalid');
check('nor is an English word that misses it', roomFromHash('#SILENT').kind === 'invalid');
check('a vowel where a consonant belongs is caught', roomFromHash('#TAKOEB').kind === 'invalid');
// And a word that DOES fit the shape is a perfectly good code — the rule is about the
// pattern, not about meaning.
check('a word that fits it is a code', roomFromHash('#BANANA').kind === 'code');

group('the code itself');

check('a code is six characters', ROOM_CODE_LENGTH === 6);
check('shown as two groups of three', ROOM_CODE_LENGTH / ROOM_CODE_GROUP === 2);
// A formatter that could not divide the length evenly would print a ragged group.
check('and the grouping divides the length', ROOM_CODE_LENGTH % ROOM_CODE_GROUP === 0);

// A thousand codes, because "every triplet equally often" is the sort of claim that is
// wrong by one character and never noticed. The shape is checked on every one of them:
// a generator that could emit a code its own validator refuses would mint dead rooms.
{
  let bad = 0;
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const code = generateRoomCode();
    if (!isRoomCode(code)) bad++;
    seen.add(code);
  }
  check('every generated code is a valid one', bad === 0, bad);
  // 2730^2 is 7.45M, so a thousand draws should collide about once in fifteen runs —
  // several collisions would mean the generator is broken rather than unlucky.
  check('and they are not all the same', seen.size > 990, seen.size);

  /*
   * Both shapes have to come up. Drawing the first letter from all 26 and letting it decide
   * makes `VCV` a fifth of the codes — rarer, and deliberately so, because that is what
   * gives every one of the 2 730 triplets the same chance. A generator that had lost one
   * shape entirely would still pass every check above.
   */
  const vowelFirst = [...seen].filter((c) => 'AEIOU'.includes(c[0] ?? '')).length;
  check('both shapes of triplet are minted', vowelFirst > 100 && vowelFirst < 350, vowelFirst);
}

group('grouping is presentation, and only presentation');

check('a full code is grouped', formatRoomCode('FONGAM') === 'FON-GAM');
// While somebody is still typing. It must not pad, or the field shows a code that
// does not exist yet.
check('a partial code is not padded', formatRoomCode('TA') === 'TA');
check('nor is an empty one', formatRoomCode('') === '');
check('the dash appears with the fourth character', formatRoomCode('FONG') === 'FONT-G');

// The round trip that matters: what we print can always be read back.
{
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const code = generateRoomCode();
    if (normaliseRoomCode(formatRoomCode(code)) !== code) bad++;
  }
  check('and a printed code always normalises back to itself', bad === 0, bad);
}

check('a pasted dash is dropped, not counted', normaliseRoomCode('FON-GAM') === 'FONGAM');
check('and so is a digit somebody typed for a letter', normaliseRoomCode('TAK0BE') === 'TAKBE');
check('and so are spaces', normaliseRoomCode('tak obe') === 'FONGAM');
// The truncation is what stops a long paste from becoming a different room.
check('anything past the length is discarded', normaliseRoomCode('FONGAMFGH') === 'FONGAM');
group('the alphabet');

check('is all 26 letters', ROOM_CODE_ALPHABET.length === 26, ROOM_CODE_ALPHABET);
// O and I are back, and that is the point of dropping the digits: they were excluded
// only because O/0 and I/1 are the same shape, and there is no 0 or 1 any more.
check('including the two the digits used to cost us',
  ROOM_CODE_ALPHABET.includes('O') && ROOM_CODE_ALPHABET.includes('I'));
check('and no digits at all', !/[0-9]/.test(ROOM_CODE_ALPHABET), ROOM_CODE_ALPHABET);
check('split five and twenty-one, with nothing in both or neither',
  ROOM_CODE_VOWELS.length === 5 &&
    ROOM_CODE_CONSONANTS.length === 21 &&
    ![...ROOM_CODE_VOWELS].some((v) => ROOM_CODE_CONSONANTS.includes(v)));

// `throw`, not `process.exit`: this project ships no `@types/node` on purpose, so `process`
// is not a name TypeScript knows here. A thrown error still exits non-zero under node, which
// is all the npm script needs. Same shape as the other .test.ts files.
if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
