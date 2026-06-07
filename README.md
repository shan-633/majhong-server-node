# Sichuan Mahjong Server (四川血战到底麻将)

A complete game server for **Sichuan Mahjong** — the popular *血战到底*
("Bloody Battle to the End") variant — written in modern Node.js (ESM).

It implements the full rules engine, a four-bot self-play driver, a Socket.IO
realtime layer, and a minimal browser client for manual play.

```
┌─────────────┐   socket.io    ┌────────────────────────────────────────────┐
│  Browser /  │ ◀────────────▶ │  server.js  ──  room.js  ──  game.js        │
│  bot client │                │                  │           ├─ win.js      │
└─────────────┘                │              RoomManager     ├─ scoring.js  │
                               │                              ├─ wall.js     │
                               │                              └─ tiles.js    │
                               └────────────────────────────────────────────┘
```

## Rules implemented

Sichuan Mahjong differs from standard mahjong in several important ways, all of
which the engine models:

- **Three suits only** — 万 (characters), 筒 (dots), 条 (bamboo), ranks 1–9,
  four copies each = **108 tiles**. No winds, dragons, flowers or seasons.
- **定缺 (choose a void suit)** — before play, every player declares one suit
  they will discard down to zero. You may never meld or win using that suit, and
  must shed those tiles before any others.
- **No chi (吃)** — you cannot claim a discard to form a sequence. Only
  **peng (碰)** and the three kongs are claimable.
- **Kongs (杠)**:
  - 暗杠 (concealed) — four in hand,
  - 直杠/明杠 (direct) — claimed from a discard,
  - 补杠/巴杠 (added) — upgrade an existing peng.
- **抢杠胡 (rob the kong)** — another player may win on the tile of an added
  kong.
- **血战到底 (bloody battle)** — the hand does **not** end at the first win; it
  continues until **three** players have won (or the wall is exhausted).
- **一炮多响** — a single discard can be won by multiple players at once.
- **杠上花 / 杠上炮 / 海底捞月** — situational bonus hands.
- **End-of-hand settlement on a draw**: 查大叫 (pay the listening players),
  花猪 (penalty for still holding all three suits), and 退税 (refund kong
  points if you end up not listening).

### Scoring (番 / fan)

Points use the common doubling model:

```
points = baseScore × 2 ^ min(totalFan, fanCap)
```

Recognised patterns include 平胡, 碰碰胡, 清一色, 七对, 龙七对, 金钩钓, 根
(per four-of-a-kind), 自摸, and the situational bonuses above. Kong payments
(刮风下雨) are settled immediately and separately.

**Everything is configurable.** See `src/constants.js` (`DEFAULT_RULES`) — fan
values, the cap (封顶), kong payments, and toggles for blood battle / draw
checks can all be overridden per room:

```js
new Game({ rules: { fanCap: 3, fan: { qingYiSe: 3 }, bloodyBattle: true } });
```

## Project layout

| File | Responsibility |
|------|----------------|
| `src/tiles.js`     | Tile model and the length-27 count-array representation |
| `src/win.js`       | Win detection (`evaluateWin`, `winningTiles`, 七对/龙七对) |
| `src/scoring.js`   | Fan counting and point calculation for a win |
| `src/wall.js`      | Shuffled 108-tile wall (seedable PRNG for reproducible games) |
| `src/constants.js` | Enums + `DEFAULT_RULES` |
| `src/game.js`      | The engine: dealing, turn loop, peng/gang, wins, settlement |
| `src/bot.js`       | A simple rule-based bot + a `playOut` self-play driver |
| `src/room.js`      | Room / seat management, bot filling, personalised state |
| `src/server.js`    | Socket.IO + static-file HTTP server |
| `public/index.html`| Minimal browser client |
| `scripts/demo.js`  | Console self-play demo |
| `test/*.test.js`   | `node:test` suites (win, scoring, full games, rooms) |

## Quick start

```bash
npm install          # installs socket.io
npm test             # run the full test suite (node:test, no network needed)
npm run demo         # play one hand with four bots in the console
npm run demo 42      # ...with a fixed seed for a reproducible game
npm start            # start the realtime server on http://localhost:3000
```

Then open `http://localhost:3000` in one or more browser tabs, **Join** the same
room, and click **Start (fill bots)**. Empty seats are filled with bots, so a
single human can play immediately.

## Realtime protocol

Client → server:

| Event | Payload | Effect |
|-------|---------|--------|
| `room:join`       | `{ room?, name? }`        | Seat the connection; replies `joined` + `state` |
| `room:start`      | `{ fillBots? }`           | Deal tiles; fill empty seats with bots |
| `game:chooseSuit` | `{ suit }` (0/1/2)        | Declare your 定缺 void suit |
| `game:action`     | `{ action, tile? }`       | `discard` / `peng` / `gang` / `hu` / `pass` |
| `game:state`      | —                         | Request a fresh personal state |

Server → client:

| Event | Payload |
|-------|---------|
| `joined` | `{ room, seat }` |
| `state`  | Personalised game state (your tiles + everyone's public info) |
| `event`  | Engine log entries (`discard`, `peng`, `gang`, `hu`, `settled`, …) |
| `error`  | `{ message }` |

## Programmatic use

The engine is transport-agnostic and easy to embed:

```js
import { Game } from './src/game.js';
import { playOut } from './src/bot.js';

const game = new Game({ seed: 7 });
game.on('hu', (e) => console.log('win!', e.patterns, e.points));
const settlement = playOut(game, { takePeng: true, takeGang: true });
console.log(settlement.scores);
```

## Testing

```bash
npm test
```

The suite covers win detection (standard / 七对 / 龙七对 / 定缺), fan scoring and
the cap, and full self-played games asserting key invariants — most importantly
that **every hand is zero-sum** across all four players and that winners never
hold their void suit. Tests use Node's built-in `node:test` runner and require
no network access.

## License

MIT
