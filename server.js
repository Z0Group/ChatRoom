// Secure interest-based chatroom server
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const {
  CONFIG,
  profanity,
  moderateMessage,
  sanitizeNickname,
  sanitizeInterests,
  clearState,
  validateEmoji,
  isSeriousViolation,
} = require('./moderation');

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0'; // Bind to all interfaces for better reliability
const MAX_ROOM_SIZE = 12;
const PRIVATE_ROOM_SIZE = 2;
const MAX_TOTAL_ROOMS = 5000;
const MAX_PRIVATE_PER_SOCKET_PER_MIN = 3;

// --- Memory Pressure System ---
// Dynamic room cap: restrict room creation when the server is under memory pressure.
// Uses a cached pressure tier updated every 30s to avoid calling process.memoryUsage() on every request.
const HEAP_LIMIT = parseInt(process.env.HEAP_LIMIT_MB, 10) || 512; // MB
let memoryPressure = 'green'; // 'green' | 'yellow' | 'red'
function updateMemoryPressure() {
  const { heapUsed } = process.memoryUsage();
  const usedMB = heapUsed / (1024 * 1024);
  const ratio = usedMB / HEAP_LIMIT;
  if (ratio > 0.85) memoryPressure = 'red';
  else if (ratio > 0.70) memoryPressure = 'yellow';
  else memoryPressure = 'green';
}
updateMemoryPressure();
setInterval(updateMemoryPressure, 30_000);

const app = express();
const server = http.createServer(app);

// --- Security middleware ---
app.disable('x-powered-by');
// Only trust proxy if BEHIND_PROXY env is set — prevents IP spoofing (#6)
if (process.env.BEHIND_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
}));

app.use(cors({ origin: false }));
app.use(express.json({ limit: '4kb' }));
app.use(express.urlencoded({ extended: false, limit: '4kb' }));

const httpLimiter = rateLimit({
  windowMs: 60_000,
  max: 1000000,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(httpLimiter);

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  },
}));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// --- Socket.IO setup ---
const io = new Server(server, {
  cors: { origin: false },
  maxHttpBufferSize: 64 * 1024, // 64 KB max payload
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

// In-memory rooms: roomId -> { interest, users: Map, persistent: bool }
const rooms = new Map();

// Seed persistent default rooms that always appear in the lobby
const DEFAULT_ROOMS = [
  'general', 'music', 'gaming', 'coding',
  'art', 'movies', 'books', 'anime',
];
for (const interest of DEFAULT_ROOMS) {
  const roomId = `default:${interest}`;
  rooms.set(roomId, {
    interest,
    users: new Map(),
    persistent: true,
    private: false,
    capacity: MAX_ROOM_SIZE,
  });
}
//console.log(`[INIT] ${DEFAULT_ROOMS.length} default rooms ready.`);
//console.table(DEFAULT_ROOMS.map(name => ({ interest: name, id: `default:${name}` })));

// Generate a short, unambiguous room code (no 0/O/1/I)
// Uses rejection sampling to eliminate modulo bias
function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 31 chars
  const maxFair = 256 - (256 % alphabet.length); // 256 - (256 % 31) = 248
  let code = '';
  while (code.length < 8) {
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < bytes.length && code.length < 8; i++) {
      if (bytes[i] < maxFair) {
        code += alphabet[bytes[i] % alphabet.length];
      }
      // else: discard biased byte
    }
  }
  return code;
}

function createPrivateRoom({ listed = false, interests = [], capacity = PRIVATE_ROOM_SIZE } = {}) {
  // Guard: cap total rooms to prevent memory exhaustion (#7)
  if (rooms.size >= MAX_TOTAL_ROOMS) {
    return { error: 'Server room limit reached. Try again later.' };
  }
  // Ensure uniqueness — error instead of overwrite on collision (#9)
  let code, roomId;
  let attempts = 0;
  do {
    code = generateRoomCode();
    roomId = `private:${code}`;
    attempts++;
  } while (rooms.has(roomId) && attempts < 20);
  if (rooms.has(roomId)) {
    return { error: 'Could not generate a unique room code. Try again.' };
  }
  rooms.set(roomId, {
    interest: interests[0] || `1-on-1 ${code}`,
    interests: interests,
    users: new Map(),
    persistent: false,
    private: true,
    listed: !!listed,
    capacity: Math.max(2, Math.min(12, capacity)),
    code,
    createdAt: Date.now(),
  });
  console.log(`[Server] Created private room: ${roomId}`);
  return { roomId, code };
}

