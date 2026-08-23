import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { BUILT_GAMES, PLAYERS } from '../../../shared/players';
import type { Room } from '../core/room/useRoom';
import { useActiveRoom } from '../core/room/active';
import { Sheet } from '../core/ui/Sheet';
import { useGameText } from '../core/i18n/gameText';
import { GameIllustration } from '../hub/GameIllustration';
import type { GameCard } from '../core/types';

// Only routes that exist may be offered. The soon cards remain advertisements on the hub.
const games = [...BUILT_GAMES];

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
  const [cards, setCards] = useState<GameCard[]>([]);
  useEffect(() => { if (open && cards.length === 0) void import('../games/registry').then((module) => setCards(module.catalogue())); }, [open, cards.length]);
  if (!client || !code || !current || !host) return null;
  const connected = snapshot?.players.filter((player) => player.connected).length ?? 0;
  const choices = cards.filter((card) => {
    if (card.slug === current || !(games as readonly string[]).includes(card.slug)) return false;
    const limits = PLAYERS[card.slug as keyof typeof PLAYERS];
    return connected >= limits[0] && connected <= limits[1];
  });
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
        <GameIllustration art={card.art} accent={card.accent} /><span class="game-switcher__card-title">{card.title}</span><span class="game-switcher__card-pitch">{card.pitch}</span>
      </button>)}</div> : <div class="game-switcher__confirm">
        <p>{text({ en: `Bring the ${connected - 1} other player(s) along to ${chosenCard?.title ?? chosen}?`, fr: `Faire venir les ${connected - 1} autre(s) joueur(s) vers ${chosenCard?.title ?? chosen} ?` })}</p>
        <button class="btn btn--big" type="button" onClick={bring}>{text({ en: 'Bring everyone', fr: 'Faire venir tout le monde' })}</button>
        <button class="btn btn--big" type="button" onClick={leave}>{text({ en: 'Go alone', fr: 'Continuer seul' })}</button>
        <button class="btn btn--big" type="button" onClick={() => setChosen(null)}>{text({ en: 'Back to games', fr: 'Retour aux jeux' })}</button>
      </div>}
    </Sheet>}
  </>;
}
