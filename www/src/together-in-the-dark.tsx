import { render } from 'preact';
import { DarkRoom } from './games/together-in-the-dark/DarkRoom';
import { CARD as game } from './games/together-in-the-dark/card';
import { LocaleProvider } from './core/i18n/LocaleContext';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/together-in-the-dark/together-in-the-dark.css';

// Its own card, not a lookup in the catalogue: this page needs one game, and
// importing the registry pulled every game's card and art URL into this bundle.

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(
  <LocaleProvider>
    <DarkRoom game={game} />
  </LocaleProvider>,
  root,
);
