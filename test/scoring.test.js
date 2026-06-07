import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTile, idsToCounts } from '../src/tiles.js';
import { scoreWin } from '../src/scoring.js';
import { DEFAULT_RULES, MeldType } from '../src/constants.js';

const W = 0, T = 1, S = 2;
const t = (suit, rank) => makeTile(suit, rank);
const rules = { ...DEFAULT_RULES, fan: { ...DEFAULT_RULES.fan }, gang: { ...DEFAULT_RULES.gang } };

test('basic 平胡 scores base points', () => {
  const ids = [
    t(W, 1), t(W, 2), t(W, 3),
    t(W, 4), t(W, 5), t(W, 6),
    t(W, 7), t(W, 8), t(W, 9),
    t(T, 1), t(T, 2), t(T, 3),
    t(T, 5), t(T, 5),
  ];
  const s = scoreWin({ concealed: idsToCounts(ids), melds: [], selfDraw: false, rules });
  assert.equal(s.win, true);
  assert.equal(s.points, 1); // base 1, 0 extra fan
});

test('清一色 doubles by qingYiSe fan', () => {
  const ids = [
    t(W, 1), t(W, 2), t(W, 3),
    t(W, 4), t(W, 5), t(W, 6),
    t(W, 7), t(W, 8), t(W, 9),
    t(W, 1), t(W, 2), t(W, 3),
    t(W, 5), t(W, 5),
  ];
  const s = scoreWin({ concealed: idsToCounts(ids), melds: [], selfDraw: false, rules });
  assert.equal(s.isPure, true);
  // qingYiSe = 2 fan -> 2^2 = 4
  assert.equal(s.points, 4);
});

test('碰碰胡 adds a fan', () => {
  const ids = [
    t(W, 1), t(W, 1), t(W, 1),
    t(W, 2), t(W, 2), t(W, 2),
    t(T, 3), t(T, 3), t(T, 3),
    t(S, 4), t(S, 4), t(S, 4),
    t(S, 9), t(S, 9),
  ];
  const s = scoreWin({ concealed: idsToCounts(ids), melds: [], selfDraw: false, rules });
  // pengpenghu = 1 fan -> 2
  assert.equal(s.points, 2);
});

test('self draw adds 自摸 fan', () => {
  const ids = [
    t(W, 1), t(W, 2), t(W, 3),
    t(W, 4), t(W, 5), t(W, 6),
    t(W, 7), t(W, 8), t(W, 9),
    t(T, 1), t(T, 2), t(T, 3),
    t(T, 5), t(T, 5),
  ];
  const s = scoreWin({ concealed: idsToCounts(ids), melds: [], selfDraw: true, rules });
  assert.equal(s.points, 2); // 0 + zimo 1 fan
});

test('龙七对 scores more than 七对', () => {
  const plain = [
    t(W, 1), t(W, 1), t(W, 3), t(W, 3), t(W, 5), t(W, 5),
    t(T, 2), t(T, 2), t(T, 4), t(T, 4), t(S, 6), t(S, 6),
    t(S, 8), t(S, 8),
  ];
  const dragon = [
    t(W, 1), t(W, 1), t(W, 1), t(W, 1),
    t(W, 3), t(W, 3), t(W, 5), t(W, 5),
    t(T, 2), t(T, 2), t(T, 4), t(T, 4),
    t(S, 6), t(S, 6),
  ];
  const sp = scoreWin({ concealed: idsToCounts(plain), melds: [], selfDraw: false, rules });
  const sd = scoreWin({ concealed: idsToCounts(dragon), melds: [], selfDraw: false, rules });
  assert.equal(sp.sevenPairs, true);
  assert.equal(sd.sevenPairs, true);
  assert.ok(sd.points > sp.points, '龙七对 should outscore 七对');
});

test('根 from a concealed kong adds fan', () => {
  // Hand of 11 concealed tiles + an exposed an_gang (1 meld).
  // concealed: 123w 456w 99t + pair? need meldsNeeded=3 => 11 tiles = 3*3+2.
  const concealedIds = [
    t(W, 1), t(W, 2), t(W, 3),
    t(W, 4), t(W, 5), t(W, 6),
    t(T, 1), t(T, 2), t(T, 3),
    t(T, 9), t(T, 9),
  ];
  const melds = [{ type: MeldType.AN_GANG, tile: t(S, 5), from: 0 }];
  const s = scoreWin({ concealed: idsToCounts(concealedIds), melds, selfDraw: false, rules });
  assert.equal(s.win, true);
  // one gen from the kong -> at least genFan(1) fan -> points >= 2
  assert.ok(s.points >= 2);
});

test('fan cap is respected', () => {
  const cappedRules = { ...rules, fanCap: 1 };
  const ids = [
    t(W, 1), t(W, 2), t(W, 3),
    t(W, 4), t(W, 5), t(W, 6),
    t(W, 7), t(W, 8), t(W, 9),
    t(W, 1), t(W, 2), t(W, 3),
    t(W, 5), t(W, 5),
  ];
  const s = scoreWin({ concealed: idsToCounts(ids), melds: [], selfDraw: false, rules: cappedRules });
  assert.equal(s.points, 2); // capped at 2^1 even though qingyise is 2 fan
});
