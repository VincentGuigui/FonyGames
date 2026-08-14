import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { CM_GRAB_SLOP, type Player } from '../../../../shared/protocol';
import type { RoomClient } from '../../core/room/client';
import type { CatMouseGame } from './game';
import { startRenderer, type Renderer } from './render';
import { toBoard } from './layout';
import { StatusBar } from '../../core/ui/StatusBar';
import { RulesPanel } from '../../core/ui/RulesPanel';
import { Scoreboard } from '../../core/ui/Scoreboard';

/**
 * The floor. Spec: docs/specs/games/cat-and-mouse.md §7
 *
 * The canvas animates on its own rAF loop and Preact only renders the chrome, as
 * in every other game here. Pointer handling is deliberately dumb — down grabs,
 * move carries, up releases — and `game.ts` decides what each means, because
 * `direct` and `capped` differ in exactly that and the component should not know.
 *
 * The clock is the one piece of chrome that has to tick, so it re-renders itself
 * twice a second rather than the board re-rendering for it.
 */

export function ChaseBoard({
  game,
  title,
  concept,
  rules,
  accent,
  client,
  players,
}: {
  game: CatMouseGame;
  title: string;
  concept: string;
  rules: string[];
  /**
   * The game's accent, set as `--game-accent` on the round screen's own root.
   *
   * The lobby template sets it for its screens and the round screen is not inside it,
   * so without this every accented thing here — the status bar's number, the score
   * panel's values — fell back to the SITE accent. That is how Ghost Hunt shipped a
   * green game with an orange radar.
   */
  accent: string;
  client: RoomClient | null;
  players: Player[];
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  /** The pointer that owns the drag. One finger moves one icon. */
  const pointerRef = useRef<{ id: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !client) return;
    const r = startRenderer(
      canvas,
      game,
      () => client.now(),
      (p) => {
        const roundId = game.state?.roundId ?? 0;
        client.send({ t: 'move', d: { roundId, x: p.x, y: p.y } });
      },
    );
    rendererRef.current = r;
    return () => {
      r.stop();
      rendererRef.current = null;
    };
  }, [game, client]);

  /** Pointer position in board units, or null before the first frame. */
  function at(e: PointerEvent): { x: number; y: number } | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    const f = rendererRef.current?.floor();
    if (!rect || !f) return null;
    return toBoard(f, e.clientX - rect.left, e.clientY - rect.top);
  }

  function down(e: PointerEvent): void {
    if (pointerRef.current) return;
    const p = at(e);
    // `grab` refuses anything that is not on my own icon: touching the far side
    // of the floor must not teleport me there, because a teleport is not a chase
    // (spec §6). A refused touch is simply nothing — no error, no feedback.
    if (!p || !game.grab(p.x, p.y)) return;
    pointerRef.current = { id: e.pointerId };
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent): void {
    const owner = pointerRef.current;
    if (!owner || owner.id !== e.pointerId) return;
    const p = at(e);
    if (!p) return;
    game.drag(p.x, p.y);
  }

  function up(e: PointerEvent): void {
    const owner = pointerRef.current;
    if (!owner || owner.id !== e.pointerId) return;
    pointerRef.current = null;
    game.release();
  }

  function lost(e: PointerEvent): void {
    const owner = pointerRef.current;
    if (!owner || owner.id !== e.pointerId) return;
    pointerRef.current = null;
    // A cancelled pointer is a release, and a release is a full stop. Same
    // outcome as lifting a finger, which is the honest reading: a notification
    // sliding down mid-chase leaves you standing still, and standing still is
    // how a mouse gets caught (spec §8).
    game.release();
  }

  const state = game.state;
  const iAmCat = game.iAmCat;
  const myLives = game.myLives();
  const me = client?.playerId;

  /*
   * Everyone in the panel, with the cat reading **"cat"** rather than a number.
   *
   * The cat has no lives, so a numeric row for it would print a 0: on a phone, at that
   * size, a 0 in a lives column reads as "about to be out", and the cat is the one
   * player who can never be out.
   *
   * It was left out of the list entirely at first, which was worse. A two-player chase
   * is one cat and one mouse, so dropping the cat left a single row — and the panel
   * hides itself below two, meaning the smallest possible game was the one game with no
   * panel at all. A word instead of a number fixes both ends: the row exists, it says
   * what that player is, and `Number('cat')` is `NaN` so the ranking skips it without
   * needing a rule of its own.
   */
  const scores = (state?.actors ?? []).map((a) => {
    const p = players.find((q) => q.id === a.playerId);
    const isCat = a.playerId === state?.catId;
    return {
      id: a.playerId,
      avatar: p?.avatar ?? '?',
      name: p?.name ?? 'them',
      value: isCat ? 'cat' : a.lives,
      ...(a.out && !isCat ? { out: true } : {}),
    };
  });

  return (
    <div class="chase" style={{ '--game-accent': accent } as JSX.CSSProperties}>
      <canvas
        ref={canvasRef}
        class="chase__canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={lost}
      />

      <div class="chase__hud">
        {/* A number as well as pips — §12 forbids a count carried by shape alone. */}
        <StatusBar
          score={iAmCat ? undefined : { value: myLives ?? 0, label: 'lives' }}
          status={iAmCat ? 'You’re the cat — catch them all' : '●'.repeat(Math.max(0, myLives ?? 0))}
          title={title}
          concept={concept}
          rules={rules}
        />
      </div>

      {/*
        Top left, not the default bottom left: the hint line runs the full width of the
        bottom of this screen, and the panel sat on top of it.
      */}
      <Scoreboard rows={scores} me={me} unit="lives" corner="top-left" />

      <Clock endsAt={game.endsAt()} now={() => client?.now() ?? Date.now()} />

      <p class="chase__hint">{hint(iAmCat, state?.drag ?? 'direct', myLives)}</p>

      {/* Keyed on the round so "Play again" always shows a fresh panel. */}
      {state && (
        <RulesPanel
          key={state.roundId}
          title={title}
          concept={concept}
          rules={rules}
          startsAt={state.startsAt}
          now={() => client?.now() ?? Date.now()}
        />
      )}
    </div>
  );
}

function hint(iAmCat: boolean, drag: 'direct' | 'capped', lives: number | null): string {
  if (lives === 0) return 'Out of lives. Watching the rest.';
  const grab = `Hold your own ${iAmCat ? 'cat' : 'mouse'}`;
  if (drag === 'capped') return `${grab} and drag ahead — it walks that way. Let go and it stops.`;
  return `${grab} and drag. Let go and it stops dead.`;
}

/**
 * Time left, in seconds.
 *
 * Its own component with its own timer, so the ticking clock re-renders one
 * element instead of the whole board. Twice a second rather than every second:
 * a 1 Hz timer visibly skips a number when it drifts against the real deadline.
 */
function Clock({ endsAt, now }: { endsAt: number; now: () => number }): JSX.Element {
  const [, beat] = useState(0);
  useEffect(() => {
    const id = setInterval(() => beat((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - now()) / 1000));
  return (
    <p class="chase__clock" aria-label={`${left} seconds left`}>
      {left}
      <span>s</span>
    </p>
  );
}

/** Re-exported so the room screen can size its own hit slop the same way. */
export const GRAB_SLOP = CM_GRAB_SLOP;
