# CLAUDE.md — Xchess (HexChess)

Xchess: Gliński hexagonal chess. A web/TUI play surface plus a terminal-first LLM research bench on the same rules core.

## Commands
- Test: `npm test` (all) · `npm test -- src/bench` (one area)
- Lint: `npm run lint` · Typecheck: `npx tsc -b` · Build: `npm run build`
- Worker: `cd worker && npm test`
- FEN smoke: `node scripts/fen-smoke.mjs`

## Layout
- `src/rules`, `src/board`: rules core (perft-validated). Verify rules against the Wikipedia Gliński article, not memory.
- `src/ai`: negamax engine (shared by play and bench).
- `src/ui`: play surface. `src/bench`: research bench (Round 19+).
- `worker/`: Cloudflare Durable Object rooms.

## Rules for working here
- Bench fence: `src/bench` and `src/ui` never import each other (enforced by ESLint).
- No new npm dependencies without owner approval.
- No AI attribution lines in commits or PRs (owner rule).
- Commit only to your task branch; the dispatcher merges to `dev`.
- Full process rules: `RULES.md`. Dispatch briefs: `claudedocs/TASKLIST.md` (history) and `claudedocs/BENCH_BRIEFS.md` (current round).
