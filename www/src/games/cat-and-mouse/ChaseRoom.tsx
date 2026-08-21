import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { GameCard } from '../../core/types';
import {
  CM_LIVES,
  CM_MAX_PLAYERS,
  CM_MIN_PLAYERS,
  type ServerMessage,
} from '../../../../shared/protocol';
import { enoughToStart } from '../../../../shared/players';
import { soloTesting } from '../../core/solo';
import { useGameRoom } from '../../core/room/useRoom';
import { RoomGate } from '../../lobby/RoomGate';
import { GameLobby } from '../../lobby/GameLobby';
import { ChaseBoard } from './ChaseBoard';
import { GameOverScreen } from '../../core/ui/GameOver';
import { useT } from '../../core/i18n/strings';
import { useGameText, type GameText } from '../../core/i18n/gameText';
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
  return <RoomGate game={props.game}>{(code, card) => <ChaseRoomInner game={card} code={code} />}</RoomGate>;
}

function ChaseRoomInner({ game: card, code }: { game: GameCard; code: string }): JSX.Element {
  const t = useT();
  const text = useGameText();
  const [, redraw] = useState(0);
  /*
   * `capped` by default — the walk-where-I-point chase.
   *
   * `direct` was the default because it is the simpler one to explain, which is exactly
   * the wrong reason: it makes the icon follow the finger with no speed at all, so the
   * round is reaction-tag and the cat wins by scribbling. `capped` is the game the spec
   * describes (§6, "a real chase"), and a host picking blind should land in it rather
   * than have to find it.
   */
  const [drag, setDrag] = useState<'direct' | 'capped'>('capped');

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

  const { room, joinUrl, copied, showQr, share, toggleQr } = useGameRoom(code, card, onGame);
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
        accent={card.accent}
        client={client}
        players={room.room?.players ?? []}
      />
    );
  }

  const players = room.room?.players ?? [];

  /*
   * The result, on the shared end screen (core/ui/GameOver.tsx).
   *
   * The one game whose winner is a SIDE. The cat is listed with the mice — it has no
   * lives and cannot place, but leaving it out of the result of the round it just played
   * reads as a missing row — and the headline says which side took it.
   */
  if (state?.phase === 'done') {
    const byId = new Map(players.map((p) => [p.id, p]));
    const mice = state.actors.filter((a) => a.playerId !== state.catId);
    const survivors = mice.filter((a) => !a.out);
    // Most lives left first, then the cat, which is outside the ranking.
    const ranked = [...mice].sort((a, b) => b.lives - a.lives);
    const cat = byId.get(state.catId);
    const catWon = game.result?.catWins ?? survivors.length === 0;
    // A mouse win is a team win, so the crest goes to whoever survived with the most
    // lives — and only when exactly one did, the same rule the score panel uses.
    const bestMouse = ranked.filter((a) => !a.out && a.lives === (ranked[0]?.lives ?? 0));
    const winner = catWon ? state.catId : (bestMouse.length === 1 ? (bestMouse[0]?.playerId ?? null) : null);

    return (
      <GameOverScreen
        room={room}
        slug={card.slug}
        accent={card.accent}
        title={card.title}
        concept={card.concept}
        rules={card.rules}
        rows={[
          ...ranked.map((a) => ({
            id: a.playerId,
            avatar: byId.get(a.playerId)?.avatar ?? '🐭',
            name: byId.get(a.playerId)?.name ?? text({ en: 'Someone', fr: 'Quelqu’un' }),
            value: a.out ? text({ en: 'caught', fr: 'attrapé' }) : a.lives,
            unit: t.common.lives,
            ...(a.out ? { out: true } : {}),
          })),
          {
            id: state.catId,
            avatar: cat?.avatar ?? '🐱',
            name: cat?.name ?? text({ en: 'The cat', fr: 'Le chat' }),
            value: text({ en: 'cat', fr: 'chat' }),
          },
        ]}
        me={myId}
        winner={winner}
        headline={catWon ? text({ en: `${cat?.name ?? text({ en: 'The cat', fr: 'Le chat' })} caught everyone`, fr: `${cat?.name ?? text({ en: 'The cat', fr: 'Le chat' })} a attrapé tout le monde` })
          : text({ en: 'The mice got away', fr: 'Les souris se sont échappées' })}
        note={
          game.result
            ? text({ en: `The mice lasted ${(game.result.lastedMs / 1000).toFixed(0)}s. Next round the cat is someone else.`, fr: `Les souris ont tenu ${(game.result.lastedMs / 1000).toFixed(0)} s. Le chat changera à la prochaine manche.` })
            : text({ en: 'Next round the cat is someone else.', fr: 'Le chat changera à la prochaine manche.' })
        }
        onAgain={() => client?.send({ t: 'start', d: { mode: 'chase', solo } })}
        canAct={room.isHost && enoughToStart(room.connected, [CM_MIN_PLAYERS, CM_MAX_PLAYERS], solo)}
      />
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
      canStart={room.isHost && enoughToStart(room.connected, [CM_MIN_PLAYERS, CM_MAX_PLAYERS], solo)}
      startLabel={state ? t.common.playAgain : t.common.startRound}
      onStart={() => client?.send({ t: 'start', d: { mode: 'chase', drag, solo } })}
      note={note(room.isHost, room.connected, solo, text)}
      playerTag={(id) => {
        const a = state?.actors.find((q) => q.playerId === id);
        if (!a) return null;
        if (id === state?.catId) return text({ en: 'was the cat', fr: 'était le chat' });
        return a.out ? text({ en: 'out', fr: 'éliminé' }) : text({ en: `${a.lives} lives`, fr: `${a.lives} vies` });
      }}
      aside={
        // Spec §12: the one game that names who it excludes rather than shipping a
        // fallback it does not believe in. It belongs here, before anyone joins,
        // not buried in a doc.
        <p class="howto__warn" role="note">
          {text({ en: 'This one is all dragging, for the whole round — there is no tap-only way to play it.', fr: 'Toute la manche se joue en faisant glisser — il n’existe pas de version uniquement tactile.' })}
        </p>
      }
      extras={
        room.isHost ? (
          <DragPicker value={drag} onPick={setDrag} />
        ) : (
          <p class="howto__aside">{text({ en: 'The host picks the game mode.', fr: "L’hôte choisit le mode de jeu." })}</p>
        )
      }
    />
  );
}

