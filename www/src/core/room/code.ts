/**
 * Room codes. 4 characters, uppercase, with the ambiguous glyphs removed so a
 * code read aloud across a noisy room survives (docs/multiplayer.md §1).
 *
 * Excluded on purpose: O, 0, I and 1.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/**
 * Make typed input comparable: uppercase, then drop anything outside the
 * alphabet. Someone typing the letter O or the digit 0 has typed a character
 * no code contains, so it is discarded rather than guessed at.
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
