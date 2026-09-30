import { describe, expect, it } from 'vitest'

// Pipeline sanity check for pure-TS tests (the rules engine suites in T3–T5
// will follow this pattern, minus the DOM).
describe('test pipeline', () => {
  it('runs assertions with vitest globals', () => {
    expect(1 + 1).toBe(2)
  })

  it('supports the same module resolution as app code', async () => {
    const mod = await import('./App')
    expect(typeof mod.default).toBe('function')
  })
})
