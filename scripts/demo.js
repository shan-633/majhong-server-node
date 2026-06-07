/**
 * Console demo: deal a hand, let four bots play it out, and print a readable
 * narrative of the game plus the final settlement. Run with `npm run demo`.
 *
 * Pass a seed for a reproducible game: `node scripts/demo.js 42`
 */

import { Game } from '../src/game.js';
import { playOut } from '../src/bot.js';
import { tileName, SUIT_NAMES_CN } from '../src/tiles.js';

const seed = process.argv[2] ? Number(process.argv[2]) : Math.floor(Math.random() * 1e9);
const game = new Game({ seed });

const seatLabel = (s) => (s == null ? '—' : `P${s}`);

game.on('event', (e) => {
  switch (e.type) {
    case 'dealt':
      console.log(`\n=== New hand (seed ${seed}) ===`);
      break;
    case 'suitChosen':
      console.log(`定缺  ${seatLabel(e.seat)} voids ${SUIT_NAMES_CN[e.suit]}`);
      break;
    case 'draw':
      // Comment out for less noise; kept terse.
      break;
    case 'discard':
      console.log(`打牌  ${seatLabel(e.seat)} discards ${tileName(e.tile)}`);
      break;
    case 'peng':
      console.log(`碰    ${seatLabel(e.seat)} pengs ${tileName(e.tile)} (from ${seatLabel(e.from)})`);
      break;
    case 'gang':
      console.log(`杠    ${seatLabel(e.seat)} ${e.kind} ${tileName(e.tile)}`);
      break;
    case 'gangPay':
      console.log(`刮风下雨  ${seatLabel(e.from)} -> ${seatLabel(e.to)}: ${e.points}`);
      break;
    case 'hu':
      console.log(
        `胡!   ${seatLabel(e.seat)} ${e.selfDraw ? '自摸' : `点炮(${seatLabel(e.from)})`} ` +
          `${tileName(e.tile)}  +${e.points}  [${e.patterns.join(', ')}]`
      );
      break;
    case 'huaZhu':
      console.log(`花猪  ${seatLabel(e.seat)} -> ${seatLabel(e.to)}: ${e.points}`);
      break;
    case 'chaDaJiao':
      console.log(`查叫  ${seatLabel(e.from)} -> ${seatLabel(e.to)}: ${e.points}`);
      break;
    case 'tuiShui':
      console.log(`退税  ${seatLabel(e.seat)} -> ${seatLabel(e.to)}: ${e.points}`);
      break;
    case 'settled':
      console.log(`\n=== Settled (${e.reason}) ===`);
      for (const s of e.scores) {
        console.log(
          `  ${seatLabel(s.seat)} ${s.hasWon ? '✓' : ' '}  score ${s.score >= 0 ? '+' : ''}${s.score}`
        );
      }
      break;
    default:
      break;
  }
});

playOut(game, { takePeng: true, takeGang: true });
