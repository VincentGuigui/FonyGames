import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  BLINK_DEFAULT_DURATION,
  BLINK_DEFAULT_LIGHTS,
  BLINK_MAX_PLAYERS,
  BLINK_MIN_PLAYERS,
  BLINK_MISS_LIMIT,
  type BlinkOptions,
  type BlinkTapperState,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { advance, blinkScore, litLight, newBlinker, tapLight, type Blinker } from '../../../../shared/blink';
import { useGameRoom } from '../../core/room/useRoom';
import { useSoloTesting } from '../../core/useSolo';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { GameOverScreen } from '../../core/ui/GameOver';
import { PermissionPrimer } from '../../core/ui/PermissionPrimer';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { BlinkOptionsPanel } from './BlinkOptions';
import './blink-tapper.css';

/**
 * Blink Tapper's room screen. Spec: docs/specs/games/blink-tapper.md §4
 *
 * The round is `shared/blink.ts` run against the room's clock: every frame asks
 * it which light is on and writes that straight onto the buttons, because at 30
 * blinks a second a Preact render per blink would be the bottleneck. Preact
 * only re-renders when the numbers on screen change. The one thing that
 * reaches outside is the final report (spec §6).
 */
export function BlinkRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <BlinkRoomInner game={card} code={code} />}</RoomGate>;
}

type Hud = { score: number; misses: number; secondsLeft: number; countdown: number; done: boolean };

const IDLE_HUD: Hud = { score: 0, misses: 0, secondsLeft: 0, countdown: 0, done: false };

function BlinkRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<BlinkTapperState | null>(null);
  const [options, setOptions] = useState<BlinkOptions>({ lights: BLINK_DEFAULT_LIGHTS, duration: BLINK_DEFAULT_DURATION });

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'blink-tapper') setState(msg.d);
  }, []);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const clientRef = useRef(room.client);
  clientRef.current = room.client;
  const myId = room.me?.id;

  const blinkerRef = useRef<Blinker | null>(null);
  const sentRef = useRef(false);
  const lightEls = useRef<(HTMLButtonElement | null)[]>([]);
  const [hud, setHud] = useState<Hud>(IDLE_HUD);
  const hudRef = useRef<Hud>(IDLE_HUD);

  const roundId = state?.roundId;
  const playing = state?.phase === 'playing';
  const startsAt = state?.startsAt ?? 0;
  const myFinal = myId === undefined ? undefined : state?.finals[myId];
  const reported = myFinal !== undefined && myFinal !== null;

  const elapsed = useCallback((): number => (clientRef.current?.now() ?? Date.now()) - startsAt, [startsAt]);

  /** Push what the player reads — only when a number on screen moved. */
  const showHud = useCallback((b: Blinker, at: number) => {
    const next: Hud = {
      score: blinkScore(b),
      misses: b.misses,
      secondsLeft: b.duration > 0 ? Math.max(0, Math.ceil((b.duration - Math.max(0, at)) / 1000)) : 0,
      countdown: at < 0 ? Math.ceil(-at / 1000) : 0,
      done: b.done,
    };
    const was = hudRef.current;
    if (
      was.score !== next.score || was.misses !== next.misses || was.secondsLeft !== next.secondsLeft
      || was.countdown !== next.countdown || was.done !== next.done
    ) {
      hudRef.current = next;
      setHud(next);
    }
  }, []);

  const showLights = useCallback((b: Blinker, at: number) => {
    const lit = at < 0 ? null : litLight(b, at);
    lightEls.current.forEach((el, i) => el?.classList.toggle('blink__light--on', lit === i));
  }, []);

  const report = useCallback((b: Blinker) => {
    if (sentRef.current || roundId === undefined) return;
    sentRef.current = true;
    clientRef.current?.send({ t: 'blink-final', d: { roundId, hits: b.hits, misses: b.misses } });
  }, [roundId]);

  // A fresh round: a fresh blinker. A phone that rejoins mid-round picks the
  // schedule back up from `startsAt`, so every blink it was away for is missed.
  useEffect(() => {
    if (roundId === undefined || !state || state.phase !== 'playing') return;
    blinkerRef.current = newBlinker(state.options);
    sentRef.current = reported;
    hudRef.current = IDLE_HUD;
    setHud(IDLE_HUD);
    // Only the round's identity restarts it; later frames of the same round
    // (somebody else's final arriving) must not.
  }, [roundId, state?.phase]);

  // The frame loop.
  useEffect(() => {
    if (!playing || reported) return;
    let raf = 0;
    const frame = (): void => {
      const b0 = blinkerRef.current;
      if (b0) {
        const at = elapsed();
        const b = at < 0 ? b0 : advance(b0, at);
        blinkerRef.current = b;
        showLights(b, at);
        showHud(b, at);
        if (b.done) {
          report(b);
          return;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, reported, elapsed, showLights, showHud, report]);

  const tap = useCallback((light: number) => {
    const b0 = blinkerRef.current;
    if (!b0 || b0.done) return;
    const at = elapsed();
    if (at < 0) return;
    const b = tapLight(b0, at, light);
    blinkerRef.current = b;
    showLights(b, at);
    showHud(b, at);
    const el = lightEls.current[light];
    if (el) {
      const hit = b.hits > b0.hits;
      el.classList.remove('blink__light--hit', 'blink__light--miss');
      // Re-read layout so the same class re-triggers on a quick second tap.
      void el.offsetWidth;
      el.classList.add(hit ? 'blink__light--hit' : 'blink__light--miss');
    }
    if (b.done) report(b);
  }, [elapsed, showLights, showHud, report]);

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  const start = useCallback(() => {
    clientRef.current?.send({ t: 'start', d: { mode: 'blink', solo, blink: { ...options } } });
  }, [solo, options]);

  const canStart = room.isHost && enoughToStart(room.connected, [BLINK_MIN_PLAYERS, BLINK_MAX_PLAYERS], solo);

  if (state && state.phase === 'done') {
    const rows = Object.entries(state.finals)
      .sort((a, b) => (b[1]?.score ?? -Infinity) - (a[1]?.score ?? -Infinity))
      .map(([id, f]) => ({
        id,
        avatar: avatarOf(id),
        name: nameOf(id),
        value: f
          ? text({ en: `${f.score} pts · ${f.hits} hit · ${f.misses} missed`, fr: `${f.score} pts · ${f.hits} touchés · ${f.misses} ratés` })
          : text({ en: 'no score', fr: 'pas de score' }),
        out: f === null,
      }));
    return (
      <GameOverScreen
        room={room}
        screen={card.screen}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        note={text({
          en: 'A point for every lit tap, one off for every miss.',
          fr: 'Un point par tap sur une lumière allumée, un de moins par raté.',
        })}
        rows={rows}
        me={myId}
        winner={state.winner}
        onAgain={start}
        canAct={canStart}
      />
    );
  }

  if (state) {
    const lights = state.options.lights;
    const unlimited = state.options.duration === 0;
    const finished = reported || hud.done;
    const waiting = Object.values(state.finals).filter((f) => f === null).length;
    const status = unlimited
      ? text({ en: `${Math.max(0, BLINK_MISS_LIMIT - hud.misses)} misses left`, fr: `${Math.max(0, BLINK_MISS_LIMIT - hud.misses)} ratés restants` })
      : text({ en: `${hud.secondsLeft} s`, fr: `${hud.secondsLeft} s` });

    return (
      <div class="blink" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar status={status} title={card.title} concept={card.concept} rules={card.rules} screen={card.screen} />

        <p class="blink__score">
          <b>{myFinal ? myFinal.score : hud.score}</b> {text({ en: 'points', fr: 'points' })}
        </p>

        <div class={`blink__board blink__board--${lights}`}>
          {Array.from({ length: lights }, (_, i) => (
            <button
              key={i}
              type="button"
              class="blink__light"
              ref={(el) => { lightEls.current[i] = el as HTMLButtonElement | null; }}
              aria-label={text({ en: `Light ${i + 1}`, fr: `Lumière ${i + 1}` })}
              disabled={finished}
              onPointerDown={(e) => { e.preventDefault(); tap(i); }}
            />
          ))}
        </div>

        {hud.countdown > 0 && !finished && <p class="blink__countdown" aria-live="assertive">{hud.countdown}</p>}
        {finished && (
          <p class="blink__verdict" aria-live="polite">
            {waiting > 0
              ? text({ en: 'Done. Waiting for the rest.', fr: 'Terminé. On attend les autres.' })
              : text({ en: 'Done.', fr: 'Terminé.' })}
          </p>
        )}
        <p class="visually-hidden" aria-live="polite">
          {text({ en: `${hud.score} points`, fr: `${hud.score} points` })}
        </p>
      </div>
    );
  }

  return (
    <GameLobby
      card={card}
      code={code}
      joinUrl={joinUrl}
      room={room}
      copied={copied}
      showQr={showQr}
      onShare={share}
      onToggleQr={toggleQr}
      canStart={canStart}
      startLabel={t.common.startRound}
      onStart={start}
      extras={
        <>
          <BlinkSafety />
          <BlinkOptionsPanel value={options} onChange={setOptions} editable={room.isHost} />
        </>
      }
    />
  );
}

/** The flashing warning, in the lobby before anyone plays (spec §9). */
function BlinkSafety(): JSX.Element {
  const text = useGameText();
  return (
    <PermissionPrimer
      heading={text({ en: 'This game flashes — fast', fr: 'Ce jeu clignote — vite' })}
      body={text({
        en: 'The light speeds up to 30 flashes a second. If you have photosensitive epilepsy or flashing lights affect you, do not play this one.',
        fr: 'La lumière accélère jusqu’à 30 flashs par seconde. Si vous êtes épileptique photosensible ou sensible aux lumières clignotantes, ne jouez pas à celui-ci.',
      })}
    />
  );
}
