const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');

const app = express();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "https:", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https:", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: [],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
    },
  },
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 8192,
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const socketRooms = new Map();

const MAX_OPTIONS_PER_ROOM = 20;
const MAX_OPTION_LENGTH = 20;
const MAX_SOCKETS_PER_ROOM = 50;
const MAX_ROOMS_PER_SOCKET = 1;
const DECISION_TIMEOUT_MS = 20000;
const COOLDOWN_MS = 10000;

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function pickWinner(options) {
  const bytes = crypto.randomBytes(4);
  const idx = bytes.readUInt32BE(0) % options.length;
  return options[idx];
}

function getPublicState(room) {
  return {
    code: room.code,
    options: [...room.options],
    mode: room.mode,
    busy: room.busy,
  };
}

const rateCounts = new Map();

function checkRateLimit(socket) {
  const now = Date.now();
  if (!rateCounts.has(socket.id)) {
    rateCounts.set(socket.id, []);
  }
  const timestamps = rateCounts.get(socket.id);
  const cutoff = now - 10000;
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }
  if (timestamps.length >= 30) {
    return false;
  }
  timestamps.push(now);
  return true;
}

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  socket.on('create-room', (_, callback) => {
    if (!checkRateLimit(socket)) {
      callback({ error: 'Demasiadas solicitudes. Espera un momento.' });
      return;
    }
    if ((socketRooms.get(socket.id)?.size || 0) >= MAX_ROOMS_PER_SOCKET) {
      callback({ error: 'Ya tienes una sala activa.' });
      return;
    }

    let code;
    do {
      code = generateCode();
    } while (rooms.has(code));

    const room = {
      code,
      options: ['OPCIÓN A', 'OPCIÓN B', 'OPCIÓN C', 'OPCIÓN D'],
      mode: 'slot',
      busy: false,
      host: socket.id,
      sockets: new Set(),
      busyTimeout: null,
      cooldownTimeout: null,
    };

    rooms.set(code, room);
    socket.join(code);
    room.sockets.add(socket.id);
    socket._roomCode = code;

    if (!socketRooms.has(socket.id)) {
      socketRooms.set(socket.id, new Set());
    }
    socketRooms.get(socket.id).add(code);

    console.log(`  Room ${code} created by ${socket.id}`);
    callback({ success: true, code, state: getPublicState(room) });
  });

  socket.on('join-room', (code, callback) => {
    if (!checkRateLimit(socket)) {
      callback({ error: 'Demasiadas solicitudes. Espera un momento.' });
      return;
    }

    const roomCode = code?.toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      callback({ error: 'Sala no encontrada' });
      return;
    }

    if (room.sockets.size >= MAX_SOCKETS_PER_ROOM) {
      callback({ error: 'La sala está llena.' });
      return;
    }

    socket.join(roomCode);
    room.sockets.add(socket.id);
    socket._roomCode = roomCode;

    if (!socketRooms.has(socket.id)) {
      socketRooms.set(socket.id, new Set());
    }
    socketRooms.get(socket.id).add(roomCode);

    console.log(`  ${socket.id} joined room ${code}`);
    callback({ success: true, state: getPublicState(room) });
  });

  socket.on('add-option', (option) => {
    if (!checkRateLimit(socket)) return;
    const roomCode = socket._roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.busy) return;
    if (room.options.length >= MAX_OPTIONS_PER_ROOM) return;

    const val = option?.trim()?.toUpperCase();
    if (!val) return;
    if (val.length > MAX_OPTION_LENGTH) return;
    if (room.options.includes(val)) return;

    room.options.push(val);
    io.to(roomCode).emit('state-update', { options: [...room.options] });
  });

  socket.on('remove-option', (index) => {
    if (!checkRateLimit(socket)) return;
    const roomCode = socket._roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.busy) return;

    if (index >= 0 && index < room.options.length) {
      room.options.splice(index, 1);
      io.to(roomCode).emit('state-update', { options: [...room.options] });
    }
  });

  socket.on('trigger-decision', ({ mode }) => {
    if (!checkRateLimit(socket)) return;
    const roomCode = socket._roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (socket.id !== room.host) return;
    if (room.busy) return;
    if (room.options.length < 2) return;

    const winner = pickWinner(room.options);
    room.busy = true;
    room.mode = mode || 'slot';
    room.pendingWinner = winner;

    if (room.busyTimeout) clearTimeout(room.busyTimeout);
    room.busyTimeout = setTimeout(() => {
      if (rooms.has(roomCode) && rooms.get(roomCode).busy) {
        const r = rooms.get(roomCode);
        r.pendingWinner = null;
        r.busyTimeout = null;
        io.to(roomCode).emit('busy-timeout');
        console.log(`  Room ${roomCode} busy timeout (no decision-done received)`);

        if (r.cooldownTimeout) clearTimeout(r.cooldownTimeout);
        r.cooldownTimeout = setTimeout(() => {
          if (rooms.has(roomCode)) {
            r.busy = false;
            r.cooldownTimeout = null;
            io.to(roomCode).emit('cooldown-end');
            console.log(`  Room ${roomCode} cooldown ended after busy timeout`);
          }
        }, COOLDOWN_MS);
      }
    }, DECISION_TIMEOUT_MS);

    io.to(roomCode).emit('decision-start', { mode: room.mode, winner });
  });

  socket.on('decision-done', ({ winner }) => {
    const roomCode = socket._roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (socket.id !== room.host) return;
    if (!room.busy) return;
    if (winner !== room.pendingWinner) return;

    if (room.busyTimeout) {
      clearTimeout(room.busyTimeout);
      room.busyTimeout = null;
    }

    room.pendingWinner = null;
    io.to(roomCode).emit('decision-result', { winner });

    if (room.cooldownTimeout) clearTimeout(room.cooldownTimeout);
    room.cooldownTimeout = setTimeout(() => {
      if (rooms.has(roomCode)) {
        const r = rooms.get(roomCode);
        r.busy = false;
        r.cooldownTimeout = null;
        io.to(roomCode).emit('cooldown-end');
        console.log(`  Room ${roomCode} cooldown ended`);
      }
    }, COOLDOWN_MS);
  });

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id} disconnected`);
    const roomCode = socket._roomCode;
    if (!roomCode) return;

    socketRooms.delete(socket.id);

    const room = rooms.get(roomCode);
    if (!room) return;

    room.sockets.delete(socket.id);

    if (socket.id === room.host && room.sockets.size > 0) {
      const nextHost = [...room.sockets][0];
      room.host = nextHost;
      io.to(roomCode).emit('new-host', { hostId: nextHost });
    }

    if (room.sockets.size === 0) {
      if (room.busyTimeout) {
        clearTimeout(room.busyTimeout);
      }
      if (room.cooldownTimeout) {
        clearTimeout(room.cooldownTimeout);
      }
      setTimeout(() => {
        if (rooms.has(roomCode) && rooms.get(roomCode).sockets.size === 0) {
          rooms.delete(roomCode);
          console.log(`  Room ${roomCode} deleted (empty)`);
        }
      }, 60000);
    }

    io.to(roomCode).emit('room-info', {
      userCount: room.sockets.size,
      host: room.host,
    });
  });
});

server.listen(PORT, () => {
  console.log(`╔══════════════════════════════╗`);
  console.log(`║  AZARAPP SERVER              ║`);
  console.log(`║  http://localhost:${PORT}       ║`);
  console.log(`╚══════════════════════════════╝`);
});
