import { render } from 'preact';
import { SteadyRoom } from './games/steady-hand/SteadyRoom';
import { CARD as game } from './games/steady-hand/card';
import { LocaleProvider } from './core/i18n/LocaleContext';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/steady-hand/steady.css';

// Its own card, not a lookup in the catalogue: this page needs one game, and importing
// the registry pulled all thirteen cards and their art URLs into this bundle.

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(
  <LocaleProvider>
    <SteadyRoom game={game} />
  </LocaleProvider>,
  root,
);
