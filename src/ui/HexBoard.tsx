import { useMemo, type KeyboardEvent } from 'react'
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
  /** Click/tap + keyboard-activation handler for a cell. */
  onCellClick?: (notation: string) => void
  /** Currently selected cell, highlighted with an accent ring. */
  selectedCell?: string
  /** Cells (notation) to mark as legal destinations. */
  validTargets?: string[]
  /** Origin and destination of the last move, outlined in amber. */
  lastMove?: [string, string]
  /** Cell of the king in check, outlined in alert red. */
  inCheckCell?: string
}

/* Proper 3-colouring: every edge-neighbor shifts (q - r) by ±1. Index 0 is
   the central cell, which Gliński's board shades mid-tone. */
const CELL_TINTS = [
  'var(--cell-mid)',
  'var(--cell-light)',
  'var(--cell-dark)',
] as const

const NOTATIONS = new Map(
  allCells().map((cell) => {
    const { file, rank } = cellToFileRank(cell)
    return [`${cell.q},${cell.r}`, { cell, notation: `${file}${rank}` }]
  }),
)

export function HexBoard({
  size = 30,
  pieces = {},
  scanlines = true,
  legend = true,
  onCellClick,
  selectedCell,
  validTargets = [],
  lastMove,
  inCheckCell,
}: HexBoardProps) {
  const corners = useMemo(() => cellCorners(size), [size])
  const bounds = useMemo(() => boardBounds(size), [size])
  const lastMoveSet = useMemo(() => new Set(lastMove ?? []), [lastMove])
  const targetSet = useMemo(() => new Set(validTargets), [validTargets])

  return (
    <div className={`hxc-wrapper${scanlines ? ' hxc-wrapper--scanlines' : ''}`}>
      <svg
        className="hxc-svg"
        viewBox={viewBox(size)}
        role="img"
        aria-label={`Hexagonal chess board, ${NOTATIONS.size} cells, ${Object.keys(pieces).length} pieces placed`}
      >
        <g transform={`translate(${bounds.origin.x} ${bounds.origin.y})`}>
          {[...NOTATIONS.values()].map(({ cell, notation }) => {
            const center = cellCenter(cell, size)
            const tint = (((cell.q - cell.r) % 3) + 3) % 3
            const classes = ['hxc-cell']
            if (notation === selectedCell) classes.push('hxc-cell--selected')
            if (lastMoveSet.has(notation)) classes.push('hxc-cell--last')
            if (notation === inCheckCell) classes.push('hxc-cell--check')
            return (
              <CellPolygon
                key={notation}
                notation={notation}
                testId={`cell-${notation}`}
                points={cellPoints(center.x, -center.y, corners)}
                fill={CELL_TINTS[tint]}
                className={classes.join(' ')}
                strokeWidth={Math.max(1, size * 0.06)}
                interactive={Boolean(onCellClick)}
                onSelect={onCellClick}
              />
            )
          })}
          {[...targetSet].map((notation) => (
            <TargetMarker key={notation} notation={notation} size={size} />
          ))}
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

function CellPolygon({
  notation,
  testId,
  points,
  fill,
  className,
  strokeWidth,
  interactive,
  onSelect,
}: {
  notation: string
  testId: string
  points: string
  fill: string
  className: string
  strokeWidth: number
  interactive: boolean
  onSelect?: (notation: string) => void
}) {
  const select = () => onSelect?.(notation)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select()
    }
  }
  return (
    <polygon
      data-testid={testId}
      points={points}
      fill={fill}
      stroke="var(--cell-border)"
      strokeWidth={strokeWidth}
      className={className}
      // SVG shapes aren't buttons; role+label make keyboard focus meaningful.
      role={interactive ? 'button' : undefined}
      aria-label={interactive ? `cell ${notation}` : undefined}
      tabIndex={interactive ? 0 : undefined}
      cursor={interactive ? 'pointer' : undefined}
      onClick={interactive ? select : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
    />
  )
}

function TargetMarker({ notation, size }: { notation: string; size: number }) {
  const cell = fileRankToCell(notation.slice(0, 1), Number(notation.slice(1)))
  const center = cellCenter(cell, size)
  return (
    <circle
      data-testid={`target-${notation}`}
      cx={center.x}
      cy={-center.y}
      r={size * 0.3}
      fill="var(--cell-hover)"
      opacity={0.55}
      pointerEvents="none"
    />
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
