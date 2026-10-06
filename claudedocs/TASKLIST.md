# Hex-Chess Task List (dispatcher brief)

Repo: https://github.com/TribeofJudah/Hex-Chess · local: ~/Desktop/Projects/HexChess
Stack decision: Vite + React + TypeScript, SVG hex board, Vitest, plain CSS, no backend (local 2-player first).
Visual direction: retro/pixel aesthetic — pixel typeface (Press Start 2P, bundled via @fontsource/press-start-2p, loaded locally, no runtime CDN), limited 8-bit palette on dark background, chunky 2px borders, hex cells as flat colored tiles, pieces as pixel-style SVG glyphs, optional CRT scanline overlay (CSS only, toggleable). No Tailwind, no UI kit, no icon deps.
Agent stack: dpp1 = dispatcher (antigravity cli, pane 38) — owns GitHub, adds/dispatches luvus tasks, reviews + merges everything. dvv1 = developer 1 (freebuff glm5.3 flash, pane 41) — engine + tests. dvv2 = developer 2 (claude glm5.3 flash, pane 37) — UI + visual tasks.
Branch model: `dev` as integration branch, per-task feature branches (`task/<n>-<slug>`), PR into `dev`, PR to `main` per phase. Dispatcher reviews + merges + pushes GitHub.
Source of truth for rules: https://en.wikipedia.org/wiki/Hexagonal_chess#Gliński's_hexagonal_chess — devs must verify every rule against it, not from memory.

## Phase 0 — Foundation (gate: `npm run build && npm test` green)

**T1 — Scaffold** (dvv1)

- Vite + React + TS project, Vitest, ESLint + Prettier, GitHub Actions CI (lint+test+build on PR).
- Files: package.json, tsconfig, vite config, .eslintrc, .github/workflows/ci.yml, minimal index.html + main.tsx with a stub App.
- Done: `npm run dev` serves a page; CI green.

**T2 — GitHub hygiene** (dispatcher)

- Add repo description, topics (`hex-chess`, `chess`, `typescript`, `glinski`), branch protection on `main` + `dev`, README rewritten: build/run/test instructions + screenshots after T6.

## Phase 1 — Rules engine (gate: full test suite green)

**T3 — Board model** (dvv1) — paths: `src/board/`

- Hex coordinates (axial q/r), 91 hexes, valid-range check.
- Gliński notation: 11 files a–l **omitting j**, 11 ranks (1–6, 7–11 hexes per file, rank 6 = 6 cells... verify exact per-file heights from source).
- Done: cell lookup + round-trip notation parsing tests.

**T4 — Move generation** (dvv1 — this is the hardest task, do it alone before UI) — paths: `src/rules/`

- Piece moves: rook 6 directions, bishop 6 diagonals, queen = both, knight hex-knight offsets, king 1 cell + capture.
- Pawns: forward move (2 forward directions), diagonal capture; double-step and its per-file exceptions; the b-file pawn rule; promotion at last rank. All verified against source, with named test cases.
- Castling / en passant / stalemate / repetition: **verify whether Gliński's includes them before implementing.** Wikipedia says Gliński's has no castling; confirm from the source and state it in the PR.
- Pin/check/checkmate/50-move: legality filter + game-end detection.
- Done: unit tests per piece + per edge case.

**T5 — Perft validation** (dvv1) — paths: `src/rules/perft/`

- Node-count depth test from the standard initial position (known Gliński perft values are published; find from ChessProgramming/ChessV if no Wikipedia values).
- Done: perft(1..3) matches published numbers. If no publication found, hand-verified perft(1) counts + cross-check vs an existing open-source Gliński implementation link in the PR.

## Phase 2 — Playable site (gate: full game works in browser)

**T6 — Board UI** (dvv2) — paths: `src/ui/`

- SVG hex board, pieces as pixel-style SVG glyphs (no image assets), click-to-move + legal-move highlight, check highlight.
- Done: renders from the real rules engine; screenshot approved.

**T7 — Retro theme pass** (dvv2, after T6 looks correct in layout) — paths: `src/ui/`

