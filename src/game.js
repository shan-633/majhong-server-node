/**
 * Sichuan "血战到底" (Bloody Battle to the End) Mahjong engine.
 *
 * Responsibilities:
 *   - deal tiles and run the 定缺 (choose-a-missing-suit) phase
 *   - drive the draw / discard / claim turn loop
 *   - validate and apply peng (碰) and the three kongs (暗杠/直杠/补杠)
 *   - detect wins, support 一炮多响 (multiple winners on one discard) and keep
 *     playing until only one player is left (blood battle)
 *   - apply kong payments (刮风下雨) immediately and score wins via scoring.js
 *   - settle the hand on an exhaustive draw (查大叫 / 花猪)
 *
 * The engine is transport-agnostic: it emits events and exposes pure methods.
 * server.js wires it to Socket.IO; scripts/demo.js drives it with bots.
 */

import { EventEmitter } from 'node:events';
import {
  NUM_TILES,
  TILES_PER_SUIT,
  suitOf,
  idsToCounts,
  countsToIds,
  countTotal,
  tileName,
} from './tiles.js';
import { Wall } from './wall.js';
import { evaluateWin, winningTiles, isTenpai } from './win.js';
import { scoreWin } from './scoring.js';
import {
  Phase,
  TurnState,
  Action,
  MeldType,
  DEFAULT_RULES,
} from './constants.js';

const NUM_PLAYERS = 4;
const HAND_SIZE = 13; // tiles dealt to each player

/** Does a hand (count array) contain any tile of `suit`? */
function handHasSuit(counts, suit) {
  for (let r = 0; r < TILES_PER_SUIT; r++) {
    if (counts[suit * TILES_PER_SUIT + r] > 0) return true;
  }
  return false;
}

class Player {
  constructor(seat) {
    this.seat = seat;
    this.id = null; // external player/connection id
    this.name = `Seat${seat}`;
    this.connected = false;

    this.concealed = new Array(NUM_TILES).fill(0); // hand tiles
    this.melds = []; // [{type, tile, from}]
    this.missingSuit = null; // 0..2 (定缺)

    this.hasWon = false;
    this.winRecords = []; // every win this player scored this hand
    this.score = 0; // running points across the hand

    this.gangReceived = []; // {points, from} for 退税 refunds
  }

  handTileCount() {
    return countTotal(this.concealed);
  }

  reset() {
    this.concealed = new Array(NUM_TILES).fill(0);
    this.melds = [];
    this.missingSuit = null;
    this.hasWon = false;
    this.winRecords = [];
    this.gangReceived = [];
  }
}