// Emoji allow-list for reactions (kept small for simplicity and safety)
// Previously hardcoded REACTION_EMOJIS removed to allow expanded set

// Per-room message buffer to support replies and reactions.
// roomId -> [{ id, from, fromSocketId, text, ts, reactions: Map<emoji, Set<nickname>>, replyTo? }]
const roomMessages = new Map();
const MSG_BUFFER_SIZE = 80;

function generateMessageId() {
  // Cryptographically secure message ID (#1)
  return crypto.randomBytes(12).toString('hex');
}

function getMessageBuffer(roomId) {
  let buf = roomMessages.get(roomId);
  if (!buf) {
    buf = [];
    roomMessages.set(roomId, buf);
  }
  return buf;
}

function findMessage(roomId, messageId) {
  const buf = roomMessages.get(roomId);
  if (!buf) return null;
  return buf.find((m) => m.id === messageId) || null;
}

function serializeReactions(msg) {
  if (!msg.reactions) return [];
  const out = [];
  for (const [emoji, nicknames] of msg.reactions) {
    out.push({ emoji, count: nicknames.size, users: Array.from(nicknames) });
  }
  return out;
}
// socketId -> { nickname, interests: [], roomId }
const sockets = new Map();
const userMutes = new Map(); // socketId -> expiryTs

// Periodic cleanup: purge expired mutes and stale message buffers every 60s
setInterval(() => {
  const now = Date.now();
  // Clean expired mutes
  for (const [id, expiry] of userMutes) {
    if (expiry <= now) userMutes.delete(id);
  }
  // Clean message buffers for rooms that no longer exist
  for (const roomId of roomMessages.keys()) {
    if (!rooms.has(roomId)) roomMessages.delete(roomId);
  }
  // Clean all non-persistent rooms that have been empty for >3 min to prevent room hoarding
  for (const [roomId, room] of rooms) {
    if (!room.persistent && room.users.size === 0 && room.createdAt) {
      if (now - room.createdAt > 3 * 60_000) {
        rooms.delete(roomId);
        roomMessages.delete(roomId);
        typingByRoom.delete(roomId);
      }
    }
  }
}, 60_000);

// IP-based connection limit
const ipConnections = new Map();
const MAX_PER_IP = 40000;

// Track typing state per room: roomId -> Set<nickname>
const typingByRoom = new Map();

function getClientIp(socket) {
  // Only trust X-Forwarded-For when behind a verified proxy (#6)
  if (process.env.BEHIND_PROXY === 'true') {
    const fwd = socket.handshake.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) {
      const ips = fwd.split(',');
      return ips[ips.length - 1].trim(); // Trust the deepest hop inserted by the reverse proxy
    }
  }
  return socket.handshake.address || 'unknown';
}

function findOrCreateRoom(interests) {
  // Priority 1: a non-full room (PUBLIC or LISTED PRIVATE) that already has people AND whose interest matches.
  // Among candidates, pick the most populated one so matches "stick together".
  let bestPopulated = null;
  for (const [roomId, room] of rooms) {
    if (room.private && !room.listed) continue; // Skip unlisted private rooms
    if (room.users.size === 0) continue;
    if (room.users.size >= room.capacity) continue;

    // Check if any of the user's interests match any of the room's interests
    let match = false;
    if (room.interests && Array.isArray(room.interests)) {
      match = room.interests.some(ri => interests.includes(ri));
    } else {
      match = interests.includes(room.interest);
    }

    if (!match) continue;

    if (!bestPopulated || room.users.size > bestPopulated.size) {
      bestPopulated = { roomId, size: room.users.size };
    }
  }
  if (bestPopulated) return bestPopulated.roomId;

  // Priority 2: an empty default (persistent) room matching any of our interests.
  // Follow the user's own interest order so their first choice wins.
  for (const interest of interests) {
    const defaultId = `default:${interest}`;
    const room = rooms.get(defaultId);
    if (room && room.users.size < room.capacity) return defaultId;
  }

  // Priority 3: create a fresh ad-hoc public room for the user's first interest.
  // Guard: cap total rooms (#7)
  if (rooms.size >= MAX_TOTAL_ROOMS) {
    // Fall back to a global default room rather than spawning infinite persistent memory leaks
    return 'default:general';
  }
  const interest = interests[0];
  const roomId = `room:${interest}:${Date.now().toString(36)}`;
  rooms.set(roomId, {
    interest,
    users: new Map(),
    persistent: false,
    private: false,
    capacity: MAX_ROOM_SIZE,
  });
  return roomId;
}

function listUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.users.values());
}

/**
 * Finds a unique nickname in a room by appending a numeric suffix if needed.
 * @param {object} room
 * @param {string} nickname
 * @returns {string}
 */
function getUniqueNickname(room, nickname) {
  if (!room) return nickname;

  const existingNames = new Set(room.users.values());
  if (!existingNames.has(nickname)) return nickname;

  let i = 1;
  while (existingNames.has(`${nickname}${i}`)) {
    i++;
  }
  return `${nickname}${i}`;
}

function listRooms() {
  const out = [];
  for (const [roomId, room] of rooms) {
    // Skip rooms that are empty and not persistent AND not listed
    if (room.users.size === 0 && !room.persistent && !room.listed) continue;

    // Private rooms are hidden from the public lobby UNLESS they're listed.
    if (room.private && !room.listed) continue;
    out.push({
      roomId,
      interest: room.interest,
      interests: room.interests || null,
      count: room.users.size,
      capacity: room.capacity,
      full: room.users.size >= room.capacity,
      persistent: !!room.persistent,
      private: !!room.private,
      listed: !!room.listed,
      code: room.code || null,
    });
  }
  // Sort logic: Joinable first, then sort by member count, then persistence
  out.sort((a, b) => {
    // 1. Fullness (Full rooms ALWAYS at the absolute bottom)
    if (a.full !== b.full) return a.full ? 1 : -1;
    // 2. Activity (Most populated rooms FIRST)
    if (a.count !== b.count) return b.count - a.count;
    // 3. Persistence (Default rooms towards top of their "count tier")
    if (a.persistent !== b.persistent) return a.persistent ? -1 : 1;
    return 0;
  });
  // Cap the list to show all joinable rooms, but only the first 15 full ones
  const joinable = out.filter(r => !r.full);
  const full = out.filter(r => r.full).slice(0, 15);
  return [...joinable, ...full];
}

function getLobbyStats() {
  const totalOnline = sockets.size;
  const roomList = listRooms();
  // Trending = top rooms by member count (any type)
  const trending = [...roomList]
    .sort((a, b) => b.count - a.count)
    .filter(r => r.count > 0)
    .slice(0, 6)
    .map(r => r.interest);
  return { rooms: roomList, totalOnline, trending };
}

let broadcastTimer = null;
function broadcastRooms() {
  if (broadcastTimer) return;
  // Send first update after a join/leave but then wait at least 3s before next
  broadcastTimer = setTimeout(() => {
    io.to('lobby').emit('rooms:update', getLobbyStats());
    broadcastTimer = null;
  }, 3000); 
}

function broadcastOnline() {
  // Everyone, including people inside chat rooms, sees the online count
  io.emit('stats:online', sockets.size);
}

function leaveCurrentRoom(socket) {
  const meta = sockets.get(socket.id);
  if (!meta || !meta.roomId) return;
  const room = rooms.get(meta.roomId);
  const prevRoomId = meta.roomId;
  if (room) {
    room.users.delete(socket.id);
    socket.leave(prevRoomId);
    // Clear typing state
    const typing = typingByRoom.get(prevRoomId);
    if (typing) {
      typing.delete(meta.nickname);
      if (typing.size === 0) typingByRoom.delete(prevRoomId);
      else io.to(prevRoomId).emit('typing', Array.from(typing));
    }
    io.to(prevRoomId).emit('system', {
      text: `${meta.nickname} left.`,
      ts: Date.now(),
    });
    io.to(prevRoomId).emit('users', listUsers(prevRoomId));
    if (room.users.size === 0 && !room.persistent) {
      rooms.delete(prevRoomId);
      typingByRoom.delete(prevRoomId);
      roomMessages.delete(prevRoomId);
    }
  }
  meta.roomId = null;
  socket.join('lobby');
  broadcastRooms();
}

