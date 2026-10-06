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
`src/rules/rules.ts` lines 13 + 408). This is unusual on its own, and the
question of **which** of the two sides is the "stalemater" is the substance
the room has to decide.

### 2.1 Implementation choice in the worker

This build implements `winner = turn`, where `turn` is the side whose turn it
is when stalemate is reached (the side with no legal moves and not in
check). This is the brief's default, and it matches the engine's own
reporting: `status()` reads `state.turn` for that.

### 2.2 Why this is documented as an open call

There is a vocabulary mismatch in the source material the project inherits:

- **Conventional chess vocabulary**: the side *delivering* stalemate is the
  side whose move left the opponent with no options. They are conventionally
  the side whose turn it **was not** — the side that *would now* be on the
  move.
- **Gliński convention (this codebase)**: "the stalemater" is the side whose
  turn it is. The 3/4 partial score goes to the side that has no legal move
  and is not in check, because their move can only be a passive king-twitch
  that the opponent will exploit.

Under the conventional reading the implementer would write `winner = other(turn)`
(the mirror of `checkmate`). Under the engine-codebook reading they write
`winner = turn` (the side that `status()` reports as the stalemated side).

The brief asks me to do the second; I have done so. The implementation note
in `worker/src/room.ts` (see `checkTerminal()`'s stalemate branch) flags
this as a question for Round 13 to resolve. If Round 13 changes the call,
only the one branch is touched — the wire shape, the protocol bump, the
snapshot schema, and the rest of the test suite are unaffected.
---

## 3. Protocol bump (2 → 3)

`PROTOCOL_VERSION` is bumped to **3**. The reason union widening is an
incompatible message-shape change under `ROOM_PROTO.md` §2 — a v2 client
that switches on `reason` would silently miss any of the four new values,
playing a finished board. The join handshake rejects a v2 client with
`version_mismatch` instead.

> **Both copies must bump together.** The worker copy is
> `worker/src/protocol.ts`; the client copy is `src/ui/protocol.ts`. The t62
> fence covers `worker/**` only, so the client bump is a **required
> follow-up** for the Round 13 client pass. A worker-only deploy without the
> client bump will not break v2 clients (they cannot join), but it leaves
> the wire shape inconsistent. Tracked here, not in a separate issue list,
> because Round 13 is the natural place to land.

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
