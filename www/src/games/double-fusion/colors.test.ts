import { EMPTY_TILE, tileColor, tileTextColor } from './colors';

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

const values = Array.from({ length: 17 }, (_, i) => 2 ** (i + 1));
const hue = (v: number): number => Number(/hsl\((\d+)/.exec(tileColor(v))?.[1]);

console.log('\na tile\'s colour comes from its number (§2.2)');
check('an empty cell is the empty colour', tileColor(0) === EMPTY_TILE);
check('so is anything that is not a tile', tileColor(-4) === EMPTY_TILE && tileColor(Number.NaN) === EMPTY_TILE);
check('the same number is always the same colour', tileColor(64) === tileColor(64));
check('every tile from 2 to 131072 has a colour of its own', new Set(values.map(tileColor)).size === values.length);
check('none of them is the empty colour', values.every((v) => tileColor(v) !== EMPTY_TILE));

let apart = true;
for (let i = 1; i < values.length; i++) {
  const d = Math.abs(hue(values[i] as number) - hue(values[i - 1] as number));
  if (Math.min(d, 360 - d) < 30) apart = false;
}
check('neighbouring doublings are a clear step apart on the wheel', apart);

check('a number is dark or light on its tile', values.every((v) => ['#10131a', '#ffffff'].includes(tileTextColor(v))));
check('an empty cell has no number to read', tileTextColor(0) === 'transparent');
check('a bright green gets dark text', tileTextColor(2 ** 9) === '#10131a');
check('a deep blue gets light text', tileTextColor(2) === '#ffffff');

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall ${checks} passed`);