// --- Per-socket rate limiter (#8) ---
function createSocketRateLimiter(maxEvents, windowMs) {
  const buckets = new Map(); // id -> { count, resetAt }

  // GC interval to prevent memory leaks from inactive IDs without nullifying active throttling
  const gc = setInterval(() => {
    const now = Date.now();
    for (const [id, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(id);
    }
  }, windowMs * 2);
  gc.unref();

  function checkRate(id) {
    const now = Date.now();
    let bucket = buckets.get(id);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(id, bucket);
    }
    bucket.count++;
    return bucket.count <= maxEvents;
  }
  checkRate._buckets = buckets; // Exposed for cleanup on disconnect
  return checkRate;
}

// Rate limiters for specific event categories (per-socket)
const joinLimiter = createSocketRateLimiter(5, 60_000);       // 5 joins/min (#2)
const createRoomLimiter = createSocketRateLimiter(3, 60_000);  // 3 rooms/min (#7)
const reportLimiter = createSocketRateLimiter(3, 60_000);      // 3 reports/min
const globalEventLimiter = createSocketRateLimiter(120, 60_000); // 120 events/min total

// Per-IP rate limiters — prevents opening multiple sockets to bypass per-socket limits
const ipJoinLimiter = createSocketRateLimiter(10, 60_000);      // 10 joins/min per IP
const ipCreateRoomLimiter = createSocketRateLimiter(5, 60_000); // 5 rooms/min per IP
const ipReportLimiter = createSocketRateLimiter(5, 60_000);     // 5 reports/min per IP

