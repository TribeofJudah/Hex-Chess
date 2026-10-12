/**
 * The three board colours. Center cell f6 is mid-tone (per Wikipedia).
 * Colour classes are the three diagonal line families: orthogonally adjacent
 * cells always differ, diagonally adjacent cells always share a colour
 * (which is why Gliński's has three bishops per side).
 */

import { ORTHO_DIRS, type Axial } from './axial'
import { notationToAxial } from './notation'

export type CellColor = 'light' | 'mid' | 'dark'

/**
 * Colour of a cell from its cube coordinate s = −q − r:
 * the class (q − s) mod 3 is invariant along diagonals, cycles on
 * orthogonal steps, and f6 (0, 0) lands in the 'mid' class.
 * (Which of the two non-mid classes renders as light vs dark is a
 * display convention; the engine only needs the three-way partition.)
 */
export function cellColor({ q, r }: Axial): CellColor {
  const s = -q - r
  const cls = (((q - s) % 3) + 3) % 3
  if (cls === 0) return 'mid'
  return cls === 1 ? 'light' : 'dark'
}

/** Colour of a cell by notation, or null if the notation is invalid. */
export function colorOf(notation: string): CellColor | null {
  const axial = notationToAxial(notation)
  return axial ? cellColor(axial) : null
}

/** True if every on-board orthogonal neighbour of `cell` differs in colour. */
export function neighborsDiffer(cell: Axial): boolean {
  const c0 = cellColor(cell)
  return ORTHO_DIRS.every((d) => {
    const n = { q: cell.q + d.q, r: cell.r + d.r }
    if (Math.abs(n.q) > 5 || Math.abs(n.r) > 5 || Math.abs(n.q + n.r) > 5) {
      return true // off-board neighbour: nothing to compare
    }
    return cellColor(n) !== c0
  })
}
