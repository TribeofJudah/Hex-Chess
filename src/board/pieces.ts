/**
 * Piece types and the Gliński initial position.
 *
 * Starting array cross-verified 2026-09-30 against:
 * - https://en.wikipedia.org/wiki/Hexagonal_chess#Gli%C5%84ski's_hexagonal_chess
 *   · "rank 7 (filled with black pawns in the initial setup)"
 *   · Fool's mate 1.Qe1c3 Qe10c6 2.b1b2 b7b6 3.Bf3b1 e7e6? 4.Qc3xBf9#
 *     (pins Q e1/e10, B f3/f9, pawns b1/b7; every move verified as a
 *     straight line in src/board axial coords)
 * - hexchess.club reference (scottbedard/hexchess js/src/constants.ts):
 *   FEN 'b/qbk/n1b1n/r5r/ppppppppp/11/5P5/4P1P4/3P1B1P3/2P2B2P2/1PRNQBKNRP1'
 *   decoded via its fen-index → cell graph; re-encoding White's array
 *   below reproduces the FEN exactly, and Black's side equals
 *   mirrorCell(White's) cell by cell.
 * - Three-bishop colour rule: f1/f2/f3 occupy all three cell colours
 *   (a c1/f1/i1-style rank would put two bishops on one colour).
 */

import { mirrorCell, type Axial } from './axial'
import { notationToAxial } from './notation'

export type PieceType = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P'
export type Color = 'w' | 'b'

export interface Piece {
  readonly type: PieceType
  readonly color: Color
}

/** Cells where pawns of the given color start (also the double-step cells). */
export const PAWN_STARTS: Readonly<Record<Color, readonly string[]>> = {
  w: ['b1', 'c2', 'd3', 'e4', 'f5', 'g4', 'h3', 'i2', 'k1'],
  b: ['b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7', 'i7', 'k7'],
}

const WHITE_ARRAY: ReadonlyArray<readonly [string, PieceType]> = [
  ['g1', 'K'],
  ['e1', 'Q'],
  ['f1', 'B'],
  ['f2', 'B'],
  ['f3', 'B'],
  ['d1', 'N'],
  ['h1', 'N'],
  ['c1', 'R'],
  ['i1', 'R'],
  ...PAWN_STARTS.w.map((c) => [c, 'P'] as const),
]

export const STARTING_POSITION: ReadonlyMap<string, Piece> =
  buildStartingPosition()

function buildStartingPosition(): Map<string, Piece> {
  const map = new Map<string, Piece>()

  const put = (notation: string, type: PieceType, color: Color) => {
    const axial = notationToAxial(notation)
    if (!axial) throw new Error(`invalid starting cell: ${notation}`)
    const key = keyOf(axial)
    if (map.has(key)) throw new Error(`cell occupied twice: ${notation}`)
    map.set(key, { type, color })
  }

  for (const [cell, type] of WHITE_ARRAY) put(cell, type, 'w')
  for (const [cell, type] of WHITE_ARRAY) {
    const axial = notationToAxial(cell)
    if (!axial) throw new Error(`invalid starting cell: ${cell}`)
    const mirrored = axialToNotationSafe(mirrorCell(axial))
    put(mirrored, type, 'b')
  }

  return map
}

function axialToNotationSafe(cell: Axial): string {
  // Local import-free re-implementation to avoid a cycles/marker import;
  // must stay in sync with notation.axialToNotation.
  const FILE_LETTERS = 'abcdefghikl'
  const fileIndex = cell.q + 5
  const rank = cell.r + Math.min(cell.q, 0) + 6
  const notation = `${FILE_LETTERS[fileIndex]}${rank}`
  if (fileIndex < 0 || fileIndex > 10 || rank < 1 || rank > 11) {
    throw new Error(`mirror left the board: ${JSON.stringify(cell)}`)
  }
  return notation
}

/** Stable map key for a cell. */
export function keyOf(cell: Axial): string {
  return `${cell.q},${cell.r}`
}
