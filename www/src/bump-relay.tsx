import { render } from 'preact';
import { BumpRoom } from './games/bump-relay/BumpRoom';
import { CARD as game } from './games/bump-relay/card';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/bump-relay/bump.css';

// Its own card, not a lookup in the catalogue: this page needs one game, and
// importing the registry pulled all thirteen cards and their art URLs into this
// bundle.

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(<BumpRoom game={game} />, root);
