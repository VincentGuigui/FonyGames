import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../core/types';
import type { RoomSnapshot, RoundResult } from '../../../shared/protocol';
import type { RoomStatus } from '../core/room/client';
import { RoomClient } from '../core/room/client';
import { roomServerUrl } from '../core/room/config';
import { generateRoomCode, isRoomCode, normaliseRoomCode } from '../core/room/code';
import { loadSeat, saveSeat } from '../core/room/seat';
import { AVATARS } from '../../../shared/names';
import { QrCode } from '../core/ui/QrCode';
import { Duel, type DuelPhase } from '../games/tap-duel/Duel';

/**
 * The lobby, shared by every game (docs/multiplayer.md §3).
 *
 * No hash in the URL  -> you are creating a room; a code is generated and put
 *                        in the URL so the page is instantly shareable.
 * Hash present        -> you are joining that room.
 */
export function Lobby({ game }: { game: GameCard }): JSX.Element {
  const code = useMemo(() => codeFromLocation(), []);
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [phase, setPhase] = useState<DuelPhase>('idle');
  const [result, setResult] = useState<RoundResult | null>(null);
  const roundRef = useRef<number | null>(null);
  const fireTimer = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const clientRef = useRef<RoomClient | null>(null);

  useEffect(() => {
    // Recovering the seat from storage is what makes a refresh rejoin as the
    // same player instead of spawning a ghost alongside the old one.
    const client = new RoomClient(roomServerUrl(), code, loadSeat(code));
    clientRef.current = client;
    client.on('status', setStatus);
    client.on('presence', setRoom);
    client.on('error', setError);
    client.on('seat', (id) => saveSeat(code, id));

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

    client.connect();
    return () => {
      if (fireTimer.current !== null) clearTimeout(fireTimer.current);
      client.close();
    };
  }, [code]);

  const joinUrl = `${location.origin}${location.pathname}#${code}`;
  const me = room?.players.find((p) => p.id === clientRef.current?.playerId);
  const isHost = !!me && room?.hostId === me.id;

  async function share(): Promise<void> {
    const data = {
      title: `FonyGames — ${game.title}`,
      text: `Join my ${game.title} room: ${code}`,
      url: joinUrl,
    };
    if (navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch {
        // Cancelled, or the browser refused. Fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — long-press the code to select it.');
    }
  }

  function startDuel(): void {
    clientRef.current?.send({ t: 'start', d: { mode: 'pistol' } });
  }

  function tap(): void {
    const client = clientRef.current;
    const roundId = roundRef.current;
    if (!client || roundId === null) return;
    // Sent as our clock-corrected server time; the server re-validates it.
    client.send({ t: 'tap', d: { at: client.now(), roundId } });
    // Local feedback only — the server decides the outcome.
    setPhase((p) => (p === 'fire' ? 'result' : p === 'armed' ? 'burned' : p));
  }

  function setAvatar(avatar: string): void {
    clientRef.current?.send({ t: 'set-profile', d: { avatar } });
  }

  function rename(): void {
    const next = prompt('Your name', me?.name ?? '')?.trim();
    if (next) clientRef.current?.send({ t: 'set-profile', d: { name: next } });
  }

  const connected = room?.players.filter((p) => p.connected).length ?? 0;
  const canStart = isHost && connected >= 2;

  if (phase !== 'idle') {
    return (
      <div
        class="duel-screen"
        style={{ '--game-accent': game.accent } as JSX.CSSProperties}
      >
        <Duel
          players={room?.players ?? []}
          me={me?.id ?? null}
          phase={phase}
          result={result}
          onTap={tap}
          onAgain={startDuel}
          isHost={isHost}
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

      <ConnectionBanner status={status} />

      <section class="code-card">
        <p class="code-card__label">Room code</p>
        <p class="code-card__code">{code}</p>
        <div class="code-card__actions">
          <button class="btn btn--primary" type="button" onClick={share}>
            {copied ? 'Link copied' : 'Share link'}
          </button>
          <button
            class="btn"
            type="button"
            aria-expanded={showQr}
            onClick={() => setShowQr((v) => !v)}
          >
            {showQr ? 'Hide QR' : 'Show QR'}
          </button>
        </div>
        {showQr && (
          <div class="code-card__qr">
            <QrCode value={joinUrl} size={220} />
            <p class="code-card__hint">Point a phone camera at this.</p>
          </div>
        )}
      </section>

      {error && (
        <p class="lobby__error" role="alert">
          {error}
        </p>
      )}

      <section class="players">
        <h2 class="players__heading">
          Players{room ? ` (${room.players.length})` : ''}
        </h2>
        <ul class="players__list">
          {(room?.players ?? []).map((p) => (
            <li
              key={p.id}
              class={`player ${p.connected ? '' : 'player--away'} ${
                p.id === me?.id ? 'player--me' : ''
              }`}
            >
              <span class="player__avatar" aria-hidden="true">
                {p.avatar}
              </span>
              <span class="player__name">{p.name}</span>
              {room?.hostId === p.id && <span class="player__tag">host</span>}
              {!p.connected && <span class="player__tag">away</span>}
              {p.id === me?.id && (
                <button class="player__edit" type="button" onClick={rename}>
                  rename
                </button>
              )}
            </li>
          ))}
          {!room && <li class="player player--ghost">Connecting…</li>}
        </ul>

        {me && (
          <div class="avatar-picker">
            <p class="avatar-picker__label">Your avatar</p>
            <div class="avatar-picker__row">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  class={`avatar-picker__btn ${
                    me.avatar === a ? 'avatar-picker__btn--on' : ''
                  }`}
                  aria-label={`Use ${a}`}
                  aria-pressed={me.avatar === a}
                  onClick={() => setAvatar(a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}
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
          {!isHost
            ? 'The host starts the round.'
            : connected < 2
              ? 'Waiting for one more player…'
              : 'Wait for the signal, then tap. Moving early loses the duel.'}
        </p>
      </footer>
    </div>
  );
}

function ConnectionBanner({ status }: { status: RoomStatus }): JSX.Element | null {
  if (status === 'open') return null;
  const text: Record<Exclude<RoomStatus, 'open'>, string> = {
    connecting: 'Connecting…',
    reconnecting: 'Connection lost — reconnecting…',
    closed: 'Disconnected.',
  };
  return (
    <p class={`banner banner--${status}`} role="status">
      {text[status]}
    </p>
  );
}

/**
 * The room code lives in the URL hash so the page is shareable as-is. Landing
 * here without one means you are starting a room, so we mint a code and put it
 * in the URL immediately — before anyone connects — so a reload rejoins the
 * same room instead of silently creating a second one.
 */
function codeFromLocation(): string {
  const fromHash = normaliseRoomCode(location.hash.replace(/^#/, ''));
  if (isRoomCode(fromHash)) return fromHash;

  const fresh = generateRoomCode();
  history.replaceState(null, '', `${location.pathname}#${fresh}`);
  return fresh;
}
