import { render } from 'preact';
import { GridRoom } from './games/grid-attack/GridRoom';
import { CARD as game } from './games/grid-attack/card';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/grid-attack/grid.css';

// Its own card, not a lookup in the catalogue: this page needs one game, and importing
// the registry pulled all fourteen cards and their art URLs into this bundle.

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(<GridRoom game={game} />, root);
