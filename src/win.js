/**
 * Win ("hu" / 胡) detection for Sichuan Mahjong.
 *
 * A winning hand is 4 melds + 1 pair. Melds already exposed via peng/gang are
 * complete, so detection only has to prove that the *concealed* tiles can be
 * partitioned into (k melds + 1 pair), where k = 4 - (number of exposed melds).
 *
 * In Sichuan Mahjong a meld is either:
 *   - a triplet 刻子 (three identical tiles), or
 *   - a sequence 顺子 (three consecutive ranks in the same suit).
 * Sequences may never cross a suit boundary.
 *
 * Special winning shapes that are NOT 4-melds-plus-pair:
 *   - 七对   (seven pairs): 14 concealed tiles forming 7 distinct pairs.
 *   - 龙七对 (dragon seven pairs): seven pairs where at least one pair is
 *             actually four-of-a-kind. Detected as a refinement of 七对.
 *
 * Note: seven-pairs requires a fully concealed hand (no exposed melds).
 *
 * All functions operate on a length-27 count array (see tiles.js).
 */

import { NUM_TILES, TILES_PER_SUIT, countTotal } from './tiles.js';

/**
 * Can the given concealed counts be split into exactly `meldsNeeded` melds
 * (no pair)? Pure recursive descent over tile ids. Mutates and restores
 * `counts` in place.
 */
function canFormMelds(counts, meldsNeeded) {
  if (meldsNeeded === 0) {
    // All tiles must be consumed.
    return countTotal(counts) === 0;
  }

  // Find the lowest tile id that still has copies.
  let i = 0;
  while (i < NUM_TILES && counts[i] === 0) i++;
  if (i >= NUM_TILES) return false; // need melds but nothing left

  // Option A: use a triplet 刻子 starting at i.
  if (counts[i] >= 3) {
    counts[i] -= 3;
    if (canFormMelds(counts, meldsNeeded - 1)) {
      counts[i] += 3;
      return true;
    }
    counts[i] += 3;
  }

  // Option B: use a sequence 顺子 i, i+1, i+2 (same suit only).
  const rankInSuit = i % TILES_PER_SUIT; // 0..8
  if (
    rankInSuit <= TILES_PER_SUIT - 3 &&
    counts[i + 1] > 0 &&
    counts[i + 2] > 0
  ) {
    counts[i]--;
    counts[i + 1]--;
    counts[i + 2]--;
    if (canFormMelds(counts, meldsNeeded - 1)) {
      counts[i]++;
      counts[i + 1]++;
      counts[i + 2]++;
      return true;
    }
    counts[i]++;
    counts[i + 1]++;
    counts[i + 2]++;
  }

  return false;
}

/**
 * Standard win: the concealed counts form `meldsNeeded` melds plus exactly one
 * pair. Tries every tile that has >= 2 copies as the pair.
 */
export function isStandardWin(counts, meldsNeeded) {
  const total = countTotal(counts);
  if (total !== meldsNeeded * 3 + 2) return false;

  const work = counts.slice();
  for (let i = 0; i < NUM_TILES; i++) {
    if (work[i] >= 2) {
      work[i] -= 2;
      if (canFormMelds(work, meldsNeeded)) {
        work[i] += 2;
        return true;
      }
      work[i] += 2;
    }
  }
  return false;
}

/** Seven pairs 七对: 14 tiles, every distinct tile present an even number of times. */
export function isSevenPairs(counts) {
  if (countTotal(counts) !== 14) return false;
  for (let i = 0; i < NUM_TILES; i++) {
    if (counts[i] % 2 !== 0) return false;
  }
  return true;
}

/**
 * Dragon seven pairs 龙七对: a seven-pairs hand containing at least one
 * four-of-a-kind (a "doubled" pair). Each set of 4 counts as one "根/龙".
 * Returns the number of quadruplets (0 means it is plain 七对).
 */
export function dragonPairCount(counts) {
  if (!isSevenPairs(counts)) return 0;
  let quads = 0;
  for (let i = 0; i < NUM_TILES; i++) {
    if (counts[i] === 4) quads += 1;
  }
  return quads;
}

/**
 * Top level: is `concealed` a winning hand given `exposedMelds` already-formed
 * melds (peng + gang each count as one meld)? `allowSevenPairs` is false once
 * the player has any exposed meld.
 *
 * Returns a descriptor `{ win, sevenPairs, dragonQuads }` or `{ win: false }`.
 */
export function evaluateWin(concealed, exposedMelds) {
  const meldsNeeded = 4 - exposedMelds;
  const total = countTotal(concealed);

  // Concealed tile count must be 3*meldsNeeded + 2 (the pair).
  if (total !== meldsNeeded * 3 + 2) {
    return { win: false };
  }

  // Seven pairs only possible with a fully concealed 14-tile hand.
  if (exposedMelds === 0 && isSevenPairs(concealed)) {
    const quads = dragonPairCount(concealed);
    return { win: true, sevenPairs: true, dragonQuads: quads };
  }

  if (isStandardWin(concealed, meldsNeeded)) {
    return { win: true, sevenPairs: false, dragonQuads: 0 };
  }

  return { win: false };
}

/** Convenience boolean wrapper. */
export function canHu(concealed, exposedMelds = 0) {
  return evaluateWin(concealed, exposedMelds).win;
}

/**
 * Tenpai / "ting" (听牌) test: with the current concealed counts, is there any
 * single tile that would complete the hand? Returns the sorted array of
 * winning tile ids (empty array => not ready).
 *
 * `forbiddenSuit` (0..2 or null) is the player's declared missing suit
 * (定缺); a hand can never be ready on a tile of the forbidden suit, and a
 * hand that still holds forbidden-suit tiles is not ready at all.
 */
export function winningTiles(concealed, exposedMelds = 0, forbiddenSuit = null) {
  // If the hand still contains the forbidden suit it cannot be ready.
  if (forbiddenSuit != null) {
    for (let id = forbiddenSuit * TILES_PER_SUIT; id < (forbiddenSuit + 1) * TILES_PER_SUIT; id++) {
      if (concealed[id] > 0) return [];
    }
  }

  const result = [];
  const work = concealed.slice();
  for (let id = 0; id < NUM_TILES; id++) {
    if (forbiddenSuit != null && Math.floor(id / TILES_PER_SUIT) === forbiddenSuit) continue;
    if (work[id] >= 4) continue; // cannot draw a 5th copy
    work[id]++;
    if (evaluateWin(work, exposedMelds).win) result.push(id);
    work[id]--;
  }
  return result;
}

/** Is the hand ready to win (听牌)? */
export function isTenpai(concealed, exposedMelds = 0, forbiddenSuit = null) {
  return winningTiles(concealed, exposedMelds, forbiddenSuit).length > 0;
}
