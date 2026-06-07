import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { playOut, botStep } from '../src/bot.js';
import { Phase } from '../src/constants.js';

test('deals 13 tiles to each player and enters 定缺 phase', () => {
  const game = new Game({ seed: 1 });
  game.start();
  assert.equal(game.phase, Phase.CHOOSING_SUIT);
  for (const p of game.players) {
    assert.equal(p.handTileCount(), 13);
  }
  // Wall: 108 total - 52 dealt = 56 remaining.
  assert.equal(game.wall.remaining, 108 - 52);
});

test('a full game plays to a settled state without getting stuck', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const game = new Game({ seed });
    const settlement = playOut(game, { maxIters: 200000 });
    assert.equal(game.phase, Phase.SETTLED);
    assert.ok(settlement, 'should produce a settlement');
    assert.ok(
      ['bloodyBattleOver', 'exhaustiveDraw', 'firstWin'].includes(settlement.reason),
      `unexpected reason ${settlement.reason}`
    );
  }
});

test('scores are zero-sum across all four players', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const game = new Game({ seed });
    playOut(game);
    const total = game.players.reduce((acc, p) => acc + p.score, 0);
    assert.equal(total, 0, `seed ${seed} not zero-sum: ${total}`);
  }
});

test('blood battle continues past the first win (can have multiple winners)', () => {
  // Over many seeds at least some games should produce >1 winner.
  let multiWinnerGames = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const game = new Game({ seed, rules: { bloodyBattle: true } });
    playOut(game);
    if (game.winnersCount > 1) multiWinnerGames++;
    // Winners are at most 3 in blood battle.
    assert.ok(game.winnersCount <= 3);
  }
  assert.ok(multiWinnerGames > 0, 'expected some multi-winner games');
});

test('non-blood variant ends at the first win', () => {
  let endedByFirstWin = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const game = new Game({ seed, rules: { bloodyBattle: false } });
    const s = playOut(game);
    if (s.reason === 'firstWin') {
      endedByFirstWin++;
      assert.equal(game.winnersCount, 1);
    }
  }
  assert.ok(endedByFirstWin > 0, 'expected some games to end on first win');
});

test('定缺 is enforced: winners never hold their missing suit', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const game = new Game({ seed });
    playOut(game);
    for (const p of game.players) {
      if (p.hasWon) {
        // Winner's concealed hand must not contain the missing suit.
        const has = p.concealed.some(
          (n, id) => n > 0 && Math.floor(id / 9) === p.missingSuit
        );
        assert.equal(has, false, `winner at seat ${p.seat} held missing suit`);
      }
    }
  }
});

test('games that take kongs still settle and stay zero-sum', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const game = new Game({ seed });
    playOut(game, { takeGang: true, takePeng: true });
    assert.equal(game.phase, Phase.SETTLED);
    const total = game.players.reduce((acc, p) => acc + p.score, 0);
    assert.equal(total, 0, `seed ${seed} (gang) not zero-sum: ${total}`);
  }
});
