import type { ComponentChildren, JSX } from 'preact';
import type { PlayerId } from '../../../shared/protocol';
import type { GameCard } from '../core/types';
import type { Room } from '../core/room/useRoom';
import { AvatarPicker, CodeCard, ConnectionBanner, PlayerList } from './parts';
import { HowToPlay } from '../core/ui/HowToPlay';

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
  standings,
  /** Game-specific settings, below the players (Spill's theme picker). */
  extras,
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
  standings?: ComponentChildren;
  extras?: ComponentChildren;
}): JSX.Element {
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

      <section class="panel">
        <h2 class="panel__heading">How to play</h2>
        <HowToPlay concept={card.concept} rules={card.rules}>
          {aside}
        </HowToPlay>
      </section>

      <CodeCard
        code={code}
        joinUrl={joinUrl}
        copied={copied}
        showQr={showQr}
        onShare={onShare}
        onToggleQr={onToggleQr}
      />

      {standings}

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
        <button class="btn btn--primary btn--big" type="button" disabled={!canStart} onClick={onStart}>
          {startLabel}
        </button>
        <p class="lobby__note">{note}</p>
      </footer>
    </div>
  );
}
