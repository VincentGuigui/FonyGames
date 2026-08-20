import { render } from 'preact';
import { HuntRoom } from './games/ghost-hunt/HuntRoom';
import { CARD as game } from './games/ghost-hunt/card';
import { LocaleProvider } from './core/i18n/LocaleContext';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/ghost-hunt/ghost.css';

// Its own card, not a lookup in the catalogue: this page needs one game, and importing
// the registry pulled all thirteen cards and their art URLs into this bundle.

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(
  <LocaleProvider>
    <HuntRoom game={game} />
  </LocaleProvider>,
  root,
);
