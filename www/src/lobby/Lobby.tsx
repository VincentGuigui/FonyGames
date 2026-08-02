import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../core/types';
import type { RoundResult } from '../../../shared/protocol';
import { codeFromLocation, useRoom, shareRoom } from '../core/room/useRoom';
import { AvatarPicker, CodeCard, ConnectionBanner, PlayerList } from './parts';
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
export function Lobby({ game }: { game: GameCard }): JSX.Element {
  const code = useMemo(() => codeFromLocation(), []);
  const [showQr, setShowQr] = useState(false);
  const [phase, setPhase] = useState<DuelPhase>('idle');
  const [result, setResult] = useState<RoundResult | null>(null);
  const roundRef = useRef<number | null>(null);
  const fireTimer = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);

  const room = useRoom(code);
  const client = room.client;

  useEffect(() => {
    if (!client) return;

    client.on('arm', (roundId, fireAt) => {
      roundRef.current = roundId;
      setResult(null);
      setPhase('armed');
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

  const joinUrl = `${location.origin}${location.pathname}#${code}`;

  async function share(): Promise<void> {
    const outcome = await shareRoom(game.title, code, joinUrl);
    if (outcome === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else if (outcome === 'failed') {
      room.setError('Could not copy — long-press the code to select it.');
    }
  }

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

  const canStart = room.isHost && room.connected >= 2;

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
          isHost={room.isHost}
        />
      </div>
    );
  }

  return (
    <div class="lobby" style={{ '--game-accent': game.accent } as JSX.CSSProperties}>
      <header class="lobby__header">
        <a class="lobby__back" href="/">
          ← All games
        </a>
        <h1 class="lobby__title">{game.title}</h1>
        <p class="lobby__pitch">{game.pitch}</p>
      </header>

      <ConnectionBanner status={room.status} />

      <CodeCard
        code={code}
        joinUrl={joinUrl}
        copied={copied}
        showQr={showQr}
        onShare={share}
        onToggleQr={() => setShowQr((v) => !v)}
      />

      {room.error && (
        <p class="lobby__error" role="alert">
          {room.error}
        </p>
      )}

      <section class="players">
        <h2 class="players__heading">
          Players{room.room ? ` (${room.room.players.length})` : ''}
        </h2>
        <PlayerList room={room.room} me={room.me} onRename={room.rename} />
        {room.me && <AvatarPicker current={room.me.avatar} onPick={room.setAvatar} />}
      </section>

      <footer class="lobby__footer">
        <button
          class="btn btn--primary btn--big"
          type="button"
          disabled={!canStart}
          onClick={startDuel}
        >
          Start round
        </button>
        <p class="lobby__note">
          {!room.isHost
            ? 'The host starts the round.'
            : room.connected < 2
              ? 'Waiting for one more player…'
              : 'Wait for the signal, then tap. Moving early loses the duel.'}
        </p>
      </footer>
    </div>
  );
}
