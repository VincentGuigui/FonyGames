import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  CM_LIVES,
  CM_MAX_PLAYERS,
  CM_MIN_PLAYERS,
  type CatMouseState,
  type Player,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { soloTesting } from '../../core/solo';
import { useRoom, useShareRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { ChaseBoard } from './ChaseBoard';
import { CatMouseGame } from './game';

/**
 * Cat and Mouse's room screen. Spec: docs/specs/games/cat-and-mouse.md
 *
 * The lobby is the shared template. Two things it fills: the drag-mode picker in
 * the `extras` slot, host-only — because the choice is a **host setting, not a
 * game mode** (spec §6) — and the accessibility note, because this is the one game
 * in the catalogue that ships with no fallback and says so on the box (spec §12).
 */

/**
 * Everything about *which* room is the shared gate's job: the chooser when there is no code
 * in the hash, "this room doesn't exist" when the hash is damaged, and this screen once
 * there is a room to be in (lobby/RoomGate.tsx). Five copies of that logic used to live in
 * five files, identical down to the comment.
 */
export function ChaseRoom(props: { game: GameCard }): JSX.Element {
  return <RoomGate game={props.game}>{(code) => <ChaseRoomInner game={props.game} code={code} />}</RoomGate>;
}

function ChaseRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const [, redraw] = useState(0);
  const [drag, setDrag] = useState<'direct' | 'capped'>('direct');

  const gameRef = useRef<CatMouseGame | null>(null);
  if (!gameRef.current) gameRef.current = new CatMouseGame();
  const game = gameRef.current;

  const onGame = useCallback(
    (msg: ServerMessage) => {
      game.apply(msg);
      // Every message **except** `cm-frame`. A frame arrives fifteen times a
      // second and only moves icons the canvas draws itself, so re-rendering for
      // it would put a virtual-DOM diff on the hot path for nothing. The other
      // three change lives, the phase or the result — all of which are chrome.
      if (msg.t !== 'cm-frame') redraw((n) => n + 1);
    },
    [game],
  );

  /*
   * Read once per render rather than per click: it changes only when the admin
   * centre writes it, which cannot happen while this page is open.
   */
  const solo = soloTesting();

  const room = useRoom(code, card.slug, onGame);
  const { joinUrl, copied, showQr, share, toggleQr } = useShareRoom(code, card.title, room.setError);
  const client = room.client;
  const myId = room.me?.id;

  useEffect(() => {
    if (client && myId) game.identify(myId, () => client.now());
  }, [game, client, myId]);

  const state = game.state;

  if (state?.phase === 'running') {
    return (
      <ChaseBoard
        game={game}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        client={client}
        players={room.room?.players ?? []}
      />
    );
  }

  const players = room.room?.players ?? [];

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
      canStart={room.isHost && enoughToStart(room.connected, [CM_MIN_PLAYERS, CM_MAX_PLAYERS], solo)}
      startLabel={state ? 'Play again' : 'Start round'}
      onStart={() => client?.send({ t: 'start', d: { mode: 'chase', drag, solo } })}
      note={note(room.isHost, room.connected, solo)}
      playerTag={(id) => {
        const a = state?.actors.find((q) => q.playerId === id);
        if (!a) return null;
        if (id === state?.catId) return 'was the cat';
        return a.out ? 'out' : `${a.lives} lives`;
      }}
      aside={
        // Spec §12: the one game that names who it excludes rather than shipping a
        // fallback it does not believe in. It belongs here, before anyone joins,
        // not buried in a doc.
        <p class="howto__warn" role="note">
          This one is all dragging, for the whole round — there is no tap-only way to
          play it.
        </p>
      }
      extras={
        room.isHost ? (
          <DragPicker value={drag} onPick={setDrag} />
        ) : (
          <p class="howto__aside">The host picks how dragging works.</p>
        )
      }
      {...(state?.phase === 'done'
        ? { standings: <Standings state={state} players={players} /> }
        : {})}
    />
  );
}

function note(isHost: boolean, connected: number, solo: boolean): string {
  if (!isHost) return 'The host starts the round.';
  if (!solo && connected < CM_MIN_PLAYERS) return 'Waiting for one more…';
  if (connected > CM_MAX_PLAYERS) return `Cat and Mouse is ${CM_MIN_PLAYERS}–${CM_MAX_PLAYERS} players.`;
  return `One cat, ${CM_LIVES} lives each. Survive the clock and the mice win.`;
}

/**
 * The host's drag-mode picker.
 *
 * Two radios rather than a toggle, because these are **two different games**
 * (spec §6) and a toggle implies one is the other with a setting turned on. Each
 * carries its own one-line description for the same reason: a host choosing
 * blind would pick `direct` every time and never find the real chase.
 */
function DragPicker({
  value,
  onPick,
}: {
  value: 'direct' | 'capped';
  onPick: (v: 'direct' | 'capped') => void;
}): JSX.Element {
  const options: { id: 'direct' | 'capped'; label: string; blurb: string }[] = [
    { id: 'direct', label: 'Follow my finger', blurb: 'Fast and frantic. Reaction tag.' },
    { id: 'capped', label: 'Walk where I point', blurb: 'A real chase — the cat gains slowly.' },
  ];
  return (
    <section class="panel">
      <h2 class="panel__heading">Dragging</h2>
      <ul class="dragpick">
        {options.map((o) => (
          <li key={o.id}>
            <label class={`dragpick__opt ${value === o.id ? 'dragpick__opt--on' : ''}`}>
              <input
                type="radio"
                name="cm-drag"
                checked={value === o.id}
                onChange={() => onPick(o.id)}
              />
              <span class="dragpick__label">{o.label}</span>
              <span class="dragpick__blurb">{o.blurb}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Standings({
  state,
  players,
}: {
  state: CatMouseState;
  players: Player[];
}): JSX.Element {
  const mice = state.actors.filter((a) => a.playerId !== state.catId);
  const survived = mice.filter((a) => !a.out);
  const cat = players.find((p) => p.id === state.catId);

  // Most lives left first. The cat sits outside the ranking entirely: it has no
  // lives, and putting it at either end would suggest it placed.
  const ranked = [...mice].sort((a, b) => b.lives - a.lives);

  return (
    <section class="panel standings">
      <h2 class="panel__heading">
        {survived.length > 0 ? 'The mice got away' : `${cat?.name ?? 'The cat'} caught everyone`}
      </h2>
      <ol class="scoreline">
        {ranked.map((a) => {
          const p = players.find((q) => q.id === a.playerId);
          return (
            <li key={a.playerId}>
              <span class="scoreline__name">
                {p?.avatar} {p?.name ?? '—'}
              </span>
              <span class="scoreline__time">{a.out ? 'caught' : a.lives}</span>
              <span class="scoreline__unit">{a.out ? '' : 'left'}</span>
            </li>
          );
        })}
      </ol>
      <p class="howto__aside">
        {cat?.avatar} {cat?.name ?? 'The cat'} was the cat. Next round it is someone else.
      </p>
    </section>
  );
}
