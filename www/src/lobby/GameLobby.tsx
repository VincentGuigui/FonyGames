import type { ComponentChildren, JSX } from 'preact';
import { useContext } from 'preact/hooks';
import type { PlayerId } from '../../../shared/protocol';
import type { GameCard } from '../core/types';
import type { Room } from '../core/room/useRoom';
import { AvatarPicker, CodeCard, ConnectionBanner, PlayerList } from './parts';
import { HowToPlay } from '../core/ui/HowToPlay';
import { Disclosure } from '../core/ui/Disclosure';
import { ArrivedByLink } from './arrival';
import { soloTesting } from '../core/solo';

/**
 * The lobby, identical for every game.
 *
 * Before this existed each game had grown its own arrangement of the same
 * pieces, in a different order with different headings — so learning your way
 * around one lobby taught you nothing about the next. The panels and their
 * order are fixed here:
 *
 * 1. title and tagline
 * 2. how to play — the concept, then the bullets
 * 3. room code — share link and QR
 * 4. players
 * 5. start
 *
 * A game customises it only through the slots below, and a slot can never
 * reorder or replace a panel. If a game needs something the template cannot
 * express, change the template for everyone rather than special-casing one
 * game — that is the whole point.
 */
export function GameLobby({
  card,
  code,
  joinUrl,
  room,
  copied,
  showQr,
  onShare,
  onToggleQr,
  canStart,
  startLabel,
  onStart,
  note,
  playerTag,
  /** Extra explanation inside the how-to-play panel (Spill's table diagram). */
  aside,
  /** Result of the previous round, shown above the player list. */
  /** Game-specific settings, below the players (Spill's theme picker). */
  extras,
  /**
   * Can this game be started alone? Sling Puck cannot — it is two phones facing each
   * other across a gap, so a solo board has no opposite half — and it is the only one,
   * which is why the default is yes and only it opts out.
   */
  soloSupported = true,
}: {
  card: GameCard;
  code: string;
  joinUrl: string;
  room: Room;
  copied: boolean;
  showQr: boolean;
  onShare: () => void;
  onToggleQr: () => void;
  canStart: boolean;
  startLabel: string;
  onStart: () => void;
  note: string;
  playerTag?: (id: PlayerId) => string | null;
  aside?: ComponentChildren;
  extras?: ComponentChildren;
  soloSupported?: boolean;
}): JSX.Element {
  const arrivedByLink = useContext(ArrivedByLink);
  /*
   * Not a prop. Solo testing is a fact about the BROWSER, not about this game or this
   * room, and threading it through seven call sites would invite one of them to pass
   * something different from what its start button actually sends.
   */
  const solo = soloTesting();

  return (
    <div class="lobby" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
      <header class="lobby__header">
        <a class="lobby__back" href="/">
          ← All games
        </a>
        <h1 class="lobby__title">{card.title}</h1>
        <p class="lobby__pitch">{card.pitch}</p>
      </header>

      <ConnectionBanner status={room.status} />

      {room.error && (
        <p class="lobby__error" role="alert">
          {room.error}
        </p>
      )}

      {/*
        Said on the lobby, not only in the admin centre, because the flag is sticky and
        set in another tab — the round that starts with one player would otherwise look
        like a bug in the game rather than a switch someone left on.
      */}
      {solo && soloSupported && (
        <p class="lobby__solo" role="note">
          Solo testing is on: you can start on your own, and a round that would normally end
          when one player is left runs to its clock instead. Everything else is the real game.
        </p>
      )}

      {solo && !soloSupported && (
        <p class="lobby__solo" role="note">
          Solo testing is on, but not for this one — it is two phones facing each other across
          a gap, so there is no board to render alone. It still needs a second player.
        </p>
      )}

      {/*
        Open for someone who followed a link, collapsed for whoever came through the chooser and
        read the rules there. Collapsing it for everyone assumed the rules had been read on the
        way in — true only of the host, and false for most of the table (lobby/arrival.ts).
      */}
      <Disclosure heading="How to play" open={arrivedByLink}>
        <HowToPlay concept={card.concept} rules={card.rules}>
          {aside}
        </HowToPlay>
      </Disclosure>

      <CodeCard
        code={code}
        joinUrl={joinUrl}
        copied={copied}
        showQr={showQr}
        onShare={onShare}
        onToggleQr={onToggleQr}
      />


      <section class="panel">
        <h2 class="panel__heading">
          Players{room.room ? ` (${room.room.players.length})` : ''}
        </h2>
        <PlayerList
          room={room.room}
          me={room.me}
          onRename={room.rename}
          {...(playerTag ? { tagFor: playerTag } : {})}
        />
        {room.me && <AvatarPicker current={room.me.avatar} onPick={room.setAvatar} />}
      </section>

      {extras}

      <footer class="lobby__footer">
        {/*
          Only the host gets the button. Every game's `canStart` already requires `isHost`, so
          for everyone else it was a full-width primary control that could never become
          enabled — in a six-player room, five people looking at a dead button in the most
          prominent slot on the screen. The note carries the state instead.
        */}
        {room.isHost && (
          <button class="btn btn--primary btn--big" type="button" disabled={!canStart} onClick={onStart}>
            {startLabel}
          </button>
        )}
        <p class="lobby__note">{note}</p>
      </footer>
    </div>
  );
}
