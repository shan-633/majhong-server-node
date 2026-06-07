/**
 * A Room hosts one table (one Game) and maps connections to seats. Empty seats
 * can be filled with bots so a game can start with fewer than four humans.
 */

import { Game, NUM_PLAYERS } from './game.js';
import { botStep } from './bot.js';
import { Phase, TurnState } from './constants.js';

let roomCounter = 0;

export class Room {
  constructor({ id, rules, seed } = {}) {
    this.id = id ?? `room-${++roomCounter}`;
    this.game = new Game({ rules, seed });
    this.seatBySocket = new Map(); // socketId -> seat
    this.botSeats = new Set(); // seats controlled by bots
    this.listeners = new Set(); // (event) => void
    this.started = false;

    // Re-broadcast every engine event and let bots react afterwards.
    this.game.on('event', (event) => {
      for (const fn of this.listeners) fn(event);
      // Bots act on the next tick to avoid re-entrant engine calls.
      setImmediate(() => this.runBots());
    });
  }

  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get openSeats() {
    const taken = new Set([...this.seatBySocket.values(), ...this.botSeats]);
    const open = [];
    for (let s = 0; s < NUM_PLAYERS; s++) if (!taken.has(s)) open.push(s);
    return open;
  }

  /** Seat a human connection. Returns the assigned seat or throws if full. */
  join(socketId, name) {
    if (this.seatBySocket.has(socketId)) return this.seatBySocket.get(socketId);
    const open = this.openSeats;
    if (open.length === 0) throw new Error('room is full');
    const seat = open[0];
    this.seatBySocket.set(socketId, seat);
    this.game.seatPlayer(seat, { id: socketId, name: name || `Player${seat}` });
    return seat;
  }

  leave(socketId) {
    const seat = this.seatBySocket.get(socketId);
    if (seat == null) return;
    this.seatBySocket.delete(socketId);
    this.game.players[seat].connected = false;
  }

  seatOf(socketId) {
    return this.seatBySocket.get(socketId);
  }

  /** Fill every still-open seat with a bot and start the hand. */
  fillWithBots() {
    for (const seat of this.openSeats) {
      this.botSeats.add(seat);
      this.game.seatPlayer(seat, { id: `bot-${seat}`, name: `Bot${seat}` });
    }
  }

  start({ fillBots = true } = {}) {
    if (fillBots) this.fillWithBots();
    if (this.openSeats.length > 0) {
      throw new Error(`cannot start: ${this.openSeats.length} empty seats`);
    }
    this.started = true;
    this.game.start();
    setImmediate(() => this.runBots());
    return this;
  }

  /** Let every bot seat that currently has a legal move take exactly one move. */
  runBots() {
    if (this.game.phase === Phase.SETTLED) return;
    let acted = true;
    let guard = 0;
    while (acted && guard++ < 1000) {
      acted = false;
      for (const seat of this.botSeats) {
        if (botStep(this.game, seat, { takeGang: false, takePeng: false })) {
          acted = true;
          break;
        }
      }
    }
  }

  /** Forward a human action into the engine. */
  act(socketId, action, payload) {
    const seat = this.seatOf(socketId);
    if (seat == null) throw new Error('not seated in this room');
    return this.game.act(seat, action, payload);
  }

  chooseMissingSuit(socketId, suit) {
    const seat = this.seatOf(socketId);
    if (seat == null) throw new Error('not seated in this room');
    return this.game.chooseMissingSuit(seat, suit);
  }

  /** Personalised state for one connection (hides others' tiles). */
  stateFor(socketId) {
    const seat = this.seatOf(socketId);
    if (seat == null) return { room: this.id, ...this.game.getPublicState() };
    return { room: this.id, ...this.game.getPlayerState(seat) };
  }
}

/** A trivial in-memory registry of rooms. */
export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  create(opts) {
    const room = new Room(opts);
    this.rooms.set(room.id, room);
    return room;
  }

  get(id) {
    return this.rooms.get(id);
  }

  getOrCreate(id, opts) {
    return this.get(id) || this.create({ ...opts, id });
  }

  remove(id) {
    this.rooms.delete(id);
  }

  list() {
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      phase: r.game.phase,
      players: r.game.players.filter((p) => p.connected).length,
      openSeats: r.openSeats.length,
    }));
  }
}
