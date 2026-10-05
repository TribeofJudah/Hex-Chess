# Remote-play room protocol (ROOM_PROTO)

Status: **draft v1** — mirrors the client module `src/ui/protocol.ts` and the
room logic in `worker/src/room.ts` (t41). This document is the source of truth:
change it first, then both code copies.

The goal is a two-player remote game of Gliński hex chess: one WebSocket per
room, authoritative move list held by a Cloudflare Durable Object, clients that
reconnect and reclaim their seat. Hotseat and vs-AI play are unaffected and
share the same `useGame` state machine.

---

## 1. Transport

- **One WebSocket per room** at `<worker-origin>/room/<ROOMCODE>`.
- The room code is 4 characters from the ambiguity-free alphabet
  `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no `I/O/0/1`) — generated client-side by
  `newRoomCode()` in `src/ui/router.ts`.
- The connection is addressed by hash route `#/play/<CODE>` (see §4 for why a
  hash route and not a path).
- Frames are **UTF-8 JSON text**; binary frames are not used.
- The server never initiates; the client sends `join` first. A room exists only
  while its Durable Object is alive (see §4 lifecycle, §8 `unknown_room`).
- No TLS-terminating details here: the client derives `ws://` vs `wss://` from
  `window.location.protocol` in `defaultUrl()`.

---

## 2. Versioning and the version vector

Two independent numbers travel on every frame:

| Field       | Scope            | Meaning                                                        |
| ----------- | ---------------- | -------------------------------------------------------------- |
| `v`         | every frame      | Schema version of *this message*. Currently `PROTOCOL_VERSION`. |
| `protocol`  | `join`/`welcome` | The peer's **protocol version**, negotiated once at join.       |
| `revision`  | `move`/`state`/… | Monotonic count of applied moves in the room (the version vector). |
| `ply`       | `move` broadcast | 1-based index this move occupies in the move list.              |

- `PROTOCOL_VERSION` is bumped **only** for incompatible message-shape changes.
  Adding an optional field is compatible and does **not** bump it.
- `revision` starts at `0` (empty room) and increments by exactly `1` per
  accepted move. It is the room's logical clock: a client that has applied
  `n` moves has `revision == n`.
- `ply` is derived: `ply == moves.length + 1` at the moment the server accepts
  a move. `ply` and `revision` coincide today but are kept separate so a future
  state frame (e.g. server-side clock correction) can advance `revision`
  without implying a new ply.

The client mirrors both: `revisionRef` (last server revision it has seen) and
the length of `game.moves` (the plies it has applied). Divergence between them
is what triggers a resync (§5).

---

## 3. Message shapes

All shapes are declared in `src/ui/protocol.ts`; the worker keeps a byte-identical
copy in `worker/src/protocol.ts`.

### 3.1 client → server

```ts
interface JoinMsg   { v: number; type: 'join';   room: string; clientId: string; protocol: number }
interface MoveMsg   { v: number; type: 'move';   from: string; to: string; promotion?: PieceKind; revision: number }
interface ResyncMsg { v: number; type: 'resync'; revision: number }
interface PingMsg   { v: number; type: 'ping';   t: number }
```

- `join.clientId` is a **stable per-tab id** (`c<seq>-<random>`), reused across
  reconnects so the seat is reclaimed (§7).
- `move.revision` is the revision the client believes is current. The server
  rejects a move whose `revision` is behind, so a stale client cannot fork the
  move list (§5).
- `from`/`to` are Gliński notation cells (`f5`, `b7`, …); `promotion` is one of
  `queen|rook|bishop|knight` when a pawn reaches the far rank.

### 3.2 server → client

```ts
interface WelcomeMsg { v: number; type: 'welcome'; room: string; clientId: string; seat: Seat;
                       protocol: number; revision: number; moves: WireMove[] }
interface StateMsg   { v: number; type: 'state';   revision: number; moves: WireMove[]; reason?: string }
interface MoveBroadcast { v: number; type: 'move'; from: string; to: string; promotion?: PieceKind;
                          ply: number; color: PieceColor; revision: number; by: string }
interface PeerMsg    { v: number; type: 'peer';    connected: boolean; seats: { white: boolean; black: boolean } }
interface ErrorMsg   { v: number; type: 'error';   code: ErrCode; message: string;
                       expectedProtocol?: number; receivedProtocol?: number }
interface PongMsg    { v: number; type: 'pong';    t: number }

type Seat = 'white' | 'black' | 'spectator'
interface WireMove { from: string; to: string; promotion?: PieceKind; ply: number; color: PieceColor }
```

