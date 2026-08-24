import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'www', 'src', 'games', 'tap-fighter', 'art');
const BASE = join(ROOT, 'fighter.svg');
const source = readFileSync(BASE, 'utf8').replace(/\r\n?/g, '\n');
const colorsSource = readFileSync(join(process.cwd(), 'www', 'src', 'games', 'tap-fighter', 'game.ts'), 'utf8');
const colors = Object.fromEntries([...colorsSource.matchAll(/\b(blue|green):\s*'(#(?:[0-9a-fA-F]{6}))'/g)].map((match) => [match[1], match[2]]));
if (!colors.blue || !colors.green) throw new Error('fighter sprites: game.ts colors are missing');
if (!source.includes('#d946ef')) throw new Error('fighter sprites: base must use #d946ef fuchsia');

const check = process.argv.includes('--check');
let stale = 0;
for (const [number, color] of [['1', colors.blue], ['2', colors.green]]) {
  const target = join(ROOT, `fighter-${number}.svg`);
  const expected = source.replaceAll('#d946ef', color);
  let current = null;
  try { current = readFileSync(target, 'utf8').replace(/\r\n?/g, '\n'); } catch { /* generated below */ }
  if (current === expected) continue;
  if (check) {
    stale++;
    console.log(`STALE fighter-${number}.svg`);
  } else {
    writeFileSync(target, expected);
    console.log(`wrote fighter-${number}.svg`);
  }
}
if (stale > 0) {
  console.error('Run "npm run art:fighter" and commit the generated sprites.');
  process.exit(1);
}
if (!check) console.log('fighter sprites generated from fighter.svg');
