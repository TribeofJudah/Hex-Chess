# XCHESS_BENCH — the Xchess research-program reframe (approach doc)

**Date:** 2026-10-08 · **Status:** adopted (feasibility assessed, see §2) · **Companion assessment:** `~/Desktop/xchess-research-platform.md`
**Related docs:** TASKLIST.md · ROOM_PROTO.md · TERMINALS.md · PGN_DRAW.md · CLOCK.md

## §1 The reframe

Xchess is the product name for HexChess-as-research-platform. Two products, one core:

1. **Play surface (existing web/TUI):** humans play Gliński hexagonal chess — unchanged behaviour, renamed identity.
2. **Bench (new, terminal-first):** a headless harness (`src/bench/`) that runs models
   against the rules core, grades every ply against an engine, and logs one canonical
   JSONL stream. The bench is the research product; the play surface renders its outputs.

Rename: in-repo identity is **Xchess** as of `dc69ba4` (README, index.html title, Lobby/RemoteRoom h1s,
package names, PGN Event tag). GitHub remote (`TribeofJudah/Hex-Chess`) and Pages URL are
deliberately unchanged — outward-facing, owner action if ever wanted.

## §2 Feasibility and effectiveness (assessed 2026-10-08, verdict: GO)

Verified against the current tree (branch `dev` at `dc69ba4`):

| Prerequisite | Status | Evidence |
|---|---|---|
| Deterministic rules core, full legality | ✅ exists | `src/rules/**`, perft-validated (T5 perft(1–3) matches published Gliński counts), 91-cell board, FEN (t27), PGN import/export (t61, R10) |
| Text-based game representation | ✅ exists | SAN + FEN serialization, wire protocol v4 (`worker/src/protocol.ts:23`, `src/ui/protocol.ts:225` — `PROTOCOL_VERSION = 4`), both sides mirrored and tested |
| Grading engine (embryonic) | 🟡 exists in embryo | `src/ai/ai.ts:47` `evaluate()` = material + mobility; negamax + alpha-beta at depth 1–5 (T11/t28); needs quiescence + PV + per-ply eval exposure |
| Unattended parallel execution | ✅ trivial | plain Node process; no browser needed; the DO rooms already prove headless text transport |
| Statistical comparability | 🟡 bounded | no off-the-shelf hex engine exists, so ratings are anchor-based and model-relative; CIs required on every pairwise number |
| Cost | ✅ bounded | 40 games/pair pilot ≈ 3.2k model calls ≈ tens of millions of tokens, tens of dollars at frontier pricing; runner enforces a token cap |
| Prior art | ✅ differentiated | orthodox LLM chess evals are contaminated; no mainstream hex corpus exists to contaminate |

**What it measures effectively:** every *process-quality* metric — legality rate, illegal-retry/repair, consistency/entropy over resamples, cost curves, calibration (S9), injection robustness (S11) — these have deterministic ground truth (the validator/engine) and work at any model skill level, even if a model can barely complete a game.

