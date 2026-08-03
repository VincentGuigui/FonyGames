import { render } from 'preact';
import { SlingRoom } from './games/sling-puck/SlingRoom';
import { GAMES } from './games/registry';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/sling-puck/sling.css';

const game = GAMES.find((g) => g.slug === 'sling-puck');
if (!game) throw new Error('sling-puck missing from the registry');

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(<SlingRoom game={game} />, root);