- `welcome` is **authoritative and per-client**: it carries the joining client's
  `seat` and the full `moves` list, so a client can rebuild the board from
  scratch (`rebuild()` in `useRemoteGame.ts`).
- `state` is the answer to `resync`; identical payload to `welcome` minus the
  seat handshake, with a `reason` for diagnostics.
- `move.by` is the originating `clientId`. The sender uses it (and `ply`) to
  **suppress its own echo** rather than re-applying its move.
- `peer` is broadcast whenever the seat occupancy changes.

### 3.3 decoding rule

`decode()` in `protocol.ts` is **inbound-only** and deliberately shallow: it
returns `null` unless the frame parses as JSON, is an object, has a numeric `v`,
and a `type` in the server set. Field-level validation is the reducer's job.
A hostile or truncated frame therefore cannot crash the client — it is dropped
(test: `protocol.test.ts` "rejects client-only frames", "malformed frame").

---

## 4. Room lifecycle

1. **Create** — the client does not call the server to create; "Play online"
   generates a code locally (`newRoomCode()`) and navigates to `#/play/<CODE>`.
   The room's Durable Object is created lazily on the first `join`.
2. **Routing** — hash route, not a path. The app is served from GitHub Pages
   with `base: './'`, where a real path `/play/ABCD` 404s on reload with no
   server rewrite. `#/play/ABCD` works everywhere (`src/ui/router.ts`).
3. **Join & seating** — first joiner → `white`; second → `black`; any further
   joiner → `spectator` (the room is never "full": spectators are allowed and
   receive all broadcasts). Seat assignment is sticky per `clientId` for the
   life of the DO: a reconnecting client with a known `clientId` gets its old
   seat back rather than a new one.
4. **Play** — once both seats are filled the server broadcasts
   `peer{seats:{white:true,black:true}}`; each client moves to `playing`.
5. **Leave / drop** — a closing socket frees its seat (unless the drop is a
   transient one being reclaimed within the grace window, §7) and broadcasts a
   new `peer`.
6. **End** — the DO may evict when idle. There is no long-term persistence in
   v1: an evicted room is gone and a later `join` starts an empty room (see
   §8 `unknown_room`). The move list is authoritative only while the DO lives.

```text
        join(white)              join(black)            close(black)
  ∅ ───────────────▶ {white} ───────────────▶ {white,black} ─────────▶ {white}
   welcome(white)    peer                welcome(black)   peer       peer
```

---

## 5. Move sync and ordering

The move list is append-only and totally ordered by `ply`. The server is the
only writer.

Client sends a move with the `revision` it last saw. Server:

- `move.revision == server.revision` → **accept**: append with `ply =
  moves.length + 1`, increment `revision`, broadcast `move` (to *all* clients,
  including the sender) and, if the seat set changed, nothing else.
- `move.revision < server.revision` → **reject** with `error{code:'stale_move'}`
  and immediately send that client a fresh `state` so it resyncs. It never
  forks the list.

Client receives a `move` broadcast:

- `ply <= moves.length` → already applied (our own echo, or a duplicate). Only
  advance `revisionRef`. **Do not re-apply, do not re-send.**
- `ply == moves.length + 1` → apply via `applyMove(from,to,promotion)`, set
  `lastSentRef = ply` (so the "stream local moves" effect won't echo it), set
  `revisionRef`.
- `ply >  moves.length + 1` → **gap**: frames were missed (typically a drop).
  Send `resync{revision: moves.length}`; the server answers `state` with the
  full list, and `rebuild()` reinstates it.

Local moves are streamed by an effect gated on status being `waiting` or
`playing`. A move made before the socket is sendable stays pending and is sent
once ready, unless a `state`/`welcome` rebuild moves past it (which supersedes
it). `lastSentRef` is the single source of truth for "how many plies have left
this client", set by both paths (send and inbound-apply).

---

## 6. Version mismatch

Detection happens at two points, both fatal to the session (no reconnect):

1. **Negotiated** — server checks `join.protocol` against its own. On a
   mismatch it sends `error{code:'version_mismatch', expectedProtocol, receivedProtocol}`
   and closes.
2. **Defensive** — if a `welcome` arrives whose `protocol` differs from
   `PROTOCOL_VERSION` anyway (a server that skipped the error frame), the client
   sets `version-mismatch` itself.

Client reaction (`useRemoteGame.ts`): set `status='version-mismatch'`, record
`serverProtocol`, close the socket, **set `mismatchRef` so the close handler does
not schedule a reconnect**. The UI (`RemoteRoom.tsx`) renders
`Incompatible protocol version — server v<server>, client v<client>`.

Rationale: a version mismatch is deterministic — retrying cannot fix it and
would hammer the server. Reconnect is reserved for *transient* drops (§7).

Tests: `useRemoteGame.test.tsx` "stops and does not reconnect when the server
reports a version mismatch" (asserts `sockets.length === 1` after 10 000 ms of
fake timers), "treats a welcome whose protocol differs as a mismatch",
`RemoteRoom.test.tsx` "explains a protocol version mismatch with both versions".

