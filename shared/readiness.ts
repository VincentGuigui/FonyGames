/**
 * The room-wide ready rule, shared by the lobby and the referee.
 *
 * The host owns the Start button, so their local setup gates that button directly.
 * Every other connected player must explicitly mark themselves ready. Away seats do
 * not strand the room during their reconnect grace period.
 */
export type ReadyPlayer = {
  id: string;
  connected: boolean;
  ready: boolean;
};

export function guestsReady(players: readonly ReadyPlayer[], hostId: string | null): boolean {
  return players.every((player) => !player.connected || player.id === hostId || player.ready);
}
