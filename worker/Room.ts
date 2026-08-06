import { DurableObject } from 'cloudflare:workers';
import {
  CLOCK_SKEW_TOLERANCE_MS,
  DUEL_TIMEOUT_MS,
  FIRE_MAX_MS,
  FIRE_MIN_MS,
  HOST_GRACE_MS,
  MAX_FRAME_BYTES,
  MAX_PLAYERS,
  RATE_LIMIT_MSGS,
  RATE_LIMIT_WINDOW_MS,
  MIN_HUMAN_REACTION_MS,
  preroundFor,
  randomTarget,
  RECONNECT_GRACE_MS,
  isClientMessage,
  type ClientMessage,
  type Player,
  type PlayerId,
  type Reaction,
  type RoomSnapshot,
  type ServerMessage,
} from '../shared/protocol';
import { PLAYERS } from '../shared/players';
import {
  onBump as relayBump,
  onFuse as relayFuse,
  onPass as relayPass,
  onPlayerGone as relayPlayerGone,
  startRelay,
  type Ctx as RelayCtx,
  type Relay,
} from './bumpRelay';
import {
  nextDeadline as spillDeadline,
  onCatch as spillCatch,
  onFling as spillFling,
  onPlayerGone as spillPlayerGone,
  startSpill,
  tick as spillTick,
  toState,
  type Ctx as SpillCtx,
  type Spill,
} from './spill';
import {
  nextDeadline as siegeDeadline,
  onLob as siegeLob,
  onPlayerGone as siegePlayerGone,
  onShoo as siegeShoo,
  startSiege,
  tick as siegeTick,
  toState as siegeToState,
  type Ctx as SiegeCtx,
  type Siege,
} from './goatSiege';
import {
  nextDeadline as slingDeadline,
  onCross as slingCross,
  onPlayerGone as slingPlayerGone,
  startSling,
  tick as slingTick,
  toState as slingToState,
  type Ctx as SlingCtx,
  type Sling,
} from './slingPuck';
import {
  nextDeadline as cmDeadline,
  onMove as cmMove,
  onPlayerGone as cmPlayerGone,
  startCatMouse,
  tick as cmTick,
  toState as cmToState,
  type CatMouse,
  type Ctx as CatMouseCtx,
} from './catMouse';
import {
  randomAvatar,
  randomName,
  sanitiseAvatar,
  sanitiseName,
} from '../shared/names';

/**
 * One Durable Object per room. `idFromName(roomCode)` guarantees every player
 * with the same code reaches this exact instance — that room affinity is the
 * reason we chose Durable Objects (docs/realtime-options.md §3.3).
 *
 * Uses the WebSocket **Hibernation** API: sockets stay open while the object is
 * evicted from memory, so an idle lobby costs no duration billing. That means
 * per-connection state cannot live in a field — it is attached to the socket
 * via serializeAttachment() and survives hibernation.
 */

type Attachment = {
  playerId: PlayerId;
};

/** Per-connection, non-durable. Rebuilt after hibernation; that is fine — it only rate-limits. */
type Bucket = { count: number; windowStart: number };

/** A Tap Duel in progress. Persisted, so it survives hibernation. */
type Duel = {
  roundId: number;
  /** Server time at which every screen flips to TAP. */
  fireAt: number;
  phase: 'armed' | 'done';
  taps: Record<PlayerId, { ms: number | null; falseStart: boolean }>;
  /** Players present when the duel started; late joiners spectate. */
  entrants: PlayerId[];
};

