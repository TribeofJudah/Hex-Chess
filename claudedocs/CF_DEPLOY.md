# Cloudflare Worker deploy (t46 — round 8)

## What ships

| Workflow                          | Trigger                               | Job                                          | Auth                          |
| --------------------------------- | ------------------------------------- | -------------------------------------------- | ----------------------------- |
| `.github/workflows/cf-dryrun.yml` | PR (`main`, `dev`) + push `dev`       | `cd worker && npx wrangler deploy --dry-run` | none                          |
| `.github/workflows/cf-deploy.yml` | push tag `v*.*.*` + workflow_dispatch | `cd worker && npx wrangler deploy`           | `CLOUDFLARE_API_TOKEN` secret |

Both install with the same Node 22 + `worker/package-lock.json` cache
layout as `ci.yml`'s `worker` job, and pin the wrangler version via that
lockfile (`wrangler ^4.20.0` devDep, no runtime deps — the bundle is
self-contained). `cf-deploy.yml` also accepts `workflow_dispatch` for
manual redeploys, mirroring the Pages flow.

## Where the token lives

Repo settings → Secrets and variables → Actions →
`CLOUDFLARE_API_TOKEN`. **As of 2026-10-05 no repo secrets exist**
(`gh secret list` is empty), so the owner must add it before the first
tag deploy; until then `cf-deploy.yml` runs will fail at the Deploy
step. `cf-dryrun.yml` never needs credentials.

Token scope: Cloudflare dashboard → My Profile → API Tokens →
"Edit Cloudflare Workers" template, restricted to the one account that
hosts `hex-chess-rooms`. `worker/wrangler.toml` intentionally has no
`account_id`: wrangler infers the account from a single-membership
token. If the token must span multiple accounts, also set a
`CLOUDFLARE_ACCOUNT_ID` secret and pass it as env in `cf-deploy.yml`.

## How to rotate

1. Create the replacement token (same scope as above).
2. Update `CLOUDFLARE_API_TOKEN` in repo Settings → Actions secrets.
3. Delete ("roll") the old token in the Cloudflare dashboard.
   Deployments only run on tag pushes, so the swap window is low-risk;
   run a `workflow_dispatch` of `cf-deploy.yml` afterwards to confirm.

## The gate command

```
cd worker && npx wrangler deploy --dry-run
```

Runs anywhere (local or CI) with no credentials. `cf-dryrun.yml` is
exactly this on CI. Local final-gate usage: run it before pushing, then
`node scripts/fen-smoke.mjs` for the root.

## What a failed dry-run looks like

The PR check list shows an orange/red **"CF Worker dry-run /
cf-dryrun"** entry with the failing step "Wrangler dry-run bundle".
Typical wrangler output is an esbuild bundling error (unresolved
import, TS syntax error in `worker/src/**`) or a config error (bad DO
binding / migration in `wrangler.toml`). The failure also blocks the
merge the same way a red `CI` check does.

## Owner-only tag deploy pattern

Same release model as Pages: the `dev → main` PR requires owner
approval, and the owner cuts a `v*.*.*` tag on `main` when releasing;
the tag push fires `cf-deploy.yml` (Worker) alongside the existing
`deploy.yml` (Pages). Nobody with only write access can deploy by
pushing a branch — deploys ride on tags only. (NOTE: `RULES.md` was
not found in the checkout as of round 8 — this section documents the
pattern the brief describes; if §5's wording drifts, trust RULES.md.)

## First-run checklist

1. Owner: add the `CLOUDFLARE_API_TOKEN` secret (scope above).
2. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. Watch "Deploy Worker to Cloudflare" go green in Actions.
4. Confirm in Cloudflare dashboard (Workers → `hex-chess-rooms`) or
   `cd worker && npx wrangler tail`.
