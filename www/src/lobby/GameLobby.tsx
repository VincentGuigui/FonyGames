import type { ComponentChildren, JSX } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { PlayerId } from '../../../shared/protocol';
import type { GameCard } from '../core/types';
import type { Room } from '../core/room/useRoom';
import { CodeCard, ConnectionBanner, PlayerList, ProfileSheet } from './parts';
import { HowToPlay } from '../core/ui/HowToPlay';
import { Disclosure } from '../core/ui/Disclosure';
import { LocalePicker } from '../core/ui/LocalePicker';
import { useT } from '../core/i18n/strings';
import { track } from '../core/analytics';
import { ArrivedByLink } from './arrival';
import { hasAdminSession, setSoloTesting } from '../core/solo';
import { useSoloTesting } from '../core/useSolo';
import { guestsReady } from '../../../shared/readiness';
import { ReadyButton } from '../core/ui/ReadyButton';
import { GameSwitcher } from './GameSwitcher';

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
 * 5. start for the host, ready for every guest
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
  readyBlocked = false,
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
  /** Sensor games hold readiness until this phone has answered their primer. */
  readyBlocked?: boolean;
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
  const solo = useSoloTesting();
  const [admin, setAdmin] = useState(false);
  const [editing, setEditing] = useState(false);
  const t = useT();
  const everybodyReady = guestsReady(room.room?.players ?? [], room.room?.hostId ?? null);
  useEffect(() => { void hasAdminSession().then(setAdmin); }, []);

  return (
    <div class="lobby" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
      <header class="lobby__header">
        <LocalePicker />
        {/*
          Out of the room and back to this game's own page, not out to the hub.

          It said "← All games" and went to `/`, which is two steps away and the wrong one:
          from a lobby the thing you want is almost always this game without this room —
          start a different one, join the code somebody has just read out, or simply get
          out of a room you opened by mistake. The hub is one more tap from there, and the
          chooser has its own link to it.

          The same place the back button now goes (`RoomGate.enter`), so the two agree.
          Only the hash differs, so the browser does not reload — `RoomGate` hears the
          hashchange, puts the chooser back, and unmounting the lobby closes the socket.
        */}
        <a class="lobby__back" href={`/${card.slug}/`}>
          {t.common.leaveTheRoom}
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

      {admin && (
        <section class="lobby__solo-admin" aria-label={t.lobby.soloAdminLabel}>
          <span>{t.lobby.soloAdminLabel}</span>
          <button class="btn" type="button" aria-pressed={solo} onClick={() => setSoloTesting(!solo)}>
            {solo ? t.lobby.soloDisable : t.lobby.soloEnable}
          </button>
        </section>
      )}

      {/*
        Said on the lobby, not only in the admin centre, because the flag is sticky and
        set in another tab — the round that starts with one player would otherwise look
        like a bug in the game rather than a switch someone left on.
      */}
      {solo && soloSupported && (
        <p class="lobby__solo" role="note">
          {t.lobby.soloOn}
        </p>
      )}

      {solo && !soloSupported && (
        <p class="lobby__solo" role="note">
          {t.lobby.soloOnUnsupported}
        </p>
      )}

      {/*
        Open for someone who followed a link, collapsed for whoever came through the chooser and
        read the rules there. Collapsing it for everyone assumed the rules had been read on the
        way in — true only of the host, and false for most of the table (lobby/arrival.ts).
      */}
      <Disclosure heading={t.common.howToPlay} open={arrivedByLink}>
        <HowToPlay concept={card.concept} rules={card.rules}>
          {aside}
        </HowToPlay>
      </Disclosure>

      {/*
        Open for the host, collapsed for everyone else.

        It was a permanently open bordered card — the biggest thing on the screen, shown to
        the whole table, for a job only the host has and only until everybody has arrived.
        Four players out of five were scrolling past a code they had already used to get in.

        `room.isHost` rather than "did they follow a link", because typing a code into the
        Join tab is joining too, and only the host discriminator catches both. It costs the
        host a flicker on the first frame — the room says who the host is a moment after the
        page renders — which is the right way round: the guest, who is the common case, never
        sees it move.
      */}
      <Disclosure heading={t.common.invitePlayer} open={room.isHost}>
        <CodeCard
          code={code}
          joinUrl={joinUrl}
          copied={copied}
          showQr={showQr}
          onShare={onShare}
          onToggleQr={onToggleQr}
        />
      </Disclosure>


      <section class="panel">
        <h2 class="panel__heading">
          {t.common.players}
          {room.room ? ` (${room.room.players.length})` : ''}
        </h2>
        <PlayerList
          room={room.room}
          me={room.me}
          onChange={() => setEditing(true)}
          {...(playerTag ? { tagFor: playerTag } : {})}
        />
      </section>

      {/*
        Name and avatar together, and only when asked for. The avatar picker used to sit
        open under the list in every lobby — twelve buttons, 123 vertical pixels, for a
        choice each player makes once and usually before anybody else has even joined.
      */}
      {editing && room.me && (
        <ProfileSheet
          me={room.me}
          onSave={room.setProfile}
          onClose={() => setEditing(false)}
        />
      )}

      {extras}

      <footer class="lobby__footer">
        {/*
          Start belongs to the host; the same footer slot carries Ready for every guest.
          The referee checks those guest flags too, so this is feedback for a server rule
          rather than a client-only convention.
        */}
        {room.isHost && (
          <button
            class="btn btn--primary btn--big"
            type="button"
            disabled={!canStart || readyBlocked || !everybodyReady}
            onClick={() => {
              track('game_start', card.slug);
              onStart();
            }}
          >
            {startLabel}
          </button>
        )}
        {!room.isHost && <ReadyButton room={room} blocked={readyBlocked} />}
        {readyBlocked && <p class="lobby__ready-note">{t.lobby.finishSetup}</p>}
        {room.isHost && canStart && !everybodyReady && (
          <p class="lobby__ready-note" role="status">
            {t.lobby.waitingReady}
          </p>
        )}
        <p class="lobby__note">{note}</p>
        {room.isHost && <div class="lobby__switch-game"><GameSwitcher room={room} code={code} game={card.slug} /></div>}
      </footer>
    </div>
  );
}
