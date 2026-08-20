import { render } from 'preact';
import { NeonRoom } from './games/neon-fall/NeonRoom';
import { CARD as game } from './games/neon-fall/card';
import { LocaleProvider } from './core/i18n/LocaleContext';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/neon-fall/neon.css';

// Its own card, not a lookup in the catalogue: this page needs one game, and
// importing the registry pulled all fifteen cards and their art URLs into this
// bundle.

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(
  <LocaleProvider>
    <NeonRoom game={game} />
  </LocaleProvider>,
  root,
);
