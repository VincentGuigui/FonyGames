import { render } from 'preact';
import { SpillRoom } from './games/spill/SpillRoom';
import { GAMES } from './games/registry';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/spill/spill.css';

const game = GAMES.find((g) => g.slug === 'spill');
if (!game) throw new Error('spill missing from the registry');

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(<SpillRoom game={game} />, root);
