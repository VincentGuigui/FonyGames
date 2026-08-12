import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../core/types';
import { JoinByCode } from '../core/ui/JoinByCode';
import { HowToPlay } from '../core/ui/HowToPlay';
import { Disclosure } from '../core/ui/Disclosure';
import { mintRoomCode, readRoomHash } from '../core/room/useRoom';

type Tab = 'create' | 'join';

/**
 * Start a room, or join a friend's. Shown when the hash is empty.
 * Spec: docs/specs/join.md §Landing on a game page
 *
 * Opening a game page used to mint a code and connect immediately, so you were the host of a
 * new room before deciding you wanted one, and anyone who came to *join* had to go back to the
 * hub to type their code. Merely browsing the catalogue created rooms.
 *
 * **Create is the default tab**, because of who actually reaches this screen. A valid hash goes
 * straight to the lobby and the hub's code field navigates straight to a lobby, so the only way
 * to land here is to tap a game card on the hub — which means very nearly everyone who sees
 * this just chose a game and wants to start it. Opening on Join charged all of them a tap and
 * presented an empty code field to someone with no code. If the guess is wrong it costs one tap
 * to Join, which is the cheaper of the two mistakes.
 *
 * The code itself is **not** shown here. It lives in the lobby, once, with Share and QR beside
 * it — showing it on both screens meant the host met the same panel twice with a button in
 * between whose only visible effect was "that panel again".
 */
export function RoomChoice({
  card,
  onEnter,
  /** Shown above the tabs — the damaged-link case passes its explanation here. */
  notice,
}: {
  card: GameCard;
  onEnter: (code: string) => void;
  notice?: string;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>('create');

  /*
   * Nothing is minted until this is tapped, so browsing the catalogue still creates no rooms.
   * The hash is read first: if a code is already sitting there — a reload, or a return from the
   * Join tab — it is reused rather than replaced, so a code that may already have been read out
   * loud does not change underneath the player.
   */
  function create(): void {
    const hash = readRoomHash();
    onEnter(hash.kind === 'code' ? hash.code : mintRoomCode());
  }

  return (
    <div class="choice" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
      <header class="choice__header">
        <a class="lobby__back" href="/">
          ← All games
        </a>
        <h1 class="lobby__title">{card.title}</h1>
        <p class="lobby__pitch">{card.pitch}</p>
      </header>

      {notice && (
        <p class="lobby__error" role="alert">
          {notice}
        </p>
      )}

      {/*
        Above the choice, and open: deciding whether to start a room or wait for a friend's code
        is a decision about *this* game, so the rules come before the tabs rather than below
        them. It collapses if you already know the game.
      */}
      <Disclosure heading="How to play" open>
        <HowToPlay concept={card.concept} rules={card.rules} />
      </Disclosure>

      {/*
        A real tablist, so a keyboard and a screen reader get the same two choices a thumb does.
        `aria-selected` rather than only a class: the highlight is what a sighted player reads
        state from, and it must not be the only thing carrying it.
      */}
      <div class="choice__tabs" role="tablist" aria-label="Start or join a room">
        {(
          [
            ['create', 'Create a room'],
            ['join', 'Join a room'],
          ] as const
        ).map(([value, text]) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`choice-tab-${value}`}
            aria-selected={tab === value}
            aria-controls={`choice-panel-${value}`}
            class={`choice__tab ${tab === value ? 'choice__tab--on' : ''}`}
            onClick={() => setTab(value)}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === 'create' ? (
        <section
          class="choice__panel"
          role="tabpanel"
          id="choice-panel-create"
          aria-labelledby="choice-tab-create"
        >
          <button class="btn btn--primary btn--big choice__enter" type="button" onClick={create}>
            Create the room
          </button>
          <p class="choice__hint">
            You'll get a code and a link to share — everyone who opens it lands in your room.
          </p>
        </section>
      ) : (
        <section
          class="choice__panel"
          role="tabpanel"
          id="choice-panel-join"
          aria-labelledby="choice-tab-join"
        >
          {/*
            `onSameGame` is what stops this silently doing nothing. A code for THIS game resolves
            to `/<slug>/#CODE`, and navigating to a URL that differs only in its hash does not
            reload — the chooser would sit there with the URL already pointing at a room nobody
            entered. A code for another game navigates as it does on the hub.
          */}
          <JoinByCode label="Got a code from a friend?" slug={card.slug} onSameGame={onEnter} />
          <p class="choice__hint">
            Any FonyGames code works here — it finds the right game on its own.
          </p>
        </section>
      )}
    </div>
  );
}
