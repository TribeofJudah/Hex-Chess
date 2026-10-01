/**
 * Axial hex coordinates for Gliński's hexagonal chess.
 *
 * Coordinate system: axial (q, r) with the center cell f6 at (0, 0).
 * The board is the regular hexagon of side 6:
 *   |q| <= 5, |r| <= 5, |q + r| <= 5  →  exactly 91 cells.
 *
 * Sources (verified 2026-09-30):
 * - https://en.wikipedia.org/wiki/Hexagonal_chess#Gli%C5%84ski's_hexagonal_chess
 *   (91 cells, three colours, middle cell f6 usually mid-tone)
 */

export interface Axial {
  readonly q: number
  readonly r: number
}

/** The six orthogonal (edge-neighbor) directions. */
export const ORTHO_DIRS: readonly Axial[] = [
  { q: 1, r: 0 }, // NE (f6 -> g6)
  { q: 0, r: 1 }, // N  (up the file, the way White pawns move)
  { q: -1, r: 1 }, // NW
  { q: -1, r: 0 }, // SW
  { q: 0, r: -1 }, // S
  { q: 1, r: -1 }, // SE
]

/** The six diagonal (vertex-neighbor) directions. */
export const DIAG_DIRS: readonly Axial[] = [
  { q: 2, r: -1 },
  { q: 1, r: 1 },
  { q: -1, r: 2 },
  { q: -2, r: 1 },
  { q: -1, r: -1 },
  { q: 1, r: -2 },
]

/**
 * Hex knight leaps: two orthogonal steps in one direction, then one
 * orthogonal step at a 60° angle (Wikipedia, Gliński knight) — 12 offsets.
 */
export const KNIGHT_DIRS: readonly Axial[] = [
  { q: 1, r: -3 },
  { q: 2, r: -3 },
  { q: 3, r: -2 },
  { q: 3, r: -1 },
  { q: 2, r: 1 },
  { q: 1, r: 2 },
  { q: -1, r: 3 },
  { q: -2, r: 3 },
  { q: -3, r: 2 },
  { q: -3, r: 1 },
  { q: -2, r: -1 },
  { q: -1, r: -2 },
]

export function isValidCell({ q, r }: Axial): boolean {
  return (
    Number.isInteger(q) &&
    Number.isInteger(r) &&
    Math.abs(q) <= 5 &&
    Math.abs(r) <= 5 &&
    Math.abs(q + r) <= 5
  )
}

export function addAxial(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r }
}

export function axialEquals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r
}

/** Cube-style hex distance (number of orthogonal steps). */
export function axialDistance(a: Axial, b: Axial): number {
  const dq = b.q - a.q
  const dr = b.r - a.r
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))
}

/**
 * Mirror through the board's horizontal center line (White camp ↔ Black
 * camp, cube coords: swap r ↔ s): (q, r) → (q, −q−r).
 * e.g. f1 ↔ f11, e1 ↔ e10, b1 ↔ b7, f2 ↔ f10. The Gliński starting
 * position is exactly symmetric under this map.
 */
export function mirrorCell({ q, r }: Axial): Axial {
  return { q, r: -q - r }
}
