# hex-chess-worker

Remote-play backend (t41): one Cloudflare Durable Object per room, addressed
by `/room/<CODE>` (4–8 chars). `RoomDO` (src/index.ts) is a thin socket shell;
all room logic lives in the pure, fully unit-tested `RoomCore` (src/room.ts),
talking a byte-compatible copy of the wire protocol (src/protocol.ts, spec:
claudedocs/ROOM_PROTO.md).

## Move validation (t43)

`RoomCore` holds the authoritative position **FEN** — the same serialization
the UI carries — and advances it only when a client move frame passes its
legality gate. A rejected frame is never broadcast and mutates nothing.

### What runs

- `src/validate.ts` — the single bridge:
  `validateMove(fen, from, to, promotion?)` →
  `{ ok: true; nextFen: string; san: string } | { ok: false; reason: string }`.
- The Gliński rules engine, **vendored verbatim** from the repo's engine
  sources, so the worker and the UI can never disagree about legality:

  | worker module           | copied from             |
  | ----------------------- | ----------------------- |
  | `src/rules/rules.ts`    | `src/rules/rules.ts`    |
  | `src/board/axial.ts`    | `src/board/axial.ts`    |
  | `src/board/colors.ts`   | `src/board/colors.ts`   |
  | `src/board/pieces.ts`   | `src/board/pieces.ts`   |
  | `src/board/notation.ts` | `src/board/notation.ts` |
  | `src/board/fen.ts`      | `src/board/fen.ts`      |

  The copies are import-closed (the engine is pure TS — nothing to strip), so
  the worker bundle never reaches outside `worker/`. The `src/board/board.ts`
  barrel (ray/placement helpers used only by UI rendering) is deliberately NOT
  vendored — the engine and the bridge never import it.

  Regenerate the copies after engine changes:

  ```
  cp src/rules/rules.ts worker/src/rules/
  cp src/board/axial.ts src/board/colors.ts src/board/notation.ts src/board/pieces.ts src/board/fen.ts worker/src/board/
  ```

  and confirm they are byte-identical (`cmp`).

### Wire behaviour

On a `move` frame, after the room's seat and revision gates:

1. **Seat gate (new in t43):** the seat's colour must equal the side to move.
   A seat playing the other colour is NACKed even for a geometry-legal move —
   otherwise a broadcast could carry the wrong colour and diverge the clients.
2. **Rules gate:** `validateMove` runs the frame through the vendored engine.
   An unknown cell, empty origin, opponent's piece, illegal geometry, missing
   or wrongly-typed promotion, or a malformed stored FEN each answer
   `{ type: 'error', code: 'invalid_move', message: <reason> }` plus a fresh
   `state` frame to re-sync the sender.
3. **Accept:** the FEN is replaced by `nextFen`, the revision bumps, and the
   move broadcasts to all conns as before (the promotion kind passes through).

Tests: `test/validate.test.ts` (bridge: opening double push with SAN + ep
target, engine-serialize equality, hostile geometry, wrong-turn piece,
promotion choice, malformed FEN / cell / empty origin) and `test/room.test.ts`
(room behaviour: NACK without broadcast or revision bump, rejected-then-legal
sequence stays consistent, seat gate, promotion broadcast).

## Persistence (t44)

A room outlives its Durable Object instance. `RoomCore` exposes
`snapshot(): RoomSnapshot` (`{ fen, moves, revision }`) and its constructor
takes an optional `RoomSnapshot` to hydrate from — the round-trip pair.
`RoomDO` (src/index.ts) wires that to the object's own storage:

- **Hydrate** — on first `fetch`, if `this.core` is unset, the DO reads the
  `'room'` key and passes it to `new RoomCore(code, saved)`. A respawned object
  therefore resumes with the same code, revision and move list.
- **Persist** — after every `move` frame the DO writes `core.snapshot()` back
  to `'room'`. The write is fire-and-forget (`void storage.put(...)`): DO
  storage writes are coalesced and flushed before eviction, so awaiting would
  only add latency. Non-mutating frames (`join`/`resync`/`ping`) skip the write.

