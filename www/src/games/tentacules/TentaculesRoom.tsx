import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  TENT_ARMS,
  TENT_MAX_PLAYERS,
  TENT_MIN_PLAYERS,
  TENT_MODES,
  TENT_SUMMIT_M,
  TENT_TRIAL_MS,
  type ServerMessage,
  type TentMode,
  type TentaculesState,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { MAX_PULL, bodyOf, dist, heightOf, normaliseTentMode, type Point } from '../../../../shared/tentacules';
import { useGameRoom } from '../../core/room/useRoom';
import { useLobbyOptions } from '../../core/room/useLobbyOptions';
import { useSoloTesting } from '../../core/useSolo';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { StatusBar } from '../../core/ui/StatusBar';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText } from '../../core/i18n/gameText';
import { colorFor, loadAvatarColors } from '../../core/avatarColor';
import { armed, drop, fresh, heldPegs, launch, reconcile, rest, tick, type Octo, type Send } from './game';
import { draw, pegOf, pegsNear, type Face, type Frame, type Rival, type Shadow } from './render';
import './tentacules.css';

/**
 * Tentacules' room screen. Spec: docs/specs/games/tentacules.md §4
 *
 * The climb runs here (game.ts) and is drawn on one canvas (render.ts); what
 * leaves the phone is only what was done — a grab, a let-go, a reset — and the
 * referee's state says who holds which peg.
 */
export function TentaculesRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code, card) => <Inner game={card} code={code} />}</RoomGate>;
}

loadAvatarColors();

type Options = { mode: TentMode };
const DEFAULT_OPTIONS: Options = { mode: 'trial' };
const normaliseOptions = (raw: unknown): Options => ({ mode: normaliseTentMode(raw) });

const MODE_TEXT: Record<TentMode, { name: { en: string; fr: string }; blurb: { en: string; fr: string } }> = {
  trial: { name: { en: 'Time trial', fr: 'Contre-la-montre' }, blurb: { en: 'Climb as high as you can in one minute', fr: 'Grimpez le plus haut possible en une minute' } },
  summit: { name: { en: 'Summit', fr: 'Sommet' }, blurb: { en: `First to the ${TENT_SUMMIT_M} m line wins`, fr: `Le premier à la ligne des ${TENT_SUMMIT_M} m gagne` } },
};

/** A tentacle's tip is grabbed within this of the finger, in wall units. */
const TIP_HIT = 0.075;
/** The body is grabbed for the slingshot within this. */
const BODY_HIT = 0.13;

function Options({ value, onChange, editable }: { value: Options; onChange: (o: Options) => void; editable: boolean }): JSX.Element {
  const text = useGameText();
  return (
    <fieldset class="tent-options" disabled={!editable}>
      <legend class="tent-options__legend">{text({ en: 'Mode', fr: 'Mode' })}</legend>
      {TENT_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value.mode === mode}
          class={`tent-options__mode${value.mode === mode ? ' tent-options__mode--on' : ''}`}
          disabled={!editable}
          onClick={() => onChange({ mode })}
        >
          <b>{text(MODE_TEXT[mode].name)}</b>
          <span>{text(MODE_TEXT[mode].blurb)}</span>
        </button>
      ))}
      {!editable && <p class="howto__aside">{text({ en: 'The host picks the mode.', fr: 'L’hôte choisit le mode.' })}</p>}
    </fieldset>
  );
}

