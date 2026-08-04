import { render } from 'preact';
import { Lobby } from './lobby/Lobby';
import { CARD as game } from './games/tap-duel/card';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';

// Its own card, not a lookup in the catalogue: this page needs one game, and
// importing the registry pulled all thirteen cards and their art URLs into this
// bundle. It also removes a runtime throw that could only fire if the registry and
// this file disagreed, which is now impossible.

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(<Lobby game={game} />, root);
