# Draw by agreement — client UI (DRAW_UI)

Status: **landed (t49)** — client half of the t48 wire contract
(`claudedocs/DRAW_PROTO.md` is the wire source of truth). Ship-round 9.

---

## 1. What exists

The local machine mirrors the room's t48 contract one-to-one, so hotseat, vs
AI and remote all share one vocabulary:

| hook surface            | local (`useGame`)                        | remote (`useRemoteGame`)                             |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------- |
| `chooseOffer('offer')`  | parks `drawOffer {state:'offered', by:<mover>}` | sends `offerDraw{code, by:seat}` — no optimistic state |
| `chooseOffer('accept')` | `gameOver {kind:'agreement'}` + clear    | sends `acceptDraw{code}`                             |
| `chooseOffer('decline')`| clears the offer (no end)                | sends `declineDraw{code}`                            |
| `recvDrawOffer(view)`   | — (wire only)                            | mirrors `drawOffer{state,by}` frames ('idle' → null) |
| `recvRoomEnd()`         | — (wire only)                            | mirrors `roomEnd{reason:'draw_agreement'}` → `gameOver {kind:'agreement'}`, offer cleared |

The `drawOffer: DrawOfferView | null` slot lives on `useGame`'s state
(`DrawOfferView = { state: 'offered' | 'awaiting'; by: PieceColor }`). The
local machine only ever *produces* `'offered'` — `'awaiting'` arrives
exclusively from the wire as the offerer's per-seat view.

## 2. State rules (mirroring t48 exactly)

- An offer opens only on the **opener's own turn**; `by` = the side to move.
- A re-offer while one is open is an **idempotent no-op** (no stacking) and
  there is **no revoke** in v1.
- Accept/decline are **not turn-gated** — the room allows the opponent to
  answer on the offerer's own turn (`worker/test/draw.test.ts` proves it), so
  the local machine accepts too. The *answerer's own* `awaiting` view is not
  answerable.
- Moves do **not** clear an open offer (`play()` carries `drawOffer`
  forward); only accept / decline / terminal frames end it, as on the wire.
- `resign` and the hotseat instant `agreeDraw` (T16) clear any open offer;
  `newGame` / `loadPosition` reset the whole state slot.

## 3. AI handling

The engine never offers and never shows the button while it is "the local
player": hotseat hides the offer on the engine's turn
(`aiEnabled && turn === 'black'`). When the human offers, the engine accepts
on its next tick (same `setTimeout` pattern as the move-search effect) —
"a draw is a negotiation, not a search". The human's banner reads
"You offered a draw — waiting for a reply…" with no buttons
(`DrawOfferBanner canAnswer=false`).

## 4. UI

- `ControlBar` button relabeled **"Offer draw"** (same `onOfferDraw` prop).
  Visibility = handler presence: App and RemoteRoom pass it only when the
  game is live, no offer is open and it is the local seat's turn; remote
  additionally requires a connected peer (`canPlay && peerConnected`).
- `DrawOfferBanner` (board-container overlay, like the promotion banner):
  - `offered` + `canAnswer`: "Draw offer from White/Black — accept or
    decline?" with **Accept / Decline** buttons.
  - `awaiting`, or `offered` with `canAnswer=false`: "You offered a draw —
    waiting for a reply…" (nothing clickable).
  - `roomEnd` clears the offer and the existing `GameOverBanner` takes over
    with "Draw — by agreement".
- RemoteRoom now embeds the full `ControlBar` (draw affordance only wired;
  every other action stays disabled) — the remote page previously had no
  draw affordance at all.

## 5. Refusals

`error{code:'invalid_draw'}` (t48 messages: `not_your_turn`, `no_open_offer`,
`game_over`) is a **soft NACK**: `useRemoteGame` ignores it instead of
erroring the room — the follow-up `state` push resyncs the board, matching
the NACK-then-resync shape of rejected moves.

## 6. Tests

Root `npm test`: 189 → **204** (+15).

- `useGame.test.tsx` (+6): open/idempotent re-offer, decline clears, accept
  ends by agreement (+ post-game guard), answerability guards, engine
  auto-accept (fake timers), wire mirroring (`recvDrawOffer`/`recvRoomEnd`).
- `useRemoteGame.test.tsx` (+3): the three wire frames (+ spectator/leave
  inertness), per-seat mirror incl. `roomEnd`, `invalid_draw` NACK softness.
- `DrawOfferBanner.test.tsx` (+4): null → nothing, offered view + both
  buttons fire, awaiting view button-less, `canAnswer=false` button-less.
- `protocol.test.ts` (+2): draw-frame encode/decode round-trips +
  `invalid_draw` in `ERROR_CODES`.
- `ControlBar.test.tsx`: T16 updated for the "Offer draw" label.

## 7. Known limitations (v1)

- No revoke and no offer timeout — an unanswered offer stays open, as on the
  wire.
- A reconnect (`welcome`) does not re-push an open offer state, so the local
  mirror may forget a live offer until the next `drawOffer` frame; the room
  still holds it server-side.
- In hotseat both humans share one view, so "who may answer" is enforced by
  the buttons' placement, not the seat — the server never sees it either way.