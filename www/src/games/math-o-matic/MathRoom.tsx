import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  MATH_MAX_PLAYERS,
  MATH_MIN_PLAYERS,
  mathAnswerMs,
  type MathState,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { MATH_DEFAULT_OPTIONS, type MathOptions } from '../../../../shared/mathQuestion';
import { useGameRoom } from '../../core/room/useRoom';
import { useSoloTesting } from '../../core/useSolo';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { WideScoreboard } from '../../core/ui/WideScoreboard';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { MathOptionsPanel } from './MathOptions';
import './math-o-matic.css';

/**
 * Math-o-matic's room screen. Spec: docs/specs/games/math-o-matic.md §4
 *
 * Like Color Match, one of the lightest rooms in the catalogue: no canvas, no
 * sensor, nothing at frame rate but the timer bar — which is a CSS transform
 * driven by one `requestAnimationFrame` writing a ref, so Preact never
 * re-renders for it.
 *
 * The one thing worth being careful about is what the screen says *before* the
 * reveal: a player who has answered sees only that they have answered, never
 * whether they were right (spec §2). Showing it early would leak the answer to
 * everyone watching their neighbour's face, which in a room of eight is
 * everybody.
 */
export function MathRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <MathRoomInner game={card} code={code} />}</RoomGate>;
}

function MathRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<MathState | null>(null);
  const [options, setOptions] = useState<MathOptions>(MATH_DEFAULT_OPTIONS);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'math') setState(msg.d);
  }, []);

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;
  const clientRef = useRef(client);
  clientRef.current = client;

  const start = useCallback(() => {
    clientRef.current?.send({
      t: 'start',
      d: {
        mode: 'math',
        solo,
        // Ranges are sent as plain pairs; the referee sanitises them.
        math: { ops: [...options.ops], digits: [options.digits[0], options.digits[1]], operators: [options.operators[0], options.operators[1]] },
      },
    });
  }, [solo, options]);

  /** My tap for the question in flight. Held locally as well as being sent,
   *  because the referee deliberately does not echo it back until the reveal —
   *  so this is the only thing that can grey out the buttons in between. */
  const [tapped, setTapped] = useState<number | null>(null);
  useEffect(() => {
    setTapped(null);
  }, [state?.index, state?.roundId]);

  const answer = useCallback(
    (choice: number) => {
      const s = state;
      if (!s || s.phase !== 'ask' || tapped !== null) return;
      setTapped(choice);
      clientRef.current?.send({ t: 'math-answer', d: { roundId: s.roundId, index: s.index, choice } });
    },
    [state?.roundId, state?.index, state?.phase, tapped],
  );

  // The draining bar, written straight into the DOM. One rAF loop, no re-render.
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = state;
    if (!s || s.phase !== 'ask') return;
    const window = mathAnswerMs(s.text);
    let frame = 0;
    const loop = (): void => {
      const el = barRef.current;
      if (el) {
        const now = clientRef.current?.now() ?? Date.now();
        const left = Math.max(0, Math.min(1, (s.closesAt - now) / window));
        el.style.transform = `scaleX(${left.toFixed(4)})`;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [state?.roundId, state?.index, state?.phase, state?.closesAt]);

  const players = room.room?.players ?? [];
  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🙂';

  if (state && state.phase === 'done') {
    const ranked = Object.entries(state.scores).sort(([, a], [, b]) => b - a);
    return (
      <GameOverScreen
        room={room}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        note={
          state.draw
            ? text({ en: 'The last lives went together — nobody takes it.', fr: 'Les dernières vies sont parties ensemble — personne ne l’emporte.' })
            : text({ en: `${state.index + 1} sums.`, fr: `${state.index + 1} calculs.` })
        }
        rows={ranked.map(([id, points]) => ({
          id,
          avatar: avatarOf(id),
          name: nameOf(id),
          value: points,
          unit: text({ en: 'right', fr: 'bonnes' }),
        }))}
        me={myId}
        winner={state.winner}
        onAgain={start}
        canAct={room.isHost && enoughToStart(room.connected, [MATH_MIN_PLAYERS, MATH_MAX_PLAYERS], solo)}
      />
    );
  }

  if (state) {
    const revealing = state.phase !== 'ask';
    const myLives = myId ? state.lives[myId] ?? 0 : 0;
    const iAmOut = myId !== undefined && myLives <= 0;
    const ladder = Object.entries(state.lives).map(([id, lives]) => ({
      id,
      avatar: avatarOf(id),
      name: nameOf(id),
      // The scoreboard counts lives, because lives are what decide the round —
      // the score is the brag and it sits on the results screen (spec §2).
      value: lives,
      out: lives <= 0,
    }));

    return (
      <div class="math" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          status={text({ en: `Sum ${state.index + 1}`, fr: `Calcul ${state.index + 1}` })}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
        />

        <div class="math__question">
          <p class="math__sum" aria-live="polite">{state.text}</p>
          <div class="math__timer" aria-hidden="true">
            <div ref={barRef} class="math__timer-fill" />
          </div>
          {/* The bar's accessible equivalent: a screen reader gets the window
              as words rather than a shape it cannot see (spec §11). */}
          <p class="visually-hidden">
            {revealing
              ? text({ en: 'Answers are closed.', fr: 'Les réponses sont closes.' })
              : text({
                  en: `About ${Math.round(mathAnswerMs(state.text) / 1000)} seconds to answer.`,
                  fr: `Environ ${Math.round(mathAnswerMs(state.text) / 1000)} secondes pour répondre.`,
                })}
          </p>
        </div>

        <p class="math__prompt" aria-live="polite">
          {iAmOut
            ? text({ en: 'You are out — watch it play out', fr: 'Vous êtes éliminé — regardez la suite' })
            : revealing
              ? tapped === null
                ? text({ en: 'No answer — that cost a life', fr: 'Aucune réponse — une vie en moins' })
                : tapped === state.correct
                  ? text({ en: 'Right', fr: 'Juste' })
                  : text({ en: 'Wrong — a life gone', fr: 'Faux — une vie en moins' })
              : tapped === null
                ? text({ en: 'Which one?', fr: 'Laquelle ?' })
                : text({ en: 'Answered. Waiting for the room', fr: 'Répondu. En attente de la salle' })}
        </p>

        <div class="math__answers">
          {state.answers.map((value, i) => {
            const correct = revealing && state.correct === i;
            const mine = tapped === i;
            // Who fell for what is public, and it is most of the fun (spec §4).
            const fellForIt = revealing
              ? Object.entries(state.taps).filter(([, choice]) => choice === i).map(([id]) => id)
              : [];
            return (
              <button
                key={i}
                type="button"
                class={
                  'math__answer'
                  + (mine ? ' math__answer--mine' : '')
                  + (correct ? ' math__answer--right' : '')
                  + (revealing && !correct ? ' math__answer--wrong' : '')
                }
                disabled={revealing || tapped !== null || iAmOut}
                onClick={() => answer(i)}
              >
                <span class="math__value">{value}</span>
                {/* A tick and a cross as well as the colour, so the reveal is
                    never a colour code (spec §11). */}
                {revealing && <span class="math__mark" aria-hidden="true">{correct ? '✓' : '✕'}</span>}
                {fellForIt.length > 0 && (
                  <span class="math__who" aria-hidden="true">
                    {fellForIt.map((id) => avatarOf(id)).join('')}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <WideScoreboard
          rows={ladder}
          me={myId}
          unit={text({ en: 'lives', fr: 'vies' })}
          label={text({ en: 'Lives', fr: 'Vies' })}
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
      canStart={room.isHost && enoughToStart(room.connected, [MATH_MIN_PLAYERS, MATH_MAX_PLAYERS], solo)}
      startLabel={t.common.startRound}
      onStart={start}
      extras={<MathOptionsPanel value={options} onChange={setOptions} editable={room.isHost} />}
    />
  );
}
