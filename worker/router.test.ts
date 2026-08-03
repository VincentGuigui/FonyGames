import { gameSlug, originAllowed } from './router';

/**
 * The router's two pure guards. Same harness shape as the game tests
 * (docs/testing.md §1.1) — plain functions, no Worker runtime needed.
 *
 * Both are here because both are **security** checks rather than conveniences,
 * and docs/testing.md §2 says a threshold gets a case that passes and one that
 * must not.
 */

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
  }
}

function slugs(): void {
  console.log('\nthe game slug a connection claims');

  check('a normal slug is kept', gameSlug('sling-puck') === 'sling-puck');
  check('so is a single word', gameSlug('spill') === 'spill');
  check('and digits are fine', gameSlug('tap-duel2') === 'tap-duel2');

  check('nothing is nothing', gameSlug(null) === null);
  check('empty is nothing', gameSlug('') === null);

  // The reason this function exists: the slug is stored, handed back to the hub,
  // and turned into a URL the hub navigates to. Anything that could steer that
  // navigation somewhere else has to be refused here (see index.ts).
  check('no traversal', gameSlug('../../evil') === null, gameSlug('../../evil'));
  check('no leading slash', gameSlug('/evil') === null);
  check('no protocol-relative URL', gameSlug('//evil.example') === null);
  check('no absolute URL', gameSlug('https://evil.example') === null);
  check('no scheme', gameSlug('javascript:alert(1)') === null);
  check('no query tacked on', gameSlug('spill?x=1') === null);
  check('no fragment tacked on', gameSlug('spill#x') === null);
  check('no dots', gameSlug('spill.html') === null);
  check('no underscores or spaces', gameSlug('a b') === null && gameSlug('a_b') === null);
  check('no uppercase', gameSlug('Spill') === null);
  check('must start with a letter', gameSlug('-spill') === null && gameSlug('1spill') === null);
  // Bounded, so a forged slug cannot be used to store an unbounded string.
  check('and it is bounded', gameSlug('a'.repeat(33)) === null && gameSlug('a'.repeat(32)) !== null);
}

function origins(): void {
  console.log('\nthe origin allow-list');

  const list = 'https://fonygames.guigui.fr, https://fonygames-dev.guigui.fr';
  check('an allowed origin passes', originAllowed('https://fonygames.guigui.fr', list));
  check('the other one too', originAllowed('https://fonygames-dev.guigui.fr', list));
  check('an unknown site is refused', !originAllowed('https://evil.example', list));
  // Prefix and suffix confusion, which a naive `includes` on the string would let
  // through.
  check('a lookalike suffix is refused', !originAllowed('https://evil-fonygames.guigui.fr', list));
  check('a lookalike prefix is refused', !originAllowed('https://fonygames.guigui.fr.evil.test', list));
  check('scheme matters', !originAllowed('http://fonygames.guigui.fr', list));

  // No Origin header means it is not a browser — curl, a native client, our own
  // tests. A page cannot suppress the header, so this is not a bypass.
  check('no origin at all is allowed through', originAllowed(null, list));
  check('an empty allow-list refuses every browser', !originAllowed('https://a.test', ''));
}

for (const t of [slugs, origins]) t();

if (failures > 0) throw new Error(`${failures} check(s) failed`);
console.log('\nall passed');
