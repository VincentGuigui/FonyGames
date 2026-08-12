import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../core/types';
import { JoinByCode } from '../core/ui/JoinByCode';
import { CodeCard } from './parts';
import { mintRoomCode, readRoomHash, useShareRoom } from '../core/room/useRoom';

type Tab = 'join' | 'create';

/**
 * Join a friend's room, or start one. Shown when the hash is empty.
 * Spec: docs/specs/join.md §Landing on a game page
 *
 * Opening a game page used to mint a code and connect immediately, so you were the host of a
 * new room before deciding you wanted one, and anyone who came to *join* had to go back to
 * the hub to type their code. Merely browsing the catalogue created rooms.
 *
 * Both choices stay one tap apart, which is the point: a player who taps the wrong one loses
 * nothing. Tabs rather than two buttons that replace the screen, so the other option is
 * always visible.
 *
 * **Minting is not creating.** The room exists server-side only once someone connects, and
 * whoever connects first is host — so `onEnter` is what makes the creator the host. The code
 * is shareable before that, which is the trade: a link you can send while still looking at
 * the screen, at the cost of the host role if your friend opens it first.
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
  const [tab, setTab] = useState<Tab>('join');
  /*
   * Minted once, on the first switch to Create, and then read back from the hash.
   *
   * `readRoomHash()` first, so flipping Join → Create → Join → Create shows the SAME room
   * rather than minting a second one and abandoning the code that may already have been
   * shared. The hash is the source of truth; this state is only a cache of it.
   */
  const [created, setCreated] = useState<string | null>(null);

  function choose(next: Tab): void {
    setTab(next);
    if (next !== 'create' || created !== null) return;

    const hash = readRoomHash();
    setCreated(hash.kind === 'code' ? hash.code : mintRoomCode());
  }

  const code = created;

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
        A real tablist, so a keyboard and a screen reader get the same two choices a thumb
        does. `aria-selected` rather than only a class: the highlight is what a sighted
        player reads state from, and it must not be the only thing carrying it.
      */}
      <div class="choice__tabs" role="tablist" aria-label="Join or create a room">
        {(
          [
            ['join', 'Join a room'],
            ['create', 'Create a room'],
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
            onClick={() => choose(value)}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === 'join' ? (
        <section class="choice__panel" role="tabpanel" id="choice-panel-join" aria-labelledby="choice-tab-join">
          {/*
            `onSameGame` is what stops this silently doing nothing. A code for THIS game
            resolves to `/<slug>/#CODE`, and navigating to a URL that differs only in its
            hash does not reload — the chooser would sit there with the URL already pointing
            at a room nobody entered. A code for another game navigates as it does on the hub.
          */}
          <JoinByCode label="Got a code from a friend?" slug={card.slug} onSameGame={onEnter} />
          <p class="choice__hint">
            Any FonyGames code works here — it finds the right game on its own.
          </p>
        </section>
      ) : (
        <section class="choice__panel" role="tabpanel" id="choice-panel-create" aria-labelledby="choice-tab-create">
          {code !== null && <CreatePanel card={card} code={code} onEnter={onEnter} />}
        </section>
      )}
    </div>
  );
}

/**
 * The Create tab's body, split out for one reason: `useShareRoom` needs a code, and up there
 * the code is `string | null` until the tab is first opened. A child that only exists once
 * there *is* a code keeps the hook's input honest instead of feeding it an empty string and
 * relying on nothing rendering the result.
 */
function CreatePanel({
  card,
  code,
  onEnter,
}: {
  card: GameCard;
  code: string;
  onEnter: (code: string) => void;
}): JSX.Element {
  // No error sink: nothing has connected yet, so there is no room error line to write to.
  // A failed copy leaves the code on screen to be read, which is the fallback anyway.
  const { joinUrl, copied, showQr, share, toggleQr } = useShareRoom(code, card.title);

  return (
    <>
      <CodeCard
        code={code}
        joinUrl={joinUrl}
        copied={copied}
        showQr={showQr}
        onShare={share}
        onToggleQr={toggleQr}
      />
      <button class="btn btn--primary btn--big choice__enter" type="button" onClick={() => onEnter(code)}>
        Enter the room
      </button>
      <p class="choice__hint">
        Share the code now if you like — the room opens when you enter it.
      </p>
    </>
  );
}