export class Room extends DurableObject {
  /** seq for server->client ordering; clients drop out-of-order state. */
  #seq = 0;
  #buckets = new WeakMap<WebSocket, Bucket>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    /**
     * `CODE → slug` for the hub's join field (docs/specs/hub.md §4).
     *
     * Reads and **writes nothing**: a lookup must not bring a room into being,
     * or every mistyped code would leave an empty object behind. An unknown code
     * is a room nobody has joined, which is a 404 either way.
     */
    if (url.pathname === '/room/game') {
      const game = (await this.ctx.storage.get<string>('game')) ?? null;
      if (!game) return new Response('No such room', { status: 404 });
      return Response.json({ game });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const code = url.searchParams.get('code') ?? '';
    const game = url.searchParams.get('game');

    /*
     * The flag gate's second half. `index.ts` decides whether the game is `active` and
     * forwards the verdict as `open`; the **in-flight rule is decided here**, because
     * only this object knows whether anyone is still in the room.
     *
     * Disabling a game blocks *new* rooms and never interrupts a round
     * (docs/specs/backoffice.md §2b). So a closed game is refused only when nobody is
     * connected — a duel already running keeps accepting the player who just dropped
     * their wifi, which is the difference between "no new rooms" and "kick everyone out".
     *
     * `getWebSockets()` rather than the stored player list: a stored player inside the
     * reconnect grace is not evidence that the round is live, and using it would keep a
     * disabled game openable for RECONNECT_GRACE_MS after the last person really left.
     */
    if (url.searchParams.get('open') === '0' && this.ctx.getWebSockets().length === 0) {
      return new Response('Game unavailable', { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // acceptWebSocket (not server.accept) is what enables hibernation.
    this.ctx.acceptWebSocket(server);
    await this.ctx.storage.put('code', code);

    // The **first** connection decides which game the room is, and later ones
    // cannot change it. Otherwise someone opening another game's page on an
    // existing code would repoint the room and send the hub to the wrong place.
    if (game && !(await this.ctx.storage.get<string>('game'))) {
      await this.ctx.storage.put('game', game);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return; // protocol is JSON text only
    if (raw.length > MAX_FRAME_BYTES) return;
    if (!this.#allow(ws)) {
      this.#send(ws, {
        t: 'error',
        d: { code: 'rate-limited', message: 'Slow down.' },
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isClientMessage(parsed)) return;
    const msg = parsed as ClientMessage;

    switch (msg.t) {
      case 'join':
        await this.#onJoin(ws, msg.d);
        return;
      case 'set-profile':
        await this.#onSetProfile(ws, msg.d);
        return;
      case 'ping':
        this.#send(ws, {
          t: 'pong',
          d: { at: msg.d.at, serverTime: Date.now() },
        });
        return;
      case 'start':
        await this.#onStart(ws, msg.d.mode, msg.d.drag);
        return;
      case 'tap':
        await this.#onTap(ws, msg.d);
        return;
      case 'bump': {
        const id = this.#idOf(ws);
        if (id) await relayBump(this.#relayCtx(), id, msg.d.roundId, msg.d.at);
        return;
      }
      case 'pass': {
        const id = this.#idOf(ws);
        if (id) await relayPass(this.#relayCtx(), id, msg.d.roundId, msg.d.to);
        return;
      }
      case 'fling': {
        const id = this.#idOf(ws);
        if (id) {
          await spillFling(
            this.#spillCtx(),
            id,
            msg.d.roundId,
            msg.d.angle,
            msg.d.speed,
            msg.d.dropId,
          );
        }
        return;
      }
      case 'catch': {
        const id = this.#idOf(ws);
        if (id) await spillCatch(this.#spillCtx(), id, msg.d.roundId, msg.d.dropId);
        return;
      }
      case 'lob': {
        const id = this.#idOf(ws);
        if (id) await siegeLob(this.#siegeCtx(), id, msg.d.roundId, msg.d.to);
        return;
      }
      case 'shoo': {
        const id = this.#idOf(ws);
        if (id) await siegeShoo(this.#siegeCtx(), id, msg.d.roundId, msg.d.goatId);
        return;
      }
      case 'cross': {
        const id = this.#idOf(ws);
        if (id) {
          await slingCross(this.#slingCtx(), id, msg.d.roundId, {
            x: msg.d.x,
            vx: msg.d.vx,
            vy: msg.d.vy,
          });
        }
        return;
      }
      case 'move': {
        const id = this.#idOf(ws);
        if (id) {
          await cmMove(this.#cmCtx(), id, msg.d.roundId, { x: msg.d.x, y: msg.d.y });
        }
        return;
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.#onGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.#onGone(ws);
  }

  /**
   * There is exactly **one** alarm slot, and every game wants it: a live duel's
   * timeout, a relay fuse, a spill drop landing, a goat arriving, a Sling Puck
   * round cap — plus seat/host housekeeping underneath all of them.
   *
   * So the handler never assumes it was woken for its own reason. It runs every
   * deadline that is actually due, then re-arms from scratch via #rearm().
   * Anything else lets one subsystem silently cancel another's alarm.
   */
  async alarm(): Promise<void> {
    const duel = await this.#duel();
    if (duel && duel.phase === 'armed' && Date.now() >= duel.fireAt + DUEL_TIMEOUT_MS) {
      // Nobody tapped in time. #resolveDuel re-arms on its way out.
      await this.#resolveDuel();
      return;
    }

    const relay = await this.#relay();
    if (relay && relay.phase === 'running' && Date.now() >= Math.min(relay.fuseAt, relay.endsAt)) {
      await relayFuse(this.#relayCtx());
      await this.#rearm();
      return;
    }

    const spill = await this.#spill();
    if (spill && spill.phase === 'running' && Date.now() >= spillDeadline(spill)) {
      await spillTick(this.#spillCtx());
      await this.#rearm();
      return;
    }

    const siege = await this.#siege();
    if (siege && siege.phase === 'running' && Date.now() >= siegeDeadline(siege)) {
      await siegeTick(this.#siegeCtx());
      await this.#rearm();
      return;
    }

    const sling = await this.#sling();
    if (sling && sling.phase === 'running' && Date.now() >= slingDeadline(sling)) {
      await slingTick(this.#slingCtx());
      await this.#rearm();
      return;
    }

    const chase = await this.#catMouse();
    if (chase && chase.phase === 'running' && Date.now() >= cmDeadline(chase)) {
      await cmTick(this.#cmCtx());
      await this.#rearm();
      return;
    }

    const players = await this.#players();
    const now = Date.now();
    let changed = false;

    for (const [id, p] of players) {
      if (!p.connected && now - (p.goneAt ?? 0) >= RECONNECT_GRACE_MS) {
        players.delete(id);
        changed = true;
        // Only *now* is a Spill player genuinely gone. Doing this when the
        // socket closed would knock anyone who refreshed out of the round,
        // which is precisely what the reconnect grace exists to prevent
        // (docs/specs/games/spill.md §8).
        await spillPlayerGone(this.#spillCtx(), id);
        await siegePlayerGone(this.#siegeCtx(), id);
        await slingPlayerGone(this.#slingCtx(), id);
        await cmPlayerGone(this.#cmCtx(), id);
      }
    }
    if (changed) await this.#savePlayers(players);

    // Host promotion is deliberately deferred to here rather than done on
    // disconnect, so a refreshing host keeps the role (see #ensureHost).
    const hostBefore = (await this.ctx.storage.get<PlayerId>('hostId')) ?? null;
    await this.#ensureHost(players);
    const hostAfter = (await this.ctx.storage.get<PlayerId>('hostId')) ?? null;

    if (changed || hostBefore !== hostAfter) {
      await this.#broadcastPresence();
    }

    // A room's state dies with the room (docs/architecture.md §1). Once nobody
    // is left and no socket is still attached, drop everything rather than
    // leave an abandoned room paying rent in storage forever.
    if (players.size === 0 && this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      return;
    }

    await this.#rearm(players);
  }

  /* ----------------------- Tap Duel: pistol ------------------------ */
  /* Spec: docs/specs/games/tap-duel.md                                 */

  /**
   * Host begins a round. `mode` selects the game.
   *
   * `drag` is Cat and Mouse's only host setting and is orthogonal to `mode`
   * (cat-and-mouse.md §6); every other game ignores it.
   */
  async #onStart(
    ws: WebSocket,
    mode: string,
    drag?: 'direct' | 'capped',
  ): Promise<void> {
    const id = this.#idOf(ws);
    const hostId = (await this.ctx.storage.get<PlayerId>('hostId')) ?? null;
    if (!id || id !== hostId) return; // only the host starts rounds

    const duel = await this.#duel();
    if (duel && duel.phase !== 'done') return; // one round at a time
    const relay = await this.#relay();
    if (relay && relay.phase !== 'done') return;
    const running = await this.#spill();
    if (running && running.phase !== 'done') return;
    const besieged = await this.#siege();
    if (besieged && besieged.phase !== 'done') return;
    const slinging = await this.#sling();
    if (slinging && slinging.phase !== 'done') return;
    const chasing = await this.#catMouse();
    if (chasing && chasing.phase !== 'done') return;

    const players = await this.#players();
    const ready = [...players.values()].filter((p) => p.connected);

    if (
      mode === 'relay' ||
      mode === 'spill' ||
      mode === 'siege' ||
      mode === 'sling' ||
      mode === 'chase'
    ) {
      const roundId = ((await this.ctx.storage.get<number>('roundId')) ?? 0) + 1;
      await this.ctx.storage.put('roundId', roundId);
      const ids = ready.map((p) => p.id);
      if (mode === 'relay') await startRelay(this.#relayCtx(), roundId, ids);
      else if (mode === 'spill') await startSpill(this.#spillCtx(), roundId, ids);
      else if (mode === 'siege') await startSiege(this.#siegeCtx(), roundId, ids);
      else if (mode === 'sling') await startSling(this.#slingCtx(), roundId, ids);
      // `direct` is the default because it needs no explanation: grab your icon
      // and it follows your finger. `capped` is the deliberate choice.
      else await startCatMouse(this.#cmCtx(), roundId, ids, drag === 'capped' ? 'capped' : 'direct');
      await this.#rearm(players);
      return;
    }

    // Tap Duel's own limits, from shared/players.ts, so the card's promise and the
    // referee cannot disagree. The maximum was missing entirely: a ninth player made
    // the card a lie rather than being turned away.
    //
    // Enforced at round start, NOT at the join gate. Extra players stay in the room
    // and spectate, which is a designed behaviour — Sling Puck is exactly two and
    // shows a third player the board with `spectating` set.
    const [duelMin, duelMax] = PLAYERS['tap-duel'];
    if (ready.length < duelMin || ready.length > duelMax) return;

    const roundId = ((await this.ctx.storage.get<number>('roundId')) ?? 0) + 1;
    const spread = FIRE_MAX_MS - FIRE_MIN_MS;
    // Redrawn every duel so the delay cannot be learned (spec §2), and pushed
    // past the rules panel so the signal can never fire behind it — the one
    // game where a covered screen would cost you the round.
    const startsAt = Date.now() + preroundFor(roundId);
    const fireAt = startsAt + FIRE_MIN_MS + Math.floor(Math.random() * spread);
    // Where the target lands. Drawn here so every screen shows it in the same
    // place — a per-client position would decide the round by luck.
    const target = randomTarget();

    await this.ctx.storage.put('roundId', roundId);
    await this.#saveDuel({
      roundId,
      fireAt,
      phase: 'armed',
      taps: {},
      // Only those present when the duel started are in it; late joiners
      // spectate and play the next one.
      entrants: ready.map((p) => p.id),
    });

    this.#broadcast({ t: 'arm', s: ++this.#seq, d: { roundId, fireAt, startsAt, target } });

    // The server owns the timer, not the host — so a host dropping mid-duel
    // cannot stall it. This alarm resolves the duel if nobody taps.
    await this.#rearm(players);
  }

  async #onTap(ws: WebSocket, d: { at: number; roundId: number }): Promise<void> {
    const id = this.#idOf(ws);
    if (!id) return;

    const duel = await this.#duel();
    if (!duel || duel.phase !== 'armed') return;
    if (duel.roundId !== d.roundId) return; // stale tap from a previous duel
    if (!duel.entrants.includes(id)) return; // joined after the duel began
    if (duel.taps[id]) return; // one tap per player, per duel

    const now = Date.now();
    const at = typeof d.at === 'number' && Number.isFinite(d.at) ? d.at : now;

    // Reject a timestamp from the future: a client clock running fast, or a
    // forged tap (spec §8).
    const claimed = Math.min(at, now + CLOCK_SKEW_TOLERANCE_MS);
    const reaction = claimed - duel.fireAt;

    // Early, or superhumanly fast, is a false start either way. The floor is
    // what makes knowing `fireAt` in advance useless to a cheat.
    const falseStart = reaction < MIN_HUMAN_REACTION_MS;

    duel.taps[id] = { ms: falseStart ? null : reaction, falseStart };
    await this.#saveDuel(duel);

    if (falseStart) {
      // Told only to the offender: nobody else's duel is disturbed.
      this.#send(ws, { t: 'false-start', d: { roundId: duel.roundId } });
    }

    // Resolve as soon as every entrant has committed; otherwise the deadline
    // alarm will finish it.
    const stillOut = duel.entrants.filter((p) => !duel.taps[p]);
    if (stillOut.length === 0) await this.#resolveDuel();
  }

  async #resolveDuel(): Promise<void> {
    const duel = await this.#duel();
    if (!duel || duel.phase !== 'armed') return;

    const players = await this.#players();
    const scores = (await this.ctx.storage.get<Record<PlayerId, number>>('scores')) ?? {};

    const ranking: Reaction[] = duel.entrants.map((playerId) => {
      const tap = duel.taps[playerId];
      return {
        playerId,
        ms: tap?.ms ?? null,
        falseStart: tap?.falseStart ?? false,
      };
    });

    // Fastest valid first; everyone without a valid time sinks to the bottom.
    ranking.sort((a, b) => {
      if (a.ms === null && b.ms === null) return 0;
      if (a.ms === null) return 1;
      if (b.ms === null) return -1;
      return a.ms - b.ms;
    });

    const winner = ranking.find((r) => r.ms !== null) ?? null;
    const winnerId = winner?.playerId ?? null;
    if (winnerId) scores[winnerId] = (scores[winnerId] ?? 0) + 1;

    await this.ctx.storage.put('scores', scores);
    await this.#saveDuel({ ...duel, phase: 'done' });

    this.#broadcast({
      t: 'result',
      s: ++this.#seq,
      d: {
        roundId: duel.roundId,
        ranking: ranking.filter((r) => players.has(r.playerId)),
        winnerId,
        scores,
        noContest: winnerId === null,
      },
    });

    // Hand the alarm back to seat/host housekeeping.
    await this.#rearm(players);
  }

  async #relay(): Promise<Relay | null> {
    return (await this.ctx.storage.get<Relay>('relay')) ?? null;
  }

  /**
   * Everything bumpRelay.ts needs, without giving it socket access.
   *
   * `setAlarm` ignores the requested time on purpose: the module has already
   * saved the state that implies its deadline, so #rearm recomputes the correct
   * one across *all* subsystems. A module cannot know what else wants the slot.
   */
  #relayCtx(): RelayCtx {
    return {
      now: () => Date.now(),
      nextSeq: () => ++this.#seq,
      broadcast: (msg) => this.#broadcast(msg),
      sendTo: (playerId, msg) => {
        for (const ws of this.ctx.getWebSockets()) {
          if (this.#idOf(ws) === playerId) this.#send(ws, msg);
        }
      },
      load: () => this.#relay(),
      save: (relay) => this.ctx.storage.put('relay', relay),
      setAlarm: () => this.#rearm(),
    };
  }

  async #spill(): Promise<Spill | null> {
    return (await this.ctx.storage.get<Spill>('spill')) ?? null;
  }

  #spillCtx(): SpillCtx {
    return {
      now: () => Date.now(),
      nextSeq: () => ++this.#seq,
      broadcast: (msg) => this.#broadcast(msg),
      load: () => this.#spill(),
      save: (spill) => this.ctx.storage.put('spill', spill),
      setAlarm: () => this.#rearm(),
    };
  }

  async #siege(): Promise<Siege | null> {
    return (await this.ctx.storage.get<Siege>('siege')) ?? null;
  }

  #siegeCtx(): SiegeCtx {
    return {
      now: () => Date.now(),
      nextSeq: () => ++this.#seq,
      broadcast: (msg) => this.#broadcast(msg),
      load: () => this.#siege(),
      save: (siege) => this.ctx.storage.put('siege', siege),
      setAlarm: () => this.#rearm(),
    };
  }

  async #sling(): Promise<Sling | null> {
    return (await this.ctx.storage.get<Sling>('sling')) ?? null;
  }

  async #catMouse(): Promise<CatMouse | null> {
    return (await this.ctx.storage.get<CatMouse>('catMouse')) ?? null;
  }

  #cmCtx(): CatMouseCtx {
    return {
      now: () => Date.now(),
      nextSeq: () => ++this.#seq,
      broadcast: (msg) => this.#broadcast(msg),
      load: () => this.#catMouse(),
      save: (state) => this.ctx.storage.put('catMouse', state),
      setAlarm: () => this.#rearm(),
    };
  }

  #slingCtx(): SlingCtx {
    return {
      now: () => Date.now(),
      nextSeq: () => ++this.#seq,
      broadcast: (msg) => this.#broadcast(msg),
      load: () => this.#sling(),
      save: (sling) => this.ctx.storage.put('sling', sling),
      setAlarm: () => this.#rearm(),
    };
  }

  async #duel(): Promise<Duel | null> {
    return (await this.ctx.storage.get<Duel>('duel')) ?? null;
  }

  async #saveDuel(duel: Duel): Promise<void> {
    await this.ctx.storage.put('duel', duel);
  }

  #broadcast(msg: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) this.#send(ws, msg);
  }

  /* ---------------------------------------------------------------- */

  async #onJoin(
    ws: WebSocket,
    d: { name?: string; avatar?: string; resume?: PlayerId },
  ): Promise<void> {
    const players = await this.#players();

    // Reclaiming a seat after a drop keeps the player's identity and, if they
    // were host, their host role.
    const resuming = d.resume ? players.get(d.resume) : undefined;

    let id: PlayerId;
    if (resuming) {
      id = resuming.id;
      resuming.connected = true;
      delete resuming.goneAt;
      if (d.name) resuming.name = sanitiseName(d.name) ?? resuming.name;
      if (d.avatar) resuming.avatar = sanitiseAvatar(d.avatar) ?? resuming.avatar;

      // A seat holds exactly one live connection. Duplicating a browser tab
      // copies sessionStorage, so two tabs can legitimately try to resume the
      // same seat — without this, both stay attached and whichever closes
      // first marks the player away while the other is still playing.
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws && this.#idOf(other) === id) {
          other.close(1000, 'seat-taken-elsewhere');
        }
      }
    } else {
      const active = [...players.values()].filter((p) => p.connected).length;
      if (active >= MAX_PLAYERS) {
        this.#send(ws, {
          t: 'error',
          d: { code: 'room-full', message: 'This room is full.' },
        });
        ws.close(1008, 'room-full');
        return;
      }
      id = crypto.randomUUID();
      players.set(id, {
        id,
        name: sanitiseName(d.name) ?? randomName(),
        avatar: sanitiseAvatar(d.avatar) ?? randomAvatar(),
        connected: true,
      });
    }

