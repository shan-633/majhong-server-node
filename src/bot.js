/**
 * A simple rule-based bot, good enough to drive games to completion and to
 * power the demo / integration tests. It is intentionally not a strong AI.
 */

import {
  NUM_TILES,
  TILES_PER_SUIT,
  suitOf,
  countTotal,
} from './tiles.js';
import { Action, Phase, TurnState } from './constants.js';

/** Pick the void suit (定缺): the suit in which the player holds the fewest tiles. */
export function chooseMissingSuit(concealed) {
  const perSuit = [0, 0, 0];
  for (let id = 0; id < NUM_TILES; id++) perSuit[suitOf(id)] += concealed[id];
  let best = 0;
  for (let s = 1; s < 3; s++) if (perSuit[s] < perSuit[best]) best = s;
  return best;
}

/** Choose a tile to discard. Always sheds the void suit first. */
export function pickDiscard(player) {
  const c = player.concealed;
  const miss = player.missingSuit;

  // 1) Get rid of void-suit tiles first (required by the rules anyway).
  for (let id = miss * TILES_PER_SUIT; id < (miss + 1) * TILES_PER_SUIT; id++) {
    if (c[id] > 0) return id;
  }

  // 2) Otherwise discard the most "isolated" tile: one whose neighbours are
  //    absent, preferring singles over pairs/triplets.
  let bestId = -1;
  let bestScore = Infinity;
  for (let id = 0; id < NUM_TILES; id++) {
    if (c[id] === 0) continue;
    const suit = suitOf(id);
    const left = id % TILES_PER_SUIT > 0 ? c[id - 1] : 0;
    const right = id % TILES_PER_SUIT < TILES_PER_SUIT - 1 ? c[id + 1] : 0;
    // Lower score = more disposable. Triplets/pairs are valuable (negative),
    // neighbours are valuable.
    const score = c[id] * 2 + left + right;
    if (score < bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Decide and submit the bot's move for `seat`, if it is the bot's turn or it
 * has a pending claim. Returns true if it acted. `opts.takeGang` enables
 * concealed/added kongs (off by default to keep games short and predictable).
 */
export function botStep(game, seat, opts = {}) {
  if (game.phase === Phase.CHOOSING_SUIT) {
    if (game.players[seat].missingSuit == null) {
      game.chooseMissingSuit(seat, chooseMissingSuit(game.players[seat].concealed));
      return true;
    }
    return false;
  }

  if (game.phase !== Phase.PLAYING) return false;
  const actions = game.getAvailableActions(seat);
  if (actions.length === 0) return false;

  // Pending claim window.
  if (game.turnState === TurnState.CLAIMS) {
    if (actions.includes(Action.HU)) {
      game.act(seat, Action.HU);
      return true;
    }
    // Optionally peng/gang; default behaviour is to pass for simplicity.
    if (opts.takePeng && actions.includes(Action.PENG)) {
      game.act(seat, Action.PENG);
      return true;
    }
    game.act(seat, Action.PASS);
    return true;
  }

  // Our own discard turn.
  if (game.turnState === TurnState.DISCARD && seat === game.currentSeat) {
    if (actions.includes(Action.HU)) {
      game.act(seat, Action.HU);
      return true;
    }
    if (opts.takeGang && actions.includes(Action.GANG)) {
      game.act(seat, Action.GANG, {});
      return true;
    }
    const tile = pickDiscard(game.players[seat]);
    game.act(seat, Action.DISCARD, { tile });
    return true;
  }

  return false;
}

/**
 * Drive a game to completion with four bots. Returns the final settlement
 * event. Includes an iteration guard against accidental infinite loops.
 */
export function playOut(game, opts = {}) {
  let settlement = null;
  game.on('settled', (e) => {
    settlement = e;
  });
  if (game.phase === Phase.WAITING || game.phase === Phase.SETTLED) game.start();

  let guard = 0;
  const maxIters = opts.maxIters ?? 100000;
  while (game.phase !== Phase.SETTLED) {
    let acted = false;
    for (let seat = 0; seat < 4; seat++) {
      if (botStep(game, seat, opts)) {
        acted = true;
        break; // re-evaluate state from the top after every action
      }
    }
    if (!acted) {
      throw new Error(
        `bot driver stuck: phase=${game.phase} turnState=${game.turnState} current=${game.currentSeat}`
      );
    }
    if (++guard > maxIters) throw new Error('playOut exceeded iteration guard');
  }
  return settlement;
}
