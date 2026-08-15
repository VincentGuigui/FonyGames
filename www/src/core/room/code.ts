/**
 * Room codes. Six letters, uppercase, arranged so they can be said out loud.
 *
 * ## Why letters only, and why alternating
 *
 * The old alphabet was 24 letters plus 8 digits, drawn uniformly — so a code came out as
 * `K7P4X2`, which is a *password*. Codes here are not typed off a screen by one person;
 * they are **shouted across a room**, and a string of unrelated glyphs has to be spelled
 * out character by character, twice, over other people's noise.
 *
 * So: no digits, all 26 letters, and each group of three alternates between vowels and
 * consonants. A triplet is `CVC` or `VCV` — `TAK`, `OBE` — which means every code is two
 * syllables you can simply *say*: `TAK-OBE`, `RUP-ADI`. Nothing has to be spelled unless
 * the listener asks.
 *
 * Dropping the digits also gives O and I back. They were excluded because O/0 and I/1 are
 * the same shape in most fonts — a real problem in an alphabet containing both, and no
 * problem at all in one that contains no digits for them to be mistaken for.
 *
 * ## Six, shown as two groups of three
 *
 * The stored and transmitted form is always six bare characters — `TAKOBE`. The dash in
 * `TAK-OBE` is **presentation only**: it never reaches a URL, a WebSocket, or a Durable
 * Object name, because `idFromName` would then route `TAK-OBE` and `TAKOBE` to two
 * different rooms and two people reading the same code aloud would end up alone in
 * separate rooms.
 *
 * The grouping is also the unit the pattern works in, which is not a coincidence: a group
 * is a syllable, and the pause between them is where a reader breathes.
 *
 * ## How many there are
 *
 * A triplet is 26 × 5 × 21 = 2 730 either way round (the first letter is free, and the two
 * after it are determined in class by it), so a code is one of **7 452 900**. That is far
 * fewer than the old billion, and it is enough: codes live only as long as a room does,
 * and at a hundred rooms at once the chance of any two colliding is under a tenth of a
 * percent. Being sayable is worth more than the digits were.
 */

/** Kept separate because the pattern below is about which of the two a letter is in. */
export const ROOM_CODE_VOWELS = 'AEIOU';
export const ROOM_CODE_CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';

/** Every character a code may contain. Used for cleaning up typed input. */
export const ROOM_CODE_ALPHABET = ROOM_CODE_VOWELS + ROOM_CODE_CONSONANTS;
export const ROOM_CODE_LENGTH = 6;

/** How many characters per displayed group. `ROOM_CODE_LENGTH` must divide by it. */
export const ROOM_CODE_GROUP = 3;

const VOWELS = new Set(ROOM_CODE_VOWELS);

/**
 * Is this triplet one of the two sayable shapes — `CVC` or `VCV`?
 *
 * Stated as "the middle letter is the other kind, and the ends are the same kind", which is
 * both shapes at once and cannot drift apart the way two separate patterns would.
 */
function sayable(triplet: string): boolean {
  if (triplet.length !== ROOM_CODE_GROUP) return false;
  const [a, b, c] = triplet;
  if (a === undefined || b === undefined || c === undefined) return false;
  const first = VOWELS.has(a);
  return VOWELS.has(c) === first && VOWELS.has(b) !== first;
}

/**
 * Make typed input comparable: uppercase, then drop anything outside the alphabet.
 *
 * This is what makes a pasted `TAK-OBE` work — the dash is not a letter, so it falls away
 * like any other stray character and the six real ones remain. A digit falls away the same
 * way rather than being read as the letter it resembles: the result is then the wrong
 * length and is reported as a damaged link, which is the honest answer.
 */
export function normaliseRoomCode(input: string): string {
  const allowed = new Set(ROOM_CODE_ALPHABET);
  return [...input.toUpperCase()]
    .filter((ch) => allowed.has(ch))
    .slice(0, ROOM_CODE_LENGTH)
    .join('');
}

/**
 * A real code — the right length, all letters, and both triplets sayable.
 *
 * The pattern is checked, not just the length. A code that does not fit it cannot have come
 * from `generateRoomCode`, so treating it as one would send somebody into an empty room of
 * their own making and leave them waiting for friends who are somewhere else. Only about
 * one in forty random six-letter strings fits the shape, so most mis-hearings — a vowel
 * where a consonant belongs — are caught here rather than becoming a room.
 */
export function isRoomCode(value: string): boolean {
  if (value.length !== ROOM_CODE_LENGTH) return false;
  for (let i = 0; i < value.length; i += ROOM_CODE_GROUP) {
    if (!sayable(value.slice(i, i + ROOM_CODE_GROUP))) return false;
  }
  return true;
}

/**
 * A code as a human should read it: `TAK-OBE`.
 *
 * The one place the dash is added, so a code cannot be grouped one way on the hub and
 * another in a lobby. Takes whatever it is given — a partial code while someone is still
 * typing, or a bare six — and never pads or truncates, because a formatter that invented
 * characters would show a code nobody can use.
 */
export function formatRoomCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += ROOM_CODE_GROUP) {
    groups.push(code.slice(i, i + ROOM_CODE_GROUP));
  }
  return groups.join('-');
}

/**
 * Generate a room code: two sayable triplets.
 *
 * The first letter of each triplet is drawn from the whole alphabet and **decides the
 * shape** — a vowel makes it `VCV`, a consonant `CVC`. Which is not only the simplest way
 * to write it but also the fair one: 26 × 5 × 21 and 26 × 21 × 5 are the same number, so
 * every one of the 2 730 triplets comes up equally often. Choosing the shape first and
 * then the letters would make the 525 `VCV` triplets four times as likely each as the
 * 2 205 `CVC` ones.
 */
export function generateRoomCode(
  randomIndex: (bound: number) => number = cryptoRandomIndex,
): string {
  const pick = (from: string): string => from.charAt(randomIndex(from.length));

  let out = '';
  for (let group = 0; group < ROOM_CODE_LENGTH / ROOM_CODE_GROUP; group++) {
    const head = pick(ROOM_CODE_ALPHABET);
    const inner = VOWELS.has(head) ? ROOM_CODE_CONSONANTS : ROOM_CODE_VOWELS;
    const outer = VOWELS.has(head) ? ROOM_CODE_VOWELS : ROOM_CODE_CONSONANTS;
    out += head + pick(inner) + pick(outer);
  }
  return out;
}

/**
 * A uniform index below `bound`, with the biased tail thrown away.
 *
 * The old alphabet was 32 characters and 256 divided by it exactly, so a plain modulo was
 * uniform. None of 26, 21 or 5 divides 256 — a bare `% 26` would make the first six letters
 * of the alphabet ten percent likelier than the rest — so bytes in the short final block
 * are rejected and redrawn instead.
 */
function cryptoRandomIndex(bound: number): number {
  const limit = Math.floor(256 / bound) * bound;
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const byte = buf[0] ?? 0;
    if (byte < limit) return byte % bound;
  }
}