io.on('connection', (socket) => {
  const ip = getClientIp(socket);

  // Memory pressure: reject new connections when server is critically loaded
  if (memoryPressure === 'red') {
    socket.emit('fatal', { reason: 'Server is at capacity. Please try again in a few minutes.' });
    socket.disconnect(true);
    return;
  }

  const count = (ipConnections.get(ip) || 0) + 1;
  if (count > MAX_PER_IP) {
    socket.emit('fatal', { reason: 'Too many connections from your network.' });
    socket.disconnect(true);
    return;
  }
  ipConnections.set(ip, count);

  function checkMute(ackCall) {
    const muteExpiry = userMutes.get(ip);
    const now = Date.now();
    if (muteExpiry && muteExpiry > now) {
      if (ackCall) ackCall({ ok: false, error: `You are muted for ${Math.ceil((muteExpiry - now) / 1000)}s.` });
      return true;
    }
    return false;
  }

  sockets.set(socket.id, { nickname: null, interests: [], roomId: null, lastTyping: 0, lastReact: 0, ip });
  socket.join('lobby');
  socket.emit('rooms:update', getLobbyStats());
  broadcastRooms();
  broadcastOnline();

  // Generic rate-limit guard — applied to every named event (#8)
  socket.use(([event, ...args], next) => {
    if (!globalEventLimiter(socket.id)) {
      const ack = args.find(a => typeof a === 'function');
      if (ack) ack({ ok: false, error: 'Rate limited. Slow down.' });
      return; // Drop the event silently
    }
    next();
  });

  socket.on('rooms:list', (_payload, ack) => {
    ack && ack({ ok: true, ...getLobbyStats() });
  });

  socket.on('createPrivate', (payload, ack) => {
    try {
      if (checkMute(ack)) return;
      // Memory pressure check: block room creation when server is stressed
      if (memoryPressure === 'yellow' || memoryPressure === 'red') {
        return ack && ack({ ok: false, error: 'Server is busy. Room creation temporarily paused — try again shortly.' });
      }
      // Rate limit room creation — per-socket AND per-IP
      if (!createRoomLimiter(socket.id) || !ipCreateRoomLimiter(ip)) {
        return ack && ack({ ok: false, error: 'Too many rooms created. Wait a minute.' });
      }
      const listed = !!(payload && payload.listed);
      let interests = [];
      if (payload && Array.isArray(payload.interests)) {
        interests = sanitizeInterests(payload.interests);
      } else if (payload && payload.interest) {
        // Fallback for older clients or single interest
        const sanitized = sanitizeInterests([payload.interest]);
        if (sanitized.length > 0) interests = [sanitized[0]];
      }
      let capacity = PRIVATE_ROOM_SIZE;
      if (payload && typeof payload.capacity === 'number' && !isNaN(payload.capacity)) capacity = payload.capacity;

      const result = createPrivateRoom({ listed, interests, capacity });
      if (result.error) {
        return ack && ack({ ok: false, error: result.error });
      }
      const { roomId, code } = result;
      ack && ack({ ok: true, roomId, code, listed, interest: interests[0] || null, interests, capacity });
      if (listed) broadcastRooms();
    } catch (e) {
      console.error('[Room] Create private failed:', e.message);
      ack && ack({ ok: false, error: 'Could not create private room.' });
    }
  });

  socket.on('typing', (isTyping) => {
    if (checkMute()) return;
    const meta = sockets.get(socket.id);
    if (!meta || !meta.roomId || !meta.nickname) return;
    // Rate limit typing events
    const now = Date.now();
    if (now - meta.lastTyping < 500) return;
    meta.lastTyping = now;

    let typing = typingByRoom.get(meta.roomId);
    if (!typing) {
      typing = new Set();
      typingByRoom.set(meta.roomId, typing);
    }
    if (isTyping) typing.add(meta.nickname);
    else typing.delete(meta.nickname);

    socket.to(meta.roomId).emit('typing', Array.from(typing));
  });

  socket.on('join', (payload, ack) => {
    try {
      if (checkMute(ack)) return;
      // Rate limit joins — per-socket AND per-IP to prevent brute-forcing (#2)
      if (!joinLimiter(socket.id) || !ipJoinLimiter(ip)) {
        return ack && ack({ ok: false, error: 'Too many join attempts. Wait a minute.' });
      }

      const meta = sockets.get(socket.id);
      if (!meta) return;
      if (meta.roomId) leaveCurrentRoom(socket);

      const nickname = sanitizeNickname(payload && payload.nickname);
      const interests = sanitizeInterests(payload && payload.interests);
      const requestedRoomId = payload && typeof payload.roomId === 'string' ? payload.roomId : null;

      if (!nickname) {
        return ack && ack({ ok: false, error: 'Invalid nickname (1-24 chars, letters/numbers).' });
      }
      if (!requestedRoomId && interests.length === 0) {
        return ack && ack({ ok: false, error: 'Add at least one interest.' });
      }

      meta.nickname = nickname;
      meta.interests = interests;

      let roomId;
      if (requestedRoomId) {
        const target = rooms.get(requestedRoomId);
        if (!target) {
          return ack && ack({ ok: false, error: 'That room no longer exists.' });
        }
        if (target.users.size >= target.capacity) {
          return ack && ack({ ok: false, error: target.private ? 'This private room is full.' : 'That room is full.' });
        }
        roomId = requestedRoomId;
      } else {
        roomId = findOrCreateRoom(interests);
      }

      const room = rooms.get(roomId);
      if (!room) {
        console.error('[Join] Room disappeared after findOrCreateRoom');
        return ack && ack({ ok: false, error: 'Join failed. Please try again.' });
      }

      // Global capacity enforcement: catches fallback rooms reaching their limits
      if (room.users.size >= room.capacity) {
        return ack && ack({ ok: false, error: 'That room is full. Please try again later.' });
      }

      // Ensure the nickname is unique within the room
      const uniqueNickname = getUniqueNickname(room, nickname);

      room.users.set(socket.id, uniqueNickname);
      meta.nickname = uniqueNickname;
      meta.roomId = roomId;
      socket.leave('lobby');
      socket.join(roomId);

      ack && ack({
        ok: true,
        roomId,
        interest: room.interest,
        interests: room.interests || [],
        users: listUsers(roomId),
        private: !!room.private,
        code: room.code || null,
        capacity: room.capacity,
        history: [], // Strict: No history for new joiners
      });

      io.to(roomId).emit('system', {
        text: `${uniqueNickname} joined.`,
        ts: Date.now(),
      });
      io.to(roomId).emit('users', listUsers(roomId));
      broadcastRooms();
    } catch (err) {
      console.error('[Join] Unexpected error:', err.message);
      ack && ack({ ok: false, error: 'Join failed.' });
    }
  });

  socket.on('message', (payload, ack) => {
    try {
      if (checkMute(ack)) return;
      const meta = sockets.get(socket.id);
      if (!meta || !meta.roomId) {
        return ack && ack({ ok: false, error: 'Not in a room.' });
      }
      const raw = payload && payload.text;
      const reportHash = payload && payload.reportHash;
      if (typeof raw !== 'string') {
        return ack && ack({ ok: false, error: 'Invalid payload.' });
      }
      if (typeof reportHash !== 'string' || !reportHash.trim()) {
        return ack && ack({ ok: false, error: 'E2EE reporting hash is strictly required.' });
      }

      const result = moderateMessage(socket.id, raw);
      if (!result.ok) {
        if (result.mute && ip) {
          userMutes.set(ip, Date.now() + 60_000);
          io.to(socket.id).emit('system', { text: 'You have been muted for 60s for spamming.' });
        }
        return ack && ack({ ok: false, error: result.reason });
      }

      // Optional reply: look up the target in this room's buffer
      let replyTo = null;
      const replyToId = payload && typeof payload.replyToId === 'string' ? payload.replyToId : null;
      if (replyToId) {
        const target = findMessage(meta.roomId, replyToId);
        if (target) {
          replyTo = {
            id: target.id,
            from: target.from,
            preview: target.text,
          };
        }
      }

      // Clear typing state for this user on send
      const typing = typingByRoom.get(meta.roomId);
      if (typing && typing.has(meta.nickname)) {
        typing.delete(meta.nickname);
        socket.to(meta.roomId).emit('typing', Array.from(typing));
      }

      const msg = {
        id: generateMessageId(),
        from: meta.nickname,
        fromSocketId: socket.id, // Track sender socket for report verification (#3)
        ip: ip, // Track IP natively to avoid Hit'n Run trolls escaping punishment
        text: result.text,
        reportHash: typeof reportHash === 'string' ? reportHash.trim().toLowerCase() : null,
        ts: Date.now(),
        reactions: new Map(),
        replyTo,
      };

      // Store in room buffer (capped)
      const buf = getMessageBuffer(meta.roomId);
      buf.push(msg);
      while (buf.length > MSG_BUFFER_SIZE) buf.shift();

      io.to(meta.roomId).emit('message', {
        id: msg.id,
        from: msg.from,
        text: msg.text,
        reportHash: msg.reportHash,
        ts: msg.ts,
        replyTo: msg.replyTo,
      });
      ack && ack({ ok: true, id: msg.id });
    } catch (err) {
      ack && ack({ ok: false, error: 'Message failed.' });
    }
  });

  socket.on('message:report', (payload, ack) => {
    try {
      if (checkMute(ack)) return;
      // Rate limit reports — per-socket AND per-IP (#8)
      if (!reportLimiter(socket.id) || !ipReportLimiter(ip)) {
        return ack && ack({ ok: false, error: 'Too many reports. Wait a minute.' });
      }
      const meta = sockets.get(socket.id);
      if (!meta || !meta.roomId) return;
      const messageId = payload && typeof payload.messageId === 'string' ? payload.messageId : null;
      const reportedText = payload && typeof payload.reportedText === 'string' ? payload.reportedText : null;
      if (!messageId) return;

      const msg = findMessage(meta.roomId, messageId);
      if (msg) {
        // --- SERVER-SIDE VERIFICATION (#3) ---
        let isValid = false;
        let serverText = msg.text;

        if (msg.reportHash && reportedText) {
          const crypto = require('crypto');
          const computedHash = crypto.createHash('sha256').update(reportedText).digest('hex');
          if (computedHash === msg.reportHash) {
            isValid = true;
            serverText = reportedText;
          }
        }

        if (!isValid) {
          if (ack) ack({ ok: false, error: 'Report failed cryptographically verifiable hash check.' });
          return;
        }

        if (isSeriousViolation(serverText)) {
          // Unconditional IP Muting: Ban the native IP regardless of their online connection state
          if (msg.ip) {
            // Serious violation: Mute for 10 minutes
            userMutes.set(msg.ip, Date.now() + 10 * 60_000);
            
            // Check if they are still connected to send a courtesy system warning
            if (msg.fromSocketId) {
              io.to(msg.fromSocketId).emit('system', { text: 'ACCOUNT SUSPENDED: You have been muted for 10 minutes following a verified report of a serious violation.' });
            }
            console.log('[MOD] Report VERIFIED. IP natively muted.');
            if (ack) ack({ ok: true });
          } else {
            // Fallback for extremely legacy offline messages missing IP parameter
            if (ack) ack({ ok: false, error: 'Could not fetch original IP mapping.' });
          }
        } else {
          console.log('[MOD] Report failed verification.');
          if (ack) ack({ ok: false, error: 'Report not able to be determined as factual or serious enough for a mute.' });
        }
      } else {
        if (ack) ack({ ok: false, error: 'Message not found.' });
      }
    } catch (e) {
      console.error('[MOD] Error processing report:', e.message);
      if (ack) ack({ ok: false });
    }
  });


  socket.on('react', (payload, ack) => {
    try {
      if (checkMute(ack)) return;
      const meta = sockets.get(socket.id);
      if (!meta || !meta.roomId || !meta.nickname) {
        return ack && ack({ ok: false, error: 'Not in a room.' });
      }
      const now = Date.now();
      if (now - meta.lastReact < 150) {
        return ack && ack({ ok: false, error: 'Slow down.' });
      }
      meta.lastReact = now;

      const messageId = payload && typeof payload.messageId === 'string' ? payload.messageId : null;
      const emoji = payload && typeof payload.emoji === 'string' ? payload.emoji : null;
      if (!messageId || !emoji) {
        return ack && ack({ ok: false, error: 'Invalid payload.' });
      }
      if (!emoji || !validateEmoji(emoji)) {
        return ack && ack({ ok: false, error: 'Invalid emoji.' });
      }
      const msg = findMessage(meta.roomId, messageId);
      if (!msg) {
        return ack && ack({ ok: false, error: 'Message not found.' });
      }
      // Use strictly the room-unique nickname for reaction tracking to prevent ghosting exploits
      let reactors = msg.reactions.get(emoji);
      if (!reactors) {
        reactors = new Set();
        msg.reactions.set(emoji, reactors);
      }
      // Toggle
      if (reactors.has(meta.nickname)) reactors.delete(meta.nickname);
      else reactors.add(meta.nickname);
      if (reactors.size === 0) msg.reactions.delete(emoji);

      io.to(meta.roomId).emit('reaction', {
        messageId: msg.id,
        reactions: serializeReactions(msg),
      });
      ack && ack({ ok: true });
    } catch (err) {
      ack && ack({ ok: false, error: 'React failed.' });
    }
  });

  // Rate-limit leave to prevent broadcast storm from rapid join/leave cycling
  socket.on('leave', (...args) => {
    // Unrestricted leave logic prevents orphaned users taking up capacity limits
    leaveCurrentRoom(socket);
    const ack = args.find(a => typeof a === 'function');
    if (ack) ack({ ok: true });
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
    socket.leave('lobby');
    sockets.delete(socket.id);
    clearState(socket.id);
    // Clean up rate limiter buckets to prevent memory leak
    for (const limiter of [joinLimiter, createRoomLimiter, reportLimiter, globalEventLimiter]) {
      if (limiter._buckets) limiter._buckets.delete(socket.id);
    }
    // Explicit deletion of IP limiter buckets is removed to ensure persistent rate limits over the window.
    // Expired buckets are securely handled by the background GC interval.
    const c = (ipConnections.get(ip) || 1) - 1;
    if (c <= 0) ipConnections.delete(ip);
    else ipConnections.set(ip, c);
    broadcastRooms();
    broadcastOnline();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`2Z0 Chatroom listening on http://${HOST}:${PORT}`);
});