- Press Start 2P for headings/labels (small sizes only — pixel fonts get unreadable in body text; use a clean fallback for the move list), palette tokens as CSS custom properties, scanline overlay toggle, subtle cell hover/last-move animation.
- Done: Rams `review_files` score recorded, screenshot approved by dpp1.

**T8 — Game flow** (dvv2) — paths: `src/ui/`

- Two-player hotseat, move list (Gliński notation), new game, undo, checkmate/stalemate/draw banner.
- Done: complete game playable end to end.

**T9 — Deploy** (dpp1)

- GitHub Pages workflow (static `dist/`). Done: site live, link in README.
- Ship as MVP: hotseat only.

## Agent assignment (panes)

| Task                   | Agent                  | Pane | Basis                       |
| ---------------------- | ---------------------- | ---- | --------------------------- |
| T1, T3, T4, T5         | dvv1 (freebuff glm5.3) | 41   | engine/test work, text-only |
| T6, T7, T8             | dvv2 (claude glm5.3)   | 37   | visual/UI work              |
| T2, T9, merges, GitHub | dpp1 (antigravity)     | 38   | dispatcher                  |

## Phase 3 — Post-MVP (backlog; do not start before T8)

- Simple AI opponent (negamax over the rules engine — no new deps).
- Remote play (realtime via free hosting tier), account-less rooms.
- Position editor / FEN-like serialization for tests and sharing.
- Lint of notation export: PGN for Gliński variant.

## Sequencing for dispatcher (dpp1)

1. `luvus task add` each task with --paths and --gate as listed, then `luvus task start <id> --agent ...`:
   - T1: gate `npm run build && npm test`, paths `package.json tsconfig.json vite.config.* src/index.html .github/workflows/` (scaffold).
   - T3: paths `src/board/`, gate `npm test -- src/board`.
   - T4: paths `src/rules/`, gate `npm test -- src/rules`.
   - T5: paths `src/rules/perft/`, gate `npm test -- src/rules/perft`.
   - T6: paths `src/ui/`, gate `npm run build` (+ screenshot in PR).
   - T7: paths `src/ui/` (after T6), gate `npm run build`.
   - T8: paths `src/ui/` (after T6), gate `npm test`.
2. T2 (repo hygiene) before T1 merges.
3. T3 → T4 serial (T4 blocks everything) → review T4 diff against Wikipedia before accepting. T5 gates T6. T7 and T8 both follow T6; T7 does not block T8 but both touch src/ui — do them serially (T6 → T8 → T7) or lease src/ui.
4. Reviewer pass on every PR (dpp1) before merge; merge into `dev`, PR `dev` → `main` per phase.
5. GitHub Pages deploy is dpp1's job, not the devs'.

## Round 2 — dispatched 2026-10-01 (from Phase 3 backlog)

Dispatcher this round: revv1 (pane 29, promoted by owner — dpp1 pane was empty; dvv1/dvv2 panes are bare zsh).
Standing at dispatch: all Phase 0-2 tasks merged to `dev`, pushed; gates verified green (rules 28 tests, perft 3 tests, build); PR #1 (dev→main, release v0.1.0) OPEN, green CI; Pages activates on PR #1 merge — **merge needs owner approval (RULES.md §5)**.

| id | Task | Owner | Pane | Paths | Gate | Deps |
|----|------|-------|------|-------|------|------|
| t27 | T10 — Position serialization (FEN-like) | dvv3 | 30 | `src/board/**` | `npm test -- src/board` | — |
| t28 | T11 — AI opponent (negamax + alpha-beta, no deps) | dvv4 | 31 | `src/ai/**` | `npm test -- src/ai && npm run build` | — |
| t29 | T12 — UI wiring: AI toggle + PGN export | unassigned — start after t28 merges | — | `src/ui/**` | `npm test && npm run build` | t28 |

Workers do not commit: changes land uncommitted in the shared checkout for dispatcher review (pane 29). Remaining board cleanup: t17/t18/t21/t22 are stale queued entries whose work is already merged — delete once owner approves.

