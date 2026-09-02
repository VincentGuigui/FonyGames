import { render } from 'preact';
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { BUILT_GAMES } from '../../shared/players';
import { LocaleProvider } from './core/i18n/LocaleContext';
import { useGameText } from './core/i18n/gameText';
import './core/ui/theme.css';

/**
 * The "Random game" card's own page. Not a game — it never opens a room. It exists so
 * the card can be an ordinary `<a href="/random-game/">` like every other card
 * (`docs/design/illustrations.md`), while what actually happens is chosen here,
 * client-side, the instant the page loads: one of the built games, picked at random,
 * replacing this page in history so the back button returns to the hub rather than
 * bouncing through here again.
 */
function pickBuiltGame(): string {
  const i = Math.floor(Math.random() * BUILT_GAMES.length);
  return BUILT_GAMES[i] ?? BUILT_GAMES[0];
}

function Rolling(): JSX.Element {
  const text = useGameText();
  useEffect(() => {
    location.replace(`/${pickBuiltGame()}/`);
  }, []);
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', textAlign: 'center' }}>
      <p>{text({ en: 'Rolling the dice…', fr: 'Lancer des dés…' })}</p>
    </main>
  );
}

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(
  <LocaleProvider>
    <Rolling />
  </LocaleProvider>,
  root,
);