**Where claims are bounded (stated, not hidden):**
- **Grader is self-referential:** no mature Stockfish-grade hex engine exists publicly; cp-loss is ordinal evidence from our own (fixed-version) negamax. Never interpret cp-loss below the grader's uncertainty; log PVs for audit; treat as comparative-only.
- **Elo can be degenerate:** if all models sit near the random-bot floor, the ladder compresses; the metrics table still discriminates when Elo does not (legality/consistency don't need eval).
- **Contamination-resistance is relative:** orthodox priors *can* transfer partially (queen/rook analogs) — that's why §10.3 of the assessment quantifies leakage instead of asserting immunity.
- **No human anchor at scale:** ratings are model-relative; human-anchored Elo (assessment §10.11) is the later fix.
- **logprobs contingent on provider APIs** (suite S10); calibration only from models that emit a confidence field.

**Verdict: GO.** The hard part (trusted simulator) is already built and perft-validated; the remaining work is additive (`src/bench/**` is new paths, plus deepening `src/ai`). Effectiveness is high for process metrics, moderate for skill claims — the right trade for a contamination-resistant probe.

## §3 Architecture (bench additions)

```
src/bench/
  runner.ts      headless match runner: seed → game → JSONL stream (one line per ply)
  adapter/       agent adapter interface: (state, legalMoves, history) → move text + optional trace/conf
  bots/          random-bot, greedy-capture, shallow-minimax anchor (wraps src/ai)
  grader.ts      per-ply grading against src/ai engine: eval_before/after, cp_loss, best_move, PV top-3
  suites/        S1 legality gauntlet, S4 consistency, ... (scriptable suite registry)
  tui/           terminal screens (§6) — pure renderers over JSONL/derived aggregates
  report.ts      session report generator (SVG/HTML from JSONL)
```

Determinism: a run = seed + config; every metric rebuildable from the JSONL alone.
Boundary (TASKLIST convention): `src/bench/**` must not import from `src/ui/**`; shared logic (coordinates, rules) imports from `src/board`, `src/rules`, `src/ai` only.

## §4 Metrics (the comparison table)

| Metric | Ground truth | Notes |
|---|---|---|
| Legal-move rate | validator | primary process metric; Wilson CIs |
| Illegal-retry count / repair rate | retry loop | self-correction under feedback |
| cp loss per move | grader | comparative, engine-version-pinned |
| Blunder rate (loss > 300cp) | grader | reliability |
| Puzzle solve rate | suite | known-answer, no grading interpretation |
| Resample consistency / output entropy | probe | S4; stability of the trace |
| Tokens & wall-time per move | telemetry | reasoning cost |
| Elo w/ 95% CIs vs fixed anchor (shallow minimax = 1500) | runner | model-relative only |
| Stated-confidence calibration (S9) | grader | per-decile reliability curves |
| Injection-delta (S11) | grader | move-shift under hostile history text |

## §4a One `xc` CLI, modelled on `gh`

One command, subcommands over one JSONL corpus:

```
xc bench run --suite S1 --models a,b --seed 7 --json   # run games, stream JSONL
xc bench watch                                          # live TUI screen (§6)
xc dash metrics [--model M] [--suite S1,..]             # scorecard screen
xc dash heat --model M                                  # heatmap over hex grid
xc dash ladder                                          # Elo table with CIs
xc dash corpus [--class illegal|blunder|inconsistent]   # failure corpus browser
xc dash timeline --game G                               # per-game sparkline timeline
xc report session <run-id>                              # session report (SVG/HTML) → artifact publish
```

## §4a.1 JSONL contract

Self-contained: `src/bench/runner.ts` (`PlyRecord`) is the implementation. One line per ply:

```json
{"gameId":"g7","model":"random","ply":1,"side":"w","fen":"<serializePosition>","response":{"move":"Pf5f6","trace":"...","confidence":0.4},"verdict":{"legal":true,"san":"Pf5f6"},"engine":null,"game":{"over":false,"result":null,"winner":null}}
```

- `engine` is `null` until t91 (grader) fills `{evalBefore, evalAfter, cpLoss, bestMove, pv:[...]}`.
- Future fields are additive only; no renames without a version bump in this doc.
- Every metric in §4 must be recomputable from this file alone (§6.1).

## §4a.2 Retry policy (illegal-move repair)

The §4 metric "illegal-retry / repair rate" needs the runner to *allow* retries, not forfeit on the first illegal move:

- `MatchConfig.maxRetries` (default 0 = current behaviour). When > 0, an illegal move re-prompts the same agent with the rejected text and the legal-move list; the agent gets `retry: n` in `AgentContext`.
- Each attempt is one JSONL line (`response` = that attempt, `verdict.legal` per attempt). The ply's final outcome is the last line for that `ply`.
- After `maxRetries` illegal attempts the game ends `illegal` as today.
- Default stays 0 until S1 (t93) sets it; with 0 the existing runner tests are unchanged.

## §4a.3 Model adapter (t96)

`Agent.decide(ctx)` is the only seam. A model adapter implements it by:

1. Building a prompt from `ctx.state` (FEN + ASCII/legal list), `ctx.history`, and the retry note if `ctx.retry > 0`.
2. Calling a provider through a `ModelClient` interface `{ complete(prompt, {maxTokens}) → text }`. Tests use a mock client; **no network in tests or CI**.
3. Parsing the reply into `AgentDecision` (move text must match a `LegalMove.text` exactly; trace/confidence optional).
4. Enforcing a per-game token cap; exceeding it ends the game `token-cap`.

No provider SDK is added in Phase A (§8 no new deps): the real `ModelClient` implementation is a separate, owner-approved step.

## §5 Phases → tasks (Round 19 onward)

| Phase | Task | Scope | Unlocks |
|---|---|---|---|
Numbering: the **t-ids are canonical** (they match luvus and TASKLIST). The x-labels below are the same tasks.

| Phase | t-id (x-label) | Scope | Unlocks |
|---|---|---|---|
| A | **t90** (x1) headless runner + JSONL + random/greedy bots + adapter interface + retry policy §4a.2 | `src/bench/runner.ts, adapter.ts, bots.ts` | anything grader-dependent |
| A | **t91** (x2) grading engine: per-ply eval + PV + quiescence (deepen `src/ai`) | `src/ai/**`, `src/bench/grader*` | cp-loss, blunder rate, S2/S3 authoring |
| A | **t92** (x3) `xc` CLI + TUI: bench-watch, metrics, heat, ladder | `src/bench/tui/**` + `scripts/` bin | human-facing bench |
| A | **t96** (new) model adapter §4a.3: `ModelClient`, prompt builder, reply parser, token cap, mock client | `src/bench/adapter/**` | real model-vs-model play (no network in Phase A) |
| B | **t93** (x4) suites S1/S4 + registry | `src/bench/suites/**` | first stress data |
| B | **t94** (x5) session report generator → artifact publish | `src/bench/report*` | provenance loop |
| B | **t95** (x6) match scheduler, anchor Elo + Wilson CIs, pinned-engine regression CI | `scripts/`, `.github/workflows/` (CI edit needs owner OK) | the refinement loop closes |

## §6 TUI interface (what the terminal UI renders)

Screens (mockups in the assessment's TUI section):
1. **bench watch** — live match: ASCII hex board (renderer over the same `hexMath` math), move list, model output + validator verdict lines, eval sparkline.
2. **dash metrics** — per-model scorecard: metrics table + degradation sparklines.
3. **dash heat** — heatmap over the hex grid, 4-step `·`/`░`/`▒`/`▓` density ramp, rendered exactly over the board's staggered geometry.
4. **dash ladder** — Elo table with CIs, per-pair scorecards.
5. **dash corpus** — failure corpus browser: filter by class/phase/model.
6. **dash timeline** — per-game eval sparkline + event markers.
7. **report session** — session report summary page in-terminal summary, artifacts published per run.

Rendering rules: no TUI library (plain ANSI + Unicode blocks), no new deps;
board renderer shares the rules core via a vitest-gated equality test against `hexMath`-derived geometry — the same math, so a cell in the TUI is the same cell as on the web board (same `cellCenter`-fidelity stagger layout).

## §6.1 TUI screens are derived, not authoritative

Every TUI screen reads from the JSONL/derived aggregates; the JSONL is the only authority. If a screen shows a number, the JSONL determines it — no screen keeps its own state beyond viewport state.

## §7 Boundary with the play product

The play surface (web) and the bench (terminal) share the rules core and nothing else. `src/bench/**` never imports `src/ui/**` and never writes to the DO rooms in Phase A. Bot-vs-bot through DO rooms (assessment §4.4) is a later phase; the Phase A runner is pure in-process. Neither side imports the other, and the web UI never renders bench data in Phase A; when it does (report publishing), it publishes to the artifact server, not into the product UI.

## §8 Non-goals for Phase A/B

- No web dashboard product (the TUI + published reports are the interfaces).
- No DO-room bot transport in Phase A (assessment §4.4 is a later phase).
- No new dependencies (runner/grader/TUI are stdlib Node + the existing core).
- No changes to `worker/**` in Phase A (DO test pool already in place).
- Rebrand is identity-only; no URL or directory renames (outward-facing).
- No AI attribution trailers anywhere in outputs/commits (repo rule).