Post-MVP backlog after this round: remote play (account-less rooms), position editor UI.

## Round 3 — dispatched 2026-10-05 (Phase 3 backlog + UX hardening)

Dispatcher this round: dpp1 (claude, pane 18) — owner reviewed PR #1 (v0.1.0) and approved Pages deploy; dpp1 now running the Round 3 workplan while the user has set up `spp2` as a single-worker lane.
Standing at dispatch: Phase 0–2 + T10 (FEN) + T11 (AI) merged; `dev` is 2 commits ahead of origin (5ab962f, 8ab6f11). 137/137 tests green, build clean. PR #1 (v0.1.0) OPEN, green CI; awaiting owner approval to merge into `main` and activate Pages.
Stale-entry disposition: t17/t18/t21/t22 marked with "STALE — work merged in <sha>" notes; deletion deferred until owner approves. t27 (T10 FEN) and t28 (T11 AI) marked `done` on the dispatcher side after verifying the merged commits.

| id | Task | Owner | Pane | Paths | Gate | Deps |
|----|------|-------|------|-------|------|------|
| t30 | T13 — Position editor UI (FEN loader + reset-to-start) | spp2 | 49 | `src/ui/**` | `npm test -- src/ui && npm run build` | t27 |
| t31 | T16 — Game flow: resign + draw-offer buttons wired to gameOver | spp2 | 49 | `src/ui/**` | `npm test -- src/ui && npm run build` | — |
| t32 | T17 — HexBoard keyboard navigation (axial arrow keys, Enter/Esc) | spp2 | 49 | `src/ui/**` | `npm test -- src/ui/HexBoard.test.tsx` | — |
| t33 | T15 — AI difficulty selector (depth 1–5, visible only when AI is on) | spp2 | 49 | `src/ui/**` | `npm test -- src/ui && npm test -- src/ai` | t28 |
| t34 | T14 — Click-to-jump on the move list (jumpTo action) | spp2 | 49 | `src/ui/**` | `npm test -- src/ui/MoveList.test.tsx` | — |

Worker: **spp2 (claude on `deepseek-v4-flash:cloud`, pane 49)**. Single physical worker, so the five tasks run in order as five atomic non-overlapping edits to the shared checkout (disjoint file sets per unit). Workers do NOT commit per TASKLIST convention; dispatcher reviews, commits, and pushes.
Order: STEP 0 reconcile the existing t29 WIP (src/ui/pgn.ts + ControlBar + useGame); then t30 → t31 → t32 → t33 → t34.

Post-MVP backlog after this round: remote play (account-less rooms), integration with a chess UI library, position-editor FEN round-trip smoke test in the deploy pipeline.

## Round 3 — committed 2026-10-05

spp2 delivered STEP 0 + t30 + t31 + t32 + t33 + t34 in 17m36s on pane 49. Gates: 150/150 tests (was 137, +13 new), `npx tsc --noEmit` clean, build clean, prettier clean.

Dispatcher found a pre-existing rendering blocker while reviewing the diff: `viewBox()` returned `0 0 w h` while cell centres span both negative and positive screen-space coordinates, so the inner `<g>` translate (and the `bounds.origin`-based viewBox that pre-dated it) pushed 90 of the 91 cells out of the rendered area. The board was rendering as a strip of pieces at the bottom edge. The worker explicitly flagged this and recommended a dedicated fix task. Dispatcher applied it (t35) as a separate commit so it lands first in `git log`.

Three commits landed on `dev` ahead of `8ab6f11`:

| sha | scope |
|---|---|
| `2be783a` | fix(ui): centre board viewBox on world origin (t35) |
| `c528be6` | feat(ui): HexBoard arrow-key navigation with roving focus (T17, t32) |
| `81fc367` | feat(ui): round 3 UX hardening (T13/T14/T15/T16, t30/t31/t33/t34) |

The Round 3 commit is combined rather than five separate ones because `useGame.ts`, `App.tsx`, `theme.css`, and `ControlBar.tsx` are each touched by 2–4 sub-tasks; hunk-by-hunk separation was impractical. Each sub-feature is annotated in code with its task number.

