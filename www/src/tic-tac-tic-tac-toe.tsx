import { render } from 'preact';
import { TttRoom } from './games/tic-tac-tic-tac-toe/TttRoom';
import { CARD as game } from './games/tic-tac-tic-tac-toe/card';
import { LocaleProvider } from './core/i18n/LocaleContext';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
const root = document.getElementById('app'); if (!root) throw new Error('#app missing from index.html');
render(<LocaleProvider><TttRoom game={game} /></LocaleProvider>, root);
