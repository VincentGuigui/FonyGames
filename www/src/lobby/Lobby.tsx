import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../core/types';
import type { PlayerId, RoundResult } from '../../../shared/protocol';
import { useGameRoom } from '../core/room/useRoom';
import { enoughToStart, PLAYERS } from '../../../shared/players';
import { useSoloTesting } from '../core/useSolo';
import { RoomGate } from './RoomGate';
import { GameLobby } from './GameLobby';
import { RulesPanel } from '../core/ui/RulesPanel';
import { useT } from '../core/i18n/strings';
import { useGameText, type GameText } from '../core/i18n/gameText';
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
  return <RoomGate game={props.game}>{(code, card) => <LobbyInner game={card} code={code} />}</RoomGate>;
}

function LobbyInner({ game, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [phase, setPhase] = useState<DuelPhase>('idle');
  const [result, setResult] = useState<RoundResult | null>(null);
  /**
   * The running match score, which outlives the round it came from.
   *
   * `result` is cleared on every arm, so the score panel — which reads from it — showed
   * nil for everyone from the second duel onwards, right through the get-ready and the
   * signal, and only remembered the score once the round was over. The tally is a
   * different fact from the last round's outcome and needs to be held separately.
   */
  const [tally, setTally] = useState<Record<PlayerId, number>>({});
  /**
   * Did the last result take the match?
   *
   * The server clears its own tally when somebody reaches the target, so the *next*
   * round is a new match starting from nil. Without this the winning tally would sit on
   * screen through the whole first duel of the next one.
   */
  const matchOver = useRef(false);
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
  const [targetScale, setTargetScale] = useState(1);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, game);
  const client = room.client;

  useEffect(() => {
    if (!client) return;

    client.on('arm', (roundId, fireAt, startsAt, where, speed) => {
      const firstDuel = roundRef.current === null;
      roundRef.current = roundId;
      setResult(null);
      // The score survives the arm; a finished MATCH does not. The server has already
      // cleared its tally, so this duel is the first of a new one and starts from nil.
      if (matchOver.current) {
        setTally({});
        setTargetScale(1);
        matchOver.current = false;
      } else if (!firstDuel) {
        setTargetScale((scale) => scale * 0.7);
      }
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
      setTally(r.scores);
      matchOver.current = r.matchWinnerId !== null;
      setPhase('result');
    });

    return () => {
      if (fireTimer.current !== null) clearTimeout(fireTimer.current);
    };
  }, [client]);

  function startDuel(): void {
    client?.send({ t: 'start', d: { mode: 'pistol', solo } });
  }

  function tap(): void {
    const roundId = roundRef.current;
    if (!client || roundId === null) return;
    // Sent as our clock-corrected server time; the server re-validates it.
    client.send({ t: 'tap', d: { at: client.now(), roundId } });
    // Local feedback only — the server decides the outcome.
    setPhase((p) => (p === 'fire' ? 'submitted' : p === 'armed' ? 'burned' : p));
  }

  const [minPlayers, maxPlayers] = PLAYERS['tap-duel'];
  // Matches what the server will accept. Offering Start when the referee would
  // refuse it is the silent no-op this project keeps having to fix.
  const canStart = room.isHost && enoughToStart(room.connected, [minPlayers, maxPlayers], solo);

  if (phase !== 'idle') {
    return (
      <div class="duel-screen" style={{ '--game-accent': game.accent } as JSX.CSSProperties}>
        <Duel
          players={room.room?.players ?? []}
          me={room.me?.id ?? null}
          phase={phase}
          result={result}
          tally={tally}
          onTap={tap}
          onAgain={startDuel}
          target={target}
          targetScale={targetScale}
          armed={armedAt}
          now={() => client?.now() ?? Date.now()}
          isHost={room.isHost}
          room={room}
          title={game.title}
          concept={game.concept}
          rules={game.rules}
          accent={game.accent}
          slug={game.slug}
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
      startLabel={t.common.startRound}
      onStart={startDuel}
      note={note(room.isHost, room.connected, text)}
    />
  );
}

function note(isHost: boolean, connected: number, text: GameText): string {
  const [min, max] = PLAYERS['tap-duel'];
  if (!isHost) return text({ en: 'The host starts the round.', fr: "L’hôte démarre la manche." });
  if (connected < min) return text({ en: 'Waiting for one more player…', fr: 'En attente d’un joueur supplémentaire…' });
  // Say the number rather than leaving a dead button and no explanation.
  if (connected > max) return text({ en: `Tap Duel is ${min}–${max} players. Someone has to sit out.`, fr: `Tap Duel se joue de ${min} à ${max} joueurs. Quelqu’un doit attendre.` });
  return text({ en: 'Wait for the signal, then tap. Moving early loses the duel.', fr: 'Attendez le signal, puis touchez. Partir trop tôt fait perdre le duel.' });
}
