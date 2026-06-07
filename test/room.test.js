import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, RoomManager } from '../src/room.js';
import { Phase } from '../src/constants.js';

test('a room with one human + three bots plays itself to settlement', async () => {
  const room = new Room({ id: 'r1', seed: 3 });
  const seat = room.join('sock-1', 'Human');
  assert.equal(seat, 0);

  const settled = new Promise((resolve) => room.game.on('settled', resolve));
  room.start({ fillBots: true });

  // The human seat still needs to choose a suit and play; emulate a bot for it
  // by reusing the engine's bot through the room's own runBots after marking it.
  // Simplest: also treat the human seat as a bot for this test.
  room.botSeats.add(0);
  room.runBots();

  // Give the setImmediate-driven bot loop a few ticks to finish the hand.
  const result = await Promise.race([
    settled,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
  ]);

  assert.equal(room.game.phase, Phase.SETTLED);
  assert.ok(result.scores);
  const total = result.scores.reduce((a, s) => a + s.score, 0);
  assert.equal(total, 0);
});

test('RoomManager creates and lists rooms', () => {
  const mgr = new RoomManager();
  const a = mgr.getOrCreate('alpha', {});
  const b = mgr.getOrCreate('alpha', {});
  assert.equal(a, b, 'getOrCreate returns the same room for the same id');
  mgr.create({ id: 'beta' });
  const ids = mgr.list().map((r) => r.id).sort();
  assert.deepEqual(ids, ['alpha', 'beta']);
});

test('joining a full room throws', () => {
  const room = new Room({ id: 'full', seed: 1 });
  room.join('a');
  room.join('b');
  room.join('c');
  room.join('d');
  assert.throws(() => room.join('e'), /full/);
});

test('stateFor hides other players hands but shows your own', () => {
  const room = new Room({ id: 'priv', seed: 1 });
  room.join('me', 'Me');
  room.fillWithBots();
  room.game.start();
  const st = room.stateFor('me');
  assert.ok(Array.isArray(st.hand), 'own hand is visible');
  assert.equal(st.hand.length, 13);
  // Public player views only expose a tile count, not the tiles.
  for (const p of st.players) {
    assert.equal(p.hand, undefined);
    assert.equal(typeof p.handCount, 'number');
  }
});
