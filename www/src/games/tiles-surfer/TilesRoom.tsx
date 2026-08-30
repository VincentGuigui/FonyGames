import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  TILES_LIVES,
  TILES_MAX_PLAYERS,
  TILES_MIN_PLAYERS,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { useSoloTesting } from '../../core/useSolo';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { Scoreboard, type ScoreRow } from '../../core/ui/Scoreboard';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText, type GameText } from '../../core/i18n/gameText';
import { applyTilesSurfer, bestStreak, scoreOf, TilesRun, reportDue, type TilesSurferView } from './game';
import { TilesCanvas } from './TilesCanvas';

/**
 * Tiles Surfer's room screen. Spec: docs/specs/games/tiles-surfer.md
 *
 * The first game in the catalogue whose round runs almost entirely on this
 * phone rather than the referee's (spec §8): the `TilesRun` in `run` is the
 * whole simulation, and this component's only jobs are to feed it a clock,
 * read its numbers back out for the screen, and hand the referee a periodic
 * checkpoint. Every other player's board is invisible to this phone — all
 * that ever arrives about them is the same periodic numbers this phone sends
 * about itself (§6) — so the only thing rendered here besides this player's
 * own board is the shared, low-frequency `Scoreboard`.
 */
export function TilesRoom(props: { game: GameCard }): JSX.Element {
  return (
    <RoomGate game={props.game}>
      {(code, card) => <TilesRoomInner game={card} code={code} />}
    </RoomGate>
  );
}

function TilesRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const [state, setState] = useState<TilesSurferView | null>(null);

  const onGame = useCallback((msg: ServerMessage) => {
    setState((prev) => applyTilesSurfer(prev, msg));
  }, []);

  const solo = useSoloTesting();
  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const client = room.client;
  const myId = room.me?.id;

  const clientRef = useRef(client);
  clientRef.current = client;

  const running = state?.phase === 'running';

  // This player's own board — created fresh the instant a new round's `roundId` arrives,
  // and never touched by anything the referee sends: there is nothing for it to correct.
  const runRef = useRef<TilesRun | null>(null);
  if (state && (!runRef.current || runRef.current.roundId !== state.roundId)) {
    runRef.current = new TilesRun(state.roundId);
  }
  const run = runRef.current;

  const [mine, setMine] = useState({ score: 0, lives: TILES_LIVES });
  const lastReportedRef = useRef(0);
  const finalSentRef = useRef(false);
  const wonReportRoundRef = useRef<number | null>(null);

  useEffect(() => {
    setMine({ score: 0, lives: TILES_LIVES });
    lastReportedRef.current = 0;
    finalSentRef.current = false;
  }, [state?.roundId]);

  const elapsedMs = useCallback(() => {
    if (!state) return 0;
    return (clientRef.current?.now() ?? Date.now()) - state.startsAt;
  }, [state?.startsAt]);

  const onTick = useCallback(() => {
    const r = runRef.current;
    if (!r) return;
    setMine((prev) => (prev.score === r.score && prev.lives === r.lives ? prev : { score: r.score, lives: r.lives }));

    const send = (): void => {
      clientRef.current?.send({
        t: 'tiles-report',
        d: {
          roundId: r.roundId,
          score: r.score,
          lives: r.lives,
          perfects: r.perfects,
          longestStreak: r.longestStreak,
          avgReactionMs: r.avgReactionMs,
        },
      });
    };

    if (!r.alive) {
      if (!finalSentRef.current) {
        finalSentRef.current = true;
        send();
      }
      return;
    }
    if (reportDue(r, lastReportedRef.current)) {
      lastReportedRef.current = r.score;
      send();
    }
  }, []);

  // The winner never sends their own closing report by running out of lives — by
  // definition they are still going when the round ends around them (spec §6) — so
  // the moment the referee says the round is over, one last report carries their
  // real final numbers instead of whatever their last checkpoint happened to be.
  useEffect(() => {
    if (!state || state.phase !== 'done' || !myId || state.winner !== myId) return;
    const r = runRef.current;
    if (!r || wonReportRoundRef.current === state.roundId) return;
    wonReportRoundRef.current = state.roundId;
    clientRef.current?.send({
      t: 'tiles-report',
      d: {
        roundId: r.roundId,
        score: r.score,
        lives: r.lives,
        perfects: r.perfects,
        longestStreak: r.longestStreak,
        avgReactionMs: r.avgReactionMs,
      },
    });
  }, [state?.phase, state?.winner, myId]);

  const players = room.room?.players ?? [];
  const scoreRows: ScoreRow[] = players.map((p) => ({
    id: p.id,
    avatar: p.avatar,
    name: p.name,
    value: Math.round(scoreOf(state ?? emptyView(), p.id)),
    ...(state && (state.scores[p.id]?.lives ?? TILES_LIVES) <= 0 ? { out: true } : {}),
  }));

  if (state && state.phase === 'done') {
    const ranked = [...players].sort((a, b) => scoreOf(state, b.id) - scoreOf(state, a.id));
    return (
      <GameOverScreen
        room={room}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        note={text({
          en: `Longest perfect streak of the round: ${bestStreak(state)}`,
          fr: `Plus longue série parfaite de la manche : ${bestStreak(state)}`,
        })}
        rows={ranked.map((p) => ({
          id: p.id,
          avatar: p.avatar,
          name: p.name,
          value: Math.round(scoreOf(state, p.id)),
          unit: text({ en: 'pts', fr: 'pts' }),
          ...((state.scores[p.id]?.lives ?? 0) <= 0 ? { out: true } : {}),
        }))}
        me={myId}
        winner={state.winner}
        onAgain={() => client?.send({ t: 'start', d: { mode: 'tiles', solo } })}
        canAct={room.isHost && enoughToStart(room.connected, [TILES_MIN_PLAYERS, TILES_MAX_PLAYERS], solo)}
      />
    );
  }

  if (state && running && run) {
    const iAmOut = mine.lives <= 0;

    if (iAmOut) {
      return (
        <div class="tiles tiles--out" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
          <StatusBar
            status={text({ en: 'You’re out', fr: 'Vous êtes éliminé' })}
            title={card.title}
            concept={card.concept}
            rules={card.rules}
          />
          <Scoreboard rows={scoreRows} me={myId} unit={text({ en: 'pts', fr: 'pts' })} best="high" />
          <p class="tiles__gone" aria-hidden="true">🧊</p>
          <p class="tiles__gone-note">{text({ en: 'Out of lives — watching the rest of the run.', fr: 'Plus de vie — vous regardez la suite.' })}</p>
        </div>
      );
    }

    return (
      <div class="tiles" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          score={{ value: Math.round(mine.score), label: text({ en: 'pts', fr: 'pts' }) }}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
        />
        <p class="tiles__lives">
          <span aria-hidden="true">
            {'●'.repeat(mine.lives)}
            {'○'.repeat(Math.max(0, TILES_LIVES - mine.lives))}
          </span>
          <span class="tiles__lives-n">{mine.lives} {t.common.lives}</span>
        </p>
        <TilesCanvas run={run} elapsedMs={elapsedMs} accent={card.accent} onTick={onTick} />
        <Scoreboard rows={scoreRows} me={myId} unit={text({ en: 'pts', fr: 'pts' })} best="high" />
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
      canStart={room.isHost && enoughToStart(room.connected, [TILES_MIN_PLAYERS, TILES_MAX_PLAYERS], solo)}
      startLabel={state ? t.common.playAgain : t.common.startRound}
      onStart={() => client?.send({ t: 'start', d: { mode: 'tiles', solo } })}
      note={note(room.isHost, room.connected, text)}
    />
  );
}

function emptyView(): TilesSurferView {
  return { roundId: 0, startsAt: 0, endsAt: 0, scores: {}, winner: null, phase: 'running', seq: 0 };
}

function note(isHost: boolean, connected: number, text: GameText): string {
  if (connected > TILES_MAX_PLAYERS) return text({ en: `${TILES_MAX_PLAYERS} players is the most this one takes.`, fr: `${TILES_MAX_PLAYERS} joueurs maximum.` });
  if (!isHost) return text({ en: 'The host starts the round.', fr: "L’hôte démarre la manche." });
  return text({ en: 'Own board, own pace — land your taps and it only gets faster.', fr: 'Votre plateau, votre rythme — visez juste et ça accélère.' });
}