    ws.serializeAttachment({ playerId: id } satisfies Attachment);
    await this.#savePlayers(players);
    await this.#ensureHost(players);

    const room = await this.#snapshot(players);
    this.#send(ws, {
      t: 'welcome',
      s: ++this.#seq,
      d: { you: id, serverTime: Date.now(), room },
    });

    // Someone joining — or refreshing — into a live round needs the board, not
    // just the player list. Everything in flight is described by arrivesAt, so
    // one snapshot is enough to resume the animation exactly where it is.
    const spill = await this.#spill();
    if (spill && spill.phase === 'running') {
      this.#send(ws, { t: 'spill', s: ++this.#seq, d: toState(spill) });
    }
    const siege = await this.#siege();
    if (siege && siege.phase === 'running') {
      this.#send(ws, { t: 'siege', s: ++this.#seq, d: siegeToState(siege) });
    }
    // Sling Puck resyncs the **count** and nothing else: the pucks were never
    // the server's to remember, so a refresher gets their own five back at rest
    // and loses only the motion nobody else could see (spec §9).
    const sling = await this.#sling();
    if (sling && sling.phase === 'running') {
      this.#send(ws, { t: 'sling', s: ++this.#seq, d: slingToState(sling) });
    }
    // Cat and Mouse resyncs the full state, then the next tick puts everyone
    // where they are — a refresher comes back at their last reported position,
    // which is what spec §8 promises.
    const chase = await this.#catMouse();
    if (chase && chase.phase === 'running') {
      this.#send(ws, { t: 'cm', s: ++this.#seq, d: cmToState(chase) });
    }

    await this.#broadcastPresence(ws);
  }

  async #onSetProfile(
    ws: WebSocket,
    d: { name?: string; avatar?: string },
  ): Promise<void> {
    const id = this.#idOf(ws);
    if (!id) return;
    const players = await this.#players();
    const me = players.get(id);
    if (!me) return;

    const name = sanitiseName(d.name);
    const avatar = sanitiseAvatar(d.avatar);
    if (!name && !avatar) return;
    if (name) me.name = name;
    if (avatar) me.avatar = avatar;

    await this.#savePlayers(players);
    await this.#broadcastPresence();
  }

  async #onGone(ws: WebSocket): Promise<void> {
    const id = this.#idOf(ws);
    if (!id) return;
    const players = await this.#players();
    const me = players.get(id);
    if (!me) return;

    // Another live socket may already hold this seat — either a refresh that
    // resumed before the old socket finished closing, or the duplicate-tab
    // eviction in #onJoin. Marking the player away here would undo a resume
    // that has already succeeded.
    const heldElsewhere = this.ctx
      .getWebSockets()
      .some((other) => other !== ws && this.#idOf(other) === id);
    if (heldElsewhere) return;

    // Not removed immediately: a phone that locked or switched network gets
    // RECONNECT_GRACE_MS to reclaim the same seat (docs/multiplayer.md §5).
    me.connected = false;
    me.goneAt = Date.now();

    await this.#savePlayers(players);
    // Relay must react immediately — the bomb cannot sit on an empty seat. A
    // Spill player, by contrast, is only out once their seat is reaped, so a
    // refresh keeps their water (see the reaping loop in alarm()).
    await relayPlayerGone(this.#relayCtx(), id);
    // No #ensureHost here: promoting the moment a socket drops is exactly
    // what stole the host role from anyone who refreshed. The alarm handles
    // it once HOST_GRACE_MS has passed.
    await this.#broadcastPresence();
    await this.#rearm(players);
  }

  /**
   * The host is a UI role only — the server owns round state — but it must
   * point at someone present, so a host leaving never stalls the room.
   *
   * Crucially it does **not** demote a host who has only just dropped: a page
   * refresh looks exactly like a disconnect, and promoting instantly would
   * hand the role to someone else every time the host reloaded. Within
   * HOST_GRACE_MS the role is held for them; the alarm promotes once that
   * expires.
   */
  async #ensureHost(players: Map<PlayerId, StoredPlayer>): Promise<void> {
    const current = (await this.ctx.storage.get<PlayerId>('hostId')) ?? null;
    const host = current ? players.get(current) : undefined;

    if (host?.connected) return;
    if (host && Date.now() - (host.goneAt ?? 0) < HOST_GRACE_MS) return;

    const next = [...players.values()].find((p) => p.connected)?.id ?? null;
    if (next === current) return;
    if (next) await this.ctx.storage.put('hostId', next);
    else await this.ctx.storage.delete('hostId');
  }

  /**
   * Next housekeeping moment: the earliest of any dropped player's seat
   * expiry and, if the host is among them, their (much shorter) host-role
   * expiry. Miss the host deadline and a genuinely departed host would hold
   * the role for the full minute. Infinity when everybody is present.
   */
  async #housekeepingDue(players?: Map<PlayerId, StoredPlayer>): Promise<number> {
    const map = players ?? (await this.#players());
    const hostId = (await this.ctx.storage.get<PlayerId>('hostId')) ?? null;
    let at = Infinity;

    for (const p of map.values()) {
      if (p.connected) continue;
      const goneAt = p.goneAt ?? 0;
      at = Math.min(at, goneAt + RECONNECT_GRACE_MS);
      if (p.id === hostId) at = Math.min(at, goneAt + HOST_GRACE_MS);
    }
    return at;
  }

  /** Earliest deadline any live game still owes an answer for. */
  async #gameDue(): Promise<number> {
    const duel = await this.#duel();
    if (duel?.phase === 'armed') return duel.fireAt + DUEL_TIMEOUT_MS;

    const relay = await this.#relay();
    if (relay?.phase === 'running') return Math.min(relay.fuseAt, relay.endsAt);

    const spill = await this.#spill();
    if (spill?.phase === 'running') return spillDeadline(spill);

    const siege = await this.#siege();
    if (siege?.phase === 'running') return siegeDeadline(siege);

    const sling = await this.#sling();
    if (sling?.phase === 'running') return slingDeadline(sling);

    const chase = await this.#catMouse();
    if (chase?.phase === 'running') return cmDeadline(chase);

    return Infinity;
  }

  /**
   * Point the one alarm slot at whichever deadline comes first. Every path that
   * changes a deadline ends here rather than calling setAlarm itself, which is
   * what keeps a landing drop from cancelling a seat reap and vice versa.
   */
  async #rearm(players?: Map<PlayerId, StoredPlayer>): Promise<void> {
    const at = Math.min(await this.#housekeepingDue(players), await this.#gameDue());
    if (!Number.isFinite(at)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(at);
  }

  async #broadcastPresence(except?: WebSocket): Promise<void> {
    const room = await this.#snapshot();
    const msg: ServerMessage = { t: 'presence', s: ++this.#seq, d: room };
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) this.#send(ws, msg);
    }
  }

  async #snapshot(
    players?: Map<PlayerId, StoredPlayer>,
  ): Promise<RoomSnapshot> {
    const map = players ?? (await this.#players());
    const code = (await this.ctx.storage.get<string>('code')) ?? '';
    const hostId = (await this.ctx.storage.get<PlayerId>('hostId')) ?? null;
    const list: Player[] = [...map.values()].map(({ id, name, avatar, connected }) => ({
      id,
      name,
      avatar,
      connected,
    }));
    return { code, players: list, hostId };
  }

  #idOf(ws: WebSocket): PlayerId | null {
    const a = ws.deserializeAttachment() as Attachment | null;
    return a?.playerId ?? null;
  }

  #send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already gone; webSocketClose will clean up.
    }
  }

  #allow(ws: WebSocket): boolean {
    const now = Date.now();
    const b = this.#buckets.get(ws);
    if (!b || now - b.windowStart >= RATE_LIMIT_WINDOW_MS) {
      this.#buckets.set(ws, { count: 1, windowStart: now });
      return true;
    }
    b.count += 1;
    return b.count <= RATE_LIMIT_MSGS;
  }

  async #players(): Promise<Map<PlayerId, StoredPlayer>> {
    const raw = (await this.ctx.storage.get<StoredPlayer[]>('players')) ?? [];
    return new Map(raw.map((p) => [p.id, p]));
  }

  async #savePlayers(players: Map<PlayerId, StoredPlayer>): Promise<void> {
    await this.ctx.storage.put('players', [...players.values()]);
  }
}

/** Player plus the drop timestamp, which never goes on the wire. */
type StoredPlayer = Player & { goneAt?: number };
