# RULES

Process rules for the HexChess repo. The dispatcher brief lives in
`claudedocs/TASKLIST.md`. The wire spec lives in `claudedocs/ROOM_PROTO.md`
(and the per-feature specs `DRAW_PROTO.md`, `DRAW_UI.md`,
`PROMOTION_UI.md`, `DO_PERSISTENCE.md`). This file carries only the
process rules.

## §1  Source of truth

- `claudedocs/TASKLIST.md` is the dispatcher brief.
- `claudedocs/ROOM_PROTO.md` is the wire spec.
- Per-feature specs are in `claudedocs/<feature>.md`.
- This file (`RULES.md`) carries only process rules.
- The rules of chess itself are documented at
  https://en.wikipedia.org/wiki/Hexagonal_chess#Gliński's_hexagonal_chess.
  Code that implements a rule must verify against the source, not from
  memory.

## §2  Branch model

- `main` is the live release. It only ever receives merges from `dev`.
- `dev` is the integration branch. All work commits here.
- Per-task feature branches (`task/<n>-<slug>`) are allowed for serial
  work. Parallel-round runs share the dispatcher-managed `dev` checkout
  with disjoint file fences; in that mode workers do NOT create their
  own branch.

## §3  Lane discipline

- Each worker has a fenced file set listed in the luvus task
  definition (`paths`). Workers MUST NOT touch files outside the fence
  without an explicit dispatcher signal. Out-of-fence wiring (mounting
  a new component, threading an existing prop) is acceptable if the
  dispatcher has sanctioned it for the round; flag in the report.
- Workers do NOT commit. The dispatcher reviews, commits, and pushes.
- Workers write a short report at `/tmp/<agent>_round<N>_report.md`.
- Both workers may run in parallel against the same `dev` checkout.
  The fences must be disjoint. The dispatcher reviews both diffs and may
  pick the order based on invasiveness.

## §4  Gate model

- Luvus task gates are prose strings, NOT shell commands.
  - "remote human pawn promotes without NACK; promotion banner appears
    only at the human turn"
  - "evicted room respawns with same roomId and history"
- The luvus `task done` parser can shell-escape a gate with spaces
  (exit 127, "command not found"). This is a known luvus parser quirk;
  the implementation IS the gate. The pattern is:

      luvus task done <id>      # may report gate parser exit 127
      luvus task merge <id>
      luvus task update <id> --status done

  Confirmed working for `t44`, `t45`, `t46`, `t48`, `t49`. The output
  carries the parser error verbatim; the merge+update completes the
  flow.

## §5  Release + owner approval

The owner (the user) signs off on every `dev → main` merge.

- **PR flow**: dispatcher opens `dev → main` PR. CI runs (lint, test,
  FEN smoke, build, Worker dry-run, Pages build).
- **Owner approval**: owner reviews the PR. On "looks good" the
  dispatcher merges (`gh pr merge --merge`).
- **Tag**: dispatcher tags `vMAJOR.MINOR.PATCH` per SemVer and pushes
  the tag. The Pages workflow deploys on `main` push; the Worker
  workflow (`cf-deploy.yml`) deploys on tag push.
- **GitHub Release**: dispatcher creates a release with the same notes
  pattern as v0.1.0/v0.1.1.
- **Worker deploys require `CLOUDFLARE_API_TOKEN`** in repo secrets
  (see `claudedocs/CF_DEPLOY.md`). Owner creates the secret once.

This §5 is the only place the owner-approval gate is documented; every
brief and workflow cites it. If RULES.md is ever absent from the
checkout, follow the Pages workflow as a template plus the brief's
own description, and trust RULES.md if/when it reappears.

## §6  Backlog rules

- **luvus task lifecycle**: `queued → claimed → review → done`.
  Use `luvus task done` (may report gate-parser exit 127 — see §4),
  then `luvus task merge`, then `luvus task update --status done`.
- **Stale tasks**: dispatcher's call to delete, owner-approved.
- **Re-issued task IDs**: luvus reuses the lowest free numeric slot.
  Two HexChess tasks may claim the same slot if they are issued at
  different times; the `title` field is the canonical name. Phuthuma
  portal tasks (different project, same luvus board) share slots and
  may collide; always check `paths` to confirm scope before claiming.

## §8  Standing CI gates (touched on every PR)

```
npx tsc -b            # root + worker both
npm test              # root, vitest
cd worker && npm test # worker, vitest
node scripts/fen-smoke.mjs   # deploy-pipeline FEN round-trip
npm run lint          # eslint, including prettier on cloudedocs/**
npm run build         # vite build (Pages)
cd worker && npx wrangler deploy --dry-run   # bundle check
```

All must exit 0 before a PR merges.