Seats are **not** persisted — they are live-connection state, re-derived from
the first joiners on a respawn (see ROOM_PROTO §4.7). The snapshot lives in the
DO's sqlite-backed storage (no extra binding needed —
`new_sqlite_classes = ["RoomDO"]` in wrangler.toml).

The DO wrapper itself is not unit-tested (the vitest suite runs on Node, with no
`WebSocketPair`/workerd); its persistence get/put is covered by the `RoomCore`
snapshot tests plus a `wrangler deploy --dry-run` bundle check. A full workerd
DO test would need `@cloudflare/vitest-pool-workers` (follow-up).

Tests: `test/room.test.ts` "RoomCore persistence (t44)" — revive keeps code +
revision + history, a revived room continues from the restored **position**
(not just the list), and a revived room still rejects a stale move.

## Draw agreement (t48)

A draw by mutual agreement, server-side. Spec: `claudedocs/DRAW_PROTO.md`;
wire shapes appended to `claudedocs/ROOM_PROTO.md` §9.

- **Frames.** Client `offerDraw{code, by}` / `acceptDraw{code}` /
  `declineDraw{code}`; server `drawOffer{code, state, by}` (delivered **per
  seat**: the offerer sees `awaiting`, the opponent `offered`, and `idle`
  clears) and the terminal `roomEnd{code, reason:'draw_agreement'}`.
  Additive — `PROTOCOL_VERSION` is not bumped.
- **Authority.** The acting seat is taken from the connection, never the wire
  `by`. An offer must be on the offerer's own turn; only the opponent may
  accept or decline. Refusals are `invalid_draw` (+ a `state` push) with a
  reason in `not_your_turn | no_open_offer | game_over` — kept distinct from
  `invalid_move`.
- **State.** One open offer at a time; a second offer is an idempotent no-op.
  No revoke (simpler path; see `DRAW_PROTO.md` §8). An agreed draw is the
  room's only terminal state in v1.
- **Code.** `RoomCore.offerDraw/acceptDraw/declineDraw` are pure transitions
  returning `DrawResult`; `receive` turns that into frames. `validateDraw()`
  (`src/validate.ts`) is the shape gate. `RoomSnapshot` now carries
  `drawOffer`/`drawBy`/`ended`, so a revived room keeps its offer (t44).

Tests: `test/draw.test.ts` — happy path, decline, cross-turn, no-offer /
self-accept, spectator, game-over, revive, malformed payload.

## Clock (t56)

A server-authoritative chess clock. Spec: `claudedocs/CLOCK.md`.

- **Time control.** 5 min + 3 s increment, fixed constants in `src/clock.ts`
  (there is no `createRoom` call to negotiate with — the code is generated
  client-side). The clock is initialised at room creation and **runs** from the
  second `join`; a dropped socket does not pause it.
- **Derived, not counted.** `ClockState { white, black, since }` stores each
  seat's remaining time _as of_ `since`, the epoch ms the running seat started
  burning. A seat's real remaining time is `stored - (now - since)`, so no
  storage write is needed per tick.
- **Tick driver.** The DO's alarm — its only timer, and one that survives
  eviction — calls `RoomCore.tick(now)` at 1 Hz while a clock burns and
  broadcasts `clock{white, black, turn, running}`. The alarm stops when the
  clock does. `RoomCore` holds no timer: `now` is injected via the constructor.
- **Flag fall.** At zero the room ends: a final `clock` at `0`, then
  `roomEnd{reason:'time', winner}`. The room is terminal and refuses moves.
- **Protocol.** `PROTOCOL_VERSION` **1 → 2**: `welcome` gained `clock` and
  `ended`; `roomEnd.reason` gained `'time'`. The client copy
  (`src/ui/protocol.ts`) must bump in the same commit.
- **Persistence.** `RoomSnapshot` carries `clock`, so an evicted room resumes
  with the right numbers; a room woken after a clock expired flags on its first
  tick.

Tests: `test/clock.test.ts` — burn only the side to move, tick cadence,
increment + hand-over, flag fall, no move after the end, revive mid-game, flag
after eviction, draw stops the clock.
