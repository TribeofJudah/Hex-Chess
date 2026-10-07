# Round 10 — server clock (t56) + multiplayer PGN (t55) — 2026-10-05

Dispatcher: dpp1 (claude, pane 38, owner = the user).
Workers: **spp2** (pane 49, `deepseek-v4-flash:cloud`) + **dvv**
(pane 50, `glm-5.3-flash:cloud`), parallel on the same checkout with
disjoint fences.

Two commits landed on `dev`:

| sha | scope |
| --- | ----- |
| `81bb4ec` | round10(server-clock): 1Hz move clock with persistence + PROTOCOL bump to 2 (t56) |
| `c8930f3` | round10(draw-pgn-export): roomEnd reason + loser-named comment for multiplayer terminals (t55) |

`dev` is now 8 commits ahead of `main` (Rounds 4, 5, 6, 7, 8, 9, 10).

**Standing gates (post-merge):** root tests **215/215**, worker
**52/52**, `tsc -b` 0, lint 0, build ok, FEN smoke 8/8,
`wrangler deploy --dry-run` exits 0, bundle 32.97 KiB gzip 9.27 KiB.

## Why this round

Two wire-level gaps from Round 9:

1. **Server-authoritative clock.** `CLOCK.md` exists as a spec but the
   worker had no timer. Per §1 of that spec: 5 min + 3 s, 1 Hz tick,
   increment on the side-to-move's move, flag fall ends the room with
   `roomEnd{reason:'time', winner}`. The brief
   (`spp2_round10_brief.md`) called for a server-authoritative timer;
   Round 7's note ("time-out → `roomEnd{reason:'time'}`") had been
   waiting on a worker.
2. **Multiplayer PGN export.** Round 9 wired draw agreement over the
   wire, but `RemoteRoom.tsx` had no export callsite — the PGN module
   was hotseat-only. The brief (`dvv_round10_brief.md`) called for
   `1/2-1/2` + `*[Draw by agreement]*` for an agreed draw, loser-named
   comment for a clock timeout, and the export to thread the room's
   terminal reason through.

Both are mid-sized, independent units with disjoint fences — the
parallel split paid out.

## Fences

- `spp2 / t56`: `worker/**` only + `claudedocs/CLOCK.md`. Out-of-fence
  reads on `src/ui/protocol.ts` (to mirror `ClockWire`, `ClockMsg` and
  the protocol bump) — flagged in the report and mirrored in the
  follow-up commit (`c8930f3`). No out-of-fence writes.
- `dvv / t55`: `src/ui/{pgn,pgn.test,RemoteRoom}.{ts,tsx}` +
  `claudedocs/PGN_DRAW.md`. The `useRemoteGame.ts` edits dvv drafted
  were subsumed by spp2's mirror — spp2 had added
  `useGame.roomEndReason: 'draw_agreement' | 'time' | null` to the
  reducer, which is the field dvv's PGN thread consumes. dvv's net
  delta in `useRemoteGame.ts` was zero; the dvv side of the merge is
  the test-stub rework and the `RemoteRoom` callsite.

### Collision + merge (mid-round)

spp2 and dvv both touched files near the wire boundary:

- spp2 mirrored `ClockMsg` / `ClockWire` into `src/ui/protocol.ts` and
  threaded `roomEndReason` through `useGame`'s reducer.
- dvv edited `useRemoteGame.ts` and `pgn.ts` for the same wire field.

Resolution: **additive** merge. spp2's `useGame.roomEndReason` reducer
field + wire types won. dvv's `pgn.ts` accepts the merged vocabulary
(`'time'` not `'timeout'`; explicit `timeLoser` 4th arg) and threads
through the reducer field rather than inventing its own. Both
`pgn.test.ts` suites are intentionally merged in `c8930f3` (verified
by the dispatcher reading the file before commit). The single use case
is: `useRemoteGame().roomEndReason === 'draw_agreement' | 'time' | null`,
exposed via `toPgn(moves, gameOver, reason, loser?)` where `loser?` is
the side whose clock fell.


