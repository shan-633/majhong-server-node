/**
 * Fan (番) counting and point settlement for a winning hand.
 *
 * The scoring model is the common Sichuan "血战到底" doubling system:
 *
 *     points = baseScore * 2 ^ min(totalFan, fanCap)
 *
 * Each named pattern contributes a number of fan; the winning player collects
 * `points` from the loser(s). On a discard win (点炮) only the discarder pays;
 * on a self-draw (自摸) every other still-playing player pays.
 *
 * Kong payments (刮风下雨) are handled separately and immediately in game.js;
 * this module only scores the act of winning.
 */

import {
  NUM_TILES,
  suitsPresent,
  countTotal,
} from './tiles.js';
import { evaluateWin } from './win.js';
import { MeldType } from './constants.js';

/**
 * Count "根" (gen): every set of four identical tiles the player holds counts
 * as one gen. This includes kongs (an/ming/bu) and any natural four-of-a-kind
 * sitting in a seven-pairs hand. Each gen adds `genFan` fan.
 */
function countGen(concealed, melds) {
  let gen = 0;
  // Every kong is a gen.
  for (const m of melds) {
    if (
      m.type === MeldType.AN_GANG ||
      m.type === MeldType.MING_GANG ||
      m.type === MeldType.BU_GANG
    ) {
      gen += 1;
    }
  }
  // Natural four-of-a-kind among concealed tiles (e.g. inside 龙七对 or a
  // concealed triplet+draw). A peng upgraded to bu_gang is already counted
  // above, so only look at what remains concealed.
  for (let i = 0; i < NUM_TILES; i++) {
    if (concealed[i] === 4) gen += 1;
  }
  return gen;
}

/** Are all exposed melds triplets/kongs (no sequence)? Needed for 碰碰胡. */
function allMeldsAreTriplets(melds) {
  return melds.every((m) => m.type !== 'chi'); // Sichuan has no chi anyway
}

/**
 * Determine whether a standard (non seven-pairs) win is 碰碰胡 (all triplets).
 * We re-derive this from the concealed tiles: a peng-peng-hu hand has the pair
 * plus only triplets in the concealed portion.
 */
function isAllTriplets(concealed, meldsNeeded) {
  // Greedy: must be pair + meldsNeeded triplets, no sequences.
  const total = countTotal(concealed);
  if (total !== meldsNeeded * 3 + 2) return false;
  let pairs = 0;
  let triplets = 0;
  for (let i = 0; i < NUM_TILES; i++) {
    const c = concealed[i];
    if (c === 0) continue;
    if (c === 2) pairs += 1;
    else if (c === 3) triplets += 1;
    else return false; // a 1 or a 4 means it can't be pure pair+triplets
  }
  return pairs === 1 && triplets === meldsNeeded;
}

/**
 * Compute the fan breakdown for a winning hand.
 *
 * @param {object} ctx
 * @param {number[]} ctx.concealed  concealed count array INCLUDING the winning tile
 * @param {Array}    ctx.melds      exposed melds [{type, tile}]
 * @param {boolean}  ctx.selfDraw   true if 自摸
 * @param {boolean}  ctx.afterKong  true if won on a kong replacement tile (杠上花/杠上炮)
 * @param {boolean}  ctx.robKong    true if 抢杠胡
 * @param {boolean}  ctx.lastTile   true if 海底/河底
 * @param {object}   ctx.rules      rule config
 * @returns {{fan:number, cappedFan:number, points:number, patterns:string[]}}
 */
export function scoreWin(ctx) {
  const { concealed, melds, rules } = ctx;
  const meldsNeeded = 4 - melds.length;
  const result = evaluateWin(concealed, melds.length);
  if (!result.win) {
    return { fan: 0, cappedFan: 0, points: 0, patterns: [], win: false };
  }

  const F = rules.fan;
  let fan = 0;
  const patterns = [];

  const add = (n, label) => {
    if (n > 0) {
      fan += n;
      patterns.push(`${label} (+${n})`);
    } else {
      patterns.push(label);
    }
  };

  // ---- Suit purity (清一色) ----
  const suits = suitsPresent(concealed);
  for (const m of melds) suits.add(Math.floor(m.tile / 9));
  const isPure = suits.size === 1;

  // ---- Shape based fan ----
  if (result.sevenPairs) {
    if (result.dragonQuads > 0) {
      // 龙七对: base qiDui fan, +longQiDui boost, plus extra fan per additional quad.
      const dragonFan = F.longQiDui + (result.dragonQuads - 1) * F.genFan;
      add(dragonFan, `龙七对 x${result.dragonQuads}`);
    } else {
      add(F.qiDui, '七对');
    }
    // Note: gen from quads inside 龙七对 already folded into dragonFan above,
    // so do NOT also call countGen for the seven-pairs concealed quads.
  } else {
    if (isAllTriplets(concealed, meldsNeeded) && allMeldsAreTriplets(melds)) {
      // 金钩钓: peng-peng-hu where ALL melds are exposed and you win on the pair.
      const exposedTriplets = melds.length;
      if (exposedTriplets === 4) {
        add(F.jinGouDiao, '金钩钓');
        add(F.pengPengHu, '碰碰胡');
      } else {
        add(F.pengPengHu, '碰碰胡');
      }
    } else {
      add(F.pingHu, '平胡');
    }
  }

  if (isPure) add(F.qingYiSe, '清一色');

  // ---- Gen (根) — skip for 龙七对 whose quads are already scored. ----
  if (!result.sevenPairs || result.dragonQuads === 0) {
    const gen = countGen(concealed, melds);
    if (gen > 0) add(gen * F.genFan, `根 x${gen}`);
  } else {
    // Plain seven pairs (no quad) still can have gen from... none, since quads
    // would make it 龙七对. Nothing to add.
  }

  // ---- Situational fan ----
  if (ctx.selfDraw && rules.zimoExtraFan) add(F.pingHu >= 0 ? 1 : 0, '自摸');
  if (ctx.afterKong) {
    add(ctx.selfDraw ? F.ganggangHua : F.ganggangPao, ctx.selfDraw ? '杠上花' : '杠上炮');
  }
  if (ctx.robKong) add(F.qiangGangHu, '抢杠胡');
  if (ctx.lastTile) add(F.haiDiLao, ctx.selfDraw ? '海底捞月' : '河底捞鱼');

  const cappedFan = Math.min(fan, rules.fanCap);
  const points = rules.baseScore * Math.pow(2, cappedFan);

  return { fan, cappedFan, points, patterns, win: true, isPure, sevenPairs: result.sevenPairs };
}
