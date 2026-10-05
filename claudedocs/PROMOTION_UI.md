# Promotion UI (t45 — round 7)

## Problem

Round 6 made the room worker validate moves against the vendored engine: a
pawn arriving on its promotion zone **must** carry a `promotion` kind
(`worker/src/validate.ts`), otherwise the move is NACKed as `invalid_move`
and the client resyncs to the pre-move position. The human path never sent
a kind (`useGame.play` left `promotion` undefined for click-driven moves),
so a pawn push to the last cell looped forever: play → NACK → resync → stuck.

## Design

- **Detection is engine-authoritative.** On the human's second click, with
  the selection still highlighted, `useGame` asks the engine
  (`movesFrom` over `toRulesState(position, turn)`) whether the arrival
  `from → to` generates promotion moves. The engine's `promotionZone` is the
  single source of truth (white: `a6 b7 c8 d9 e10 f11 g10 h9 i8 k7 l6`;
  black: rank 1), so no geometry is duplicated into `hexMath` and both
  colours work without extra helpers.
- **The move parks** in `pendingPromotion: { from, to, options } | null`
  inside the reducer's `GameState`. Options are the engine's offered kinds
  (Q/R/B/N → `queen rook bishop knight`, deduped, engine order).
- **Banner**: `src/ui/PromotionBanner.tsx`, rendered inside `HexBoard`
  between board and legend on both routes (`App.tsx` hotseat,
  `RemoteRoom.tsx` remote). Selection and target highlights stay up exactly
  like a normal two-click; the banner ("Choose promotion:" + one button per
  kind, plus an Esc hint) is the only new affordance.
- **Complete**: `choosePromotion(kind)` dispatches `choosePromotion`, which
  replays the parked `{from, to}` through `play(...)` with the kind — the
  same `play` path AI and remote peers already use. The recorded move gains
  `promotion`, its SAN gains an `=Q`-style suffix (PGN/MoveList render
  `san` verbatim), and the piece transforms on the board.
- **Cancel**: Esc (window-level listener in `useGame`) dispatches
  `cancelPromotion` — deselect, banner down, no move. Re-clicking the source
  or selecting a different own piece also abandons the parked move; clicking
  another legal target re-evaluates it (promotion cell re-parks, ordinary
  target plays and the banner dies).
- **Silent paths**: AI moves and remote peers apply through the `move`
  action with their own kind — they never raise a banner. The banner can
  only arise from human `clickCell`, which is inert while the AI thinks or
  while browsing history.

## Wire flow (remote)

`sendMove` aliases `applyMove`, and `useRemoteGame`'s outbound effect
already forwards `move.promotion`; with the banner the human's move now
carries the kind and round-6 server validation accepts it. Note: the remote
test drives `loadFen` purely to place a promotion-ready pawn without
scripting a long game — `loadFen` is not part of the remote room UI.

## Files

| File                                                  | Change                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ui/useGame.ts`                                   | `PendingPromotion` type + `pendingPromotion` state, `choosePromotion`/`cancelPromotion` actions, engine detection (`promotionKinds`), Esc listener, `=X` SAN suffix |
| `src/ui/PromotionBanner.tsx`                          | NEW — kind-chooser banner                                                                                                                                           |
| `src/ui/HexBoard.tsx`                                 | new `promotion`/`onPromotionChoose` props, banner mount                                                                                                             |
| `src/App.tsx`, `src/ui/RemoteRoom.tsx`                | wiring only (flagged fence extension)                                                                                                                               |
| `src/ui/theme.css`                                    | `.hxc-promo` styles (flagged fence extension)                                                                                                                       |
| `src/ui/useGame.test.tsx`, `src/ui/HexBoard.test.tsx` | 5 + 1 new tests                                                                                                                                                     |

## Tests

`useGame.test.tsx` → `useGame human promotion (t45)`:

1. banner appears (`pendingPromotion` parked, nothing moved, highlights up)
2. choose completes (piece transforms, `promotion` + `e9 e10=R` SAN, turn flips)
3. Esc cancels and normal play resumes
4. AI-style `applyMove(from, to, kind)` never parks
5. remote: the outbound wire frame carries `promotion: 'queen'`

`HexBoard.test.tsx`: banner renders and forwards the kind; hidden when
nothing is pending. Count: 183 → 189 root (worker stays 31/31, untouched).

## Out of scope / notes

- No `hexMath` last-rank helper added: the engine is the promotion
  authority; geometry would duplicate it.
- `useRemoteGame.ts` needed no behaviour change (`sendMove` aliases
  `applyMove`; the streamer already forwards `move.promotion`).
- `worker/**`, `tsconfig*`, `package.json`, `src/board/**`, `src/rules/**`,
  `src/ai/**`, `protocol.ts`, `router.ts`, `MoveList.tsx`: untouched.
