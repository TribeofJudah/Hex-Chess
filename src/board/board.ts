/**
 * Board model barrel: cell lookup, colour, rays, initial position.
 */

export * from './axial'
export * from './notation'
export * from './colors'
export * from './pieces'

import { DIAG_DIRS, ORTHO_DIRS, type Axial } from './axial'
import { cellColor, type CellColor } from './colors'
import {
  axialToNotation,
  isValidNotation,
  notationToAxial,
  rankCells,
  RANK_CELL_COUNTS,
} from './notation'
import { keyOf, STARTING_POSITION, type Piece } from './pieces'

/** A located piece: what stands where. */
export interface Placed {
  readonly cell: Axial
  readonly piece: Piece
}

/** Cells reachable from `cell` along one direction until the board edge. */
export function ray(cell: Axial, dir: Axial): Axial[] {
  const cells: Axial[] = []
  let q = cell.q + dir.q
  let r = cell.r + dir.r
  while (Math.abs(q) <= 5 && Math.abs(r) <= 5 && Math.abs(q + r) <= 5) {
    cells.push({ q, r })
    q += dir.q
    r += dir.r
  }
  return cells
}

/** All orthogonal rays from a cell (6 directions). */
export function orthoRays(cell: Axial): Axial[][] {
  return ORTHO_DIRS.map((d) => ray(cell, d))
}

/** All diagonal rays from a cell (6 directions). */
export function diagRays(cell: Axial): Axial[][] {
  return DIAG_DIRS.map((d) => ray(cell, d))
}

/** Orthogonal neighbours that are on the board. */
export function orthoNeighbors(cell: Axial): Axial[] {
  return ORTHO_DIRS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r })).filter(
    (n) => Math.abs(n.q) <= 5 && Math.abs(n.r) <= 5 && Math.abs(n.q + n.r) <= 5,
  )
}

export {
  axialToNotation,
  cellColor,
  isValidNotation,
  keyOf,
  notationToAxial,
  rankCells,
  RANK_CELL_COUNTS,
  STARTING_POSITION,
  type Axial,
  type CellColor,
  type Piece,
}

/** Pieces of the initial position as located placements (FEN order). */
export function initialPlacement(): Placed[] {
  const out: Placed[] = []
  for (const [key, piece] of STARTING_POSITION) {
    const [q, r] = key.split(',').map(Number)
    out.push({ cell: { q, r }, piece })
  }
  return out.sort((a, b) => b.cell.r - a.cell.r || a.cell.q - b.cell.q)
}

/** Look up the piece at a notation cell in the initial position. */
export function pieceAt(notation: string): Piece | undefined {
  const axial = notationToAxial(notation)
  return axial ? STARTING_POSITION.get(keyOf(axial)) : undefined
}

/** Colour helper by notation (null if invalid). */
export function colorAt(notation: string): CellColor | null {
  const axial = notationToAxial(notation)
  return axial ? cellColor(axial) : null
}

export { isValidNotation as isValidCellNotation }
