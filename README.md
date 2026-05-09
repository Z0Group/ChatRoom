# ChatRoom

ChatRoom is a real-time, interest-based chat app built with `Express` and `Socket.IO`.
It is designed around anonymous use (no accounts), lightweight moderation, and private room support.

This README explains how the project is structured, how messages and rooms work, and how to run and customize it safely.

## Stack

- Backend: `Node.js`, `Express`, `Socket.IO`
- Frontend: plain `HTML`, `CSS`, and vanilla `JavaScript`
- Moderation: `leo-profanity` plus local custom word lists

## Project Structure

- `server.js`: main server (HTTP + WebSocket), room lifecycle, events, security/rate limits
- `moderation.js`: nickname/interest/message moderation helpers and emoji/violation checks
- `moderation.local.js`: local-only custom moderation lists (ignored by git)
- `moderation.local.example.js`: template for local moderation config
- `public/index.html`: app UI structure
- `public/app.js`: all client behavior (join flow, room list, chat, private invites, E2EE handling)
- `public/style.css`: styling

## How It Works (High Level)

1. The browser loads `public/index.html` and opens a Socket.IO connection.
2. The client receives live room stats for the lobby.
3. User joins by:
   - choosing interests (auto-matching), or
   - clicking a listed room, or
   - joining/creating a private room.
4. Messages are sent through the `message` socket event, moderated/rate-limited on server, then broadcast to the room.
5. The client renders chat, users, typing state, reactions, and report actions in real time.

## Room System

### Default Rooms

At startup, the server creates persistent default rooms:

- `general`
- `music`
- `gaming`
- `coding`
- `art`
- `movies`
- `books`
- `anime`

These always appear in the lobby.

### Dynamic Public Rooms

When a user joins by interests:

- server first tries to place them in an existing active matching room,
- then tries an empty matching default room,
- otherwise creates a new non-persistent public room.

Empty non-persistent rooms are cleaned up automatically.

### Private Rooms

Private rooms are created with short codes and can be:

- unlisted (invite-only), or
- listed (visible in lobby).

Room capacity is configurable per private room (bounded on server).

## Messaging, Reactions, and Replies

- Messages are delivered through Socket.IO room events.
- Server keeps a small per-room message buffer for reply/reaction targeting.
- Replies reference a message ID and include a preview payload.
- Reactions are toggled per user and emoji, then broadcast with aggregate counts.

## Moderation and Safety

Moderation is split between server checks (authoritative) and client-side filtering (visual comfort).

### Server-Side Moderation (`moderation.js`)

- Sanitizes nickname/interests.
- Rejects profane nicknames and tags.
- Applies message anti-spam controls:
  - minimum send interval,
  - 8 messages / 10s flood control (then escalation),
  - duplicate message blocking,
  - repeated-character spam blocking.
- Evaluates serious violation reports.
- Supports temporary IP-based mutes for abuse.

### Client-Side Filtering (`public/app.js`)

- Optional profanity masking toggle in UI.
- Runs only on displayed text (does not replace server moderation).

### Local Custom Word Lists (Not Committed)

Sensitive or custom terms are loaded from `moderation.local.js`, which is git-ignored.

Shape of `moderation.local.js`:

```js
module.exports = {
  extraProfanityWords: [],
  seriousViolations: [],
};
```

Use `moderation.local.example.js` as the template.

## E2EE Behavior in Private Rooms

Private unlisted rooms use a URL hash key flow for end-to-end encryption behavior on the client:

- sender encrypts message content in browser (AES-GCM via Web Crypto),
- server relays encrypted payload,
- recipient decrypts in browser when they have the same URL hash key.

Notes:

- the URL hash (`#key=...`) is not sent as part of normal HTTP request path/query,
- reporting still uses a message hash verification flow to validate claims.

## Security Controls

Implemented controls include:

- `helmet` security headers and restrictive CSP
- disabled `x-powered-by`
- conservative static asset headers
- event and action rate limiting (per-socket and per-IP)
- connection cap per IP
- room creation caps and memory pressure guardrails
- strict payload validation in socket handlers

## Running Locally

### Requirements

- Node.js 18+ recommended

### Install

```bash
npm install
```

### Start

```bash
npm start
```

Server default:

- host: `0.0.0.0`
- port: `5000`

Open `http://localhost:5000`.

## Environment Variables

- `PORT`: server port (default `5000`)
- `HOST`: bind address (default `0.0.0.0`)
- `BEHIND_PROXY`: set to `true` only when running behind trusted reverse proxy
- `HEAP_LIMIT_MB`: memory threshold base for pressure checks (default `512`)

## Operational Notes

- State is in-memory only (rooms, sockets, message buffers, mutes).
- Restarting server clears active rooms and buffers.
- This is suitable for single-instance deployments or development.
- Horizontal scaling requires shared state (or sticky sessions + external coordination).

## Development Notes

- No build step is required.
- Frontend assets are served directly from `public/`.
- Socket and moderation logic are currently hand-written and centralized.

If this grows, useful next refactors are:

- split socket handlers into modules (`join`, `message`, `rooms`, `reports`)
- move constants and limits into a config file
- add integration tests around socket event flows

## Troubleshooting

### Cannot join / gets rate-limited quickly

- Wait for limiter window to reset.
- Check whether multiple browser tabs are open from the same IP.

### Invite link does not decrypt messages

- Make sure the full invite link (including `#key=...`) is shared.
- If hash is missing, room still works but messages may appear encrypted.

### `moderation.local.js` not loading

- Verify file is at project root next to `moderation.js`.
- Ensure it exports an object with `extraProfanityWords` and/or `seriousViolations`.

