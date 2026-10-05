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
