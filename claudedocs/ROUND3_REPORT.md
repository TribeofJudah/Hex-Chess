# Round 3 worker report — spp2 (pane 42)

Date: 2026-10-05 · Branch: `dev` · Base HEAD: `8ab6f11`
**Nothing committed.** All changes are uncommitted in the shared checkout for
dispatcher review, per `TASKLIST.md`.

## Gate status

| Gate | Result |
|------|--------|
| `npm test -- src/ui` (all) | **150/150 passed** (was 137) |
| `npx tsc --noEmit` | clean |
| `npm run lint` (`eslint .`) | clean |
| `npm run build` | clean |
| `prettier --check "src/**/*.{ts,tsx,css}"` | clean |

## Tasks delivered (five units)

### t30 — T13 — Position editor UI (load FEN into the live board)
- NEW `src/ui/PositionEditor.tsx` — form + `<input>`, Load button, `role="alert"` error.
- NEW `src/ui/PositionEditor.test.tsx`.
- `src/ui/useGame.ts` — `fenToPieces()`, `stateFor()`, `GameAction{loadPosition}`, `loadFen()` (try/catch → `{ok}`/`{ok:false,error}`), `keyCounts` seeded in `stateFor`.
- `src/App.tsx` — `<PositionEditor onLoad={game.loadFen} />`.
- `src/ui/theme.css` — `.hxc-position`, `.hxc-position__label`, `.hxc-input`, `.hxc-position__error`.
- `src/ui/useGame.test.tsx` — `describe('position editing (T13)')`, `KING_FEN` round-trip.

### t31 — T16 — Resign + draw-offer wired to gameOver
- `src/ui/useGame.ts` — `GameOver.kind` gains `'resign' | 'agreement'`; actions `resign`/`draw`; `resign()`/`agreeDraw()` on the hook.
- `src/ui/ControlBar.tsx` — Resign + Draw buttons (disabled when handler absent).
- `src/ui/GameOverBanner.tsx` — `'resign'` / `'agreement'` banner text.
- `src/App.tsx` — `onResign`/`onOfferDraw` wiring; `gameOverText()` cases.
- `src/ui/pgn.ts` — `pgnResult`: resign → `1-0`/`0-1`.
- Tests: `GameOverBanner.test.tsx`, `ControlBar.test.tsx`, `pgn.test.ts`, `useGame.test.tsx` (T16).

### t32 — T17 — HexBoard keyboard nav (arrows select, Enter confirms)
- `src/ui/HexBoard.tsx` — `ARROW_STEPS`, `arrowNeighbor()`, roving `focused` state (default `f6`), `rootRef` + focus effect, `onCellKey` (Enter/Space → click, arrows → move focus), `tabIndex` per cell.
- `src/ui/HexBoard.test.tsx` — arrow-nav + Enter test.

### t33 — T15 — AI difficulty selector (depth 1–5)
- `src/ui/useGame.ts` — `clampDepth()` (1–5, non-finite→3), `aiDepth` state, `setAiDepth()`, `aiDepth` added to AI effect deps.
- `src/ui/ControlBar.tsx` — `DEPTHS = [1..5]` `<select className="hxc-select" aria-label="AI depth">`.
- `src/App.tsx` — `aiDepth`/`onAiDepthChange` wiring.
- `src/ui/theme.css` — `.hxc-depth`, `.hxc-select`.
- Tests: `ControlBar.test.tsx`, `useGame.test.tsx` (T15).

### t34 — T14 — Move-list click to jump back
- `src/ui/useGame.ts` — `GameStore.viewPly`, `GameAction{jumpTo}`, `timeline`/`shown`/`livePly` derivation, `jumpTo()`, `viewPly` on the result.
- `src/ui/MoveList.tsx` — `viewPly`/`onJump` props; moves are `<button className="hxc-movelist__move" aria-current>`.
- `src/App.tsx` — `viewPly`/`onJump` props.
- `src/ui/theme.css` — `.hxc-movelist__move`.
- Tests: `MoveList.test.tsx`, `useGame.test.tsx` (T14).

## Two things the dispatcher needs to know

### 1. The five tasks are NOT file-disjoint
`useGame.ts`, `App.tsx`, `theme.css` and `ControlBar.tsx` are each touched by
2–4 of the tasks. Committing them as five clean commits therefore requires
**splitting by hunk, not by file**. Suggested grouping if hunk-splitting is
undesirable: t30+t33 (both add controls/state to the hook+bar) or one combined
"round 3 UI" commit. I have not split them; the tree is one uncommitted blob.

### 2. Pre-existing gap found: App.tsx was unwired from round 2 (t29)
At HEAD, `ControlBar` and `useGame` already exposed `aiEnabled`/`onToggleAi`
and `onExportPgn`, but `App.tsx` never passed them — the AI toggle and Export
PGN buttons rendered disabled. t33 cannot function without that wiring, so I
connected it as part of this round (`src/App.tsx`). This is a fix to t29's
leftovers, not new scope.

## Bug found (PRE-EXISTING — not mine)

**The board renders as a squashed strip of pieces at the bottom edge — the
91 cells never draw.** Verified against a clean HEAD worktree (`8ab6f11`):
identical `viewBox="0 0 412 461.261"` and `transform="translate(-206 -230.6307065990918)"`
on both HEAD and the working tree; HEAD renders the same broken strip. My
HexBoard diff is keyboard-only and leaves all geometry byte-identical.

Likely cause: the inner `<g>` is translated by half the viewBox (centring
assumption) while the viewBox origin is `0 0`, pushing cell content negative
and clipping it. Not fixed here — out of scope for these five tasks. Recommend
a dedicated fix task.

## Cleanup done
- Dev servers on 5173/5174 killed.
- Temp HEAD worktree `/tmp/hexhead` removed (`git worktree list` clean).
- Stray root PNGs and `.playwright-mcp/` removed.

## Working-tree files (uncommitted)
Tracked (M): `claudedocs/TASKLIST.md`, `src/App.tsx`, `src/ui/{ControlBar,GameOverBanner,HexBoard,MoveList}.tsx` (+ `.test.tsx`), `src/ui/theme.css`, `src/ui/useGame.ts` (+ `.test.tsx`).
Untracked (??): `src/ui/PositionEditor.tsx` (+ `.test.tsx`), `src/ui/pgn.ts` (+ `.test.ts`).
