import { render } from 'preact';
import { SiegeRoom } from './games/goat-siege/SiegeRoom';
import { GAMES } from './games/registry';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/goat-siege/siege.css';

const game = GAMES.find((g) => g.slug === 'goat-siege');
if (!game) throw new Error('goat-siege missing from the registry');

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(<SiegeRoom game={game} />, root);