## Decisions worth flagging for review

### t56 — time control fixed at 5 min + 3 s

Module constants in `worker/src/clock.ts`. No `createRoom` call exists
to negotiate with (rooms are created lazily on the first `join`, see
`ROOM_PROTO.md` §4.1), so the defaults are constants. Per-room time
control would need a field on `join`; not built (YAGNI).

### t56 — clock runs from the second `join`

A lone player waiting for an opponent is not charged for the wait. The
clock is initialised to the defaults at room creation but starts
running on the second seat. Disconnecting does not pause the clock
(reconnecting is not a way to save time; seats stay reserved per
`ROOM_PROTO.md` §4.3).

### t56 — clock is derived, never counted

`ClockState.since` is the epoch ms the running seat started burning;
real remaining = `stored - (now - since)`. Nothing is written per tick,
so eviction accuracy is free: a woken DO computes elapsed time from
`since` instead of replaying lost ticks.

### t56 — alarm 1 Hz, live rooms wake even with nobody connected

The DO's only timer survives eviction; `RoomCore` keeps no timer at
all (`tick(now)` takes the time as a parameter; tests use explicit
timestamps). A live room wakes once per second even with nobody
connected, bounded by the time control. If that ever costs real money,
tick only while `live.size > 0` and keep the alarm as a deadline
backstop. Flagged for owner awareness.

### t56 — `roomEnd{reason:'time', winner}`

Reason value is `'time'`, matching the Round 7 dispatcher's note.
`winner` is the SIDE THAT WON (the opposite of the seat that ran
out); the PGN inverts to name the LOSER at the call site.

### t55 — comment BEFORE the result terminator

Importers key the game end on the movetext result token, so the
annotation sits directly above it; the `[Result "..."]` header
already carries the machine value.

### t55 — reason as a separate optional arg, not folded into `GameOver`

Wire vocabulary (`'draw_agreement' | 'time' | null`) vs local rules
vocabulary; hotseat callsites stay byte-identical.

### t55 — `downloadPgn` stays one-PGN-per-snapshot

Re-exports whatever the move list holds at click time. Filename is
`hex-chess-<roomCode>.pgn` for multi-room disambiguation.

### t55 — house-convention caveat in PGN_DRAW.md

`*[...]*` is a HEADS-UP comment, not a strict-PGN comment (strict PGN
uses `{...}` braces). Documented so future readers don't think this
is a PGN-spec move-text element.


## Protocol bump (1 → 2)

`PROTOCOL_VERSION` is `2` on both worker and client (mirror).
`ROOM_PROTO.md` §2 bumps the version only for incompatible message-shape
changes, and this is one: `welcome` gained two required fields
(`clock?`, `ended?`) and `roomEnd.reason` gained a value
(`'time' + winner?`). A v1 client reading a v2 `welcome` would run a
clock-less board against a clocked server, so the join handshake
rejects it with `version_mismatch`.

The bump is mirrored across both protocol files in a single commit each
(`81bb4ec` worker side; `c8930f3` client side). v1 clients are rejected
at join. The dvv commit also de-hardcoded `PROTOCOL_VERSION` from the
worker test files that spp2 had flagged as a rot hazard during the
bump.

## Persistence

`RoomSnapshot` carries `clock?: ClockState` (optional so pre-t56
snapshots still hydrate). DO write-predicate widened to `join` (the
clock may start), `move` (the clock switches sides), or a draw frame
(t56 freezes it). A flag fall persists on the tick that ends the room.
`resync` and `ping` still do not write.

## Coverage (worker)

`worker/test/clock.test.ts` (NEW, 10 tests): arithmetic (only the side
to move burns; a frozen clock floors at zero); the clock not running
before both seats are taken; 1 Hz ticks with the idle seat untouched;
the increment and hand-over on a move; the flag fall ending the room
with `winner`; a move refused after the room ended; a room revived
after eviction still counting from `since`; a clock that expired while
the DO was evicted flagging on the next tick; a draw agreement
stopping the clock.

