/**
 * Tile model for Sichuan Mahjong (四川麻将).
 *
 * Sichuan Mahjong uses only the three numbered suits (no winds, dragons,
 * flowers or seasons):
 *   - 万 (wan / characters)   suit index 0, ids 0..8   -> ranks 1..9
 *   - 筒 (tong / dots)        suit index 1, ids 9..17  -> ranks 1..9
 *   - 条 (tiao / bamboo)      suit index 2, ids 18..26 -> ranks 1..9
 *
 * There are 4 physical copies of each of the 27 distinct tiles = 108 tiles.
 *
 * A tile is represented throughout the engine as an integer "tile id" in the
 * range 0..26. A *hand* is represented as a length-27 count array, where
 * `counts[id]` is the number of copies of that tile the player holds. This
 * representation makes the win-detection and scoring algorithms simple and
 * fast.
 */

export const SUITS = ['wan', 'tong', 'tiao'];
export const SUIT_NAMES_CN = ['万', '筒', '条'];
export const TILES_PER_SUIT = 9;
export const NUM_TILES = SUITS.length * TILES_PER_SUIT; // 27 distinct tiles
export const COPIES_PER_TILE = 4;
export const TOTAL_TILES = NUM_TILES * COPIES_PER_TILE; // 108

/** Suit index (0=wan, 1=tong, 2=tiao) of a tile id. */
export function suitOf(id) {
  return Math.floor(id / TILES_PER_SUIT);
}

/** Rank (1..9) of a tile id. */
export function rankOf(id) {
  return (id % TILES_PER_SUIT) + 1;
}

/** Build a tile id from a suit index (0..2) and rank (1..9). */
export function makeTile(suit, rank) {
  return suit * TILES_PER_SUIT + (rank - 1);
}

/** Human readable label, e.g. 5 of wan -> "5万". */
export function tileName(id) {
  return `${rankOf(id)}${SUIT_NAMES_CN[suitOf(id)]}`;
}

/** Short ascii label, e.g. "5w", "3t" (t=tong? -> use w/d/b). */
export function tileCode(id) {
  const codes = ['m', 'p', 's']; // man, pin, sou (common mahjong notation)
  return `${rankOf(id)}${codes[suitOf(id)]}`;
}

/** A fresh length-27 zeroed count array. */
export function emptyCounts() {
  return new Array(NUM_TILES).fill(0);
}

/** Convert an array of tile ids into a count array. */
export function idsToCounts(ids) {
  const counts = emptyCounts();
  for (const id of ids) counts[id]++;
  return counts;
}

/** Convert a count array back into a sorted array of tile ids. */
export function countsToIds(counts) {
  const ids = [];
  for (let id = 0; id < NUM_TILES; id++) {
    for (let n = 0; n < counts[id]; n++) ids.push(id);
  }
  return ids;
}

/** Total number of tiles described by a count array. */
export function countTotal(counts) {
  let sum = 0;
  for (let i = 0; i < counts.length; i++) sum += counts[i];
  return sum;
}

/** The set of suit indices that appear in a count array. */
export function suitsPresent(counts) {
  const present = new Set();
  for (let id = 0; id < NUM_TILES; id++) {
    if (counts[id] > 0) present.add(suitOf(id));
  }
  return present;
}

/** Render a hand (count array) as a readable string for logging. */
export function handToString(counts) {
  return countsToIds(counts).map(tileName).join(' ');
}
