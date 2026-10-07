# Draw by agreement — wire protocol (DRAW_PROTO)

Status: **draft v2** — server-side only (t48), client UI landed in Round 9
(R9, `6415790`). The draw-agreement half of the terminal-enforcement contract
is unchanged; the rest of the wire bumped to `PROTOCOL_VERSION = 3` in R12
to widen `roomEnd.reason` to six values. This document is the source of truth
for the offer / accept / decline state machine and the
`roomEnd{reason:'draw_agreement'}` terminal it owns.

A draw may be agreed when one seat offers and the opponent accepts. Frames ride
the **existing** room WebSocket (`<worker-origin>/room/<CODE>`, JSON text — see
`ROOM_PROTO.md` §1); there is no new transport. `PROTOCOL_VERSION` was **not**
bumped by t48: the frames are additive, and a v1 client that ignores them is
unaffected. (R12 later bumped to 3 — see `ROOM_PROTO.md` §3.)

---

## 1. Seats and authority

- Only the two seated players may act. The acting seat is derived from the
  **connection** (`RoomCore.live`), never from the wire `by` field — a client
  cannot claim the opponent's seat. A spectator's frame is refused with
  `invalid_draw`.
- An offer may only be opened on the **offerer's own turn**, matching chess
  etiquette: white may offer only while it is White to move. The DO enforces
  this; an offer on the opponent's turn is refused with `invalid_draw`
  (`not_your_turn`).
- Only the **opponent** of the offerer may accept or decline. The offerer
  answering their own offer is refused (`no_open_offer`).

---

## 2. Message shapes

Added to `worker/src/protocol.ts` (byte-identical to the copy the client will
get in Round 9).

### 2.1 client → server

```ts
interface OfferDrawMsg {
  v: number
  type: 'offerDraw'
  code: string
  by: Seat
}
interface AcceptDrawMsg {
  v: number
  type: 'acceptDraw'
  code: string
}
interface DeclineDrawMsg {
  v: number
  type: 'declineDraw'
  code: string
}
```

- `code` is the room code (routing already identifies the room; it is carried
  for symmetry and shape-checked, not trusted).
- `by` is **advisory**: the server uses the connection's seat. It is
  shape-checked (must be `white`/`black` for an offer) and otherwise ignored.

### 2.2 server → client

```ts
interface DrawOfferMsg {
  v: number
  type: 'drawOffer'
  code: string
  state: 'offered' | 'awaiting' | 'idle'
  by: Seat
}
interface RoomEndMsg {
  v: number
  type: 'roomEnd'
  code: string
  reason: 'draw_agreement'
}
```

`drawOffer` is delivered **per seat** (not one identical broadcast):

| `state`    | who receives it                      | meaning                           |
| ---------- | ------------------------------------ | --------------------------------- |
| `awaiting` | the seat named in `by` (offerer)     | you offered; the opponent replies |
| `offered`  | everyone else (opponent, spectators) | an offer is open to you           |
| `idle`     | everyone                             | the offer is cleared              |

`by` names the seat that most recently acted (offerer, or the accepter /
decliner when the offer clears). `roomEnd{reason:'draw_agreement'}` is the
terminal frame on acceptance. In v3 it is **one of six** wire-emitted reasons
(this document owns only the first):

- `draw_agreement` (this doc, t48 / R8–R9): both seats consented; no `winner`.
- `time` (`CLOCK.md`, t56 / R10): a clock ran out; `winner` is the opponent.
- `checkmate` / `stalemate` / `draw50` / `repetition` (`TERMINALS.md`,
  t62 / R12): the engine game-end states; `checkmate` and `stalemate` carry
  a `winner` (the trapping side); the two draws do not.

The union lives in `worker/src/protocol.ts` (`RoomEndMsg.reason`) and is
mirrored in `src/ui/protocol.ts`. v2 clients are rejected at join with
`version_mismatch` because their `reason` union cannot represent the four
new values.

---

## 3. State machine

