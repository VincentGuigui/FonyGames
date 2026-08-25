import { render } from 'preact';
import { UfoRoom } from './games/ufo-hunt/UfoRoom';
import { CARD as game } from './games/ufo-hunt/card';
import { LocaleProvider } from './core/i18n/LocaleContext';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/ufo-hunt/ufo-hunt.css';

// Its own card, not a lookup in the catalogue: this page needs one game, and
// importing the registry pulled every game's card and art URL into this bundle.

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(
  <LocaleProvider>
    <UfoRoom game={game} />
  </LocaleProvider>,
  root,
);