export class Game extends EventEmitter {
  constructor(options = {}) {
    super();
    this.rules = { ...DEFAULT_RULES, ...(options.rules || {}) };
    // Deep-merge the nested fan/gang tables if the caller overrides them.
    this.rules.fan = { ...DEFAULT_RULES.fan, ...(options.rules?.fan || {}) };
    this.rules.gang = { ...DEFAULT_RULES.gang, ...(options.rules?.gang || {}) };

    this.seed = options.seed; // optional, for reproducible games
    this.players = Array.from({ length: NUM_PLAYERS }, (_, s) => new Player(s));
    this.dealer = options.dealer ?? 0; // 庄家 seat

    this.phase = Phase.WAITING;
    this.turnState = null;
    this.currentSeat = this.dealer;

    this.wall = null;
    this.lastDiscard = null; // {seat, tile}
    this.lastDrawnTile = null; // tile id of the most recent self-draw
    this.afterKong = false; // current draw is a kong replacement
    this.afterKongDiscardPending = false; // the upcoming discard follows a kong

    this.pendingClaims = null; // claim resolution state, see _openClaims
    this.winnersCount = 0;
    this.log = [];
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  seatPlayer(seat, { id, name } = {}) {
    const p = this.players[seat];
    p.id = id ?? p.id;
    p.name = name ?? p.name;
    p.connected = true;
    return p;
  }

  _emit(type, payload = {}) {
    const event = { type, ...payload };
    this.log.push(event);
    this.emit('event', event);
    this.emit(type, payload);
  }

  /** Deal a fresh hand and move to the 定缺 phase. */
  start() {
    if (this.phase !== Phase.WAITING && this.phase !== Phase.SETTLED) {
      throw new Error(`cannot start from phase ${this.phase}`);
    }
    for (const p of this.players) {
      p.reset();
      p.score = 0;
    }
    this.wall = new Wall({ seed: this.seed });
    this.phase = Phase.DEALING;
    this.winnersCount = 0;
    this.lastDiscard = null;
    this.afterKong = false;
    this.afterKongDiscardPending = false;
    this.pendingClaims = null;

    for (let n = 0; n < HAND_SIZE; n++) {
      for (let s = 0; s < NUM_PLAYERS; s++) {
        this.players[s].concealed[this.wall.draw()]++;
      }
    }

    this.phase = Phase.CHOOSING_SUIT;
    this._emit('dealt', {});
    this._emit('phase', { phase: this.phase });
    return this;
  }

  /** 定缺: each player declares the suit they will void (0=wan,1=tong,2=tiao). */
  chooseMissingSuit(seat, suit) {
    if (this.phase !== Phase.CHOOSING_SUIT) throw new Error('not in choosing phase');
    if (suit < 0 || suit > 2) throw new Error('invalid suit');
    const p = this.players[seat];
    if (p.missingSuit != null) throw new Error('suit already chosen');
    p.missingSuit = suit;
    this._emit('suitChosen', { seat, suit });

    if (this.players.every((pl) => pl.missingSuit != null)) {
      this.phase = Phase.PLAYING;
      this._emit('phase', { phase: this.phase });
      this._beginTurn(this.dealer, /*draw*/ true);
    }
    return this;
  }

  // ---------------------------------------------------------------------------
  // Turn loop
  // ---------------------------------------------------------------------------

  _activeSeats() {
    return this.players.filter((p) => !p.hasWon).map((p) => p.seat);
  }

  _nextActiveSeat(from) {
    for (let i = 1; i <= NUM_PLAYERS; i++) {
      const s = (from + i) % NUM_PLAYERS;
      if (!this.players[s].hasWon) return s;
    }
    return null;
  }

  /** Start `seat`'s turn. If `draw`, pull a tile for them first. */
  _beginTurn(seat, draw) {
    this.currentSeat = seat;
    if (draw) {
      const tile = this.afterKong ? this.wall.drawReplacement() : this.wall.draw();
      if (tile == null) {
        // Wall exhausted with no tile to draw -> exhaustive draw.
        this._exhaustiveDraw();
        return;
      }
      this.players[seat].concealed[tile]++;
      this.lastDrawnTile = tile;
      this.turnState = TurnState.DISCARD;
      this.afterKongDiscardPending = this.afterKong;
      this._emit('draw', { seat, tile, wall: this.wall.remaining });
      // Reset afterKong now that the replacement has been drawn; the "after
      // kong" property still applies to a self-draw win this turn, which we
      // capture via afterKongDiscardPending below.
      const wasAfterKong = this.afterKong;
      this.afterKong = false;
      this._emitActions(seat, { drewTile: tile, afterKong: wasAfterKong });
    } else {
      this.turnState = TurnState.DISCARD;
      this._emit('turn', { seat });
      this._emitActions(seat, {});
    }
  }

  /** Emit the set of legal actions for the seat to act now. */
  _emitActions(seat, ctx) {
    this._emit('actions', { seat, actions: this.getAvailableActions(seat), ...ctx });
  }

  /**
   * Legal actions for `seat` given the current state. Used by clients/bots and
   * for validation.
   */
  getAvailableActions(seat) {
    const p = this.players[seat];
    if (this.phase !== Phase.PLAYING) return [];

    // A pending claim window: only the eligible claimers may act.
    if (this.turnState === TurnState.CLAIMS && this.pendingClaims) {
      const e = this.pendingClaims.eligible[seat];
      if (!e || this.pendingClaims.responses[seat] != null) return [];
      return [...e, Action.PASS];
    }

    if (this.turnState === TurnState.DISCARD && seat === this.currentSeat) {
      const actions = [Action.DISCARD];
      // Self-draw win (自摸)?
      if (this._canSelfHu(seat)) actions.push(Action.HU);
      // Any concealed/added kong available?
      if (this._availableSelfKongs(seat).length > 0) actions.push(Action.GANG);
      return actions;
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // Action entry point
  // ---------------------------------------------------------------------------

  act(seat, action, payload = {}) {
    if (this.phase !== Phase.PLAYING) throw new Error('game not in play');
    switch (action) {
      case Action.DISCARD:
        return this._actDiscard(seat, payload.tile);
      case Action.PENG:
        return this._actClaim(seat, Action.PENG, payload);
      case Action.GANG:
        // Gang during your own discard turn = self kong; during a claim = ming gang.
        if (this.turnState === TurnState.DISCARD && seat === this.currentSeat) {
          return this._actSelfKong(seat, payload.tile);
        }
        return this._actClaim(seat, Action.GANG, payload);
      case Action.HU:
        if (this.turnState === TurnState.DISCARD && seat === this.currentSeat) {
          return this._actSelfHu(seat);
        }
        return this._actClaim(seat, Action.HU, payload);
      case Action.PASS:
        return this._actClaim(seat, Action.PASS, payload);
      default:
        throw new Error(`unknown action ${action}`);
    }
  }

  // ---- Discard ----

  _actDiscard(seat, tile) {
    if (this.turnState !== TurnState.DISCARD || seat !== this.currentSeat) {
      throw new Error('not your discard');
    }
    const p = this.players[seat];
    if (tile == null || p.concealed[tile] <= 0) throw new Error('tile not in hand');

    // 定缺 enforcement: if the player still holds tiles of their missing suit
    // they must discard those first.
    if (handHasSuit(p.concealed, p.missingSuit) && suitOf(tile) !== p.missingSuit) {
      throw new Error('must discard your missing-suit tiles first (定缺)');
    }

    p.concealed[tile]--;
    const afterKong = this.afterKongDiscardPending;
    this.afterKongDiscardPending = false;
    this.lastDiscard = { seat, tile, afterKong };
    this._emit('discard', { seat, tile, afterKong });

    this._openClaims(seat, tile, { robKong: false, afterKong });
    return this;
  }

  // ---- Claim window after a discard (or a rob-kong window) ----

  /**
   * Open a claim window on `tile` discarded/declared by `fromSeat`.
   * Computes which other active players may peng/gang/hu and waits for them.
   */
  _openClaims(fromSeat, tile, { robKong, afterKong, gangSeat }) {
    const eligible = {};
    for (const s of this._activeSeats()) {
      if (s === fromSeat) continue;
      const acts = [];
      const p = this.players[s];

      // HU on the discard (点炮). For a rob-kong window only HU is offered.
      if (this._canClaimHu(s, tile)) acts.push(Action.HU);

      if (!robKong) {
        // Kong (直杠): needs three identical concealed tiles.
        if (p.concealed[tile] >= 3) acts.push(Action.GANG);
        // Peng (碰): needs two identical concealed tiles. Skip if the tile is
        // the player's missing suit (they may not build melds in that suit).
        else if (p.concealed[tile] >= 2 && suitOf(tile) !== p.missingSuit) {
          acts.push(Action.PENG);
        } else if (p.concealed[tile] >= 2 && suitOf(tile) === p.missingSuit) {
          // cannot peng your void suit; ignore
        }
      }

      if (acts.length > 0) eligible[s] = acts;
    }

    if (Object.keys(eligible).length === 0) {
      // Nobody can claim -> proceed.
      if (robKong) {
        this._completeBuGang(gangSeat, tile);
      } else {
        this._advanceAfterDiscard(fromSeat);
      }
      return;
    }

    this.turnState = TurnState.CLAIMS;
    this.pendingClaims = {
      fromSeat,
      tile,
      robKong: !!robKong,
      afterKong: !!afterKong,
      gangSeat: gangSeat ?? null,
      eligible,
      responses: {},
    };
    this._emit('claims', {
      fromSeat,
      tile,
      robKong: !!robKong,
      eligible: Object.fromEntries(Object.entries(eligible)),
    });
    // Notify each eligible seat of its options.
    for (const s of Object.keys(eligible)) {
      this._emitActions(Number(s), { claimTile: tile, robKong: !!robKong });
    }
  }

  _actClaim(seat, action, payload) {
    if (this.turnState !== TurnState.CLAIMS || !this.pendingClaims) {
      throw new Error('no claim in progress');
    }
    const pc = this.pendingClaims;
    const allowed = pc.eligible[seat];
    if (!allowed) throw new Error('you are not eligible to claim');
    if (pc.responses[seat] != null) throw new Error('already responded');
    if (action !== Action.PASS && !allowed.includes(action)) {
      throw new Error(`cannot ${action} here`);
    }
    pc.responses[seat] = action;
    this._emit('claimResponse', { seat, action });

    this._tryResolveClaims();
    return this;
  }

  /** Resolve the claim window once every eligible player has responded. */
  _tryResolveClaims() {
    const pc = this.pendingClaims;
    const eligibleSeats = Object.keys(pc.eligible).map(Number);
    const allResponded = eligibleSeats.every((s) => pc.responses[s] != null);
    if (!allResponded) return;

    // Priority: HU > GANG > PENG. Multiple HU allowed (一炮多响).
    const huSeats = eligibleSeats.filter((s) => pc.responses[s] === Action.HU);
    const gangSeat = eligibleSeats.find((s) => pc.responses[s] === Action.GANG);
    const pengSeat = eligibleSeats.find((s) => pc.responses[s] === Action.PENG);

    this.turnState = null;
    const tile = pc.tile;
    const fromSeat = pc.fromSeat;
    const wasRobKong = pc.robKong;
    const wasAfterKong = pc.afterKong;
    const gangOwner = pc.gangSeat;
    this.pendingClaims = null;

    if (huSeats.length > 0) {
      // Order winners by seat distance after the discarder (closest pays-first).
      huSeats.sort((a, b) => ((a - fromSeat + 4) % 4) - ((b - fromSeat + 4) % 4));
      for (const s of huSeats) {
        this._applyWin(s, tile, {
          selfDraw: false,
          fromSeat,
          robKong: wasRobKong,
          afterKong: wasAfterKong,
          lastTile: this.wall.remaining === 0,
        });
      }
      if (wasRobKong) {
        // The kong was robbed; the would-be konger keeps the tile gone.
        this._emit('kongRobbed', { gangSeat: gangOwner, tile });
      }
      if (this._maybeEndHand()) return;
      // Continue play: next active seat after the discarder draws.
      const next = this._nextActiveSeat(fromSeat);
      if (next == null) return;
      this._beginTurn(next, true);
      return;
    }

    if (wasRobKong) {
      // Nobody robbed -> the bu gang completes.
      this._completeBuGang(gangOwner, tile);
      return;
    }

    if (gangSeat != null) {
      this._applyMingGang(gangSeat, fromSeat, tile);
      return;
    }
    if (pengSeat != null) {
      this._applyPeng(pengSeat, fromSeat, tile);
      return;
    }

    // Everyone passed -> next player draws.
    this._advanceAfterDiscard(fromSeat);
  }

  _advanceAfterDiscard(fromSeat) {
    const next = this._nextActiveSeat(fromSeat);
    if (next == null) {
      this._exhaustiveDraw();
      return;
    }
    this._beginTurn(next, true);
  }

  // ---------------------------------------------------------------------------
  // Peng / Gang
  // ---------------------------------------------------------------------------

  _applyPeng(seat, fromSeat, tile) {
    const p = this.players[seat];
    p.concealed[tile] -= 2;
    p.melds.push({ type: MeldType.PENG, tile, from: fromSeat });
    this._emit('peng', { seat, tile, from: fromSeat });
    // The penger must now discard (no draw).
    this.currentSeat = seat;
    this.turnState = TurnState.DISCARD;
    this.afterKongDiscardPending = false;
    this._emitActions(seat, {});
  }

  /** 直杠/明杠: claim a discard to form a kong. */
  _applyMingGang(seat, fromSeat, tile) {
    const p = this.players[seat];
    p.concealed[tile] -= 3;
    p.melds.push({ type: MeldType.MING_GANG, tile, from: fromSeat });
    this._emit('gang', { seat, tile, kind: MeldType.MING_GANG, from: fromSeat });
    this._payMingGang(seat, fromSeat);
    if (this._maybeEndHand()) return;
    // Konger draws a replacement tile.
    this.afterKong = true;
    this._beginTurn(seat, true);
  }

  /** Concealed (暗杠) and added (补杠) kongs initiated on your own turn. */
  _availableSelfKongs(seat) {
    const p = this.players[seat];
    const kongs = [];
    // 暗杠: four concealed copies.
    for (let id = 0; id < NUM_TILES; id++) {
      if (p.concealed[id] === 4) kongs.push({ kind: MeldType.AN_GANG, tile: id });
    }
    // 补杠: a concealed copy matching an existing peng.
    for (const m of p.melds) {
      if (m.type === MeldType.PENG && p.concealed[m.tile] >= 1) {
        kongs.push({ kind: MeldType.BU_GANG, tile: m.tile });
      }
    }
    // 定缺: cannot kong tiles of the missing suit.
    return kongs.filter((k) => suitOf(k.tile) !== p.missingSuit);
  }

  _actSelfKong(seat, tile) {
    const options = this._availableSelfKongs(seat);
    const choice = tile == null ? options[0] : options.find((o) => o.tile === tile);
    if (!choice) throw new Error('no such kong available');
    const p = this.players[seat];

    if (choice.kind === MeldType.AN_GANG) {
      p.concealed[choice.tile] -= 4;
      p.melds.push({ type: MeldType.AN_GANG, tile: choice.tile, from: seat });
      this._emit('gang', { seat, tile: choice.tile, kind: MeldType.AN_GANG });
      this._payAnGang(seat);
      if (this._maybeEndHand()) return this;
      this.afterKong = true;
      this._beginTurn(seat, true);
      return this;
    }

    // 补杠 — open a rob-kong window before completing.
    this._emit('gangDeclared', { seat, tile: choice.tile, kind: MeldType.BU_GANG });
    this.lastDiscard = { seat, tile: choice.tile, afterKong: false };
    this._openClaims(seat, choice.tile, { robKong: true, afterKong: false, gangSeat: seat });
    return this;
  }

  _completeBuGang(seat, tile) {
    const p = this.players[seat];
    const meld = p.melds.find((m) => m.type === MeldType.PENG && m.tile === tile);
    if (!meld) throw new Error('no peng to upgrade');
    meld.type = MeldType.BU_GANG;
    p.concealed[tile] -= 1;
    this._emit('gang', { seat, tile, kind: MeldType.BU_GANG });
    this._payBuGang(seat);
    if (this._maybeEndHand()) return;
    this.afterKong = true;
    this._beginTurn(seat, true);
  }

  // ---- Kong payments (刮风下雨) ----

  _recordGang(receiver, from, points) {
    this.players[receiver].score += points;
    this.players[from].score -= points;
    this.players[receiver].gangReceived.push({ points, from });
    this._emit('gangPay', { to: receiver, from, points });
  }

  _payAnGang(seat) {
    const pts = this.rules.gang.anGang;
    for (const s of this._activeSeats()) {
      if (s !== seat) this._recordGang(seat, s, pts);
    }
  }

  _payBuGang(seat) {
    const pts = this.rules.gang.buGang;
    for (const s of this._activeSeats()) {
      if (s !== seat) this._recordGang(seat, s, pts);
    }
  }

  _payMingGang(seat, fromSeat) {
    const pts = this.rules.gang.mingGang;
    if (this.rules.gang.mingGangPaidByDiscarder) {
      // The player who discarded the konged tile pays for all three.
      this._recordGang(seat, fromSeat, pts * 3);
    } else {
      for (const s of this._activeSeats()) {
        if (s !== seat) this._recordGang(seat, s, pts);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Winning
  // ---------------------------------------------------------------------------

  /** Validate a self-draw (自摸) win for the seat about to act. */
  _canSelfHu(seat) {
    const p = this.players[seat];
    if (handHasSuit(p.concealed, p.missingSuit)) return false;
    return evaluateWin(p.concealed, p.melds.length).win;
  }

  _actSelfHu(seat) {
    if (!this._canSelfHu(seat)) throw new Error('not a winning hand');
    this._applyWin(seat, this.lastDrawnTile, {
      selfDraw: true,
      fromSeat: null,
      robKong: false,
      afterKong: this.afterKongDiscardPending,
      lastTile: this.wall.remaining === 0,
    });
    if (this._maybeEndHand()) return this;
    const next = this._nextActiveSeat(seat);
    if (next == null) return this;
    this._beginTurn(next, true);
    return this;
  }

  /** Validate a discard/rob-kong win on `tile` for `seat`. */
  _canClaimHu(seat, tile) {
    const p = this.players[seat];
    if (p.hasWon) return false;
    if (suitOf(tile) === p.missingSuit) return false; // 定缺
    if (handHasSuit(p.concealed, p.missingSuit)) return false;
    p.concealed[tile]++;
    const ok = evaluateWin(p.concealed, p.melds.length).win;
    p.concealed[tile]--;
    return ok;
  }

  /**
   * Apply a win for `seat`. `tile` is the winning tile (already in hand for a
   * self-draw; added here for a discard win). Handles scoring + payment.
   */
  _applyWin(seat, tile, ctx) {
    const p = this.players[seat];
    if (!ctx.selfDraw) p.concealed[tile]++; // include the claimed tile

    const score = scoreWin({
      concealed: p.concealed,
      melds: p.melds,
      selfDraw: ctx.selfDraw,
      afterKong: ctx.afterKong,
      robKong: ctx.robKong,
      lastTile: ctx.lastTile,
      rules: this.rules,
    });

    if (!score.win) {
      // Should not happen (we validated), but guard anyway.
      if (!ctx.selfDraw) p.concealed[tile]--;
      throw new Error('scoreWin disagreed with win validation');
    }

    // Settlement.
    const record = {
      seat,
      tile,
      selfDraw: ctx.selfDraw,
      from: ctx.fromSeat,
      points: score.points,
      fan: score.fan,
      cappedFan: score.cappedFan,
      patterns: score.patterns,
    };

    if (ctx.selfDraw) {
      // Every other still-playing player pays.
      for (const s of this._activeSeats()) {
        if (s === seat) continue;
        this.players[s].score -= score.points;
        p.score += score.points;
      }
    } else {
      // Only the discarder pays (点炮).
      this.players[ctx.fromSeat].score -= score.points;
      p.score += score.points;
    }

    p.hasWon = true;
    p.winRecords.push(record);
    this.winnersCount += 1;
    this._emit('hu', record);
  }

  // ---------------------------------------------------------------------------
  // End of hand
  // ---------------------------------------------------------------------------

  /** End the hand when the blood battle is over (only one player left). */
  _maybeEndHand() {
    const stillPlaying = this._activeSeats();
    if (this.rules.bloodyBattle) {
      if (stillPlaying.length <= 1) {
        this._settle('bloodyBattleOver');
        return true;
      }
      return false;
    }
    // Non-blood variant: first win ends the hand.
    if (this.winnersCount >= 1) {
      this._settle('firstWin');
      return true;
    }
    return false;
  }

  /** Exhaustive draw (流局): nobody can draw any more tiles. */
  _exhaustiveDraw() {
    if (this.rules.checkTingOnDraw) this._checkTingAndHuaZhu();
    this._settle('exhaustiveDraw');
  }

  /**
   * 查大叫 / 花猪 settlement on an exhaustive draw.
   *
   *  - 花猪 (hua zhu): a non-winner still holding all three suits pays every
   *    other non-hua player the capped score.
   *  - 查大叫: among the remaining non-winners, players who are 听牌 (ting)
   *    collect their best hand value from each non-ting non-hua player.
   *  - 退税: a non-ting / hua-zhu player refunds any kong points they took.
   */
  _checkTingAndHuaZhu() {
    const losers = this.players.filter((p) => !p.hasWon);

    // Classify.
    for (const p of losers) {
      p._huaZhu =
        handHasSuit(p.concealed, 0) &&
        handHasSuit(p.concealed, 1) &&
        handHasSuit(p.concealed, 2);
      p._ting = !p._huaZhu && isTenpai(p.concealed, p.melds.length, p.missingSuit);
    }

    const huaZhu = losers.filter((p) => p._huaZhu);
    const ting = losers.filter((p) => p._ting);
    const notTing = losers.filter((p) => !p._ting && !p._huaZhu);

    const cap = this.rules.baseScore * Math.pow(2, Math.min(this.rules.huaZhuPenaltyFan, this.rules.fanCap));

    // 花猪 pays everyone else (winners included? commonly pays the not-hua players).
    for (const hz of huaZhu) {
      const payees = this.players.filter((p) => p !== hz && !p._huaZhu);
      for (const payee of payees) {
        hz.score -= cap;
        payee.score += cap;
        this._emit('huaZhu', { seat: hz.seat, to: payee.seat, points: cap });
      }
    }

    // 查大叫: each not-ting player pays each ting player that ting player's best value.
    for (const t of ting) {
      const best = this._bestTingValue(t);
      for (const nt of notTing) {
        nt.score -= best;
        t.score += best;
        this._emit('chaDaJiao', { from: nt.seat, to: t.seat, points: best });
      }
    }

    // 退税: not-ting / hua-zhu refund kong points they received this hand.
    for (const p of [...notTing, ...huaZhu]) {
      for (const g of p.gangReceived) {
        p.score -= g.points;
        this.players[g.from].score += g.points;
        this._emit('tuiShui', { seat: p.seat, to: g.from, points: g.points });
      }
      p.gangReceived = [];
    }
  }

  /** Best winning value a ting player could achieve, for 查大叫. */
  _bestTingValue(p) {
    const wins = winningTiles(p.concealed, p.melds.length, p.missingSuit);
    let best = this.rules.baseScore; // at minimum a base hand
    for (const id of wins) {
      p.concealed[id]++;
      const s = scoreWin({
        concealed: p.concealed,
        melds: p.melds,
        selfDraw: false,
        afterKong: false,
        robKong: false,
        lastTile: false,
        rules: this.rules,
      });
      p.concealed[id]--;
      if (s.win && s.points > best) best = s.points;
    }
    return best;
  }

  _settle(reason) {
    this.phase = Phase.SETTLED;
    this.turnState = null;
    const scores = this.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      score: p.score,
      hasWon: p.hasWon,
      wins: p.winRecords,
    }));
    this._emit('settled', { reason, scores });
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  /** Public state safe to broadcast (no concealed hands). */
  getPublicState() {
    return {
      phase: this.phase,
      turnState: this.turnState,
      currentSeat: this.currentSeat,
      dealer: this.dealer,
      wallRemaining: this.wall ? this.wall.remaining : 0,
      lastDiscard: this.lastDiscard,
      winnersCount: this.winnersCount,
      players: this.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        connected: p.connected,
        missingSuit: p.missingSuit,
        melds: p.melds,
        handCount: p.handTileCount(),
        hasWon: p.hasWon,
        score: p.score,
      })),
      pendingClaim: this.pendingClaims
        ? {
            tile: this.pendingClaims.tile,
            fromSeat: this.pendingClaims.fromSeat,
            robKong: this.pendingClaims.robKong,
            waitingOn: Object.keys(this.pendingClaims.eligible)
              .map(Number)
              .filter((s) => this.pendingClaims.responses[s] == null),
          }
        : null,
    };
  }

  /** Private view for one seat, including their concealed tiles. */
  getPlayerState(seat) {
    const p = this.players[seat];
    return {
      ...this.getPublicState(),
      seat,
      hand: countsToIds(p.concealed),
      handNames: countsToIds(p.concealed).map(tileName),
      missingSuit: p.missingSuit,
      availableActions: this.getAvailableActions(seat),
    };
  }
}

export { Player, HAND_SIZE, NUM_PLAYERS };
