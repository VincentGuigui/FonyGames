import { render } from 'preact';
import { Lobby } from './lobby/Lobby';
import { GAMES } from './games/registry';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';

const game = GAMES.find((g) => g.slug === 'tap-duel');
if (!game) throw new Error('tap-duel missing from the registry');

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(<Lobby game={game} />, root);
