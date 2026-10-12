/**
 * Plain-text hex board renderer (XCHESS_BENCH §6).
 *
 * One glyph per cell on the same staggered projection the web board uses
 * (src/ui/hexMath.ts `cellCenter`: x = 1.5·size·q, y = √3·size·(r + q/2)):
 * a cell's terminal row is κ = 2r + q — y divided by the half-cell vertical
 * step √3/2·size — and its terminal column is 2q, two glyph slots per
 * horizontal hex step. Files stay vertical columns, rank 1 at the bottom,
 * rank 11 (f11) at the top vertex.
 */
import { isValidCell, type Axial } from '../../board/axial'
import { parsePosition } from '../../board/fen'
import { keyOf, type Piece } from '../../board/pieces'

/** Max |κ| = |2r + q| over the board (f11/f1 are the extremes). */
export const K_MAX = 10

/** Max |q| over the board. */
export const Q_MAX = 5

/** Terminal rows of the rendered board (κ descending, top-down). */
export const ROWS = 2 * K_MAX + 1

/** Terminal columns of the rendered board (files every 2 columns, plus gaps). */
export const COLS = 4 * Q_MAX + 1

const EMPTY_GLYPH = '·'

/** White = outline, black = filled; index 0 → 'w', 1 → 'b'. */
const PIECE_GLYPHS: Record<Piece['type'], [string, string]> = {
  K: ['♔', '♚'],
  Q: ['♕', '♛'],
  R: ['♖', '♜'],
  B: ['♗', '♝'],
  N: ['♘', '♞'],
  P: ['♙', '♟'],
}

/** Screen position of a cell: row 0 is the top of the picture. */
export function screenPos(cell: Axial): { row: number; col: number } {
  // Files are vertical columns two terminal columns apart (one blank between
  // files), so col = 2(q + Q_MAX); q = −5 (file a) lands on column 0.
  return { row: K_MAX - (2 * cell.r + cell.q), col: 2 * (cell.q + Q_MAX) }
}

/** Every cell the renderer places, in any order — the TUI's cell set. */
export function boardCells(): Axial[] {
  const cells: Axial[] = []
  for (let q = -Q_MAX; q <= Q_MAX; q++) {
    for (let r = -Q_MAX; r <= Q_MAX; r++) {
      if (isValidCell({ q, r })) cells.push({ q, r })
    }
  }
  return cells
}

/** Glyph for a piece (or the empty-cell dot). */
export function glyphOf(piece: Piece | undefined): string {
  if (!piece) return EMPTY_GLYPH
  return PIECE_GLYPHS[piece.type][piece.color === 'w' ? 0 : 1]!
}

/** One placed glyph: what renders where. */
export interface GlyphCell {
  cell: Axial
  glyph: string
}

/**
 * Glyphs for a whole position from its FEN. Throws on malformed FEN —
 * the JSONL is the only authority, so a bad line must fail loudly.
 */
export function positionGlyphs(fen: string): GlyphCell[] {
  const pos = parsePosition(fen)
  return boardCells().map((cell) => ({
    cell,
    glyph: glyphOf(pos.board.get(keyOf(cell))),
  }))
}

/** Render placed glyphs as ROWS lines of COLS columns (trailing spaces trimmed). */
export function renderCells(glyphs: readonly GlyphCell[]): string[] {
  const grid: string[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ' '),
  )
  for (const { cell, glyph } of glyphs) {
    const { row, col } = screenPos(cell)
    grid[row]![col] = glyph
  }
  return grid.map((line) => line.join('').trimEnd())
}

/** Render a FEN position as text board lines. */
export function renderFen(fen: string): string[] {
  return renderCells(positionGlyphs(fen))
}
