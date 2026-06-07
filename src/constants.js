/**
 * Shared enums and the default rule configuration for the engine.
 *
 * The scoring of Sichuan Mahjong varies a lot between tables ("一桌一规矩").
 * Everything that differs between house rules lives in DEFAULT_RULES so a room
 * can override it without touching the engine.
 */

/** Kinds of exposed/declared meld. */
export const MeldType = Object.freeze({
  PENG: 'peng', // 碰  triplet claimed from a discard
  AN_GANG: 'an_gang', // 暗杠 concealed kong (4 from hand)
  MING_GANG: 'ming_gang', // 直杠/明杠 kong claimed directly from a discard
  BU_GANG: 'bu_gang', // 补杠/巴杠 upgrade an existing peng to a kong
});

/** High level game phases. */
export const Phase = Object.freeze({
  WAITING: 'waiting', // waiting for players to join
  DEALING: 'dealing', // tiles being dealt
  CHOOSING_SUIT: 'choosing_suit', // 定缺 every player picks a missing suit
  PLAYING: 'playing', // normal turn loop
  SETTLED: 'settled', // hand finished, scores applied
});

/** What the engine is waiting on at any instant during PLAYING. */
export const TurnState = Object.freeze({
  DRAW: 'draw', // current player must draw
  DISCARD: 'discard', // current player must discard
  CLAIMS: 'claims', // a discard is on the table, waiting for peng/gang/hu claims
});

/** Actions a player may submit. */
export const Action = Object.freeze({
  DISCARD: 'discard',
  PENG: 'peng',
  GANG: 'gang', // covers ming/an/bu gang; engine infers which
  HU: 'hu',
  PASS: 'pass',
});

/**
 * Default rules. All "fan" values are additive exponents: a hand worth N fan
 * scores `baseScore * 2^min(N, fanCap)` points.
 */
export const DEFAULT_RULES = {
  baseScore: 1,
  fanCap: 4, // 封顶: maximum doubling, 2^4 = 16 by default

  fan: {
    pingHu: 0, // 平胡 (base hand) contributes no extra doubling
    pengPengHu: 1, // 碰碰胡 all-triplets
    qingYiSe: 2, // 清一色 one suit only
    qiDui: 2, // 七对
    longQiDui: 3, // 龙七对 (per quad it gains another fan, see scoring.js)
    jinGouDiao: 1, // 金钩钓 win on the pair with every other meld exposed
    ganggangHua: 1, // 杠上花 win on the replacement tile after a kong
    ganggangPao: 1, // 杠上炮 deal-in on the discard forced by a kong
    qiangGangHu: 1, // 抢杠胡 rob the kong
    haiDiLao: 1, // 海底捞月 win on the very last drawn tile
    genFan: 1, // 根: each four-of-a-kind adds this many fan
  },

  // 刮风下雨 — kong payments (points, NOT fan; paid immediately).
  gang: {
    anGang: 2, // 暗杠: every other player pays this
    mingGang: 1, // 直杠/明杠: paid by ... (see `mingGangPaidByDiscarder`)
    buGang: 1, // 补杠: every other player pays this
    mingGangPaidByDiscarder: true, // true => only the discarder pays mingGang*3? see scoring
  },

  zimoExtraFan: true, // 自摸 adds one fan
  // 血战到底: keep playing until 3 of the 4 players have won.
  bloodyBattle: true,
  // 查大叫 / 花猪 end-of-hand penalties on exhaustive draw.
  checkTingOnDraw: true,
  huaZhuPenaltyFan: 4, // 花猪 pays the capped score to each non-hua player
};