`worker/test/{room,draw,protocol}.test.ts` had `PROTOCOL_VERSION = 1`
de-hardcoded (the literal was a rot hazard during the bump) and
de-hardcoded clock expectations in `room.test.ts`.

Not covered here (no workerd under Node vitest — see `worker/README.md`):
the DO adapter itself (`alarm()`, `arm()`, `load()`), so the
alarm arming/re-arming path in `index.ts` is exercised only by
`wrangler deploy --dry-run` plus review.

## Coverage (root)

`src/ui/pgn.test.ts`: 15 tests (3 originals + 12 new). Resignation
unchanged (byte-exact), hotseat agreement unchanged, mirrored draw
agreement (result override + comment tail), draw+time fall-through,
clock-loss annotations both colors (loser-named), reason-only override
(undefined snapshot ⇒ `1/2-1/2`, no comment), corroboration matrix,
plus a hook-level threading test (`renderHook(useRemoteGame)` → frame
feed → the exact `RemoteRoom` export expression, including the
`?? undefined` null-shim).

`src/ui/protocol.test.ts`: clock + welcome frames round-trip.


## Out-of-fence (dispatcher-approved)

- **`claudedocs/ROOM_PROTO.md`**: dispatcher applied the v2 edits
  inline — §5.1 control-frames table (added `clock` row, welcome/roomEnd
  annotations), §8.3 non-goals (clocks live), §9 terminal-state note.
  Was outside both worker fences; the spec needed to stay in lockstep
  with the bump.
- **`claudedocs/CLOCK.md`**: new spec written by spp2
  (`worker/src/clock.ts` itself is the canonical implementation reference).
- **`claudedocs/PGN_DRAW.md`**: new spec written by dvv.

## Deferred (logged in CLOCK.md §9)

- **No client UI yet.** `src/ui/protocol.ts` is v2; nothing renders the
  clock. Round 11 candidate.
- **No pause / no abandonment timeout.** A room whose players both
  vanish keeps burning until someone flags; no "abandoned room"
  cleanup.
- **No `resign`.** Resignation is still absent from the protocol; only
  a draw agreement and a flag fall end the room.
- **Checkmate / stalemate / 50-move** still not enforced server-side.
- DO test pool (`@cloudflare/vitest-pool-workers`) still missing.

## Stale-entry disposition

- t56, t57: `review` (post-`task done` luvus flow; `task merge` will
  flip them to `review`; `task update --status done` will close them).
- t53 remains queued (placeholder title, no work — empty stub).
- t47 (T-cf-deploy-pipeline) is queued but the code already landed
  in `cf7f328` (Round 8). To be flipped to done in this turn's
  follow-up.

## Next up (dpp1)

- **Round 11 candidate (single-fence): Clock UI.** `useRemoteGame` to
  thread `ClockMsg` frames into a `Clock` component in `RemoteRoom` /
  `App.tsx`; `theme.css` styling; tests for the hook carrying the
  field through. `src/ui/**` only — no worker change needed. The
  clock is wired; it just doesn't render.
- **Round 12 candidates**: server-side checkmate / stalemate / 50-move
  enforcement (still listed as non-goal in `ROOM_PROTO.md` §8.3); PGN
  import (round-trip for replay/share); reconnect UX polish; resign
  over the wire (currently absent from the protocol).
- **v0.1.3 PR**: opened previously, awaits owner approval per
  `RULES.md` §5. Will need description refresh to include R10
  (server clock + PGN multiplayer export).
- **dvv pane**: still in `done` state; close at next dispatch slot.


---

## Appendix A — file inventory

### `81bb4ec` round10(server-clock) — spp2 (t56)

