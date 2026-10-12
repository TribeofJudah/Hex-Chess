import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TARGET_STAGGER,
  flipDelta,
  prefersReducedMotion,
  staggerDelay,
  withViewTransition,
} from './motion'

/** jsdom ships no matchMedia, so every test that needs a verdict installs one. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prefersReducedMotion', () => {
  it('is false when the browser has no matchMedia at all', () => {
    expect(prefersReducedMotion()).toBe(false)
  })

  it('reads the reduce query', () => {
    stubReducedMotion(true)
    expect(prefersReducedMotion()).toBe(true)
    stubReducedMotion(false)
    expect(prefersReducedMotion()).toBe(false)
  })
})

describe('flipDelta', () => {
  /* Screen space: y grows downward, as the board draws. A piece that ends at
     `to` must start translated by the vector from `to` back to `from`. */
  it('is the vector from the last position back to the first', () => {
    expect(flipDelta({ x: 10, y: 40 }, { x: 30, y: 25 })).toEqual({
      x: -20,
      y: 15,
    })
  })

  it('is zero for a piece that did not move', () => {
    expect(flipDelta({ x: 7, y: -3 }, { x: 7, y: -3 })).toEqual({ x: 0, y: 0 })
  })
})

describe('staggerDelay', () => {
  it('gives the nearest marker no wait and the furthest the whole budget', () => {
    expect(staggerDelay(0, 4)).toBe(0)
    expect(staggerDelay(4, 4)).toBe(TARGET_STAGGER)
  })

  it('spaces the fan by distance', () => {
    expect(staggerDelay(2, 4)).toBe(TARGET_STAGGER / 2)
  })

  it('never exceeds the budget, however odd the input', () => {
    expect(staggerDelay(9, 4)).toBe(TARGET_STAGGER)
    expect(staggerDelay(-3, 4)).toBe(0)
    // One marker, or none: there is no distance to spread over.
    expect(staggerDelay(0, 0)).toBe(0)
  })
})

describe('withViewTransition', () => {
  /** jsdom has no View Transitions API; stand one up and take it down again. */
  const stubViewTransition = () => {
    const start = vi.fn<(cb: () => void) => void>()
    Reflect.set(document, 'startViewTransition', start)
    return start
  }
  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition')
  })

  it('runs the update plainly when the API is missing', () => {
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('runs the update plainly when reduced motion is asked for', () => {
    stubReducedMotion(true)
    const start = stubViewTransition()
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
  })

  it('hands the update to the transition so the recolour can cross-fade', () => {
    stubReducedMotion(false)
    const start = stubViewTransition()
    const update = vi.fn()
    withViewTransition(update)
    expect(start).toHaveBeenCalledTimes(1)
    // The callback belongs to the transition — running it here would recolour
    // before the browser has captured the frame it needs to fade from.
    expect(update).not.toHaveBeenCalled()
    start.mock.calls[0]?.[0]?.()
    expect(update).toHaveBeenCalledTimes(1)
  })
})
