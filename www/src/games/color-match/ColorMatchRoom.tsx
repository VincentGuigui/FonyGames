import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  COLOR_MATCH_MAX_PLAYERS,
  COLOR_MATCH_MIN_PLAYERS,
  type ColorMatchState,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { colorActionMs, reactionMultiplier, rungAt, type Rgb } from '../../../../shared/color';
import { useGameRoom } from '../../core/room/useRoom';
import { useSoloTesting } from '../../core/useSolo';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { WideScoreboard } from '../../core/ui/WideScoreboard';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { ColorWheel } from './ColorWheel';
import { neutralFor } from './wheel';
import './color-match.css';

/**
 * Color Match's room screen. Spec: docs/specs/games/color-match.md §4
 *
 * The lightest room in the catalogue: no canvas, no sensor, no per-frame
 * anything. The referee sends a level and three absolute timestamps, this
 * component renders a wheel and a draining pie, and one message goes back per
 * level. The only thing running at frame rate is the pie, and it is a CSS
 * transform driven by one `requestAnimationFrame` loop writing a ref — Preact
 * never re-renders for it, the same split Asteroid Race's HUD uses.
 */
export function ColorMatchRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <ColorMatchRoomInner game={card} code={code} />}</RoomGate>;
}

/** The pie's own circumference: a stroke of width 10 on a circle of radius 5
 *  paints a solid disc of radius 10, so the dash length around r=5 is what a
 *  fraction of the pie costs. */
const PIE_C = 2 * Math.PI * 5;

