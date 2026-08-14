import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../core/types';
import type { RoundResult } from '../../../shared/protocol';
import { useRoom, useShareRoom } from '../core/room/useRoom';
import { PLAYERS } from '../../../shared/players';
import { RoomGate } from './RoomGate';
import { GameLobby } from './GameLobby';
import { RulesPanel } from '../core/ui/RulesPanel';
import { Duel, type DuelPhase } from '../games/tap-duel/Duel';

/**
 * Tap Duel's room screen (docs/multiplayer.md §3).
 *
 * No hash in the URL  -> you are creating a room; a code is generated and put
 *                        in the URL so the page is instantly shareable.
 * Hash present        -> you are joining that room.
 *
 * The connection, the join card and the player list are shared with every other
 * game; what is specific to Tap Duel is the duel screen and the `pistol` start.
 */

/**
 * Everything about *which* room is the shared gate's job: the chooser when there is no code
 * in the hash, "this room doesn't exist" when the hash is damaged, and this screen once
 * there is a room to be in (lobby/RoomGate.tsx). Five copies of that logic used to live in
 * five files, identical down to the comment.
 */
export function Lobby(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code) => <LobbyInner game={props.game} code={code} />}</RoomGate>;
}

function LobbyInner({ game, code }: { game: GameCard; code: string }): JSX.Element {
  const [phase, setPhase] = useState<DuelPhase>('idle');
  const [result, setResult] = useState<RoundResult | null>(null);
  const roundRef = useRef<number | null>(null);
  const fireTimer = useRef<number | null>(null);
  /** Server time the current duel's rules panel clears. */
  // `fireAt` rides along because the drifting target needs it: the wander runs from
  // startsAt and freezes at fireAt (games/tap-duel/drift.ts).
  const [armedAt, setArmedAt] = useState<{
    roundId: number;
    startsAt: number;
    fireAt: number;
    /** The drift speed for this round. Slow early in a match, faster with each point. */
    speed: number;
  } | null>(null);
  /** Where the target will appear. From the server, so it is the same for all. */
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);

  const room = useRoom(code, game.slug);
  const { joinUrl, copied, showQr, share, toggleQr } = useShareRoom(code, game.title, room.setError);
  const client = room.client;

  useEffect(() => {
    if (!client) return;

    client.on('arm', (roundId, fireAt, startsAt, where, speed) => {
      roundRef.current = roundId;
      setResult(null);
      setPhase('armed');
      setTarget(where);
      // The server sends both times and guarantees fireAt > startsAt, so the
      // signal can never land behind the panel.
      setArmedAt({ roundId, startsAt, fireAt, speed });
      // Scheduled against SERVER time, so every screen flips at the same true
      // instant however different the pings are (tap-duel.md §6).
      const delay = Math.max(0, fireAt - client.now());
      if (fireTimer.current !== null) clearTimeout(fireTimer.current);
      fireTimer.current = setTimeout(() => {
        setPhase((p) => (p === 'armed' ? 'fire' : p));
      }, delay) as unknown as number;
    });

    client.on('falseStart', () => setPhase('burned'));

    client.on('result', (r) => {
      if (fireTimer.current !== null) clearTimeout(fireTimer.current);
      setResult(r);
      setPhase('result');
    });

    return () => {
      if (fireTimer.current !== null) clearTimeout(fireTimer.current);
    };
  }, [client]);

  function startDuel(): void {
    client?.send({ t: 'start', d: { mode: 'pistol' } });
  }

  function tap(): void {
    const roundId = roundRef.current;
    if (!client || roundId === null) return;
    // Sent as our clock-corrected server time; the server re-validates it.
    client.send({ t: 'tap', d: { at: client.now(), roundId } });
    // Local feedback only — the server decides the outcome.
    setPhase((p) => (p === 'fire' ? 'result' : p === 'armed' ? 'burned' : p));
  }

  const [minPlayers, maxPlayers] = PLAYERS['tap-duel'];
  // Matches what the server will accept. Offering Start when the referee would
  // refuse it is the silent no-op this project keeps having to fix.
  const canStart =
    room.isHost && room.connected >= minPlayers && room.connected <= maxPlayers;

  if (phase !== 'idle') {
    return (
      <div class="duel-screen" style={{ '--game-accent': game.accent } as JSX.CSSProperties}>
        <Duel
          players={room.room?.players ?? []}
          me={room.me?.id ?? null}
          phase={phase}
          result={result}
          onTap={tap}
          onAgain={startDuel}
          target={target}
          armed={armedAt}
          now={() => client?.now() ?? Date.now()}
          isHost={room.isHost}
          title={game.title}
          concept={game.concept}
          rules={game.rules}
          accent={game.accent}
        />
        {armedAt && (
          <RulesPanel
            key={armedAt.roundId}
            title={game.title}
            concept={game.concept}
            rules={game.rules}
            startsAt={armedAt.startsAt}
            now={() => client?.now() ?? Date.now()}
          />
        )}
      </div>
    );
  }

  return (
    <GameLobby
      card={game}
      code={code}
      joinUrl={joinUrl}
      room={room}
      copied={copied}
      showQr={showQr}
      onShare={share}
      onToggleQr={toggleQr}
      canStart={canStart}
      startLabel="Start round"
      onStart={startDuel}
      note={note(room.isHost, room.connected)}
    />
  );
}

function note(isHost: boolean, connected: number): string {
  const [min, max] = PLAYERS['tap-duel'];
  if (!isHost) return 'The host starts the round.';
  if (connected < min) return 'Waiting for one more player…';
  // Say the number rather than leaving a dead button and no explanation.
  if (connected > max) return `Tap Duel is ${min}–${max} players. Someone has to sit out.`;
  return 'Wait for the signal, then tap. Moving early loses the duel.';
}
