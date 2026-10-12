# BENCH_BRIEFS — Round 19 task briefs (Xchess bench)

Source docs: `XCHESS_BENCH.md` (design, JSONL contract §4a.1, retry §4a.2, adapter §4a.3, TUI §6).
Each block is a self-contained dispatch brief. Paste one block plus its `deja ctx` pointer into `luvus task add`.

## Common rules (all tasks)

- Stack: Vite + React + TypeScript; Vitest; ESLint. No new npm dependencies. The bench is plain Node + ANSI.
- Fence (enforced by `eslint.config.js`): `src/bench/**` never imports `src/ui/**`; `src/ui/**` never imports `src/bench/**`. Shared rules and geometry come from `src/rules`, `src/board`, `src/ai` only.
- Determinism: a run is `seed + config`. Same inputs → byte-identical JSONL. No `Math.random`, no `Date.now` in records (use `ply` for ordering).
- Rules of chess: verify against https://en.wikipedia.org/wiki/Hexagonal_chess#Gliński's_hexagonal_chess, not memory (RULES.md §1).
- Stay inside `--paths`. Out-of-fence need → report it, don't fix it.
- Do not commit to `dev`. Commit only on your luvus task branch; the dispatcher merges. Commit messages carry no AI attribution lines (owner rule).
- Do not bump `PROTOCOL_VERSION`. Do not touch `worker/**` or `src/ui/**` in Round 19.
- Done = the gate passes with output shown. Never skip or disable a test to get green.
- Report at the end: files changed, gate output (tail), anything out of fence, open questions.

Reviewer (rvv1) checklist for every bench diff:
1. Fence: no `src/ui` import in `src/bench`, no new deps in `package.json`.
2. Determinism: running the same seed twice gives identical JSONL (ask for the test).
3. Tests assert behaviour and known values, not snapshots of incidental output.
4. Stats: every rate has a Wilson 95% CI; no CI on a single unseeded run.
5. Grader numbers are labelled comparative-only (XCHESS_BENCH §2).

---

## t90 — headless runner + JSONL + adapter + bots (+ retry policy)
**Agent:** dvv1 · **Status:** built in worktree `luvus/t87` (untracked `src/bench/{adapter,bots,runner,runner.test}.ts`), not landed.
**Paths:** `src/bench/**`
**Gate:** `npm test -- src/bench && npm run build`
**Deps:** none

Goal:
1. Review the existing untracked code in `luvus/t87`; confirm it meets XCHESS_BENCH §3, §4a.1.
2. Add retry policy §4a.2: `MatchConfig.maxRetries` (default 0), `AgentContext.retry`, one JSONL line per attempt, game ends `illegal` after the cap. Test: with `maxRetries: 2`, an agent that is illegal once then legal produces two lines for that ply with the second `legal: true`.
3. Add a determinism test: same seed → identical `toJsonl` output.

Out of scope: grading (`engine` stays `null`), model clients, TUI.

---

## t91 — grading engine: per-ply eval, PV top-3, quiescence
**Agent:** dvv1 (highest correctness risk; dispatcher reviews the diff line by line). If the dispatcher prefers, write it in-house on Opus instead.
**Paths:** `src/ai/**`, `src/bench/grader*`
**Gate:** `npm test -- src/ai && npm test -- src/bench`
**Deps:** t90

Goal:
1. Deepen `src/ai/ai.ts`: quiescence search over captures (bounded depth), principal variation returned top-3 by score. Keep `bestMove`'s public signature working for existing callers and tests.
2. `src/bench/grader.ts`: per-ply `{evalBefore, evalAfter, cpLoss, bestMove, pv}` in the `engine` field of `PlyRecord`. `cpLoss = max(0, bestScore − scoreOfPlayed)` from the mover's view.
3. Pin the grader version: export `GRADER_VERSION` string and write it into each record.

