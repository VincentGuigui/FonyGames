import type { JSX } from 'preact';
import type { Player, PlayerId } from '../../../../shared/protocol';
import { StatusBar } from '../../core/ui/StatusBar';
import { GameOverScreen } from '../../core/ui/GameOver';
import { Scoreboard } from '../../core/ui/Scoreboard';
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
  accent,
  onAgain,
  canAgain,
  sound,
  onSound,
}: {
  state: RushView;
  players: Player[];
  myId: PlayerId | undefined;
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
  onAgain: () => void;
  /** Host only — everyone else is told who to wait for. */
  canAgain: boolean;
  /** The tune: on by default, and a race is loud enough that some rooms need it off. */
  sound: boolean;
  onSound: (on: boolean) => void;
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
    /*
     * The result is the shared panel now (core/ui/GameOver.tsx). What used to be here — a
     * trophy, a placing list and a "Race again" button — was the same three facts in
     * Shake Rush's own class names, and every other game had its own copy of it.
     *
     * The lane list is NOT repeated here. It is the game's picture of the race and it
     * belongs to the round; once the race is over, the numbers are the result.
     */
    return (
      <GameOverScreen
        accent={accent}
        title={title}
        concept={concept}
        rules={rules}
        status="Finish"
        menu={<SoundToggle on={sound} onChange={onSound} />}
        rows={ids.map((id) => {
          const at = state.at[id] ?? 0;
          const short = toGo(at);
          return {
            id,
            avatar: byId.get(id)?.avatar ?? '🙂',
            name: byId.get(id)?.name ?? 'Someone',
            // "home" rather than "0 short": nought to go is the whole point of the race,
            // and a zero in a column of numbers does not read as having won.
            value: short === 0 ? 'home' : short,
            unit: 'short',
            ...(state.away.includes(id) ? { out: true } : {}),
          };
        })}
        me={myId}
        winner={ids[0] ?? null}
        onAgain={onAgain}
        againLabel="Race again"
        canAct={canAgain}
      />
    );
  }

  return (
    <div class="rush" style={{ '--game-accent': accent } as JSX.CSSProperties}>
      <StatusBar
        score={{ value: left, label: 'to go' }}
        status={state.finished.length > 0 ? 'Someone is home' : undefined}
        title={title}
        concept={concept}
        rules={rules}
      >
        <SoundToggle on={sound} onChange={onSound} />
      </StatusBar>

      <Scoreboard rows={rushRows(players, state)} me={myId} unit="shakes to go" best="low" />

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

/**
 * The tune's off switch, in the menu.
 *
 * In the menu rather than on the track for the same reason as everything else that is not
 * the race: the screen is being read mid-shake, and a control small enough to sit in a
 * corner is a control that gets hit by accident. Nobody needs it *during* a shake anyway —
 * you decide once, in the room you are in, and it is remembered (`tune.ts`).
 *
 * A button with `aria-pressed`, not a checkbox: it acts immediately and has no form around
 * it, which is what that role is for.
 */
function SoundToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }): JSX.Element {
  return (
    <>
      <h3 class="gamemenu__label">Sound</h3>
      <button
        class={`btn rush__sound ${on ? 'rush__sound--on' : ''}`}
        type="button"
        aria-pressed={on}
        onClick={() => onChange(!on)}
      >
        <span aria-hidden="true">{on ? '🔊' : '🔇'}</span>
        {on ? 'A note per shake' : 'Silent'}
      </button>
    </>
  );
}

/**
 * How far everyone still has, for the panel.
 *
 * FEWEST to go is the lead, so `best: 'low'` — the runner in front is the one with the
 * smallest number, and `'high'` would put the bold on whoever is last.
 *
 * This says the same thing as the lane list above it, which is a real duplication and a
 * deliberate one: the track is the game's own picture of the race and the panel is the
 * uniform readout every game now has. If one has to go, it is the number on the end of
 * each lane rather than the panel.
 */
function rushRows(players: Player[], state: RushView) {
  return players.map((p) => ({
    id: p.id,
    avatar: p.avatar,
    name: p.name,
    value: toGo(state.at[p.id]) === 0 ? 'home' : toGo(state.at[p.id]),
    ...(state.away.includes(p.id) ? { out: true } : {}),
  }));
}
