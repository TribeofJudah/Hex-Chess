# Engine-game-end terminals on the room (Round 12, t62)

Date: 2026-10-05 · Branch: `round12(terminals-worker)` (this round; mirrored
on `dev` once it lands)

Source: dispatcher `dpp1` (worker fence). Status: **draft** — Round 12 lands
this on the worker; the client UI lands in Round 13 and may amend the
stalemate-winner call documented in §2.

The room enforces the four engine game-end states (`checkmate`, `stalemate`,
`draw50`, `repetition`) in addition to the two terminals it already had
(`draw_agreement`, t48; `time` for a flagged clock, t56). This document is
the source of truth for those wire-level decisions; the prototype lives in
`worker/src/room.ts`, the wire shapes in `worker/src/protocol.ts`, the
predicates in `src/rules/rules.ts` (`status()`), and the persistence contract
in `worker/README.md` (RoomSnapshot).

---

## 1. Wire surface

`roomEnd.reason` widens to four new values. The full union is:

```ts
reason: 'draw_agreement' | 'time' | 'checkmate' | 'stalemate' | 'draw50' | 'repetition'
```

`winner` semantics:

| reason          | `winner`                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `draw_agreement` | absent — neither side wins (t48)                                                                              |
| `time`          | present — the seat whose clock did **not** expire (t56)                                                        |
| `checkmate`     | present — the seat that delivered mate, i.e. the opponent of the side whose turn it is                       |
| `stalemate`     | present — see §2 for the open call                                                                              |
| `draw50`        | absent — neither side wins                                                                                     |
| `repetition`    | absent — neither side wins                                                                                     |

`welcome.ended` (carried since t56) still reads true for any of these.

---

## 2. Stalemate: who wins 3/4?

The Gliński rules score stalemate **3/4 : 1/4**, not 1/2 : 1/2 — the side
that delivered the stalemate wins the larger partial point (see
`src/rules/rules.ts` lines 13 + 408). The semantic question of which side
is the "stalemater" has a single canonical answer in this codebase:

**The side that trapped the opponent's king. The `winner` field is the
trapping side, i.e. `other(turn)` where `turn` is the side whose turn it is
when the engine reports stalemate.**

This is the same convention as `src/rules/adapter.ts:64`, where
`statusAfter` returns `{ kind: 'stalemate', winner: opponent }`. It is the
same convention as `src/ui/useGame.ts:585` (the reducer's `recvRoomEnd`
case for stalemate) and the PGN exporter (`pgnResult` returns
`3/4-1/4` / `1/4-3/4` against the winner). All four agree.

### 2.1 Why `winner = other(turn)` and not `winner = turn`

The engine's `status()` returns `'stalemate'` for the side whose turn it
is when the position has no legal moves and is not in check. That side
is the **stalemated** side in game-theoretic vocabulary — the side that
cannot move. Conventional chess (FIDE, PGN export conventions) awards
the partial point to the **other** side: the one that *did* move and
*did* trap the king. The engine adapter `statusAfter` already encodes
this with `winner: opponent`, and the room does too.

An earlier draft of Round 12 picked `winner = turn` based on a literal
read of the engine's `state.turn`. That reading is incoherent with
`statusAfter`, with conventional chess, and with the line comments in
`useGame.ts:585`. It was caught during dispatcher gates and corrected to
`winner = other(turn)` before merge.

### 2.2 Stalemate fixtures

The engine's `stalemate` branch is `legalMoves(state) === 0 && !inCheck(state, state.turn)`.
The rules test's exhaustive search only finds the Map-overwrite path (a
K+Q at the same cell). The chosen fixture instead exercises the **king-capture**
path: the engine's `pseudoMoves` doesn't exclude king captures, so a queen
can capture the enemy king. Post-move the captured side has no king and
no pieces. `inCheck(state, 'b')` returns `false` because
`findKing(state, 'b') === null`. `legalMoves(state, 'b') === 0` because
there are no black pieces. `status()` therefore returns `'stalemate'`.

Pre: white queen at `d8`, black king at `c8`, white king at `l1`. White
plays `Q@d8→c8` (king capture). Post: black has nothing → engine says
`stalemate` → room broadcasts
`roomEnd{reason: 'stalemate', winner: 'white'}`.

The `winner = other(turn) = 'white'` is the side that *just moved*, the
side that trapped the opponent's king. That is the side that earns the 3/4
partial point under Gliński rules.
---

## 3. Protocol bump (2 → 3)

