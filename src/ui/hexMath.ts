/**
 * Geometry and coordinate math for Gliński's hexagonal chess board.
 *
 * The board is a regular hexagon of side 6 (91 cells) built from flat-top
 * hexagon cells arranged in 11 vertical files. Cube coordinates (q, r, s)
 * are the source of truth, with s = -q - r. A cell belongs to the board iff
 * all three coordinates are within the board radius (|q|, |r|, |s| <= 5).
 *
 * Notation (per Wikipedia, Gliński's variant):
 * - 11 files, letters a-l with j omitted. From White's view, file "a" is the
 *   leftmost column.
 * - 11 ranks, and each rank is a bent diagonal that bends 60° at the central
 *   file "f": rank populations are 11,11,11,11,11,11,9,7,5,3,1 and the single
 *   cell on rank 11 is f11 (the top vertex). Rank 1 is the bottom edge.
 * - A file of height h labels its cells a1..ah bottom-up, so file heights
 *   are 6,7,8,9,10,11,10,9,8,7,6 for a,b,c,d,e,f,g,h,i,k,l.
 */

export const BOARD_RADIUS = 5

/** File letters, left to right from the white player's point of view. */
export const FILES = 'abcdefghikl'

export interface HexCell {
  /** File axis (axial), -5..5. */
  q: number
  /** Row axis (axial), -5..5. */
  r: number
  /** Third cube coordinate, always equals -q - r. */
  s: number
}

export type PieceColor = 'white' | 'black'
export type PieceKind = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn'

export function isValidQr(q: number, r: number): boolean {
  const s = -q - r
  const within = (n: number) => Math.abs(n) <= BOARD_RADIUS
  return within(q) && within(r) && within(s)
}

/** Every board cell, top-left to bottom-right reading order. */
export function allCells(): HexCell[] {
  const cells: HexCell[] = []
  for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q++) {
    for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r++) {
      if (isValidQr(q, r)) cells.push({ q, r, s: -q - r })
    }
  }
  return cells
}

// ---------------------------------------------------------------------------
// Notation: file letter + per-file rank (1 = bottom of that file).
//
// Bent-rank algebra (derivable from the rank-1 bent edge):
//   cells with q >= 0: rank = r + 6
//   cells with q <= 0: rank = 6 - s
//   (the q = 0 cell satisfies both and belongs to rank 11 / 1 at the ends)
// ---------------------------------------------------------------------------

export function cellToFileRank(cell: HexCell): { file: string; rank: number } {
  const { q, r, s } = cell
  if (!isValidQr(q, r)) throw new Error(`not a board cell: q=${q} r=${r}`)
  const rank = q >= 0 ? r + 6 : 6 - s
  return { file: FILES[q + BOARD_RADIUS], rank }
}

export function fileRankToCell(file: string, rank: number): HexCell {
  const q = FILES.indexOf(file) - BOARD_RADIUS
  if (q < -BOARD_RADIUS) throw new Error(`unknown file: ${file}`)
  const height = 11 - Math.abs(q)
  if (rank < 1 || rank > height) {
    throw new Error(`rank ${rank} out of range for file ${file} (1-${height})`)
  }
  const r = q >= 0 ? rank - 6 : rank - 6 - q
  if (!isValidQr(q, r)) throw new Error(`invalid cell ${file}${rank}`)
  return { q, r, s: -q - r }
}

/** Number of cells in a file (6 at the edges up to 11 in the center). */
export function fileHeight(file: string): number {
  const q = FILES.indexOf(file) - BOARD_RADIUS
  return 11 - Math.abs(q)
}

// ---------------------------------------------------------------------------
// Projection: flat-top cells, files vertical, rank 1 at the bottom.
// ---------------------------------------------------------------------------

export interface Point {
  x: number
  y: number
}

/**
 * Center of a cell on screen. `size` is the hex circumradius.
 * Flat-top mapping: x steps by 1.5·size per file, vertical neighbor spacing
 * is full √3·size, and y grows upward with r (SVG callers negate it).
 */
export function cellCenter(cell: HexCell, size: number): Point {
  return {
    x: 1.5 * size * cell.q,
    y: Math.sqrt(3) * size * (cell.r + cell.q / 2),
  }
}

/** The 6 corner offsets of a flat-top cell (screen space, y down). */
export function cellCorners(size: number): Point[] {
  const corners: Point[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i
    corners.push({
      x: size * Math.cos(angle),
      y: size * Math.sin(angle),
    })
  }
  return corners
}

/** SVG `points` attribute for a cell polygon, centered at (cx, cy). */
export function cellPoints(cx: number, cy: number, corners: Point[]): string {
  return corners.map((c) => `${round(cx + c.x)},${round(cy + c.y)}`).join(' ')
}

function round(n: number): number {
  // 1/1000 px is far below any rendering unit; keeps viewBox compact.
  return Math.round(n * 1000) / 1000
}

export interface Bounds {
  width: number
  height: number
  /** Screen-space top-left corner of the board's bounding box. */
  origin: Point
}

/**
 * Bounding box of the whole projected board (rank 1 at bottom in screen
 * coords once y is negated) plus stroke padding.
 */
export function boardBounds(size: number, padding = 2): Bounds {
  // Center-file cells (q=0) carry the extremes: r=±5 and the cells'
  // vertical half-extent is (√3/2)·size on a flat-top hex.
  const halfHeight =
    Math.sqrt(3) * size * BOARD_RADIUS + (Math.sqrt(3) / 2) * size + padding
  // Edge-file cells (q=-5) reach x = -7.5·size - size.
  const halfWidth = 1.5 * size * BOARD_RADIUS + size + padding
  return {
    width: round(2 * halfWidth),
    height: round(2 * halfHeight),
    origin: { x: -halfWidth, y: -halfHeight },
  }
}

/** SVG viewBox string for the projected board. */
export function viewBox(size: number, padding = 2): string {
  const { width, height } = boardBounds(size, padding)
  return `0 0 ${width} ${height}`
}