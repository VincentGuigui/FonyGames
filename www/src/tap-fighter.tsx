import { render } from 'preact';
import { LocaleProvider } from './core/i18n/LocaleContext';
import { TapFighterRoom } from './games/tap-fighter/TapFighterRoom';
import { CARD as game } from './games/tap-fighter/card';
import './core/ui/theme.css';
import './lobby/lobby.css';
import './core/ui/game-chrome.css';
import './games/tap-fighter/tap-fighter.css';
import './games/tap-fighter/rhythm.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');
render(<LocaleProvider><TapFighterRoom game={game} /></LocaleProvider>, root);