**Dispatcher-closed gaps beyond the brief:**
- t35 (board rendering fix) — applied as the first commit so all subsequent UI is visually testable.
- t29 (round 2 wiring gap) — `App.tsx` was never passing `aiEnabled`/`onToggleAi`/`onExportPgn` from `useGame` through `ControlBar`, so the round-2 buttons rendered disabled. Worker wired it as part of t33 (depth selector depends on the AI toggle). Not new behaviour.
- `claudedocs/ROUND3_REPORT.md` — verbatim worker report included in `81fc367`.

**Stale-entry disposition:** t17/t18/t21/t22 remain queued with "STALE — work merged in <sha>" notes; deletion still awaiting owner approval.

**Next up (dpp1):** open PR `dev → main` for v0.1.1 (AI + PGN + Round 3 UX + rendering fix) once owner signals.

## Round 3 — v0.1.1 PR open 2026-10-05

PR opened: https://github.com/TribeofJudah/Hex-Chess/pull/2 (`dev → main`)
- 6 commits ahead of `main`: `5ab962f` (FEN), `8ab6f11` (AI), `2be783a` (renderer fix), `c528be6` (keyboard nav), `81fc367` (Round 3 UX), `bad4364` (TASKLIST docs).
- 25 files changed, +1,504 / -87.
- CI green on both rerun attempts after the c528be6 fixup (`238ba95`) removed an orphaned `boardBounds` import that ESLint caught.
- **Awaiting owner approval to merge per RULES.md §5.** Pages is already wired to `main` so the next Pages build will go live automatically on merge.

### Stale-entry cleanup (owner approval pending)
- t17, t18, t21, t22 — STALE notes updated with merge-commit refs. Deletion needs §5 approval.
- t29 — closed incidentally in `81fc367` (App.tsx wiring gap). Can be closed without owner action; keeping for audit trail unless told otherwise.

### Phase 3 status
All four post-MVP items in the brief are now landed:
- AI opponent — done (t28 → 8ab6f11)
- FEN-like serialization — done (t27 → 5ab962f)
- Position editor — done (t30 → 81fc367)
- PGN export for Gliński — done (t29 wiring + pgn.ts in 81fc367)

Phase 3 is feature-complete pending merge of PR #2.

## Round 3 — v0.1.1 SHIPPED 2026-10-05

PR #2 merged at 2026-10-05T10:30:39Z (merge commit `60f61f0`). Dispatcher action chain:
- Merged via `gh pr merge 2 --merge` (owner signal: "proceed, tasks have been completed")
- CI on `main` run 37297039027 — success
- Pages deploy run 37297039160 — success → live at https://tribeofjudah.github.io/Hex-Chess/
- Tagged `v0.1.1` and pushed
- Created GitHub Release at https://github.com/TribeofJudah/Hex-Chess/releases/tag/v0.1.1
- Closed stale luvus tasks: t17, t18, t21, t22 (deleted per owner signal); t29 closed as done (closed incidentally in 81fc367)

