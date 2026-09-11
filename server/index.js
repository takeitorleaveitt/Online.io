const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const GameRoom = require('./game/GameRoom');
const C = require('./game/constants');
const { resolvedZones } = require('./game/zones');
const { sanitizeDisplayName } = require('./game/moderation');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 5000,
  pingTimeout: 10000,
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/healthz', (req, res) => res.status(200).send('ok'));
app.get('/api/status', (req, res) => {
  res.json({
    rooms: rooms.map((r) => ({ name: r.name, players: r.playerCount, real: r.realCount, bots: r.botCount })),
  });
});
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// ---------- matchmaking ----------

const rooms = [];
const partyRoomMap = new Map(); // partyCode -> room name
let arenaCounter = 1000;

function createRoom() {
  arenaCounter += 1;
  const room = new GameRoom(io, `arena-${arenaCounter}`);
  room.displayName = `ARENA #${arenaCounter}`;
  room.start();
  rooms.push(room);
  return room;
}

function pickRoomForJoin(partyCode) {
  if (partyCode) {
    const existingName = partyRoomMap.get(partyCode);
    if (existingName) {
      const existing = rooms.find((r) => r.name === existingName);
      if (existing && existing.playerCount < C.MAX_PLAYERS_PER_ROOM) return existing;
    }
  }
  let room = rooms.find((r) => r.playerCount < C.MAX_PLAYERS_PER_ROOM * 0.9);
  if (!room) room = createRoom();
  if (partyCode) partyRoomMap.set(partyCode, room.name);
  return room;
}

if (rooms.length === 0) createRoom();

function isNameTaken(lowerName) {
  for (const r of rooms) {
    for (const p of r.players.values()) {
      if (!p.isBot && p.name.toLowerCase() === lowerName) return true;
    }
  }
  return false;
}

// ---------- sockets ----------

io.on('connection', (socket) => {
  socket.data.roomName = null;

  function getRoom() {
    return rooms.find((r) => r.name === socket.data.roomName) || null;
  }

  function doJoin(data) {
    const resolved = sanitizeDisplayName(data && data.name, isNameTaken);
    const room = pickRoomForJoin(data && data.partyCode);
    socket.data.roomName = room.name;
    const player = room.addRealPlayer(socket, { ...(data || {}), name: resolved.name });
    socket.emit('joined', {
      playerId: player.id,
      roomName: room.displayName,
      worldSize: C.WORLD_SIZE,
      zones: resolvedZones.map((z) => ({ id: z.id, name: z.name, color: z.color, x0: z.x0, y0: z.y0, x1: z.x1, y1: z.y1, hazard: z.hazard || null })),
      weapons: C.WEAPONS,
      abilities: C.ABILITIES,
      evolutions: C.EVOLUTIONS,
      realCount: room.realCount,
      botCount: room.botCount,
      name: resolved.name,
      nameChanged: resolved.changed,
      nameChangeReason: resolved.reason,
    });
  }

  socket.on('join', (data) => {
    try { doJoin(data); } catch (err) { console.error('join error', err); }
  });

  socket.on('respawn', (data) => {
    try {
      const room = getRoom();
      if (room) room.removePlayerBySocket(socket.id);
      doJoin(data);
    } catch (err) { console.error('respawn error', err); }
  });

  socket.on('input', (data) => {
    const room = getRoom();
    if (room) room.handleInput(socket.id, data);
  });

  socket.on('ability', (key) => {
    const room = getRoom();
    if (room && typeof key === 'string') room.handleAbility(socket.id, key);
  });

  socket.on('upgrade', (key) => {
    const room = getRoom();
    if (room && typeof key === 'string') room.handleUpgrade(socket.id, key);
  });

  socket.on('evolve', (key) => {
    const room = getRoom();
    if (room && typeof key === 'string') room.handleEvolve(socket.id, key);
  });

  socket.on('weapon', (key) => {
    const room = getRoom();
    if (room && typeof key === 'string') room.handleWeaponSelect(socket.id, key);
  });

  socket.on('chat', (text) => {
    const room = getRoom();
    if (room) room.handleChat(socket.id, text);
  });

  socket.on('disconnect', () => {
    const room = getRoom();
    if (room) room.removePlayerBySocket(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Online.io server listening on port ${PORT}`);
});