| file | change |
| ---- | ------ |
| `worker/src/clock.ts` | **NEW** — `ClockState {white,black,since}`, `INITIAL_MS`/`INCREMENT_MS`/`TICK_MS`, `remainingAt`/`freezeAt`/`afterMove`/`clockWire`. Pure arithmetic, no timers |
| `worker/src/protocol.ts` | `PROTOCOL_VERSION` 1→2; `+ClockWire`, `+ClockMsg`; `welcome += clock, ended`; `roomEnd.reason += 'time'`, `+winner?` |
| `worker/src/room.ts` | `clock` field + injectable `now`; `clockRunning` getter; `tick(now)`; `startClock()` on the second join; increment + hand-over on an accepted move; clock frozen on an agreed draw; moves refused once the room has ended; `clock` in `RoomSnapshot` |
| `worker/src/index.ts` | `alarm()` 1 Hz tick driver; `load()` hydration helper shared by `fetch`/`alarm`; `arm()`; persist predicate widened to `join` |
| `worker/test/clock.test.ts` | **NEW** — 10 tests |
| `worker/test/{room,draw,protocol}.test.ts` | de-hardcode `PROTOCOL_VERSION = 1` (rot hazard during the bump) |
| `worker/README.md` | "Clock (t56)" section |
| `claudedocs/CLOCK.md` | **NEW** — full spec (time control, semantics, tick/eviction, frames, protocol bump, persistence, coverage, non-goals) |
| `claudedocs/ROOM_PROTO.md` | §5.1 control-frames table (`clock` row added), §8.3 non-goals (clocks live), §9 terminal-state note |

**Test delta:** worker 42 → 52 (+10).

### `c8930f3` round10(draw-pgn-export) — dvv (t55)

| file | change |
| ---- | ------ |
| `src/ui/pgn.ts` | additive to t56's reducer field (`'draw_agreement' \| 'time' \| null`); drawn-result override; corroboration guard; reason as separate optional arg (`timeLoser` 4th arg) |
| `src/ui/pgn.test.ts` | merged suite — their 4 t56 tests + my 11 (15 total); resignation unchanged (byte-exact); hotseat agreement unchanged; mirrored draw agreement; clock-loss annotations both colors (loser-named); reason-only override; corroboration matrix; hook-level threading test (`renderHook(useRemoteGame)` → frame feed → the exact `RemoteRoom` export expression) |
| `src/ui/RemoteRoom.tsx` | export wiring: `import { downloadPgn, toPgn }` + always-available `onExportPgn` on `ControlBar` calling `toPgn(game.moves, game.gameOver, game.roomEndReason ?? undefined)`, filename `hex-chess-<roomCode>.pgn` |
| `src/ui/useRemoteGame.ts` | subsumed by spp2's protocol mirror; no net t55 delta beyond what the worker committed |
| `src/ui/useRemoteGame.test.tsx` | stubSocket rework — verify the wire mirror thread |
| `claudedocs/PGN_DRAW.md` | **NEW** — rendering contract, the 3 decisions with justifications, merged remote wiring |

**Test delta:** root 204 → 215 (+11).


---

## Appendix B — gate snapshot (final, after both commits)

| check | result |
| ------ | ------ |
| `cd worker && npm test` | **52 passed** (5 files) |
| `cd worker && npx tsc --noEmit` | exit 0 |
| `npx tsc -b` | exit 0 |
| root `npm test` | **215 passed** (22 files) |
| `npm run lint` | exit 0 (prettier on `claudedocs/**` clean) |
| `node scripts/fen-smoke.mjs` | PASSED (8/8) |
| `npm run build` | exit 0 |
| `cd worker && npx wrangler deploy --dry-run` | exit 0, 32.97 KiB gzip 9.27 KiB, `env.ROOMS` → `RoomDO` |

Baseline before starting: HEAD `c2c2b16`, clean tree, worker 42/42,
root 204/204, `tsc -b` 0, FEN smoke PASSED. No migration is needed
(`[[migrations]] tag v1` unchanged — same class `RoomDO`,
storage-compatible snapshot with optional `clock`).

---

## Appendix C — verbatim worker reports

- `/tmp/spp2_round10_report.md`
- `/tmp/dvv_round10_report.md`
