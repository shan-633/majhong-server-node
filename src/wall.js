/**
 * The wall (牌墙): the shuffled draw pile for a hand.
 *
 * Sichuan Mahjong has no flowers/honors, so the wall is simply 4 copies of
 * each of the 27 numbered tiles = 108 tiles, shuffled.
 */

import { NUM_TILES, COPIES_PER_TILE } from './tiles.js';

/** Deterministic-ish Fisher–Yates shuffle, optionally seeded for tests. */
export function shuffle(array, rng = Math.random) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A tiny seedable PRNG (mulberry32) so games can be reproduced from a seed. */
export function seededRng(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export class Wall {
  constructor({ seed } = {}) {
    const rng = seed == null ? Math.random : seededRng(seed);
    const tiles = [];
    for (let id = 0; id < NUM_TILES; id++) {
      for (let c = 0; c < COPIES_PER_TILE; c++) tiles.push(id);
    }
    this.tiles = shuffle(tiles, rng);
    this.index = 0; // next tile to draw from the front
  }

  get remaining() {
    return this.tiles.length - this.index;
  }

  /** Draw the next tile from the live wall, or null if exhausted. */
  draw() {
    if (this.remaining <= 0) return null;
    return this.tiles[this.index++];
  }

  /**
   * Draw a replacement tile after a kong. In real Sichuan play this comes from
   * the tail of the wall; mechanically it is just "the next available tile".
   */
  drawReplacement() {
    return this.draw();
  }
}