Room-level (what `RoomCore` stores); the per-seat view above is derived from
`by`.

```text
  idle ──offerDraw(own turn)──▶ awaiting ──acceptDraw──▶ (ended, idle)
    ▲                             │
    └────────declineDraw──────────┘
```

- `idle` — no offer open.
- `awaiting` — an offer is open, owned by `by`; the opponent must accept or
  decline. A second `offerDraw` while `awaiting` is an **idempotent no-op**
  (the offerer cannot re-offer or stack offers).
- `ended` — a draw was agreed. The room is terminal: any further draw frame is
  refused with `invalid_draw` (`game_over`).

The brief's per-seat `offered` state is the opponent's view of `awaiting`; it
is carried on the wire (`state: 'offered'`) but not stored — the room has only
two states plus the terminal flag.

---

## 4. Return shape — `RoomCore`

`offerDraw(by)` / `acceptDraw(by)` / `declineDraw(by)` are pure transitions
returning a `DrawResult`, mirroring `MoveVerdict`:

```ts
type DrawResult =
  | {
      ok: true
      drawOffer: 'offered' | 'awaiting' | 'idle'
      by: Seat
      end?: { reason: 'draw_agreement' }
    }
  | {
      ok: false
      error: 'invalid_draw'
      reason: 'not_your_turn' | 'no_open_offer' | 'game_over'
    }
```

`receive()` turns an `ok` result into the wire frames and a failure into
`error{code:'invalid_draw', message: reason}` plus a fresh `state` push — the
same NACK-then-resync shape as a rejected move.

`reason` mapping:

| reason          | when                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `not_your_turn` | offer on the opponent's turn, or any frame from a spectator           |
| `no_open_offer` | accept/decline with no offer open, or the offerer answering their own |
| `game_over`     | any draw frame after the room has ended                               |

---

## 5. Validation

`validateDraw(msg)` in `worker/src/validate.ts` is the shape gate, called
before any state change:

- `code` must be a non-empty string — else `invalid_draw`.
- an `offerDraw.by` must be `white`/`black` — else `invalid_draw`.

It is deliberately shape-only: legality (whose turn, who may answer) is the
room's job, because it depends on live state the wire cannot assert. A
malformed payload is `invalid_draw`, kept **distinct** from `invalid_move` so
the client can tell the two apart.

---

## 6. Persistence

`RoomSnapshot` (`worker/src/room.ts`) carries `drawOffer`, `drawBy` and
`ended`, so a room revived after DO eviction keeps an open offer and resumes a
terminal one. The fields are optional in the type, so a pre-t48 snapshot still
hydrates (defaults: `idle`, `null`, `false`).

---

## 7. Coverage

Worker tests (`worker/test/draw.test.ts`): happy path (offer → accept →
`roomEnd`), decline clears the offer, cross-turn offer refused, no-offer and
self-accept refused, spectator refused, offer after game-over refused, revived
room keeps its offer, malformed payload refused.

---

## 8. Non-goals for v1

- **No revoke.** An offer in flight cannot be withdrawn — only offer →
  accept-or-decline. (The brief listed a revoke; the simpler path was chosen
  and flagged.) A re-offer while an offer is open is a no-op, so the offerer
  is not stuck: the opponent must still answer or the game continues.
- Client UI is live (R9, `6415790`): the "Offer draw" button in
  `RemoteRoom.tsx` opens a per-seat draw-offer banner; acceptance is
  gated on the offerer's own turn and the opponent's explicit accept.
- Clocks (t56, R10) and the engine game-end terminals (t62, R12) live
  on the same socket. `roomEnd` carries six reasons in v3:
  `draw_agreement` | `time` | `checkmate` | `stalemate` | `draw50`
  | `repetition`. This document only owns the first; the others are
  in `CLOCK.md` §7 and `TERMINALS.md`.
- Resign is **not** yet on the wire (Round 13 candidate; would
  bump `PROTOCOL_VERSION` to 4 and add `roomEnd{reason:'resign', winner}`).
