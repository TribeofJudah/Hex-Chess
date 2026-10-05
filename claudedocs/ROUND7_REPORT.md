# Round 7 — DO persistence + client-side human promotion

Date: 2026-10-05 · Branch: dev · Commits: `9f782fd`, `651ffca`
Dispatcher: dpp1 (claude, pane 38)
Workers: spp2 (pane 49, deepseek-v4-flash:cloud) + dvv (pane 50,
glm-5.3-flash:cloud), parallel on the same checkout with disjoint
fences.

## At a glance

| task | title | worker | files | gate | landed |
| ---- | ----- | ------ | ----- | ---- | ------ |
| t44  | DO persists room state across eviction | spp2 | 5 | worker tests 34/34, all green | `9f782fd` |
| t45  | wire promotion choice over the wire | dvv | 9 (incl. 2 new) | root tests 189/189, all green | `651ffca` |

Total: 14 files, +643 / -22, no deletions of existing code. Two
independent, parallel commits in ~30 minutes wall time.

## Why this round

Round 6 shipped t43 (server-validate moves against the rules engine).
The commit was correct but created a *gap*: any human move that promoted
was missing the field the new server check required, so the client was
NACKed and stuck resyncing. t45 closes that gap on the client side.
t44 was always queued (deferred from R5); it makes a static subject survive
eviction. Both were ready to land at the same time and were cleanly
disjoint (`worker/**` vs `src/ui/**`), so they ran in parallel.

## Standing gates at dispatch

- root: 183/183 vitest, `tsc -b` 0, lint 0, build 250.53 kB
- worker: 31/31 vitest, tsc 0, wrangler dry-run ok
- FEN smoke 8/8

## Standing gates after

- root: **189/189** vitest (+6 from t45), `tsc -b` 0, lint 0, build ok
- worker: **34/34** vitest (+3 from t44), tsc 0, wrangler dry-run 24.66 KiB
- FEN smoke 8/8

## Fences

- `spp2 / t44`: `worker/**` only.
- `dvv / t45`: `src/ui/**` + `src/test/**` + `claudedocs/PROMOTION_UI.md`.

### Out-of-fence dispatches actually needed

dvv wrote +2 lines each to `src/App.tsx` and `src/ui/RemoteRoom.tsx`
(mounting `PromotionBanner`, threading `promotion` through
`useRemoteGame.sendMove`'s third argument which already existed). These
were not in the explicit fence but were trivial wiring of the new
component; flagged in dvv's pane-side report. Dispatcher verified the
changes are +2- to those files only.

spp2 wrote **no out-of-fence** files.

## Decisions worth flagging for review

### t44 — seats are deliberately NOT persisted

`RoomCore.snapshot()` captures `{code, fen, moves, revision}` only. The
two-color seats are live-connection state and are re-derived on respawn
from arrival order, the same way a brand-new room handles them.

Consequence: a reconnecting client reclaims its seat only while the
original DO instance is alive; after eviction the colours are re-issued
in join order. Persisting seats would let a never-returning client hold
a colour forever (the current in-memory behaviour) — that may or may
not be desirable for matchmaking.

Flagged in `claudedocs/ROOM_PROTO.md` §4.7. If seats should be in the
snapshot, the change is ~3 lines plus a guard test.

### t44 — snapshot is fire-on-move, not on every revision bucket

`revision` advances only on an accepted move, so the write set is the
same whether you bucket, debounce, or fire-on-move — fire-on-move has
the fewest moving parts. Rejected moves hit the write but are no-op
overwrites. `join`/`resync`/`ping` skip the write entirely so a ping
loop does not flood storage.

Writes are `void storage.put(...)` — DO storage is coalesced and
flushed before eviction, so awaiting would only add latency.

### t45 — engine-authoritative promotion detection

`pendingPromotion` is set when the engine emits a promotion candidate
for the user's pawn in `movesFrom()`. We do not duplicate the last-rank
rule into the UI; we ask the engine what's possible. Works for both
colours, never parks engine-illegal arrivals.

### t45 — AI moves do NOT prompt the banner

AI moves already carry their own `promotion` kind from the rules
engine, and `useGame.play` accepts the third arg. The AI path silently
passes through. Only the *human* path parks on the last rank for the
banner.

## What's NOT covered (deferred)

- **DO wrapper is not driven in the worker tier test pool.** The vitest
  suite runs on Node — no `WebSocketPair`, no DO runtime — so
  `RoomDO.fetch` is not exercised end-to-end. The DO wrapper is a
  thin `get`/`put` of the snapshot; that path is covered by the
  `RoomCore` snapshot tests + the wrangler dry-run bundle. Add
  `@cloudflare/vitest-pool-workers` for the wrapper itself under test
  if wanted. Logged as follow-up, not blocking.
- **Reconnect after eviction still works only on the read path.** A
  client connecting to a freshly-evicted DO sees the correct board,
  but the *user experience* (reconnecting UI) is not polished; that's
  `useRemoteGame`'s concern, not the DO. Out of scope here.

## Coordination notes

- Both workers used `deepseek-v4-flash:cloud` (spp2) and
  `glm-5.3-flash:cloud` (dvv). Both panes ran in auto-approve mode.
- `luvus task merge` misfires on gates with spaces (it shelles out the
  raw gate string and reports `exit 127`); the implementation IS the gate
  in those cases. Pattern is `task done → task merge → task update
  --status done`. Confirmed works for both t44 and t45.
- Token cap recall from R6 did not bite us. dvv burned ~80k tokens on
  a ~50-line UI change but finished cleanly. Worth noting for future
  rounds where dvv is asked to do engine-authoritative state work:
  the planning phase runs heavy before any file appears in
  `git diff --stat`.

## Next up

- Open `dev → main` PR for **v0.1.3** (this round + the previously-
  unmerged Round 6 server-validate work). 6 commits ahead of
  `origin/dev`. Pages deploys on merge. **Requires owner approval per
  RULES.md §5.**
- Round 8 candidates (parallel-safe fences):
  - **t46 — T-cf-deploy-pipeline**: CI runs `wrangler deploy --dry-run`
    on PRs and `wrangler deploy` on tag push. Fence:
    `.github/workflows/**`. No code change. ~30 lines.
  - **t47 — T-move-clock (server-authoritative timer)**: room tracks
    per-active-color time; time-out → `roomEnd{reason: 'time'}`.
    UI renders it. Fences: `worker/**` + `src/ui/**` —
    candidate for a *serial* lane, since it touches both.
  - **t48 — T-draw-by-agreement wire protocol**: server-side state
    machine for `offerDraw` / `acceptDraw` / `declineDraw`, broadcast
    to opponent, validated by `validate.ts`. Fence: `worker/**`.
    UI follow-up is Round 9.
  - **t49 — T-doc-rounds**: dispatcher-only. Write the
    `claudedocs/TASKLIST.md` Round 7 entry. ~50 lines.