function note(isHost: boolean, connected: number, solo: boolean, text: GameText): string {
  if (!isHost) return text({ en: 'The host starts the round.', fr: "L’hôte démarre la manche." });
  if (!solo && connected < CM_MIN_PLAYERS) return text({ en: 'Waiting for one more…', fr: 'En attente d’un joueur…' });
  if (connected > CM_MAX_PLAYERS) return text({ en: `Cat and Mouse is ${CM_MIN_PLAYERS}–${CM_MAX_PLAYERS} players.`, fr: `Cat and Mouse se joue de ${CM_MIN_PLAYERS} à ${CM_MAX_PLAYERS} joueurs.` });
  return text({ en: `One cat, ${CM_LIVES} lives each. Survive the clock and the mice win.`, fr: `Un chat, ${CM_LIVES} vies chacun. Si elles tiennent jusqu’au bout, les souris gagnent.` });
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
  const text = useGameText();
  // The default leads, because a list is read top down and the first entry is what a host
  // in a hurry picks. That used to be `direct`, which is the lesser of the two games.
  const options: { id: 'direct' | 'capped'; label: string; blurb: string }[] = [
    { id: 'capped', label: text({ en: 'Walk where I point', fr: 'Marcher vers mon doigt' }),
      blurb: text({ en: 'A real chase — the cat gains slowly.', fr: 'Une vraie poursuite — le chat se rapproche lentement.' }) },
    { id: 'direct', label: text({ en: 'Follow my finger', fr: 'Suivre mon doigt' }),
      blurb: text({ en: 'Fast and frantic. Reaction tag.', fr: 'Rapide et frénétique. Un jeu de réflexes.' }) },
  ];
  return (
    <section class="panel">
      {/* Shared wording with Ghost Hunt's route picker — see the note there. */}
      <h2 class="panel__heading">{text({ en: 'Select a game mode', fr: 'Choisissez un mode de jeu' })}</h2>
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