`PROTOCOL_VERSION` is bumped to **3**. The reason union widening is an
incompatible message-shape change under `ROOM_PROTO.md` §2 — a v2 client
that switches on `reason` would silently miss any of the four new values,
playing a finished board. The join handshake rejects a v2 client with
`version_mismatch` instead.

> **Both copies must bump together.** The worker copy is
> `worker/src/protocol.ts`; the client copy is `src/ui/protocol.ts`. The t62
> fence covers `worker/**` only; the client bump lands in the matching
> `round12(terminals-client)` branch (commit `4139737`). Both copies are
> `PROTOCOL_VERSION = 3`. The PR that merges both lands on `dev` together.

---

## 4. Position-key history & repetition persistence

The engine's `status()` reads `state.history` for threefold repetition. The
FEN does not carry it, so the room maintains a parallel `history: string[]`
field (`RoomSnapshot.history`, t62) — one entry per accepted move plus the
opening position key. `checkTerminal()` calls `status()` on a `GameState`
rebuilt from the current FEN + this parallel array.

### 4.1 What it is

- One entry per applied move: `positionKey(board, turn, ep)` of the
  post-move position.
- Computed the same way the engine's `applyMove` computes it (mirrored as
  a private helper in `worker/src/room.ts` because the engine's
  `positionKey` is not exported). The two are bit-equal by hand.
- The first entry of a fresh room is the opening position key, computed
  once at module load (`INITIAL_POSITION_KEY`).

### 4.2 Why a snapshot needs to carry it

Without `history` in the snapshot, a room that is revived after a DO eviction
loses its position-key track. The 50-move counter and the halfmove counter
survive (they live in the FEN), but the threefold-repetition counter does
not — a game that has already cycled twice would lose its "2 occurrences"
state and would never detect the third. `RoomSnapshot.history` closes that
gap. The repetition test in `worker/test/terminals.test.ts` exercises the
seed→revive boundary explicitly.

### 4.3 What if a pre-t62 snapshot is revived

Pre-t62 snapshots don't carry `history`. The constructor hydrates with
`[INITIAL_POSITION_KEY]`, which is a clean slate for repetition counting —
the same state a brand-new room takes. **This means a game in progress
that is revived across the eviction boundary loses any in-flight
repetition window.** `checkmate`, `stalemate`, `draw50` are unaffected
because they do not read `history`.

`welcome.ended` is already part of the snapshot, so a pre-t62 terminal room
re-emerges as terminal — see the snapshot-persistence test.

---

## 5. What did NOT change in Round 12

- **The engine (`src/rules/rules.ts`)** — the predicates `status()`,
  `applyMove()`, `legalMoves()` are unchanged. The room is the bridge; the
  rules engine is the oracle.
- **The client mirror (`src/ui/protocol.ts`, `src/ui/RemoteRoom.tsx`,
  `src/ui/useRemoteGame.ts`)** — explicitly out of the worker fence. The
  brief's hard constraint forbids it. The client UI for stalemate/draw50/
  repetition banners, the result-line text, and the protocol bump on the
  client side land in Round 13.
- **The other terminals (t48 + t56)** — `draw_agreement` and `time` are
  unchanged. They share the close-out path with the new four (set `ended`,
  freeze the clock, broadcast `roomEnd`), which is the only structural
  change to `room.ts`.
- **Hotseat / vs-AI play** — `src/ui/useGame.ts` already runs the same
  engine locally and surfaces the game-end via its own adapter; the worker
  enforcement is invisible to those flows.

---

## 6. Tests

`worker/test/terminals.test.ts` (new, 6 tests):

| Test                                                       | What it covers                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `checkmate → roomEnd{reason:"checkmate", winner: deliverer}` | Wikipedia Fool's mate seeded into the room; Qc3xf9# fires      |
| `stalemate → roomEnd{reason:"stalemate", winner: side whose turn it is}` | K@`c8`+Q@`d8`+K@`l1`, Qd8→c8 captures the king; stalemate |
| `draw50 → roomEnd{reason:"draw50"} with no winner`          | Custom FEN with halfmove=100; a single king move triggers     |
| `repetition → roomEnd{reason:"repetition"} with no winner`  | Knight shuffle, two cycles; cycle 1 in the snapshot, cycle 2 in the room |
| `refuses a move once the room is terminal`                  | Post-stalemate, follow-up move is NACKed with `the room has ended` |
| `a snapshot with ended:true stays terminal`                 | `welcome.ended` carries through; moves are NACKed             |

All 6 pass alongside the 52 pre-existing worker tests (58/58 green).
