import { useMemo } from 'react'
import {
  allCells,
  boardBounds,
  cellCorners,
  cellCenter,
  cellPoints,
  cellToFileRank,
  fileRankToCell,
  viewBox,
  type PieceColor,
  type PieceKind,
} from './hexMath'
import { GlyphRects, PieceLegend } from './pieces/Piece'
import './theme.css'

/** Pieces keyed by Gliński notation, e.g. { f1: { kind: 'king', color: 'white' } }. */
export type BoardPieces = Record<string, { kind: PieceKind; color: PieceColor }>

export interface HexBoardProps {
  /** Cell circumradius in SVG user units. */
  size?: number
  pieces?: BoardPieces
  /** CRT scanline overlay, defaults on. */
  scanlines?: boolean
  /** Glyph strip below the board (preview aid), defaults on. */
  legend?: boolean
}

/* Proper 3-colouring: every edge-neighbor shifts (q - r) by ±1. Index 0 is
   the central cell, which Gliński's board shades mid-tone. */
const CELL_TINTS = [
  'var(--cell-mid)',
  'var(--cell-light)',
  'var(--cell-dark)',
] as const

export function HexBoard({
  size = 30,
  pieces = {},
  scanlines = true,
  legend = true,
}: HexBoardProps) {
  const corners = useMemo(() => cellCorners(size), [size])
  const bounds = useMemo(() => boardBounds(size), [size])
  const cells = useMemo(() => allCells(), [])

  return (
    <div className={`hxc-wrapper${scanlines ? ' hxc-wrapper--scanlines' : ''}`}>
      <svg
        className="hxc-svg"
        viewBox={viewBox(size)}
        role="img"
        aria-label={`Hexagonal chess board, ${cells.length} cells, ${Object.keys(pieces).length} pieces placed`}
      >
        <g transform={`translate(${bounds.origin.x} ${bounds.origin.y})`}>
          {cells.map((cell) => {
            const center = cellCenter(cell, size)
            const tint = (((cell.q - cell.r) % 3) + 3) % 3
            const { file, rank } = cellToFileRank(cell)
            return (
              <polygon
                key={`${cell.q},${cell.r}`}
                data-testid={`cell-${file}${rank}`}
                points={cellPoints(center.x, -center.y, corners)}
                fill={CELL_TINTS[tint]}
                stroke="var(--cell-border)"
                strokeWidth={Math.max(1, size * 0.06)}
              />
            )
          })}
          {Object.entries(pieces).map(([notation, piece]) => (
            <PlacedPiece
              key={notation}
              notation={notation}
              kind={piece.kind}
              color={piece.color}
              size={size}
            />
          ))}
        </g>
      </svg>
      {legend ? <PieceLegend /> : null}
    </div>
  )
}

function PlacedPiece({
  notation,
  kind,
  color,
  size,
}: {
  notation: string
  kind: PieceKind
  color: PieceColor
  size: number
}) {
  const cell = fileRankToCell(notation.slice(0, 1), Number(notation.slice(1)))
  const center = cellCenter(cell, size)
  const width = size * 1.25
  const height = (width * 10) / 8
  // Sit the glyph on the lower half of the cell (SVG y points down).
  const bottom = -center.y + (Math.sqrt(3) / 2) * size * 0.92
  return (
    <svg
      x={center.x - width / 2}
      y={bottom - height}
      width={width}
      height={height}
      viewBox="0 0 8 10"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`${color} ${kind} on ${notation}`}
      style={{
        // One-px rim so dark glyphs read on dark cells and light on light.
        filter:
          color === 'black'
            ? 'drop-shadow(0 0 1px var(--piece-black-accent))'
            : 'drop-shadow(0 0 1px var(--cell-border))',
      }}
    >
      <GlyphRects kind={kind} color={color} />
    </svg>
  )
}

export default HexBoard