function Inner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const solo = useSoloTesting();
  const [state, setState] = useState<TentaculesState | null>(null);
  const stateRef = useRef<TentaculesState | null>(null);

  const onGame = useCallback((msg: ServerMessage) => {
    if (msg.t === 'tentacules') {
      stateRef.current = msg.d;
      setState(msg.d);
    }
  }, []);
  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
  const clientRef = useRef(room.client);
  clientRef.current = room.client;
  const myId = room.me?.id;
  const myIdRef = useRef(myId);
  myIdRef.current = myId;
  const [options, setOptions] = useLobbyOptions<Options>(room, normaliseOptions, DEFAULT_OPTIONS);
  const players = room.room?.players ?? [];
  const playersRef = useRef(players);
  playersRef.current = players;

  const now = (): number => clientRef.current?.now() ?? Date.now();

  /* The octopus, and everything the frame loop reads, in refs. */
  const octo = useRef<Octo>(fresh());
  const pending = useRef(new Map<number, { peg: number | null; at: number }>());
  const cam = useRef(0);
  const drag = useRef<{ arm: number; at: Point } | null>(null);
  const pull = useRef<{ from: Point; by: Point } | null>(null);
  const tips = useRef<Point[]>([]);
  const resetAt = useRef(-Infinity);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [height, setHeight] = useState(0);
  const [clock, setClock] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const toastSeq = useRef(0);

  const playing = state?.phase === 'playing';

  const say = useCallback((msg: string) => {
    const id = ++toastSeq.current;
    setToast({ id, text: msg });
    window.setTimeout(() => setToast((x) => (x?.id === id ? null : x)), 1100);
  }, []);

  const send = useCallback((s: Send) => {
    const st = stateRef.current;
    if (!st) return;
    const at = now();
    if (s.t === 'grab') {
      pending.current.set(s.arm, { peg: s.peg, at });
      clientRef.current?.send({ t: 'tentacules-grab', d: { roundId: st.roundId, arm: s.arm, peg: s.peg } });
    } else if (s.t === 'let-go') {
      for (const arm of s.arms) pending.current.set(arm, { peg: null, at });
      clientRef.current?.send({ t: 'tentacules-let-go', d: { roundId: st.roundId, arms: s.arms } });
    } else {
      for (let arm = 0; arm < TENT_ARMS; arm++) pending.current.set(arm, { peg: -(arm + 1), at });
      resetAt.current = at;
      clientRef.current?.send({ t: 'tentacules-reset', d: { roundId: st.roundId } });
    }
  }, []);

  // A new round: a fresh octopus on its starting pegs, or — back mid-round — on
  // the pegs the referee says it holds.
  const builtFor = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!state || myId === undefined || state.phase !== 'playing' || builtFor.current === state.roundId) return;
    builtFor.current = state.roundId;
    pending.current.clear();
    const mine = state.players[myId];
    let o = fresh();
    if (mine) o = reconcile(o, mine.holds, pending.current, (id) => pegOf(state.seed, id), now());
    const at = rest(o);
    if (at) o = { ...o, body: at };
    octo.current = o;
    cam.current = Math.max(0, o.body.y - 1);
  }, [state, myId]);

  // The referee's word on my holds.
  useEffect(() => {
    if (!state || myId === undefined || builtFor.current !== state.roundId) return;
    const mine = state.players[myId];
    if (!mine) return;
    const before = heldPegs(octo.current).length;
    octo.current = reconcile(octo.current, mine.holds, pending.current, (id) => pegOf(state.seed, id), now());
    if (heldPegs(octo.current).length < before && pending.current.size === 0) say(text({ en: 'Knocked off!', fr: 'Décroché !' }));
  }, [state, myId]);

  /** Who holds a shared peg, other than me. */
  const rivalsOf = (st: TentaculesState): Map<number, Rival> => {
    const out = new Map<number, Rival>();
    for (const [id, p] of Object.entries(st.players)) {
      if (id === myIdRef.current) continue;
      const avatar = playersRef.current.find((q) => q.id === id)?.avatar ?? '';
      p.holds.forEach((peg, arm) => {
        if (peg !== null && peg > 0) out.set(peg, { tint: colorFor(avatar) ?? '#8892A6', since: p.since[arm] ?? 0 });
      });
    }
    return out;
  };

  // The frame loop: simulate, sync, draw.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      const st = stateRef.current;
      const el = canvas.current;
      const ctx = el?.getContext('2d');
      if (!st || !el || !ctx || st.phase !== 'playing') return;
      const t = performance.now();
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const at = now();
      const started = at >= st.startsAt;
      const rivals = rivalsOf(st);
      const taken = (peg: number): { since: number } | null => rivals.get(peg) ?? null;

      if (started && !pull.current) {
        const near = pegsNear(st.seed, octo.current.body.y - 1.2, octo.current.body.y + 1.2);
        const r = tick(octo.current, dt, at, near, taken);
        octo.current = r.octo;
        for (const s of r.send) send(s);
      }
      const o = octo.current;

      // Size the canvas to its box, in device pixels.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // The camera keeps the body at mid-screen once it gets there; it follows a fall down too.
      const visible = h / w;
      const want = Math.max(0, o.body.y - visible * 0.5);
      cam.current += (want - cam.current) * (reduced && Math.abs(want - cam.current) > visible ? 1 : Math.min(1, dt * 6));

      const restAt = rest(o);
      const body = pull.current && restAt ? { x: restAt.x + pull.current.by.x, y: restAt.y + pull.current.by.y } : o.body;
      const n = heldPegs(o).length;
      const face: Face =
        at - resetAt.current < 1500 || (o.mode === 'falling' && o.vel.y < -2)
          ? 'dizzy'
          : pull.current
            ? 'strain'
            : o.mode === 'flying'
              ? 'joy'
              : n === 1
                ? 'worried'
                : 'happy';
      const shadows: Shadow[] = Object.entries(st.players)
        .filter(([id]) => id !== myIdRef.current)
        .map(([id, p]) => {
          const who = playersRef.current.find((q) => q.id === id);
          const holds = p.holds.map((peg) => (peg === null ? null : pegOf(st.seed, peg)));
          const b = bodyOf(st.seed, p.holds);
          return { id, name: who?.name ?? '?', avatar: who?.avatar ?? '🐙', tint: colorFor(who?.avatar ?? '') ?? '#8892A6', holds, body: b, height: b ? heightOf(b.y) : 0 };
        });
      const myAvatar = playersRef.current.find((q) => q.id === myIdRef.current)?.avatar ?? '';
      const f: Frame = {
        seed: st.seed,
        w,
        h,
        dpr,
        camY: cam.current,
        now: at,
        summit: st.mode === 'summit',
        reduced,
        me: {
          tint: colorFor(myAvatar) ?? card.accent,
          body,
          holds: o.holds,
          tips: tips.current,
          face,
          armed: armed(o) && !pull.current,
          oneSince: o.oneSince,
          drag: drag.current,
          pull: pull.current?.by ?? null,
        },
        shadows,
        rivals,
      };
      draw(ctx, f);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // The clock and the height on the status bar.
  useEffect(() => {
    if (!playing || !state) return;
    const id = window.setInterval(() => {
      const into = now() - state.startsAt;
      setCountdown(into < 0 ? Math.ceil(-into / 1000) : 0);
      setClock(state.mode === 'trial' ? Math.max(0, Math.ceil((TENT_TRIAL_MS - Math.max(0, into)) / 1000)) : Math.max(0, Math.floor(into / 1000)));
      setHeight(heightOf(octo.current.body.y));
    }, 200);
    return () => window.clearInterval(id);
  }, [playing, state?.roundId]);

  /* Input: drag a tentacle tip to a peg, or pull the body back when armed. */
  const toWorld = (e: PointerEvent): Point => {
    const el = canvas.current as HTMLCanvasElement;
    const r = el.getBoundingClientRect();
    const w = r.width;
    return { x: (e.clientX - r.left) / w, y: cam.current + (r.height - (e.clientY - r.top)) / w };
  };
  const onDown = (e: PointerEvent): void => {
    const st = stateRef.current;
    if (!st || now() < st.startsAt || drag.current || pull.current) return;
    const p = toWorld(e);
    const o = octo.current;
    // What a tap means, in order: a held tentacle (its peg), the body when the
    // slingshot is armed, then a free tentacle — free tips dangle close to the body.
    const tipAt = (held: boolean): number => {
      let best = -1;
      let gap = TIP_HIT;
      tips.current.forEach((tip, arm) => {
        const d = dist(tip, p);
        if ((o.holds[arm] !== null) === held && d < gap) {
          gap = d;
          best = arm;
        }
      });
      return best;
    };
    let best = tipAt(true);
    const restAt = rest(o);
    if (best < 0 && armed(o) && restAt && dist(restAt, p) <= BODY_HIT) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      pull.current = { from: p, by: { x: 0, y: 0 } };
      return;
    }
    if (best < 0) best = tipAt(false);
    if (best < 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { arm: best, at: p };
  };
  const onMove = (e: PointerEvent): void => {
    const p = toWorld(e);
    if (drag.current) drag.current = { ...drag.current, at: p };
    if (pull.current) {
      const by = { x: p.x - pull.current.from.x, y: p.y - pull.current.from.y };
      const len = Math.hypot(by.x, by.y);
      const k = len > MAX_PULL ? MAX_PULL / len : 1;
      pull.current = { ...pull.current, by: { x: by.x * k, y: by.y * k } };
    }
  };
  const onUp = (e: PointerEvent): void => {
    const st = stateRef.current;
    if (!st) return;
    const at = now();
    if (pull.current) {
      const by = pull.current.by;
      pull.current = null;
      const l = launch(octo.current, by);
      if (l) {
        octo.current = l.octo;
        send(l.send);
      }
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const p = toWorld(e);
    const rivals = rivalsOf(st);
    const r = drop(octo.current, d.arm, p, pegsNear(st.seed, p.y - 0.3, p.y + 0.3), (peg) => rivals.get(peg) ?? null, at);
    if (r.ok) {
      octo.current = r.octo;
      send(r.send);
    } else if (r.reason === 'reach') say(text({ en: 'Too far!', fr: 'Trop loin !' }));
    else if (r.reason === 'taken') say(text({ en: 'Taken — wait 3 s', fr: 'Pris — attendez 3 s' }));
  };

  const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' });
  const avatarOf = (id: string): string => players.find((p) => p.id === id)?.avatar ?? '🐙';

  const start = useCallback(() => {
    clientRef.current?.send({ t: 'start', d: { mode: 'tentacules', solo, tentacules: { ...options } } });
  }, [solo, options]);
  const canStart = room.isHost && enoughToStart(room.connected, [TENT_MIN_PLAYERS, TENT_MAX_PLAYERS], solo);

  if (state && state.phase === 'done') {
    const rows = Object.entries(state.players)
      .sort((a, b) => (a[0] === state.winner ? -1 : b[0] === state.winner ? 1 : b[1].best - a[1].best || a[1].bestAt - b[1].bestAt))
      .map(([id, p]) => ({
        id,
        avatar: avatarOf(id),
        name: nameOf(id),
        value: `${p.best.toFixed(1)} m`,
        ...(p.finishedMs !== undefined ? { detail: text({ en: `Summit in ${(p.finishedMs / 1000).toFixed(1)} s`, fr: `Sommet en ${(p.finishedMs / 1000).toFixed(1)} s` }) } : {}),
        out: false,
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
        status={text(MODE_TEXT[state.mode].name)}
        headline={state.solo ? text({ en: 'Well climbed!', fr: 'Bien grimpé !' }) : undefined}
        note={text(
          state.mode === 'trial'
            ? { en: 'The highest point reached in a minute wins.', fr: 'Le point le plus haut atteint en une minute gagne.' }
            : { en: `First to the ${TENT_SUMMIT_M} m line wins; otherwise the highest.`, fr: `Le premier à la ligne des ${TENT_SUMMIT_M} m gagne ; sinon, le plus haut.` },
        )}
        rows={rows}
        me={myId}
        winner={state.winner}
        onAgain={start}
        canAct={canStart}
      />
    );
  }

  if (state) {
    const mm = `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, '0')}`;
    return (
      <div class="tent" style={{ '--game-accent': card.accent } as JSX.CSSProperties}>
        <StatusBar
          score={{ value: height.toFixed(1), label: 'm' }}
          status={state.mode === 'trial' ? `${clock} s` : mm}
          title={card.title}
          concept={card.concept}
          rules={card.rules}
          screen={card.screen}
        />
        <canvas
          ref={canvas}
          class={`tent__wall${countdown > 0 ? ' tent__wall--wait' : ''}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => {
            drag.current = null;
            pull.current = null;
          }}
          aria-label={text({ en: 'The reef wall: drag a tentacle onto a peg', fr: 'Le mur de récif : glissez une tentacule sur un plot' })}
        />
        {countdown > 0 && <p class="tent__overlay" aria-live="assertive">{countdown}</p>}
        {toast && (
          <p key={toast.id} class="tent__toast" aria-live="polite">
            {toast.text}
          </p>
        )}
        <p class="visually-hidden" aria-live="polite">
          {text({ en: `${height.toFixed(0)} metres`, fr: `${height.toFixed(0)} mètres` })}
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
      extras={<Options value={options} onChange={setOptions} editable={room.isHost} />}
    />
  );
}
