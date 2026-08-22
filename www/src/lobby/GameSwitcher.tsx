import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { BUILT_GAMES, PLAYERS } from '../../../shared/players';
import type { Room } from '../core/room/useRoom';
import { useActiveRoom } from '../core/room/active';
import { Sheet } from '../core/ui/Sheet';
import { useGameText } from '../core/i18n/gameText';

// Only routes that exist may be offered. The soon cards remain advertisements on the hub.
const games = [...BUILT_GAMES];
function label(slug: string): string { return slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '); }

export function GameSwitcher(props: { room?: Room; code?: string; game?: string }): JSX.Element | null {
  const active = useActiveRoom();
  const text = useGameText();
  const room = props.room ?? undefined;
  const current = props.game ?? active?.game;
  const code = props.code ?? active?.code;
  const snapshot = room?.room ?? active?.room;
  const client = room?.client ?? active?.client;
  const host = room?.isHost ?? Boolean(snapshot?.hostId && active?.client.playerId === snapshot.hostId);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  if (!client || !code || !current || !host) return null;
  const connected = snapshot?.players.filter((player) => player.connected).length ?? 0;
  const choose = (game: string) => setChosen(game);
  const leave = () => { if (chosen) window.location.assign(`/${chosen}/`); };
  const bring = () => { if (chosen) client.send({ t: 'switch-game', d: { game: chosen, bring: true } }); };
  return <>
    <button class="btn btn--big" type="button" onClick={() => setOpen(true)}>{text({ en: 'Play a different game', fr: 'Jouer à un autre jeu' })}</button>
    {open && <Sheet label={text({ en: 'Choose a game', fr: 'Choisir un jeu' })} onClose={() => { setOpen(false); setChosen(null); }}>
      <h2>{text({ en: 'Choose a game', fr: 'Choisir un jeu' })}</h2>
      {!chosen ? <div class="game-switcher__list">{games.filter((game) => game !== current).map((game) => {
        const limits = PLAYERS[game as keyof typeof PLAYERS];
        const allowed = connected >= limits[0] && connected <= limits[1];
        return <button class="btn btn--big" type="button" disabled={!allowed} onClick={() => choose(game)}>{label(game)}{!allowed && ` — ${text({ en: 'roster does not fit', fr: 'effectif incompatible' })}`}</button>;
      })}</div> : <div class="game-switcher__confirm">
        <p>{text({ en: `Bring the ${connected - 1} other player(s) along to ${label(chosen)}?`, fr: `Faire venir les ${connected - 1} autre(s) joueur(s) vers ${label(chosen)} ?` })}</p>
        <button class="btn btn--big" type="button" onClick={bring}>{text({ en: 'Bring everyone', fr: 'Faire venir tout le monde' })}</button>
        <button class="btn btn--big" type="button" onClick={leave}>{text({ en: 'Go alone', fr: 'Continuer seul' })}</button>
      </div>}
    </Sheet>}
  </>;
}
