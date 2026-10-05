import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { isValidCell } from '../board/axial'
import { axialToNotation, notationToAxial } from '../board/notation'
import {
  allCells,
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
  selectedCell?: string | undefined
  /** Cells (notation) to mark as legal destinations. */
  validTargets?: string[]
  /** Origin and destination of the last move, outlined in amber. */
  lastMove?: [string, string] | undefined
  /** Cell of the king in check, outlined in alert red. */
  inCheckCell?: string | undefined
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

/* Arrow keys walk the axial grid: files step with q, ranks step with r
   (screen-up = r+1 for every file, since cells project flat-top). */
const ARROW_STEPS: Record<string, { q: number; r: number }> = {
  ArrowLeft: { q: -1, r: 0 },
  ArrowRight: { q: 1, r: 0 },
  ArrowUp: { q: 0, r: 1 },
  ArrowDown: { q: 0, r: -1 },
}

/** The neighbor of `notation` one step along an arrow key, or null at the rim. */
function arrowNeighbor(notation: string, key: string): string | null {
  const dir = ARROW_STEPS[key]
  const cell = notationToAxial(notation)
  if (!dir || !cell) return null
  const next = { q: cell.q + dir.q, r: cell.r + dir.r }
  return isValidCell(next) ? axialToNotation(next) : null
}

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
  const lastMoveSet = useMemo(() => new Set(lastMove ?? []), [lastMove])
  const targetSet = useMemo(() => new Set(validTargets), [validTargets])

  // Roving focus: one cell is tabbable; arrows move it, Enter/Space act (T17).
  const rootRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState('f6')
  const interactive = Boolean(onCellClick)

  useEffect(() => {
    if (!interactive) return
    rootRef.current
      ?.querySelector<SVGElement>(`[data-testid="cell-${focused}"]`)
      ?.focus?.()
  }, [focused, interactive])

  const onCellKey = (notation: string, event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onCellClick?.(notation)
      return
    }
    const next = arrowNeighbor(notation, event.key)
    if (next) {
      event.preventDefault()
      setFocused(next)
    }
  }

  return (
    <div
      ref={rootRef}
      className={`hxc-wrapper${scanlines ? ' hxc-wrapper--scanlines' : ''}`}
    >
      <svg
        className="hxc-svg"
        viewBox={viewBox(size)}
        role="img"
        aria-label={`Hexagonal chess board, ${NOTATIONS.size} cells, ${Object.keys(pieces).length} pieces placed`}
      >
        <g>
          {[...NOTATIONS.values()].map(({ cell, notation }) => {
            const center = cellCenter(cell, size)
            const tint = ((((cell.q - cell.r) % 3) + 3) % 3) as 0 | 1 | 2
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
                interactive={interactive}
                tabIndex={notation === focused ? 0 : -1}
                onSelect={onCellClick}
                onKeyDown={onCellKey}
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
  tabIndex,
  onSelect,
  onKeyDown,
}: {
  notation: string
  testId: string
  points: string
  fill: string
  className: string
  strokeWidth: number
  interactive: boolean
  tabIndex: number
  onSelect?: ((notation: string) => void) | undefined
  onKeyDown?: ((notation: string, event: KeyboardEvent) => void) | undefined
}) {
  const select = () => onSelect?.(notation)
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
      tabIndex={interactive ? tabIndex : undefined}
      cursor={interactive ? 'pointer' : undefined}
      onClick={interactive ? select : undefined}
      onKeyDown={
        interactive ? (event) => onKeyDown?.(notation, event) : undefined
      }
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
