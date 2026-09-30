/**
 * Gliński cell notation: 11 files a–l omitting j, 11 ranks (1–11).
 *
 * Rank geometry (verified against Wikipedia, 2026-09-30):
 *   ranks 1–6: 11 cells each · rank 7: 9 (b7–k7) · rank 8: 7 (c8–i8)
 *   rank 9: 5 (d9–h9) · rank 10: 3 (e10–g10) · rank 11: 1 (f11)
 * Total: 6·11 + 9 + 7 + 5 + 3 + 1 = 91. Ranks bend 60° at file f.
 *
 * Coordinate mapping (f6 = origin, files step NE/E, ranks step N):
 *   q = fileIndex − 5
 *   r = (rank − 6) − min(fileIndex − 5, 0)
 * with inverse fileIndex = q + 5, rank = r + min(q, 0) + 6.
 * Landmarks: a1=(−5,0) f1=(0,−5) l1=(5,−5) f11=(0,5) k4=(4,−2) e10=(−1,5).
 */

import { isValidCell, mirrorCell, type Axial } from './axial'

/** File letters a–l, omitting j (11 files). */
export const FILE_LETTERS = 'abcdefghikl'

const FILE_INDEX: Record<string, number> = {}
for (let i = 0; i < FILE_LETTERS.length; i++) FILE_INDEX[FILE_LETTERS[i]] = i

/** Inclusive file-index bounds per rank (derived from the hexagon shape). */
const RANK_BOUNDS: Record<number, [number, number]> = {
  1: [0, 10],
  2: [0, 10],
  3: [0, 10],
  4: [0, 10],
  5: [0, 10],
  6: [0, 10],
  7: [1, 9], // b7–k7
  8: [2, 8], // c8–i8
  9: [3, 7], // d9–h9
  10: [4, 6], // e10–g10
  11: [5, 5], // f11
}

/** Cells per rank 1 → 11 (Wikipedia: "Ranks 1–6 each contain 11 cells..."). */
export const RANK_CELL_COUNTS: readonly number[] = [
  11, 11, 11, 11, 11, 11, 9, 7, 5, 3, 1,
]

export function isValidNotation(notation: string): boolean {
  const m = /^([a-ikl])(\d{1,2})$/.exec(notation)
  if (!m) return false
  const file = FILE_INDEX[m[1]]
  const rank = Number(m[2])
  if (file === undefined) return false
  const bounds = RANK_BOUNDS[rank]
  return bounds !== undefined && file >= bounds[0] && file <= bounds[1]
}

/** Parse "f6"-style notation to axial coords with f6 at (0, 0). */
export function notationToAxial(notation: string): Axial | null {
  if (!isValidNotation(notation)) return null
  const fileIndex = FILE_INDEX[notation[0]]
  const rank = Number(notation.slice(1))
  const df = fileIndex - 5
  const axial: Axial = { q: df, r: rank - 6 - Math.min(df, 0) }
  return isValidCell(axial) ? axial : null
}

/** Format axial coords back to "f6"-style notation. */
export function axialToNotation(cell: Axial): string {
  const { q, r } = cell
  const fileIndex = q + 5
  const rank = r + Math.min(q, 0) + 6
  return `${FILE_LETTERS[fileIndex]}${rank}`
}

/** Cells of one rank, left to right. */
export function rankCells(rank: number): string[] {
  const bounds = RANK_BOUNDS[rank]
  if (!bounds) return []
  const cells: string[] = []
  for (let f = bounds[0]; f <= bounds[1]; f++) {
    cells.push(`${FILE_LETTERS[f]}${rank}`)
  }
  return cells
}

/** Cells of one file, bottom to top. */
export function fileCells(file: string): string[] {
  const idx = FILE_INDEX[file]
  if (idx === undefined) return []
  const cells: string[] = []
  for (let rank = 1; rank <= 11; rank++) {
    const n = `${file}${rank}`
    if (isValidNotation(n)) cells.push(n)
  }
  return cells
}

/** All 91 cells in FEN order: rank 11 → 1, left to right within each rank. */
export function allCells(): Axial[] {
  const cells: Axial[] = []
  for (let rank = 11; rank >= 1; rank--) {
    for (const notation of rankCells(rank)) {
      const axial = notationToAxial(notation)
      if (axial) cells.push(axial)
    }
  }
  return cells
}

/** Point-mirror a cell in notation space (e1 ↔ e10, f1 ↔ f11). */
export function mirrorNotation(notation: string): string | null {
  const axial = notationToAxial(notation)
  return axial ? axialToNotation(mirrorCell(axial)) : null
}