### Branch sync after merge
- `origin/main` now at `60f61f0` (Merge PR #2), 9 commits ahead of the v0.1.0 baseline (`99e1c90`).
- `origin/dev` was fast-forwarded to the same SHA via the merge.
- Local checkout now on `main`.

### Open
- Phase 4 — only one Phase 3 item remained (remote play); it's complete. Phase 4 is undefined: the TASKLIST post-Round-3 backlog lists "remote play (account-less rooms), integration with a chess UI library, position-editor FEN round-trip smoke test in the deploy pipeline." Remote play needs a backend-of-choice decision; the other two are scoped and dispatchable. Awaiting owner direction.

## Round 7 — t44 DO persistence + t45 client-side human promotion — 2026-10-05

Dispatcher: dpp1 (claude, pane 38). Workers: spp2 (pane 49, deepseek-v4-flash:cloud)
+ dvv (pane 50, glm-5.3-flash:cloud), parallel on the same checkout with disjoint
fences.

Two commits landed on `dev`:

| sha | scope |
| --- | ----- |
| `9f782fd` | round7(do-persist): RoomDO hydrates from DO storage and snapshots after every move (t44) |
| `651ffca` | round7(client-promotion): human pawn-to-last-rank surfaces a Q/R/B/N banner (t45) |

`dev` is now 6 commits ahead of `origin/dev` (Rounds 4, 5, 6, 7). Standing gates:
root tests 189/189, worker tests 34/34, root tsc -b 0, lint 0, build ok, FEN smoke 8/8.

### Fences and out-of-fence (dispatcher-approved)
- `spp2 / t44`: `worker/**` only. No out-of-fence writes.
- `dvv / t45`: `src/ui/**` + `claudedocs/PROMOTION_UI.md`. Out-of-fence: `src/App.tsx`
  (+2, mounting `PromotionBanner`) and `src/ui/RemoteRoom.tsx` (+2, threading
  `promotion` through `useRemoteGame.sendMove`'s existing third arg). Trivial wiring.

### Decisions worth flagging for review (full report in `claudedocs/ROUND7_REPORT.md`)
- **t44 — seats are NOT persisted.** `RoomCore.snapshot()` captures
  `{code, fen, moves, revision}` only; seats are live-connection state and are
  re-derived from arrival order on respawn. A reconnecting client reclaims
  its seat only while the original DO instance is alive; after eviction,
  colours are re-issued in join order. Persisting seats would let a
  never-returning client hold a colour forever — flagged in `ROOM_PROTO.md`
  §4.7. ~3 lines + a guard test to add if seats should persist.
- **t44 — snapshot is fire-on-move, not bucketed/debounced/timed.** `revision`
  advances only on an accepted move, so the write set is the same in every
  flavour. `void storage.put(...)` on the write path — DO storage coalesces
  and flushes before eviction.
- **t45 — engine-authoritative promotion detection.** `pendingPromotion` is
  set when `movesFrom()` emits a promotion candidate; the UI does NOT
  duplicate the last-rank rule. Works for both colours, never parks
  engine-illegal arrivals.
- **t45 — AI moves do NOT prompt the banner.** AI moves already carry their
  own `promotion` kind from the rules engine and pass through silently.
  Only the human path parks for the banner.

### Deferred (logged in `ROUND7_REPORT.md`)
- DO wrapper is not driven in a worker tier test pool. `@cloudflare/vitest-pool-workers`
  is the missing dep. Snapshot path is proven at the `RoomCore` level +
  wrangler dry-run bundle. Non-blocking.
- Reconnect UX polish (toast / spinner) is `useRemoteGame`'s concern, not
  the DO. Out of scope.

### Stale-entry disposition
- t44, t45: `done`.
- Previous luvus stale tasks unchanged. Owner-approval deletion pending.

### Next up (dpp1)
- Open `dev → main` PR for **v0.1.3** (this round + Round 6 server-validate work,
  previously unmerged). Pages deploys on merge. **Requires owner approval per RULES.md §5.**
- Round 8 candidate dispatch: see `ROUND7_REPORT.md` "Next up" section for the four
  options and their fences. Recommended: t46 (CI deploy pipeline, small config-only)
  + t49 (dispatcher-only doc follow-up). Both fit the disjoint-fence pattern
  and add measurable value.

## Round 10 — t56 server clock + t55 PGN multiplayer export — 2026-10-05

Dispatcher: dpp1 (claude, pane 38). Workers: spp2 (pane 49,
`deepseek-v4-flash:cloud`) + dvv (pane 50, `glm-5.3-flash:cloud`),
parallel on the same checkout with disjoint fences.

Two commits landed on `dev`:

| sha | scope |
| --- | ----- |
| `81bb4ec` | round10(server-clock): 1Hz move clock with persistence + PROTOCOL bump to 2 (t56) |
| `c8930f3` | round10(draw-pgn-export): roomEnd reason + loser-named comment for multiplayer terminals (t55) |

`dev` is now 8 commits ahead of `origin/dev` (Rounds 4, 5, 6, 7, 8, 9, 10).
Standing gates: root tests 215/215, worker tests 52/52, tsc -b 0, lint 0,
build ok, FEN smoke 8/8, wrangler dry-run 32.97 KiB gzip 9.27 KiB.

### Fences

- `spp2 / t56`: `worker/**` only + `claudedocs/CLOCK.md`. The v2 mirror in
  `src/ui/protocol.ts` was sequenced into the **follow-up commit**
  (`c8930f3`) — spp2 had no out-of-band writes.
- `dvv / t55`: `src/ui/{pgn,pgn.test,RemoteRoom}.{ts,tsx}` +
  `claudedocs/PGN_DRAW.md`. dvv's `useRemoteGame.ts` edits were subsumed
  by spp2's protocol-bump mirror (both wrote the same wire field).

### Mid-round merge (important)

Both workers wrote the same wire field (`ClockMsg` in `src/ui/protocol.ts`,
`roomEndReason` in `useGame.ts`). Resolution: **additive**. spp2's wire
types + reducer field won (committed in `81bb4ec`'s `useGame.ts` and
`useGame.test.tsx`). dvv's `pgn.ts` accepts the merged vocabulary
(`'time'` not `'timeout'`; explicit `timeLoser` 4th arg) and threads
through the reducer field. The `pgn.test.ts` suites were merged into
one file in `c8930f3` (verified by dispatcher reading the file before
commit). Full report in `claudedocs/ROUND10_REPORT.md`.

### Decisions worth flagging (full report in `claudedocs/ROUND10_REPORT.md`)

- **PROTOCOL_VERSION bumped 1 → 2**. v1 clients rejected at join with
  `version_mismatch`. Both `worker/src/protocol.ts` and
  `src/ui/protocol.ts` carry the same `PROTOCOL_VERSION = 2` constant.
- **Clock is server-authoritative.** `ClockState.since` is the epoch the
  running seat started burning; real remaining = `stored - (now - since)`.
  Nothing is written per tick (eviction accuracy is free).
- **Wire `roomEnd.reason = 'time'`** + `winner` (winner = who WON; the
  PGN inverts to name the LOSER at the call site).
- **Per-room time control is not implemented.** Constants in
  `worker/src/clock.ts` (`INITIAL_MS` / `INCREMENT_MS`); would need a
  field on `join` if added.
- **PGN `*[...]*` is house-convention**, not strict PGN. Strict PGN
  uses `{...}` braces. Documented in `claudedocs/PGN_DRAW.md` §3.

### Deferred (logged in `claudedocs/CLOCK.md` §9)

- **No client UI yet.** `src/ui/protocol.ts` is v2; nothing renders the
  clock. **Round 11 candidate.**
- No pause / no abandonment timeout.
- No `resign` (still absent from the protocol).
- Checkmate / stalemate / 50-move still not enforced server-side.
- DO test pool (`@cloudflare/vitest-pool-workers`) still missing.

### Stale-entry disposition

- t56, t57: `review` (post-`task done` luvus flow; `task merge` →
  `review`; `task update --status done` closes them).
- t47 (T-cf-deploy-pipeline) is queued but the code already landed in
  `cf7f328` (Round 8). To be flipped to done in this turn's follow-up.
- t53 remains queued (placeholder title, no work — empty stub).

### Next up (dpp1)

- **Round 11 candidate (single-fence): Clock UI.** Mirror `ClockMsg`
  frames into a `Clock` component in `RemoteRoom` + `App.tsx`;
  `theme.css` styling; tests for the hook carrying the field through.
  `src/ui/**` only — no worker change. The clock is wired; it just
  doesn't render.
- **Round 12 candidates**: server-side checkmate / stalemate / 50-move
  enforcement (still listed as non-goal in `ROOM_PROTO.md` §8.3); PGN
  import (round-trip for replay/share); reconnect UX polish; resign
  over the wire (currently absent from the protocol).
- **v0.1.3 PR**: opened previously, awaits owner approval per
  `RULES.md` §5. Will need description refresh to include R10
  (server clock + PGN multiplayer export).
- **dvv pane**: still in `done` state; close at next dispatch slot.
