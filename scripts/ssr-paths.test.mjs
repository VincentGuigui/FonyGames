import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { importUrl, jsPath, viteKey } from './ssr-paths.mjs';

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

console.log('\ngenerated JavaScript paths');

const windows = String.raw`C:\dev factory\My\FonyGames\www\src\hub\Hub.tsx`;
const literal = jsPath(windows);
const roundTrip = Function(`return ${literal}`)();
check('a Windows path survives generated JavaScript', roundTrip === windows, { literal, roundTrip });
check('its backslashes were escaped', literal.includes('\\\\dev factory\\\\My'), literal);

const quoted = `/tmp/it's a game/Hub.tsx`;
check('quotes and spaces survive too', Function(`return ${jsPath(quoted)}`)() === quoted);
check(
  'a Windows relative path matches a Vite manifest key',
  viteKey(String.raw`src\games\spill\art\card.svg`) === 'src/games/spill/art/card.svg',
);
check('a POSIX manifest key stays untouched', viteKey('src/games/spill/art/card.svg') === 'src/games/spill/art/card.svg');

console.log('\ndynamic import URLs');

const local = resolve('node_modules/.cache/ssr.mjs');
const url = importUrl(local);
check('the URL uses the file scheme', url.startsWith('file://'), url);
check('the URL contains no backslash', !url.includes('\\'), url);
check('the file URL returns to the same local path', fileURLToPath(url) === local, { url, local });

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