function css(rgb: Rgb): string {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

function ColorMatchRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<ColorMatchState | null>(null);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'color-match') setState(msg.d);
  }, []);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;
  const clientRef = useRef(client);
  clientRef.current = client;

  const level = state?.level ?? 1;
  const rung = rungAt(level);

  /** This phone's own pick. Reset every level — a cursor left on the last
   *  answer would hand out free points whenever two levels happened to want
   *  the same colour. */
  const [pick, setPick] = useState<Rgb>(() => neutralFor());
  useEffect(() => {
    setPick(neutralFor());
  }, [level, state?.roundId]);

  /** Send on every change rather than once at the deadline: the referee keeps
   *  the last one that arrived before the window shut (spec §6), so a phone
   *  that dies mid-level still has its most recent answer in. */
  const onPick = useCallback(
    (rgb: Rgb) => {
      setPick(rgb);
      const s = state;
      if (!s || s.phase !== 'pick') return;
      clientRef.current?.send({
        t: 'color-pick',
        d: { roundId: s.roundId, level: s.level, rgb: [rgb[0], rgb[1], rgb[2]], at: clientRef.current.now() },
      });
    },
    [state?.roundId, state?.level, state?.phase],
  );

  // The pie, written straight into the DOM. One rAF loop, no re-render.
  const pieRef = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const s = state;
    if (!s || s.phase !== 'pick') return;
    let frame = 0;
    const loop = (): void => {
      const el = pieRef.current;
      if (el) {
        const now = clientRef.current?.now() ?? Date.now();
        const left = Math.max(0, Math.min(1, (s.picksDueAt - now) / colorActionMs(s.level)));
        // A stroke on a half-radius circle IS the pie: the dash eats the
        // sweep, so one number drives the whole shape.
        el.style.strokeDasharray = `${(PIE_C * left).toFixed(2)} ${PIE_C.toFixed(2)}`;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [state?.roundId, state?.level, state?.phase, state?.picksDueAt]);

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  if (state && state.phase === 'done') {
    const ranked = Object.entries(state.totals).sort(([, a], [, b]) => b - a);
    return (
      <GameOverScreen
        room={room}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        note={text({
          en: `The room ran out of colour at level ${state.level}.`,
          fr: `La salle a séché au niveau ${state.level}.`,
        })}
        rows={ranked.map(([id, total]) => ({ id, avatar: avatarOf(id), name: nameOf(id), value: total, unit: text({ en: 'pts', fr: 'pts' }) }))}
        me={myId}
        winner={state.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'color-match', solo } })}
        canAct={room.isHost && enoughToStart(room.connected, [COLOR_MATCH_MIN_PLAYERS, COLOR_MATCH_MAX_PLAYERS], solo)}
      />
    );
  }

  if (state) {
    const target = state.target as Rgb;
    const revealing = state.phase === 'reveal';
    const mine = myId ? state.picks[myId] : undefined;
    const ladder = Object.entries(state.totals).map(([id, total]) => ({ id, avatar: avatarOf(id), name: nameOf(id), value: total }));

    return (
      <div class="cmatch" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={text({ en: `Level ${state.level}`, fr: `Niveau ${state.level}` })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
        />

        <div class="cmatch__target" style={{ background: css(target) }}>
          <svg class="cmatch__pie" viewBox="-12 -12 24 24" aria-hidden="true">
            <circle r="10" fill="rgba(11, 9, 16, 0.55)" />
            {/* Rotated with SVG's own transform, not CSS: under
                `transform-box: view-box` a CSS `transform-origin: center`
                resolves to (12, 12) in user space rather than to this
                viewBox's own centre at (0, 0), which swings the arc clean off
                the circle. `rotate(-90)` here is about the origin, full stop. */}
            <g transform="rotate(-90)">
              <circle ref={pieRef} r="5" fill="none" stroke="#F8FAFC" stroke-width="10" stroke-dasharray="31.4" />
            </g>
          </svg>
        </div>

        {/*
          The verdict panel. Its footprint never changes: both lines are always
          in the DOM and both reserve their own height, so the wheel does not
          jump down the page the moment a score appears. What varies is what
          they say, and whether the second one is visible at all.
        */}
        <div
          class={`cmatch__verdict${revealing ? ` cmatch__verdict--${(mine?.score ?? 0) > 0 ? 'hit' : 'miss'}` : ' cmatch__verdict--quiet'}`}
          aria-live="polite"
        >
          <p class="cmatch__score">
            {revealing ? (
              <>
                <strong class="cmatch__points">{mine?.score ?? 0}</strong>
                {text({ en: 'points', fr: 'points' })}
              </>
            ) : (
              text({ en: 'Find it', fr: 'Trouvez-la' })
            )}
          </p>
          {/* Accuracy, how long it took, and whether the clock helped or hurt.
              The multiplier itself is not shown (it is arithmetic nobody reads
              mid-round); the word and its colour are the whole message. */}
          <p class="cmatch__breakdown" style={{ visibility: revealing ? 'visible' : 'hidden' }}>
            {text({ en: 'accuracy', fr: 'précision' })} <strong>{mine?.accuracy ?? 0}</strong>
            {mine ? (
              <>
                {' · '}
                {text({ en: `${(mine.reactionMs / 1000).toFixed(1)}s`, fr: `${(mine.reactionMs / 1000).toFixed(1)} s` })}
                {(() => {
                  const k = reactionMultiplier(mine.reactionMs, colorActionMs(state.level));
                  if (k === 1) return null;
                  return (
                    <>
                      {' · '}
                      <span class={k > 1 ? 'cmatch__bonus' : 'cmatch__malus'}>
                        {k > 1 ? text({ en: 'bonus', fr: 'bonus' }) : text({ en: 'malus', fr: 'malus' })}
                      </span>
                    </>
                  );
                })()}
              </>
            ) : (
              <>{' · '}{text({ en: 'no answer', fr: 'aucune réponse' })}</>
            )}
          </p>
        </div>

        <div class="cmatch__board">
          <ColorWheel
            rung={rung}
            value={revealing ? target : pick}
            onPick={onPick}
            disabled={revealing}
            label={text({ en: 'Colour wheel', fr: 'Roue chromatique' })}
          />
        </div>

        <WideScoreboard
          rows={ladder}
          me={myId}
          unit={text({ en: 'pts', fr: 'pts' })}
          label={text({ en: 'Scores', fr: 'Scores' })}
        />
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
      canStart={room.isHost && enoughToStart(room.connected, [COLOR_MATCH_MIN_PLAYERS, COLOR_MATCH_MAX_PLAYERS], solo)}
      startLabel={t.common.startRound}
      onStart={() => client?.send({ t: 'start', d: { mode: 'color-match', solo } })}
      extras={
        <p class="cmatch__warning">
          {text({
            en: 'This one is pure colour matching — if you are colour-blind, it will not be a fair race.',
            fr: 'Ici tout repose sur la couleur — si vous êtes daltonien, la course ne sera pas équitable.',
          })}
        </p>
      }
    />
  );
}
