import { render } from 'preact';
import { Hub } from './hub/Hub';
import './core/ui/theme.css';
import './hub/hub.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

render(<Hub />, root);
