const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// --- Room state ---
const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getPublicState(room) {
  return {
    code: room.code,
    options: [...room.options],
    mode: room.mode,
    busy: room.busy,
  };
}

// --- Socket.IO ---
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  // --- CREATE ROOM ---
  socket.on('create-room', (_, callback) => {
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
    };

    rooms.set(code, room);
    socket.join(code);
    room.sockets.add(socket.id);
    socket._roomCode = code;

    console.log(`  Room ${code} created by ${socket.id}`);
    callback({ success: true, code, state: getPublicState(room) });
  });

  // --- JOIN ROOM ---
  socket.on('join-room', (code, callback) => {
    const room = rooms.get(code?.toUpperCase());
    if (!room) {
      callback({ error: 'Sala no encontrada' });
      return;
    }

    socket.join(code.toUpperCase());
    room.sockets.add(socket.id);
    socket._roomCode = code.toUpperCase();

    console.log(`  ${socket.id} joined room ${code}`);
    callback({ success: true, state: getPublicState(room) });
  });

  // --- ADD OPTION ---
  socket.on('add-option', (option) => {
    const roomCode = socket._roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.busy) return;

    const val = option?.trim()?.toUpperCase();
    if (!val) return;
    if (room.options.includes(val)) return;

    room.options.push(val);
    io.to(roomCode).emit('state-update', { options: [...room.options] });
  });

  // --- REMOVE OPTION ---
  socket.on('remove-option', (index) => {
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

  // --- TRIGGER DECISION ---
  socket.on('trigger-decision', ({ mode }) => {
    const roomCode = socket._roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.busy) return;
    if (room.options.length < 2) return;

    room.busy = true;
    room.mode = mode || 'slot';

    io.to(roomCode).emit('decision-start', { mode: room.mode });
  });

  // --- DECISION DONE ---
  socket.on('decision-done', ({ winner }) => {
    const roomCode = socket._roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    room.busy = false;
    io.to(roomCode).emit('decision-result', { winner });
  });

  // --- DISCONNECT ---
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id} disconnected`);
    const roomCode = socket._roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    room.sockets.delete(socket.id);

    // If host leaves, transfer host to next person in room
    if (socket.id === room.host && room.sockets.size > 0) {
      const nextHost = [...room.sockets][0];
      room.host = nextHost;
      io.to(roomCode).emit('new-host', { hostId: nextHost });
    }

    // If room is empty, clean up after a delay
    if (room.sockets.size === 0) {
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

// --- START ---
server.listen(PORT, () => {
  console.log(`╔══════════════════════════════╗`);
  console.log(`║  AZARAPP SERVER              ║`);
  console.log(`║  http://localhost:${PORT}       ║`);
  console.log(`╚══════════════════════════════╝`);
});
