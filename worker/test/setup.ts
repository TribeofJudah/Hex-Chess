import { env as testEnv } from 'cloudflare:test'
import type { Env } from '../src/index'

/**
 * Test bindings (t67), typed as this worker's `Env`. `cloudflare:test`'s `env`
 * is generated from the wrangler config the pool loads, so the `ROOMS`
 * Durable Object namespace in `wrangler.toml` is present at runtime; the cast
 * just restores the app-level type.
 */
export const env = testEnv as unknown as Env

/** The Durable Object stub for a room code — the same addressing the Worker's
 *  `/room/<CODE>` route uses (`idFromName(code)`). */
export function roomStub(code: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(code.toUpperCase()))
}
