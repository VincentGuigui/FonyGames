import { renderToString } from 'preact-render-to-string';
import type { PlayerId } from '../../../../shared/protocol';
import { GameOver } from './GameOver';
import type { Room } from '../room/useRoom';

/**
 * The shared end screen's markup.
 * Component: core/ui/GameOver.tsx · spec: docs/design/game-chrome.md §8
 *
 * Rendered for real with `preact-render-to-string` — the same renderer the hub's build
 * uses — so these are assertions about what a player sees rather than about props. No DOM
 * and no browser, which is what makes it cheap enough to cover the cases a harness never
 * reaches: nobody won, a game with no numbers, a two-word value beside a unit.
 *
 * The browser harnesses cover the other half — that each GAME reaches this screen with its
 * rows filled in — because that is the half a string cannot answer.
 */

let failures = 0;
let checks = 0;

function check(what: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${what}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${what}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

const A = 'a' as PlayerId;
const B = 'b' as PlayerId;

const rows = [
  { id: A, avatar: '🦊', name: 'Ana', value: 12, unit: 'left' },
  { id: B, avatar: '🐢', name: 'Bo', value: 4, unit: 'left' },
];

function readyRoom(isHost: boolean, guestReady: boolean): Room {
  const players = [
    { id: A, avatar: '🦊', name: 'Ana', connected: true, ready: false },
    { id: B, avatar: '🐢', name: 'Bo', connected: true, ready: guestReady },
  ];
  const me = isHost ? players[0] : players[1];
  return {
    client: null,
    status: 'open',
    room: { code: 'ABCDEF', players, hostId: A },
    error: null,
    setError: () => {},
    me,
    isHost,
    connected: 2,
    setProfile: () => {},
  };
}

const html = (props: Partial<Parameters<typeof GameOver>[0]> = {}): string =>
  renderToString(
    <GameOver slug="demo" rows={rows} me={A} winner={A} canAct={true} onAgain={() => {}} {...props} />,
  );

console.log('\nwho won');

{
  check('the winner is named', html().includes('You won'));
  check('by name when it is not you', html({ me: B }).includes('Ana won'));
  check('their avatar is the crest', /gameover__crest[^>]*>🦊/.test(html()));
  // A round nobody won is a real state in five of these games — an emptied room, a duel
  // both players false-started, a hunt with no catches.
  check('nobody winning is said, not left blank',
    html({ winner: null }).includes('Nobody won that one'));
  check('and then no row is bold', !html({ winner: null }).includes('gameover__row--won'));
  check('a game with a side rather than a player says its own thing',
    html({ winner: null, headline: 'The mice got away' }).includes('The mice got away'));
}

console.log('\nthe rows');

{
  const out = html();
  check('everybody is listed', (out.match(/gameover__row/g) ?? []).length >= 2);
  check('exactly one row is the winner’s', (out.match(/gameover__row--won/g) ?? []).length === 1);
  check('and one is mine', (out.match(/gameover__row--me/g) ?? []).length === 1);
  check('the number is separated from its unit',
    out.includes('<span class="gameover__value">12</span>') && out.includes('gameover__unit'),
    out.slice(out.indexOf('gameover__value'), out.indexOf('gameover__value') + 120));

  // "caught left" is nonsense, so a word value drops the unit. Pass the Bomb, Cat and
  // Mouse and Shake Rush all mix words and numbers in the same column.
  const words = html({
    rows: [
      { id: A, avatar: '🦊', name: 'Ana', value: 'caught', unit: 'lives' },
      { id: B, avatar: '🐢', name: 'Bo', value: 3, unit: 'lives' },
    ],
  });
  check('a word value carries no unit', (words.match(/gameover__unit/g) ?? []).length === 1, words);

  const gone = html({ rows: [{ ...rows[0]!, out: true }, rows[1]!] });
  check('someone out is marked as out', gone.includes('gameover__row--out'));
}

console.log('\nwhat happens next');

{
  const mid = html({ onNext: () => {}, nextLabel: 'Next duel' });
  check('mid-match offers one button', mid.includes('Next duel'));
  // The whole point of the distinction: at 6–4 nobody wants to be asked whether to
  // abandon the match, so neither the play-again nor the exit is offered.
  check('and nothing else', !mid.includes('Play again') && !mid.includes('Leave game'));

  const done = html();
  check('a finished game offers to play again', done.includes('Play again'));
  check('and a way out', done.includes('Leave game'));
  check('the way out is a link, not a button',
    /<a class="btn btn--big gameover__leave" href="\/">/.test(done), done.slice(done.indexOf('gameover__leave') - 60));

  const guest = html({ canAct: false });
  check('a non-host is told who to wait for', guest.includes('The host starts the next one.'));
  check('is offered no start button', !guest.includes('Play again'));
  // Being a guest is not a reason to be stuck in a room whose host has wandered off.
  check('but can still leave', guest.includes('Leave game'));
  check('and can be told something else while waiting',
    html({ canAct: false, waiting: 'Waiting for the host to start a new match…' })
      .includes('start a new match'));

  const unreadyHost = html({ room: readyRoom(true, false) });
  check('the host cannot replay before the guest is ready', /gameover__go[^>]*disabled/.test(unreadyHost));
  check('the host is told what is missing', unreadyHost.includes('Waiting for every player to be ready.'));

  const readyGuest = html({ room: readyRoom(false, true), canAct: false });
  check('a guest can mark readiness on the result screen too', readyGuest.includes('Ready ✓'));
  check('the ready control exposes its pressed state', readyGuest.includes('aria-pressed="true"'));
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
