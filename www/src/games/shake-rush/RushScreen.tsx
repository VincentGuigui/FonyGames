import type { JSX } from 'preact';
import type { Player, PlayerId } from '../../../../shared/protocol';
import { opponentOf, StatusBar } from '../../core/ui/StatusBar';
import { progress, standings, toGo, type RushView } from './game';

/**
 * The race, on one phone. Spec: docs/specs/games/shake-rush.md §4
 *
 * Everything here has to be readable **while the phone is being shaken
 * violently**, which rules out anything small, thin, or dependent on fine detail.
 * So: big shapes, big type, and one number — the shakes you have left — carrying
 * the state that matters most.
 *
 * Lanes are horizontal and stacked, sorted by who is ahead, with your own lane
 * pulled out so you can find it without reading.
 */
export function RushScreen({
  state,
  players,
  myId,
  title,
  concept,
  rules,
  onAgain,
  canAgain,
}: {
  state: RushView;
  players: Player[];
  myId: PlayerId | undefined;
  title: string;
  concept: string;
  rules: string[];
  onAgain: () => void;
  /** Host only — everyone else is told who to wait for. */
  canAgain: boolean;
}): JSX.Element {
  const byId = new Map(players.map((p) => [p.id, p]));
  const ids = standings(
    state,
    players.map((p) => p.id),
  );
  const over = state.phase === 'over';
  const mine = myId ? state.at[myId] : undefined;
  const left = toGo(mine);
  const iAmHome = myId ? state.finished.includes(myId) || state.order[0] === myId : false;

  if (over) {
    const winner = ids[0];
    return (
      <div class="rush rush--over">
        <StatusBar status="Finish" title={title} concept={concept} rules={rules} />

        <p class="rush__trophy" aria-hidden="true">
          {winner ? (byId.get(winner)?.avatar ?? '🏆') : '🏆'}
        </p>
        <p class="rush__winner">
          {winner === myId ? 'You won' : `${byId.get(winner ?? ('' as PlayerId))?.name ?? 'Someone'} won`}
        </p>

        <ol class="rush__placing">
          {ids.map((id, i) => (
            <li key={id} class={`rush__place ${id === myId ? 'rush__place--me' : ''}`}>
              <span class="rush__place-n">{i + 1}</span>
              <span aria-hidden="true">{byId.get(id)?.avatar ?? '🙂'}</span>
              <span class="rush__place-who">{byId.get(id)?.name ?? 'Someone'}</span>
              <span class="rush__place-at">
                {toGo(state.at[id]) === 0 ? 'home' : `${toGo(state.at[id])} short`}
              </span>
            </li>
          ))}
        </ol>

        {canAgain ? (
          <button class="btn btn--primary btn--big rush__again" type="button" onClick={onAgain}>
            Race again
          </button>
        ) : (
          <p class="rush__note">The host starts the next one.</p>
        )}
      </div>
    );
  }

  return (
    <div class="rush">
      <StatusBar
        score={{ value: left, label: 'to go' }}
        status={state.finished.length > 0 ? 'Someone is home' : undefined}
        opponent={rushOpponent(players, myId, state)}
        title={title}
        concept={concept}
        rules={rules}
      />

      {/*
        The count, not a bar. "37 to go" is a motivator; a bar filling up is
        wallpaper — and at this size it is the one thing legible mid-shake.
        `aria-live` is off: a number changing five times a second would make a
        screen reader unusable, and the lane list below carries the same state.
      */}
      <p class="rush__togo" aria-hidden="true">
        {iAmHome ? '🏁' : left}
      </p>
      <p class="rush__togo-note">{iAmHome ? "You're home — watching" : 'shakes to go'}</p>

      <ul class="rush__track">
        {ids.map((id) => {
          const p = byId.get(id);
          const isMe = id === myId;
          const away = state.away.includes(id);
          const home = state.finished.includes(id);
          return (
            <li key={id} class={`rush__lane ${isMe ? 'rush__lane--me' : ''} ${away ? 'rush__lane--away' : ''}`}>
              <span class="rush__lane-who">
                <span aria-hidden="true">{p?.avatar ?? '🙂'}</span>
                <span class="rush__lane-name">{isMe ? 'You' : (p?.name ?? 'Someone')}</span>
                {away && <span class="rush__lane-away">away</span>}
              </span>
              {/*
                Position AND a number, never position alone: the runner is the
                fast read, the number is the one that still works when two people
                are within a few pixels of each other.
              */}
              <span
                class="rush__lane-rail"
                role="img"
                aria-label={`${isMe ? 'You' : (p?.name ?? 'Someone')}: ${toGo(state.at[id])} shakes to go`}
              >
                <span class="rush__lane-fill" style={{ width: `${progress(state.at[id]) * 100}%` }} />
                <span class="rush__runner" style={{ left: `${progress(state.at[id]) * 100}%` }} aria-hidden="true">
                  {home ? '🏁' : (p?.avatar ?? '🙂')}
                </span>
              </span>
              <span class="rush__lane-n">{toGo(state.at[id])}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** How far the other runner still has, in a two-player race. */
function rushOpponent(players: Player[], me: PlayerId | undefined, state: RushView) {
  const other = opponentOf(players, me);
  if (!other) return null;

  return {
    avatar: other.avatar,
    name: other.name,
    value: toGo(state.at[other.id]) === 0 ? 'home' : toGo(state.at[other.id]),
    dim: state.away.includes(other.id),
  };
}
