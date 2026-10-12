import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

/**
 * t67 (Round 15): run the worker suite inside the workerd runtime via
 * `@cloudflare/vitest-pool-workers`, so `worker/test/terminals-do.test.ts` can
 * drive a real Durable Object over WebSockets.
 *
 * `defineWorkersConfig`/`defineWorkersProject` were removed in pool-workers
 * 0.13.0 and replaced by the `cloudflareTest()` Vite plugin (exported from the
 * package root) — verified against the installed 0.22.0 typings. The wrangler
 * config supplies the worker `main` (src/index.ts) and the `ROOMS` Durable
 * Object binding/migration, so `env.ROOMS` is populated in `cloudflare:test`.
 *
 * The pure unit suites (room, clock, terminals, protocol, validate, draw) run
 * unchanged in this pool — they are runtime-agnostic. If one ever needs Node,
 * mark just that file with `// @vitest-environment node`.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      // The bundled workerd binary (miniflare pinned by pool-workers 0.22.0)
      // only supports compatibility dates up to 2026-08-22, while wrangler.toml
      // targets 2026-09-23 (a deploy-time setting, out of scope to change).
      // Pin the date for the test runtime only; deploy is unaffected.
      miniflare: { compatibilityDate: '2026-08-22' },
    }),
  ],
})
