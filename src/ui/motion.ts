/**
 * Shared motion helpers (R16 / t66).
 *
 * The board's animations are CSS-driven, so "reduced motion" is mostly handled
 * by the `@media (prefers-reduced-motion: no-preference)` wrappers in
 * theme.css. What lives here is the JS half: the FLIP maths the slide's custom
 * properties are filled from, the stagger curve for the legal-target fan, and
 * the two paths that have to *decide* something in JS — how long a capture
 * ghost lingers, and whether a theme change cross-fades.
 *
 * Durations are the `--motion-*` tokens in src/index.css and live only there —
 * nothing here duplicates them except TARGET_STAGGER, which is the one budget
 * the JS has to do arithmetic on.
 */

/** Longest delay any one legal-target marker may wait, in ms — the whole fan
    lands inside one `--motion-fast`, whatever its size. */
export const TARGET_STAGGER = 120

export interface Point {
  x: number
  y: number
}

/** True when the user has asked the OS for less motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * FLIP delta: the transform a piece sitting at `to` must start from to look
 * like it left `from`. Points are screen-space (y down, as the board draws).
 */
export function flipDelta(from: Point, to: Point): Point {
  return { x: from.x - to.x, y: from.y - to.y }
}

/**
 * Delay for one legal-target marker: proportional to its distance from the
 * selected piece, so the fan blooms outward. `maxDistance` is the furthest
 * marker in the set — that pins the last one at TARGET_STAGGER ms, so the whole
 * fan lands inside the budget however many moves there are.
 */
export function staggerDelay(distance: number, maxDistance: number): number {
  if (!(maxDistance > 0)) return 0
  const clamped = Math.min(Math.max(distance, 0), maxDistance)
  return Math.round((clamped / maxDistance) * TARGET_STAGGER)
}

/**
 * Run `update` inside a View Transition so a recolour cross-fades, or plainly
 * when the API is missing or the user wants less motion. The caller must flush
 * its DOM change synchronously inside `update` (React otherwise schedules the
 * render past the transition's "after" snapshot, and nothing fades).
 */
export function withViewTransition(update: () => void): void {
  const start = (
    document as unknown as {
      startViewTransition?: (callback: () => void) => unknown
    }
  ).startViewTransition
  if (prefersReducedMotion() || typeof start !== 'function') {
    update()
    return
  }
  start.call(document, update)
}
