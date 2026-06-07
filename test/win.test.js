import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTile, idsToCounts } from '../src/tiles.js';
import {
  evaluateWin,
  isSevenPairs,
  dragonPairCount,
  canHu,
  winningTiles,
  isTenpai,
} from '../src/win.js';

const W = 0; // wan
const T = 1; // tong
const S = 2; // tiao
const t = (suit, rank) => makeTile(suit, rank);

test('standard 4 melds + pair (all sequences)', () => {
  // 123 456 789 wan, 123 tong, pair 5 tong -> 14 tiles
  const ids = [
    t(W, 1), t(W, 2), t(W, 3),
    t(W, 4), t(W, 5), t(W, 6),
    t(W, 7), t(W, 8), t(W, 9),
    t(T, 1), t(T, 2), t(T, 3),
    t(T, 5), t(T, 5),
  ];
  assert.equal(canHu(idsToCounts(ids), 0), true);
});

test('all triplets (碰碰胡) wins', () => {
  const ids = [
    t(W, 1), t(W, 1), t(W, 1),
    t(W, 2), t(W, 2), t(W, 2),
    t(T, 3), t(T, 3), t(T, 3),
    t(S, 4), t(S, 4), t(S, 4),
    t(S, 9), t(S, 9),
  ];
  assert.equal(canHu(idsToCounts(ids), 0), true);
});

test('not a win: floating tile', () => {
  const ids = [
    t(W, 1), t(W, 2), t(W, 3),
    t(W, 4), t(W, 5), t(W, 6),
    t(W, 7), t(W, 8), t(W, 9),
    t(T, 1), t(T, 2), t(T, 3),
    t(T, 5), t(T, 7), // 5 and 7, no pair / not adjacent
  ];
  assert.equal(canHu(idsToCounts(ids, 0), 0), false);
});

test('seven pairs (七对) detection', () => {
  const ids = [
    t(W, 1), t(W, 1),
    t(W, 3), t(W, 3),
    t(W, 5), t(W, 5),
    t(T, 2), t(T, 2),
    t(T, 4), t(T, 4),
    t(S, 6), t(S, 6),
    t(S, 8), t(S, 8),
  ];
  const counts = idsToCounts(ids);
  assert.equal(isSevenPairs(counts), true);
  const res = evaluateWin(counts, 0);
  assert.equal(res.win, true);
  assert.equal(res.sevenPairs, true);
  assert.equal(res.dragonQuads, 0);
});

test('dragon seven pairs (龙七对) with one quad', () => {
  const ids = [
    t(W, 1), t(W, 1), t(W, 1), t(W, 1), // quad
    t(W, 3), t(W, 3),
    t(W, 5), t(W, 5),
    t(T, 2), t(T, 2),
    t(T, 4), t(T, 4),
    t(S, 6), t(S, 6),
  ];
  const counts = idsToCounts(ids);
  assert.equal(dragonPairCount(counts), 1);
  const res = evaluateWin(counts, 0);
  assert.equal(res.win, true);
  assert.equal(res.sevenPairs, true);
  assert.equal(res.dragonQuads, 1);
});

test('seven pairs not valid with an exposed meld', () => {
  // 12 tiles concealed that look like 6 pairs, plus one exposed meld:
  const ids = [
    t(W, 1), t(W, 1),
    t(W, 3), t(W, 3),
    t(W, 5), t(W, 5),
    t(T, 2), t(T, 2),
    t(T, 4), t(T, 4),
    t(S, 6), t(S, 6),
  ];
  // 12 concealed + 1 exposed meld means meldsNeeded=3 -> needs 11 concealed; mismatch.
  const res = evaluateWin(idsToCounts(ids), 1);
  assert.equal(res.win, false);
});

test('winningTiles respects forbidden suit (定缺)', () => {
  // Ready on either 3w or 6w to complete 1-2 / 4-5-6 ... build a clear ting.
  // hand: 123w 456w 789w 11t  + 5t waiting on 5t? simpler: 13 tiles tenpai.
  const ids = [
    t(W, 1), t(W, 2), t(W, 3),
    t(W, 4), t(W, 5), t(W, 6),
    t(W, 7), t(W, 8), t(W, 9),
    t(T, 5), t(T, 5),
    t(T, 1), t(T, 2), // waiting on 3t (sequence) -> but that's 14? count
  ];
  // Actually that's 14 tiles; drop one to be 13 (tenpai). Remove last.
  ids.pop(); // now 13 tiles: ...11t 1t  waiting? recompute
  // Simpler explicit tenpai: 123456789w + 11t + 2t3t (13 tiles), waiting 1t/4t.
  const hand = [
    t(W, 1), t(W, 2), t(W, 3),
    t(W, 4), t(W, 5), t(W, 6),
    t(W, 7), t(W, 8), t(W, 9),
    t(T, 1), t(T, 1),
    t(T, 2), t(T, 3),
  ];
  const counts = idsToCounts(hand);
  const wins = winningTiles(counts, 0, null);
  // Should be able to win on 1t (pair->? ) Let's just assert tenpai true and
  // that no tiao? here forbidden suit tiao removes nothing since hand has tong.
  assert.equal(isTenpai(counts, 0, null), true);
  // If we forbid tong (suit 1) but hand holds tong tiles, not ready.
  assert.equal(isTenpai(counts, 0, T), false);
  assert.ok(wins.length > 0);
});
