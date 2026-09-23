import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { switchableGames } from '../../../shared/players';
import type { GameCard } from '../core/types';
import type { Room } from '../core/room/useRoom';
import { useActiveRoom } from '../core/room/active';
import { Sheet } from '../core/ui/Sheet';
import { CloseButton } from '../core/ui/CloseButton';
import { GameIllustration } from '../core/ui/GameIllustration';
import { useGameText } from '../core/i18n/gameText';
import { useLocale } from '../core/i18n/LocaleContext';
import { localizeCard } from '../core/i18n/localizeCard';

export function GameSwitcher(props: { room?: Room; code?: string; game?: string }): JSX.Element | null {
  const active = useActiveRoom();
  const text = useGameText();
  const { locale } = useLocale();
  const room = props.room ?? undefined;
  const current = props.game ?? active?.game;
  const code = props.code ?? active?.code;
  const snapshot = room?.room ?? active?.room;
  const client = room?.client ?? active?.client;
  const host = room?.isHost ?? Boolean(snapshot?.hostId && active?.client.playerId === snapshot.hostId);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<Map<string, GameCard> | null>(null);

  /*
   * Loaded once, only after the sheet opens, and dynamically — never a top-level
   * import of the registry. A game page ships its own card only, never the whole
   * catalogue (docs/architecture.md §4); this switcher is mounted on every game
   * page, so a static import here would put all thirty cards' art in every bundle.
   */
  useEffect(() => {
    if (!open || catalogue) return;
    let cancelled = false;
    void import('../games/registry').then(({ catalogue: load }) => {
      if (!cancelled) setCatalogue(new Map(load().map((card) => [card.slug, card])));
    });
    return () => {
      cancelled = true;
    };
  }, [open, catalogue]);

  if (!client || !code || !current || !host) return null;
  const connected = snapshot?.players.filter((player) => player.connected).length ?? 0;
  const choices = switchableGames(current, connected).map((slug) => {
    const card = catalogue?.get(slug);
    const localized = card ? localizeCard(card, locale) : null;
    return {
      slug,
      card: localized,
      // Falls back to the slug, title-cased, until the registry has loaded.
      title: localized?.title ?? slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
    };
  });
  const chosenCard = chosen ? choices.find((card) => card.slug === chosen) : undefined;
  const choose = (game: string) => setChosen(game);
  const leave = () => { if (chosen) window.location.assign(`/${chosen}/`); };
  const bring = () => { if (chosen) client.send({ t: 'switch-game', d: { game: chosen, bring: true } }); };
  const close = () => { setOpen(false); setChosen(null); };
  return <>
    <button class="btn game-switcher__button" type="button" onClick={() => setOpen(true)}>
      {text({ en: 'Bring everyone to another game', fr: 'Emmener tout le monde vers un autre jeu' })}
    </button>
    {open && <Sheet label={text({ en: 'Choose a game', fr: 'Choisir un jeu' })} onClose={close}>
      <div class="game-switcher__head">
        <h2>{text({ en: 'Choose a game', fr: 'Choisir un jeu' })}</h2>
        <CloseButton label={text({ en: 'Close', fr: 'Fermer' })} onClose={close} />
      </div>
      {!chosen ? <div class="game-switcher__list">{choices.map((choice) => <button key={choice.slug} class="game-switcher__card" type="button" onClick={() => choose(choice.slug)}>
        {choice.card
          ? <span class="game-switcher__card-art"><GameIllustration art={choice.card.art} accent={choice.card.accent} /></span>
          : <span class="game-switcher__card-art game-switcher__card-art--letter" aria-hidden="true">{choice.title.slice(0, 1)}</span>}
        <span class="game-switcher__card-title">{choice.title}</span><span class="game-switcher__card-pitch">{text({ en: 'Bring everyone to this game', fr: 'Emmener tout le monde vers ce jeu' })}</span>
      </button>)}</div> : <div class="game-switcher__confirm">
        <p>{text({ en: `Bring the ${connected - 1} other player(s) along to ${chosenCard?.title ?? chosen}?`, fr: `Faire venir les ${connected - 1} autre(s) joueur(s) vers ${chosenCard?.title ?? chosen} ?` })}</p>
        <button class="btn btn--big" type="button" onClick={bring}>{text({ en: 'Bring everyone', fr: 'Faire venir tout le monde' })}</button>
        <button class="btn btn--big" type="button" onClick={leave}>{text({ en: 'Go alone', fr: 'Continuer seul' })}</button>
        <button class="btn btn--big" type="button" onClick={() => setChosen(null)}>{text({ en: 'Back to games', fr: 'Retour aux jeux' })}</button>
      </div>}
    </Sheet>}
  </>;
}