Tests (required): a known tactical position where the best move is a capture (assert the grader's `bestMove`); quiescence prevents the horizon blunder (a depth-1 hanging-piece case is correctly scored); `cpLoss` is 0 when the played move is the best move; PV first move equals `bestMove`.

Out of scope: changing the eval terms (material and mobility stay). Changing the depth default.

---

## t92 — `xc` CLI + TUI screens (watch, metrics, heat, ladder)
**Agent:** dvv2 (text-only; no image work)
**Paths:** `src/bench/tui/**`, `scripts/xc*`
**Gate:** `npm test -- src/bench && npm run build`
**Deps:** t90 (dash screens need a JSONL fixture; t91 is needed only for the grader columns, so render "—" when `engine` is null)

Goal: plain ANSI and Unicode blocks, no TUI library. Screens per XCHESS_BENCH §6: `bench watch`, `dash metrics`, `dash heat`, `dash ladder`. Every screen is a pure function of JSONL lines (§6.1). The heat map uses `·░▒▓` over the same staggered geometry as `src/board` (`cellCenter`).

Tests: golden-frame tests on a small fixture JSONL (fixture committed under `src/bench/tui/__fixtures__/`); a test that the TUI board cell set equals the `src/board` cell set (equality, not visual).

Out of scope: any web UI; `dash corpus` and `dash timeline` (later round).

---

## t96 — model adapter: ModelClient, prompt builder, parser, token cap
**Agent:** dvv2 (or dvv1 after t90 if dvv2 is busy; reviewer confirms no overlap with t92 paths)
**Paths:** `src/bench/adapter/**`
**Gate:** `npm test -- src/bench && npm run build`
**Deps:** t90

Goal: implement XCHESS_BENCH §4a.3 exactly.
- `ModelClient` interface `{ complete(prompt, {maxTokens}): Promise<string> }`.
- Prompt builder: FEN, the legal-move list with `LegalMove.text`, history, retry note when `ctx.retry > 0`. Deterministic string output (test with a snapshot-free assertion on required substrings).
- Reply parser: extract the move text; it must match a legal `text` exactly. Optional `trace` and `confidence` fields. Malformed reply = illegal attempt, never a throw.
- Token cap per game: when exceeded, the game ends `token-cap` (add to the `result` union).
- A mock `ModelClient` for tests. **No network calls. No provider SDK.**

Out of scope: a real provider client (owner-approved step later).

---

## t93 — suites S1 (legality gauntlet) + S4 (consistency) + registry
**Agent:** dvv1
**Paths:** `src/bench/suites/**`
**Gate:** `npm test -- src/bench`
**Deps:** t91 (grader for S2/S3 later), t96 (S1/S4 use the adapter)

Goal: a suite registry; S1 = N seeded positions, each asked for a move, metric = legal-move rate with Wilson CI; S4 = same position resampled K times, metric = distinct-move entropy. Both emit JSONL under the §4a.1 contract with a `suite` field added (additive).

Tests: Wilson CI against a known worked value; S4 entropy of a deterministic agent is 0.

---

## t94 — session report (SVG/HTML) + artifact publish step
**Agent:** dvv2
**Paths:** `src/bench/report*`
**Gate:** `npm run build` + a report snapshot test on a fixture JSONL (snapshot allowed here, since the output is the artifact).
**Deps:** t92

Goal: `xc report session <run-id>` → a self-contained HTML (inline SVG, no external assets) with the metrics table and the ladder. The artifact publish step is a documented manual command for now; no automated upload in this task.

---

## t95 — match scheduler, anchor Elo, pinned regression CI
**Agent:** dvv1 (replaces the nonexistent dpp1 in the old TASKLIST)
**Paths:** `scripts/**`, `src/bench/ladder*` (`.github/workflows/**` is **owner-gated**: do not edit without explicit owner OK)
**Gate:** `npm test -- src/bench && npm run lint`
**Deps:** t91, t93, t96

Goal: a match scheduler over pairs of agents with a fixed seed list; anchor Elo vs the shallow-minimax bot (labelled model-relative, §2); Wilson / bootstrap CIs on every pairwise number. The nightly CI workflow is a separate, owner-approved change: the brief delivers the script and a local dry run only.

---

## Dispatch order and concurrency

- Land t90 first: rvv1 review of `luvus/t87`, follow-up commit for the retry policy, merge to `dev`.
- Then up to two live workers on disjoint paths: t91 (dvv1) ∥ t92 (dvv2). t96 starts once a worker frees up.
- Then t93 → (t94 ∥ t95).
- Round 18 (t81, t82) is reviewed by rvv1 in the same window. It touches `src/ui` and `worker`, which are disjoint from the bench, so it is a review-bandwidth limit only.
