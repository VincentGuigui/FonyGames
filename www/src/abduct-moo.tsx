import { render } from 'preact';
import { AbductRoom } from './games/abduct-moo/AbductRoom';
import { CARD as game } from './games/abduct-moo/card';
import { LocaleProvider } from './core/i18n/LocaleContext';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/abduct-moo/abduct-moo.css';

// Its own card, not a lookup in the catalogue: this page needs one game, and
// importing the registry pulled every game's card and art URL into this bundle.

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(
  <LocaleProvider>
    <AbductRoom game={game} />
  </LocaleProvider>,
  root,
);
