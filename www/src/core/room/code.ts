/**
 * Room codes. 6 characters, uppercase, with the ambiguous glyphs removed so a
 * code read aloud across a noisy room survives (docs/multiplayer.md §1).
 *
 * Excluded on purpose: O, 0, I and 1.
 *
 * ## Six, shown as two groups of three
 *
 * The stored and transmitted form is always six bare characters — `ABCDEF`. The dash
 * in `ABC-DEF` is **presentation only**: it never reaches a URL, a WebSocket, or a
 * Durable Object name, because `idFromName` would then route `ABC-DEF` and `ABCDEF`
 * to two different rooms and two people reading the same code aloud would end up
 * alone in separate rooms.
 *
 * Grouping exists because six is past the span most people hold in one glance —
 * three-and-three is how phone numbers and postcodes have always been written — and
 * because it gives someone reading it out a natural place to pause.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

/** How many characters per displayed group. `ROOM_CODE_LENGTH` must divide by it. */
export const ROOM_CODE_GROUP = 3;

const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/**
 * Make typed input comparable: uppercase, then drop anything outside the
 * alphabet. Someone typing the letter O or the digit 0 has typed a character
 * no code contains, so it is discarded rather than guessed at.
 *
 * This is also what makes a pasted `ABC-DEF` work: the dash is not in the alphabet,
 * so it falls away like any other stray character and the six real ones remain.
 */
export function normaliseRoomCode(input: string): string {
  const allowed = new Set(ROOM_CODE_ALPHABET);
  return [...input.toUpperCase()]
    .filter((ch) => allowed.has(ch))
    .slice(0, ROOM_CODE_LENGTH)
    .join('');
}

export function isRoomCode(value: string): boolean {
  return ROOM_CODE_RE.test(value);
}

/**
 * A code as a human should read it: `ABC-DEF`.
 *
 * The one place the dash is added, so a code cannot be grouped one way on the hub and
 * another in a lobby. Takes whatever it is given — a partial code while someone is
 * still typing, or a bare six — and never pads or truncates, because a formatter that
 * invents characters would show a code nobody can use.
 */
export function formatRoomCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += ROOM_CODE_GROUP) {
    groups.push(code.slice(i, i + ROOM_CODE_GROUP));
  }
  return groups.join('-');
}

/** Generate a room code, uniformly over the alphabet. */
export function generateRoomCode(
  randomIndex: (bound: number) => number = cryptoRandomIndex,
): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET.charAt(randomIndex(ROOM_CODE_ALPHABET.length));
  }
  return out;
}

function cryptoRandomIndex(bound: number): number {
  const buf = new Uint8Array(1);
  crypto.getRandomValues(buf);
  // The alphabet is 32 characters and 256 is an exact multiple of 32, so the
  // modulo is uniform with no rejection sampling. Revisit if the alphabet
  // changes to a length that does not divide 256.
  return (buf[0] ?? 0) % bound;
}
