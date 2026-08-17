import { render } from 'preact';
import { SquashRoom } from './games/squash-mosquitoes/SquashRoom';
import { CARD as game } from './games/squash-mosquitoes/card';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/squash-mosquitoes/squash.css';

// Its own card, not a lookup in the catalogue: this page needs one game, and importing
// the registry pulled all fourteen cards and their art URLs into this bundle.

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(<SquashRoom game={game} />, root);
