/**
 * Auto-generated player identities. Nobody should have to type a nickname
 * before playing (docs/multiplayer.md §1) — they get a silly one and can
 * change it in a tap.
 *
 * Deliberately gender-neutral and harmless: these appear on a stranger's phone.
 */

const ADJECTIVES = [
  'Sneaky', 'Loud', 'Wobbly', 'Turbo', 'Sleepy', 'Grumpy', 'Slippery',
  'Fearless', 'Clumsy', 'Sparkly', 'Feral', 'Polite', 'Reckless', 'Smug',
];

const NOUNS = [
  'Otter', 'Pigeon', 'Waffle', 'Goblin', 'Mango', 'Badger', 'Kettle',
  'Cactus', 'Noodle', 'Walrus', 'Comet', 'Turnip', 'Gecko', 'Muffin',
];

export const AVATARS = [
  '🦊', '🐙', '🐸', '🦉', '🐼', '🦕', '🐝', '🦩', '🐧', '🦔', '🐳', '🦄',
];

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)] as T;
}

export function randomName(random: () => number = Math.random): string {
  return `${pick(ADJECTIVES, random)} ${pick(NOUNS, random)}`;
}

export function randomAvatar(random: () => number = Math.random): string {
  return pick(AVATARS, random);
}

/** Trim and bound a user-supplied name; empty input falls back to a random one. */
export function sanitiseName(input: string | undefined): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.replace(/\s+/g, ' ').trim().slice(0, 20);
  return trimmed.length > 0 ? trimmed : null;
}

/** Only an avatar from the known set is accepted — this string is rendered on other players' phones. */
export function sanitiseAvatar(input: string | undefined): string | null {
  return typeof input === 'string' && (AVATARS as string[]).includes(input)
    ? input
    : null;
}
