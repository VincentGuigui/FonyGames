import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every playable game ends on the shared end screen.
 * Spec: docs/design/game-chrome.md §8 · component: core/ui/GameOver.tsx
 *
 * A static check, and deliberately so. Driving nine games to their last frame in a browser
 * costs minutes and needs sensors, two phones and a bit of luck for half of them — so the
 * expensive harnesses cover a handful of representative games, and this covers the one
 * failure that would otherwise slip through them: a game that simply never got migrated,
 * or a NEW game that grows its own ending because nobody remembered there was a shared one.
 *
 * It asserts the presence of the import and, separately, that the old endings are gone:
 * four games used to finish by dropping back into the lobby with a `standings` panel, and
 * an import left beside a still-live copy of the old ending would pass a naive check while
 * the player still saw the old screen.
 */

const here = dirname(fileURLToPath(import.meta.url));

let failures = 0;
let checks = 0;

function check(what, ok, detail) {
  checks++;
  if (ok) {
    console.log(`  ok   ${what}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${what}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

/** Every game folder that has a card marked `live` — the ones a player can finish. */
function liveGames() {
  return readdirSync(here, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((slug) => {
      try {
        return /status:\s*'live'/.test(readFileSync(join(here, slug, 'card.ts'), 'utf8'));
      } catch {
        return false;
      }
    })
    .sort();
}

/** Every `.tsx` in a game folder, concatenated — the ending can live in any of them. */
function sourceOf(slug) {
  return readdirSync(join(here, slug))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => readFileSync(join(here, slug, f), 'utf8'))
    .join('\n');
}

const games = liveGames();

console.log('\nthe catalogue is what it says it is');

check('there are live games to check', games.length >= 8, games);

console.log('\nevery live game ends on the shared screen');

for (const slug of games) {
  const src = sourceOf(slug);
  // Tap Duel's ending lives in `games/tap-duel/Duel.tsx`, Steady Hand's in its Room, Shake
  // Rush's in its Screen — hence "anywhere in the folder" rather than a named file.
  check(`${slug} renders GameOverScreen`, /<GameOverScreen\b/.test(src), slug);
}

console.log('\nand the endings it replaced are gone');

for (const slug of games) {
  const src = sourceOf(slug);
  // The lobby slot that four games used to end in. The prop no longer exists, so this is
  // belt and braces — but it is the specific shape of the bug this change fixed.
  check(`${slug} does not end in the lobby`, !/standings=/.test(src), slug);
  // The hand-rolled result lists, by their own class names.
  check(`${slug} has no result list of its own`,
    !/class="scoreline|__placing|__trophy/.test(src), slug);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
