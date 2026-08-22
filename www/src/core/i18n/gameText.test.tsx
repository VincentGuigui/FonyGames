import { renderToString } from 'preact-render-to-string';
import { LocaleTestProvider } from './LocaleContext';
import { useGameText } from './gameText';

let failures = 0;
let checks = 0;

function check(what: string, ok: boolean): void {
  checks++;
  if (ok) console.log(`  ok   ${what}`);
  else {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}

function Sample(): preact.JSX.Element {
  const text = useGameText();
  return <p>{text({ en: 'Ready to shake', fr: 'Prêt à secouer' })}</p>;
}

const render = (locale: 'en' | 'fr'): string =>
  renderToString(
    <LocaleTestProvider locale={locale}>
      <Sample />
    </LocaleTestProvider>,
  );

check('English selects the game-owned English text', render('en').includes('Ready to shake'));
check('French selects the game-owned French text', render('fr').includes('Prêt à secouer'));

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
