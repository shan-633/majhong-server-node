/**
 * Socket.IO realtime server for Sichuan Mahjong.
 *
 * Protocol (client -> server events):
 *   - "room:join"   { room?, name? }          -> seats you and returns state
 *   - "room:start"  { fillBots? }             -> deals tiles, fills bots
 *   - "game:chooseSuit" { suit }              -> 定缺 (0=wan,1=tong,2=tiao)
 *   - "game:action" { action, tile? }         -> discard/peng/gang/hu/pass
 *   - "game:state"                            -> request a fresh personal state
 *
 * Server -> client events:
 *   - "joined"  { room, seat }
 *   - "state"   <personal state>              (sent to each player individually)
 *   - "event"   <engine event>                (broadcast game log entry)
 *   - "error"   { message }
 *
 * A minimal static client is served from /public for quick manual testing.
 */

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { Server as SocketIOServer } from 'socket.io';
import { RoomManager } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  // Prevent path traversal outside PUBLIC_DIR.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

export function createServer() {
  const manager = new RoomManager();
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: manager.list() }));
      return;
    }
    serveStatic(req, res);
  });

  const io = new SocketIOServer(httpServer, { cors: { origin: '*' } });

  // Push fresh personal state to every connected socket in a room.
  function broadcastState(room) {
    for (const [socketId] of room.seatBySocket) {
      io.to(socketId).emit('state', room.stateFor(socketId));
    }
  }

  io.on('connection', (socket) => {
    let currentRoom = null;

    const wrap = (fn) => (payload) => {
      try {
        fn(payload || {});
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    };

    socket.on('room:join', wrap(({ room, name }) => {
      const r = manager.getOrCreate(room || 'default', {});
      const seat = r.join(socket.id, name);
      currentRoom = r;
      socket.join(r.id);

      // Relay engine events to this room's sockets, and refresh personal state.
      r.onEvent((event) => {
        io.to(r.id).emit('event', event);
        broadcastState(r);
      });

      socket.emit('joined', { room: r.id, seat });
      socket.emit('state', r.stateFor(socket.id));
    }));

    socket.on('room:start', wrap(({ fillBots = true }) => {
      if (!currentRoom) throw new Error('join a room first');
      currentRoom.start({ fillBots });
      broadcastState(currentRoom);
    }));

    socket.on('game:chooseSuit', wrap(({ suit }) => {
      if (!currentRoom) throw new Error('join a room first');
      currentRoom.chooseMissingSuit(socket.id, suit);
      broadcastState(currentRoom);
    }));

    socket.on('game:action', wrap(({ action, tile }) => {
      if (!currentRoom) throw new Error('join a room first');
      currentRoom.act(socket.id, action, { tile });
      broadcastState(currentRoom);
    }));

    socket.on('game:state', wrap(() => {
      if (!currentRoom) throw new Error('join a room first');
      socket.emit('state', currentRoom.stateFor(socket.id));
    }));

    socket.on('disconnect', () => {
      if (currentRoom) currentRoom.leave(socket.id);
    });
  });

  return { httpServer, io, manager };
}

// Start the server when run directly (`node src/server.js`).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const { httpServer } = createServer();
  httpServer.listen(PORT, () => {
    console.log(`Sichuan Mahjong server listening on http://localhost:${PORT}`);
  });
}
