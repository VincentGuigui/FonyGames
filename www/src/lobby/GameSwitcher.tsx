import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { switchableGames } from '../../../shared/players';
import type { Room } from '../core/room/useRoom';
import { useActiveRoom } from '../core/room/active';
import { Sheet } from '../core/ui/Sheet';
import { useGameText } from '../core/i18n/gameText';

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
  const choices = switchableGames(current, connected).map((slug) => ({
    slug,
    title: slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
  }));
  const chosenCard = chosen ? choices.find((card) => card.slug === chosen) : undefined;
  const choose = (game: string) => setChosen(game);
  const leave = () => { if (chosen) window.location.assign(`/${chosen}/`); };
  const bring = () => { if (chosen) client.send({ t: 'switch-game', d: { game: chosen, bring: true } }); };
  const close = () => { setOpen(false); setChosen(null); };
  return <>
    <button class="btn game-switcher__button" type="button" onClick={() => setOpen(true)}>{text({ en: 'Play a different game', fr: 'Jouer à un autre jeu' })}</button>
    {open && <Sheet label={text({ en: 'Choose a game', fr: 'Choisir un jeu' })} onClose={close}>
      <h2>{text({ en: 'Choose a game', fr: 'Choisir un jeu' })}</h2>
      <button class="btn game-switcher__close" type="button" onClick={close}>{text({ en: 'Close', fr: 'Fermer' })}</button>
      {!chosen ? <div class="game-switcher__list">{choices.map((card) => <button class="game-switcher__card" type="button" onClick={() => choose(card.slug)}>
        <span class="game-switcher__card-art" aria-hidden="true">{card.title.slice(0, 1)}</span><span class="game-switcher__card-title">{card.title}</span><span class="game-switcher__card-pitch">{text({ en: 'Bring this game to the room', fr: 'Apporter ce jeu dans la salle' })}</span>
      </button>)}</div> : <div class="game-switcher__confirm">
        <p>{text({ en: `Bring the ${connected - 1} other player(s) along to ${chosenCard?.title ?? chosen}?`, fr: `Faire venir les ${connected - 1} autre(s) joueur(s) vers ${chosenCard?.title ?? chosen} ?` })}</p>
        <button class="btn btn--big" type="button" onClick={bring}>{text({ en: 'Bring everyone', fr: 'Faire venir tout le monde' })}</button>
        <button class="btn btn--big" type="button" onClick={leave}>{text({ en: 'Go alone', fr: 'Continuer seul' })}</button>
        <button class="btn btn--big" type="button" onClick={() => setChosen(null)}>{text({ en: 'Back to games', fr: 'Retour aux jeux' })}</button>
      </div>}
    </Sheet>}
  </>;
}
