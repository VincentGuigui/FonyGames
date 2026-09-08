import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  SCREAM_ALIVE_MS,
  SCREAM_FLOOR_MS,
  SCREAM_LEVEL_MS,
  SCREAM_MAX_PLAYERS,
  SCREAM_MIN_PLAYERS,
  SCREAM_SAMPLE_MS,
  SCREAM_SUSTAIN_MS,
  SCREAM_WINDOW_MS,
  type ScreamState,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { SCREAM_DB_FLOOR, floorOf, loudestWindow, peakOf, screamScore } from '../../../../shared/scream';
import { useGameRoom } from '../../core/room/useRoom';
import { useSoloTesting } from '../../core/useSolo';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { GameOverScreen } from '../../core/ui/GameOver';
import { PermissionPrimer } from '../../core/ui/PermissionPrimer';
import { loudnessSupport, trackLoudness, type LoudnessTracker } from '../../core/sensors/loudness';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import './scream-meter.css';

/**
 * Scream Meter's room screen. Spec: docs/specs/games/scream-meter.md §4
 *
 * A match is ten rounds of the same shape: countdown, ten seconds of
 * screaming, then a brief reveal of that round's score and the running total
 * before the next prompt. `state.round`/`state.rounds` say where the room is;
 * `state.phase` says which of the three it is in.
 *
 * Your own meter is still the biggest thing on screen, but it is no longer
 * alone: a narrow, dimmed band for every other connected player flanks it,
 * fed by `state.levels` — purely visual, never scored, sampled and relayed
 * every `SCREAM_LEVEL_MS` while the window is open. The row of avatars
 * lighting up as each phone REPORTS is a different fact from how loud they
 * currently are, and both stay on screen together.
 *
 * The meter is written straight into the DOM by one `requestAnimationFrame`
 * loop, so Preact never re-renders at frame rate — the same split Color
 * Match's draining pie uses. The side bands are driven by ordinary state
 * instead: they update at the server's own ~4 Hz broadcast rate, which is
 * slow enough that a re-render costs nothing.
 */
export function ScreamRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <ScreamRoomInner game={card} code={code} />}</RoomGate>;
}

function ScreamRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<ScreamState | null>(null);
  const [support] = useState(() => loudnessSupport());
  const [micOn, setMicOn] = useState(false);
  const [micAsked, setMicAsked] = useState(false);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'scream') setState(msg.d);
  }, []);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;
  const clientRef = useRef(client);
  clientRef.current = client;

  const micRef = useRef<LoudnessTracker | null>(null);

  const enableMic = useCallback(async (): Promise<boolean> => {
    setMicAsked(true);
    if (micRef.current) return true;
    const tracker = await trackLoudness();
    micRef.current = tracker;
    setMicOn(tracker !== null);
    return tracker !== null;
  }, []);

  /**
   * What Ready and Start hang the microphone on.
   *
   * There is no fallback — a touch version of a screaming game is a different,
   * lesser game (spec §5, and one of the cases AGENTS.md §4 allows) — so a
   * refusal really does swallow the tap.
   */
  const ensureMic = useCallback(async (): Promise<boolean> => {
    if (micOn) return true;
    if (support === 'unsupported') return false;
    return enableMic();
  }, [micOn, support, enableMic]);

  // Release the microphone when the screen goes away, whatever the reason.
  useEffect(() => () => {
    micRef.current?.stop();
    micRef.current = null;
  }, []);

  const phase = state?.phase;
  const roundId = state?.roundId;
  const round = state?.round;
  const startsAt = state?.startsAt;
  const endsAt = state?.endsAt;

  /** The room's own noise floor, measured in the first second of the countdown. */
  const floorRef = useRef(SCREAM_DB_FLOOR);
  const sentRef = useRef(false);
  const [level, setLevel] = useState(SCREAM_DB_FLOOR);
  const [peakHold, setPeakHold] = useState(SCREAM_DB_FLOOR);

  const meterRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);

  /**
   * The whole round, as one effect: calibrate, sample, report.
   *
   * Driven off the referee's own absolute timestamps rather than a local
   * countdown, so 300 ms of lag costs a phone 300 ms of its own ten seconds and
   * nothing else (spec §6).
   */
  useEffect(() => {
    const mic = micRef.current;
    if (!mic || roundId === undefined || round === undefined || startsAt === undefined || endsAt === undefined) return;
    if (phase !== 'countdown' && phase !== 'window') return;

    sentRef.current = false;
    floorRef.current = SCREAM_DB_FLOOR;
    setPeakHold(SCREAM_DB_FLOOR);
    mic.reset();

    let frame = 0;
    let calibrated = false;
    let alive = 0;
    let levelSent = 0;
    let windowStarted = false;

    const loop = (): void => {
      const now = clientRef.current?.now() ?? Date.now();

      /*
       * The calibration second. `SCREAM_FLOOR_MS` of the countdown measures the
       * room rather than the player, which is the cheapest thing that makes two
       * different microphones in one room comparable (spec §5).
       */
      if (!calibrated && now >= startsAt - SCREAM_COUNTDOWN_TAIL && now < startsAt) {
        // Collected by the tracker already; nothing to do but wait.
      }
      if (!calibrated && now >= startsAt) {
        floorRef.current = floorOf(mic.samples());
        calibrated = true;
        // Everything from here is the scream, not the room.
        mic.reset();
      }

      const inWindow = calibrated && now >= startsAt && now < endsAt;
      if (inWindow && !windowStarted) windowStarted = true;

      const db = mic.level();
      // The meter, straight into the DOM — no re-render at frame rate.
      const filled = Math.max(0, Math.min(1, (db - floorRef.current) / 45));
      const el = meterRef.current;
      if (el) el.style.transform = `scaleY(${filled.toFixed(4)})`;

      if (inWindow) {
        const best = peakOf(mic.samples());
        const bestFilled = Math.max(0, Math.min(1, (best - floorRef.current) / 45));
        const peak = peakRef.current;
        // The peak-hold line stays where the best moment was: a bar with no
        // memory gives you nothing to beat (spec §4).
        if (peak) peak.style.bottom = `${(bestFilled * 100).toFixed(2)}%`;

        if (now - alive >= SCREAM_ALIVE_MS) {
          alive = now;
          clientRef.current?.send({ t: 'scream-alive', d: { roundId, round, at: now } });
        }

        // Purely visual, for the OTHER players' side meters (spec §4): the
        // same `filled` fraction this phone draws for its own bar, so the
        // room reads as one shape rather than everyone's own private curve.
        if (now - levelSent >= SCREAM_LEVEL_MS) {
          levelSent = now;
          clientRef.current?.send({ t: 'scream-level', d: { roundId, round, level: filled } });
        }
      }

      // The close. One report, once, and then the microphone has nothing left
      // to do for this round.
      if (windowStarted && !sentRef.current && now >= endsAt) {
        sentRef.current = true;
        const samples = mic.samples();
        const loudest = loudestWindow(samples, SCREAM_SUSTAIN_MS, SCREAM_SAMPLE_MS);
        const expected = Math.round(SCREAM_WINDOW_MS / SCREAM_SAMPLE_MS);
        // iOS suspends the audio context in a backgrounded tab, so a short run
        // is a real and common outcome — reported honestly rather than
        // pretending it was a full ten seconds (spec §7).
        const partial = samples.length < expected * 0.8;
        clientRef.current?.send({
          t: 'scream-score',
          d: {
            roundId,
            round,
            score: screamScore(loudest, floorRef.current),
            peak: peakOf(samples),
            floor: floorRef.current,
            partial,
          },
        });
        setLevel(loudest);
        setPeakHold(peakOf(samples));
      }

      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [roundId, round, phase, startsAt, endsAt, micOn]);

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  const promptText = (prompt: string): string => {
    switch (prompt) {
      case 'aaa': return text({ en: 'Scream AAA', fr: 'Criez AAA' });
      case 'eee': return text({ en: 'Scream EEE', fr: 'Criez III' });
      case 'ooo': return text({ en: 'Scream OOO', fr: 'Criez OOO' });
      case 'iii': return text({ en: 'Scream III', fr: 'Criez IIII' });
      case 'high': return text({ en: 'As HIGH as you can', fr: 'Le plus AIGU possible' });
      case 'low': return text({ en: 'As LOW as you can', fr: 'Le plus GRAVE possible' });
      default: return text({ en: 'Scream', fr: 'Criez' });
    }
  };

  const start = useCallback(() => {
    clientRef.current?.send({ t: 'start', d: { mode: 'scream', solo } });
  }, [solo]);

  const readyBlocked = support === 'unsupported' || (micAsked && !micOn);

  if (state && state.phase === 'done') {
    const ranked = Object.entries(state.totals).sort(([, a], [, b]) => b - a);
    return (
      <GameOverScreen
        room={room}
        readyBlocked={readyBlocked}
        onReadySetup={() => void enableMic()}
        onBeforeReady={ensureMic}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        note={
          state.draw
            ? text({ en: 'Nobody takes it — either a tie or a very polite room.', fr: 'Personne ne l’emporte — égalité, ou une salle très polie.' })
            : text({ en: `${state.rounds} rounds screamed. Highest total wins.`, fr: `${state.rounds} manches criées. Le plus gros total gagne.` })
        }
        rows={ranked.map(([id, total]) => ({
          id,
          avatar: avatarOf(id),
          name: nameOf(id),
          value: total,
          unit: text({ en: 'total', fr: 'total' }),
        }))}
        me={myId}
        winner={state.winner}
        onAgain={start}
        canAct={room.isHost && enoughToStart(room.connected, [SCREAM_MIN_PLAYERS, SCREAM_MAX_PLAYERS], solo)}
      />
    );
  }

  if (state) {
    const now = clientRef.current?.now() ?? Date.now();
    const countdown = Math.max(0, Math.ceil((state.startsAt - now) / 1000));
    const screaming = state.phase === 'window';
    const revealing = state.phase === 'reveal';
    const mine = myId ? state.scores[myId] : undefined;
    const myTotal = myId ? state.totals[myId] ?? 0 : 0;

    // Every OTHER connected player, split either side of the main meter —
    // "the room around you" rather than a leaderboard (spec §4).
    const others = players.filter((p) => p.connected && p.id !== myId);
    const half = Math.ceil(others.length / 2);
    const leftOthers = others.slice(0, half);
    const rightOthers = others.slice(half);
    const sideMeter = (p: { id: string }): JSX.Element => (
      <div key={p.id} class="scream__side-meter">
        <div class="scream__side-fill" style={{ transform: `scaleY(${(state.levels[p.id] ?? 0).toFixed(3)})` }} />
      </div>
    );

    return (
      <div class="scream" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={text({
            en: `Round ${state.round}/${state.rounds} · ${screaming ? 'Scream' : revealing ? 'Result' : 'Get ready'}`,
            fr: `Manche ${state.round}/${state.rounds} · ${screaming ? 'Criez' : revealing ? 'Résultat' : 'Préparez-vous'}`,
          })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
        />

        <p class="scream__prompt" aria-live="polite">{promptText(state.prompt)}</p>

        <div class="scream__stage">
          <div class="scream__side" aria-hidden="true">{leftOthers.map(sideMeter)}</div>

          <div class="scream__meter" aria-hidden="true">
            <div ref={meterRef} class="scream__fill" />
            {/* The peak-hold line: a bar with no memory gives you nothing to
                beat (spec §4). */}
            <div ref={peakRef} class="scream__peak" />
          </div>

          <div class="scream__side" aria-hidden="true">{rightOthers.map(sideMeter)}</div>
        </div>

        {/* The meter is not the only feedback: the numeric level is text, and
            so is this round's result once it closes (spec §11). */}
        <p class="scream__readout" aria-live="off">
          {revealing
            ? (mine
                ? text({
                    en: `This round: ${mine.score}${mine.partial ? ' (part.)' : ''}. Total: ${myTotal}.`,
                    fr: `Cette manche : ${mine.score}${mine.partial ? ' (part.)' : ''}. Total : ${myTotal}.`,
                  })
                : text({ en: `No answer this round. Total: ${myTotal}.`, fr: `Aucune réponse cette manche. Total : ${myTotal}.` }))
            : sentRef.current
              ? text({ en: `Best three seconds: ${level.toFixed(0)} dB, peak ${peakHold.toFixed(0)}`, fr: `Meilleures trois secondes : ${level.toFixed(0)} dB, pic ${peakHold.toFixed(0)}` })
              : text({ en: 'The loudest three seconds is what counts', fr: 'Ce sont les trois secondes les plus fortes qui comptent' })}
        </p>

        {/* Who has reported in — presence, not numbers (spec §4). */}
        <ul class="scream__room" aria-label={text({ en: 'Players', fr: 'Joueurs' })}>
          {players.filter((p) => p.connected).map((p) => (
            <li key={p.id} class={`scream__player ${state.reported.includes(p.id) ? 'scream__player--in' : ''}`}>
              <span aria-hidden="true">{p.avatar}</span>
            </li>
          ))}
        </ul>

        {countdown > 0 && <p class="scream__countdown" aria-live="assertive">{countdown}</p>}

        {/* Mandatory, and shown during the round rather than only in the
            primer — this is the game where the copy matters (spec §9). */}
        <p class="scream__safety">
          {text({
            en: 'Phone away from your face. Mind the neighbours.',
            fr: 'Téléphone loin du visage. Pensez aux voisins.',
          })}
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
      canStart={room.isHost && enoughToStart(room.connected, [SCREAM_MIN_PLAYERS, SCREAM_MAX_PLAYERS], solo)}
      startLabel={t.common.startRound}
      onStart={start}
      readyBlocked={readyBlocked}
      onBeforeReady={ensureMic}
      extras={<MicPrimer support={support} on={micOn} asked={micAsked} onEnable={() => void enableMic()} />}
    />
  );
}

/** How long before the green light the calibration second begins. */
const SCREAM_COUNTDOWN_TAIL = SCREAM_FLOOR_MS;

/**
 * The microphone primer.
 *
 * Mic-only, no fallback (spec §5), so this says who the game excludes before
 * anyone starts — which AGENTS.md §4 requires — and it says what the game does
 * with the microphone in plain words, because "this game needs your
 * microphone" sounds much worse than what it actually does (spec §10).
 */
function MicPrimer({
  support,
  on,
  asked,
  onEnable,
}: {
  support: 'unsupported' | 'available';
  on: boolean;
  asked: boolean;
  onEnable: () => void;
}): JSX.Element {
  const text = useGameText();
  const heading = text({ en: 'Needs the microphone', fr: 'Nécessite le microphone' });

  if (support === 'unsupported') {
    return <PermissionPrimer heading={heading} body={text({
      en: 'This device has no microphone the browser can read, and there is nothing else to play this one with — Scream Meter cannot run here.',
      fr: 'Cet appareil n’a pas de microphone lisible par le navigateur, et rien d’autre ne permet d’y jouer — Scream Meter ne peut pas fonctionner ici.',
    })} />;
  }

  if (asked && !on) {
    return (
      <PermissionPrimer
        heading={heading}
        body={text({
          en: 'The microphone was turned down, and it is the only way to play this one — a tap version of a screaming game is a different game.',
          fr: 'Le microphone a été refusé, et c’est la seule façon de jouer — une version tactile d’un jeu de cri est un autre jeu.',
        })}
        action={{ label: text({ en: 'Try again', fr: 'Réessayer' }), onClick: onEnable }}
      />
    );
  }

  if (on) {
    return <PermissionPrimer heading={heading} enabled body={text({
      en: 'Ready. Your phone measures how loud it is and sends one number. No recording is made, nothing is kept, and no audio leaves the phone.',
      fr: 'Prêt. Votre téléphone mesure le volume et envoie un seul chiffre. Aucun enregistrement, rien n’est conservé, aucun son ne quitte le téléphone.',
    })} />;
  }

  return <PermissionPrimer heading={heading} body={text({
    en: 'Your phone measures how loud it is and sends one number. No recording is made, nothing is kept, and no audio ever leaves the phone. Without it there is nothing to play — this one excludes anyone who cannot shout, and says so now rather than after.',
    fr: 'Votre téléphone mesure le volume et envoie un seul chiffre. Aucun enregistrement, rien n’est conservé, aucun son ne quitte jamais le téléphone. Sans lui il n’y a rien à jouer — ce jeu exclut qui ne peut pas crier, et le dit maintenant plutôt qu’après.',
  })} />;
}