---

## 7. Reconnect policy

On an **unexpected** close (`closedByUsRef === false` and `mismatchRef === false`):

1. `status = 'reconnecting'`.
2. Back off: `step = min(reconnectMaxMs, reconnectBaseMs * 2 ** attempt)`, then
   wait `step/2 + random()*step/2` (full-jitter-ish: every client on the same
   server does not retry in lockstep). Defaults: base `250 ms`, max `10 000 ms`.
3. Re-open the socket with the **same `clientId`**, which reclaims the seat.
4. On a successful `welcome`, reset `attempt` to `0`, so a later drop starts
   backing off from the base again.

Explicit `leave()` (and unmount) set `closedByUsRef` and close **without**
reconnecting; status is `closed`.

Not reconnected: version mismatch (§6). Not distinguished in v1: user-initiated
close vs. network drop beyond the `closedByUsRef` flag.

Rationale for jitter: a room server restart drops every client at once; without
jitter they all retry on the same tick.

Tests: "backs off and reconnects after an unexpected drop" (fake timers, asserts
a second socket after the delay and a fresh `join`), "reuses the same clientId
across a reconnect so the seat is reclaimed", "stays closed (no reconnect) after
leave()".

---

## 8. Error and test matrix

### 8.1 error codes

| `code`             | When                                   | Client reaction                         |
| ------------------ | -------------------------------------- | --------------------------------------- |
| `version_mismatch` | `join.protocol` ≠ server (§6)          | `version-mismatch`, stop, no reconnect  |
| `room_full`        | reserved (v1 seats spectators instead) | `error` status, message shown           |
| `bad_message`      | frame failed structural validation     | `error` status, message shown           |
| `stale_move`       | `move.revision` behind server (§5)     | server also pushes `state` → resync     |
| `unknown_room`     | join after DO eviction (§4)            | create fresh room / `error` status      |
| `internal`         | uncaught server fault                  | `error` status, message shown           |

Non-`version_mismatch` codes set `status='error'` and surface `error.message`;
they do **not** stop reconnection logic by themselves (the socket stays up
unless the server closes it).

### 8.2 scenario coverage

| Scenario                          | Client test (`useRemoteGame.test.tsx`)            | Worker test (`worker/test/room.test.ts`)     |
| --------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| join → seat + welcome             | handshake "opens a socket, sends join…"          | "assigns white then black, then spectator"   |
| rebuild from welcome moves        | "rebuilds the board from the authoritative…"     | "welcome carries the full move list"         |
| both seats → playing              | "goes to playing only when both seats are filled"| "broadcasts peer when the second seat fills" |
| local move streams out            | "streams a local move out once ready"            | "accepts a move and broadcasts it with ply"  |
| own echo suppressed               | "does not echo a local move back…"               | "echo includes by=clientId"                  |
| gap → resync                      | "requests a resync when a broadcast skips ahead" | "serves state on resync"                     |
| state frame rebuild               | "applies a state frame"                          | "state carries revision + moves"             |
| version mismatch, no reconnect    | "stops and does not reconnect…"                  | "rejects join with a different protocol"     |
| welcome protocol mismatch         | "treats a welcome whose protocol differs…"       | (server never sends this; defensive)         |
| non-version error surfaced        | "surfaces non-version errors…"                   | "rejects a stale move with stale_move"       |
| reconnect w/ backoff              | "backs off and reconnects after an unexpected…"  | (client-side; DO sees a re-join)             |
| clientId reclaims seat            | "reuses the same clientId across a reconnect…"   | "a known clientId reclaims its seat"         |
| leave stops reconnecting          | "stays closed (no reconnect) after leave()"      | "close frees the seat and re-broadcasts peer"|
| malformed frame ignored           | "ignores a malformed frame without crashing"     | "rejects an unparseable frame"               |

### 8.3 explicit non-goals for v1

- No persistence across DO eviction; no move history after the room dies.
- No clocks, no resign/draw over the wire yet (hotseat only).
- No server-side legality check — the server orders moves, the shared client
  rules engine judges legality. (A cheating client could send an illegal move;
  accepted for v1, flagged as a follow-up.)
- No `room_full`: spectators are allowed instead.
