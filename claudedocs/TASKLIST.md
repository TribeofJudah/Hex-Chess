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
