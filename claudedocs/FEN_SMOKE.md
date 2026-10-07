# FEN round-trip smoke test (t37)

Date: 2026-10-05 · Author: spp2 (pane 49) · Status: landed, gate green.

## What it is

A round-trip smoke test for the Gliński FEN-like serialiser
(`src/board/fen.ts`), wired into the deploy pipeline so a serialisation
regression fails the deploy before it ships.

The invariant: `serializePosition → parsePosition → serializePosition` is a
**fixed point**, and the board survives the trip with the same piece count.
Side to move, en-passant target and the halfmove/fullmove counters must be
preserved.

## Pieces

| File                           | Role                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `scripts/fen-smoke.mjs`        | Plain-`node` smoke test. Runs the **real** `fen.ts` (no test framework), prints per-case ok/FAIL, exits 1 on any failure. |
| `scripts/ts-resolve.mjs`       | Node ESM resolve hook — resolves the project's extensionless TS imports so plain `node` can load `.ts`.                   |
| `src/board/fen.smoke.test.ts`  | Vitest companion; guards the same invariants inside `npm test`.                                                           |
| `.github/workflows/deploy.yml` | Runs `node scripts/fen-smoke.mjs` before the build.                                                                       |
| `.github/workflows/ci.yml`     | Same step, for early PR signal.                                                                                           |

## Cases covered

- **Canonical stability** — the start position and a mid-game position (Black to
  move, ep target `e5`, halfmove 3, fullmove 12) survive `parse∘serialize`
  byte-for-byte.
- **Empty board** — 0 pieces, ranks `11/9/7/5/3/1/1/1/1/1/1`.
- **Full board** — all 91 cells occupied, with max counters (halfmove 100,
  fullmove 9999).
- **Piece counts** — start → 36, full → 91.
- **Counter/ep preservation** on the mid-game position.
- **Malformed input** — `parsePosition` throws on garbage.

## How to run

```bash
node scripts/fen-smoke.mjs        # pipeline gate (plain node)
npm test                          # runs fen.smoke.test.ts + fen.test.ts
```

## Requirement: Node ≥ 22.18

The plain-`node` path relies on unflagged TypeScript type-stripping
(Node 22.18+ / 23.6+). Both workflows pin `node-version: 22`, which
`actions/setup-node` resolves to the latest 22.x (≥ 22.18). `scripts/ts-resolve.mjs`
exists only because Node's type-stripping does not infer extensions for the
project's bundler-style extensionless imports (`./notation`).

## Verdict

**Pass — no flaky cases.** All eight checks are stable on Node v22.22.2,
repeated runs included.

## Cases probed and documented (not failures)

- **Round-trip stability on every case**: verified stable; none were flaky.
- **Out-of-domain input (non-goal, not a bug)**: a `Position` whose board map
  holds a piece at a key _outside_ the 91 cells is silently dropped by
  `serializePosition` (it only walks real cells). No in-app code constructs
  such a position, so no test asserts on it. Flagged here rather than
  "fixed" in `fen.ts`, per the brief.
- **Whitespace**: the format is single-space delimited; extra spaces produce a
  field-count error by design. Not exercised by the smoke test.

`src/board/fen.ts` was **not modified** — the smoke test verifies the module as
shipped. No case required a fix.

## Gate

`npm test && node scripts/fen-smoke.mjs && npm run build` — green.
