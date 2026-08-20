import { render } from 'preact';
import { SlingRoom } from './games/sling-puck/SlingRoom';
import { CARD as game } from './games/sling-puck/card';
import { LocaleProvider } from './core/i18n/LocaleContext';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/sling-puck/sling.css';

// Its own card, not a lookup in the catalogue: this page needs one game, and
// importing the registry pulled all thirteen cards and their art URLs into this
// bundle. It also removes a runtime throw that could only fire if the registry and
// this file disagreed, which is now impossible.

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(
  <LocaleProvider>
    <SlingRoom game={game} />
  </LocaleProvider>,
  root,
);
