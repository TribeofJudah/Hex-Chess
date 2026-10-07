import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { axialDistance, isValidCell } from '../board/axial'
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
import { flipDelta, prefersReducedMotion, staggerDelay } from './motion'
import { PIECE_BOX, PieceLegend, PieceShape } from './pieces/Piece'
import { PromotionBanner } from './PromotionBanner'
import type { PendingPromotion } from './useGame'
import './theme.css'

/** Pieces keyed by Gliński notation, e.g. { f1: { kind: 'king', color: 'white' } }. */
export type BoardPieces = Record<string, { kind: PieceKind; color: PieceColor }>

export interface HexBoardProps {
  /** Cell circumradius in SVG user units. */
  size?: number
  pieces?: BoardPieces
  /**
   * @deprecated The CRT overlay was removed in R15 (t64); this prop is
   * ignored. RemoteRoom.tsx still passes it — delete both together.
   */
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
  /** Parked last-rank pawn move; renders the kind-chooser banner (t45). */
  promotion?: PendingPromotion | null
  /** Completes the parked promotion with the chosen kind (t45). */
  onPromotionChoose?: (kind: PieceKind) => void
}

/* Every glyph draws inside y 1.9..23 of the 22x24 piece box (see
   pieces/Piece.tsx), so the box is taller than the piece the eye reads. These
   are that ink span, and the share of the cell's √3·size height it should
   cover. */
const INK_TOP = 1.9
const INK_BOTTOM = 23
const INK_HEIGHT_RATIO = 0.72

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

/**
 * What the board should play for one piece, this render (R16 / t66).
 *
 * The board keeps no piece identity across renders: a piece *is* the square it
 * stands on, and what animates is the transition that put it there. `slide`
 * and `promote` both travel from `from`; a piece with no entry here simply
 * appears where it belongs, which is also what reduced motion gets.
 */
type PieceMotion =
  | { kind: 'slide'; from: string }
  | { kind: 'promote'; from: string; fromKind: PieceKind }

interface Ghost {
  notation: string
  kind: PieceKind
  color: PieceColor
}

interface MotionPlan {
  motion: Record<string, PieceMotion>
  /** Pieces that left the board: captures, including en passant. */
  ghosts: Ghost[]
}

/** Nothing moving: the first render, and every turn that only changes highlight. */
const NO_MOTION: MotionPlan = { motion: {}, ghosts: [] }

/**
 * A board's identity as a string, so "did anything actually change?" survives
 * callers that hand down a fresh object literal every render (they all do).
 * Sorted, because the record is rebuilt by spread on every move and key order
 * is not stable; a spurious change would restart an animation mid-flight.
 */
function boardKey(pieces: BoardPieces): string {
  return Object.entries(pieces)
    .map(([notation, piece]) => `${notation}:${piece.color[0]}${piece.kind}`)
    .sort()
    .join(' ')
}

/**
 * Diff the board from one render ago against this one and decide what moved.
 *
 * A pawn promotion arrives as a *different* piece from the one that set out, so
 * it gets the two-glyph treatment: the pawn slides, then the chosen kind scales
 * in over it. Nothing else in Gliński's can change a piece's kind on its own
 * square, which is what makes this a safe read.
 */
function planMotion(
  before: BoardPieces,
  after: BoardPieces,
  lastMove: [string, string] | undefined,
): MotionPlan {
  const from = lastMove?.[0]
  const to = lastMove?.[1]
  if (!from || !to) return NO_MOTION
  const mover = after[to]
  const wasFrom = before[from]
  /* A forward move is the only board change these props can describe: the mover
     stands on `to`, and `from` — which held a piece a moment ago — is empty
     behind it. Undo and move-list browsing put the board back the other way
     round (a stale `lastMove`, or the restored piece standing on `after[from]`
     again), so those snap instead of replaying.
     ponytail: undo of a move whose destination square happens to be an older
     move's origin still reads as forward and jiggles for `--motion-base`. The
     props cannot tell the two apart; passing the turn, or an undo flag, would. */
  if (!mover || !wasFrom || after[from]) return NO_MOTION
  const motion: Record<string, PieceMotion> = {
    [to]:
      wasFrom.color === mover.color &&
      wasFrom.kind === 'pawn' &&
      mover.kind !== 'pawn'
        ? { kind: 'promote', from, fromKind: wasFrom.kind }
        : { kind: 'slide', from },
  }
  /* Everything that no longer stands where it did left the board: the piece a
     move captured, a pawn taken en passant, or the pawn a promotion replaced. */
  const ghosts = Object.entries(before)
    .filter(([notation, piece]) => {
      if (notation === from) return false
      const now = after[notation]
      return !(now && now.kind === piece.kind && now.color === piece.color)
    })
    .map(([notation, piece]) => ({ notation, ...piece }))
  return { motion, ghosts }
}

/** Style that starts a piece back on the square it came from (the FLIP half). */
function slideStyle(from: string, size: number, to: { x: number; y: number }) {
  const cell = fileRankToCell(from.slice(0, 1), Number(from.slice(1)))
  const centre = cellCenter(cell, size)
  const delta = flipDelta({ x: centre.x, y: -centre.y }, to)
  return {
    '--slide-x': `${delta.x}px`,
    '--slide-y': `${delta.y}px`,
  }
}

export function HexBoard({
  size = 30,
  pieces = {},
  legend = true,
  onCellClick,
  selectedCell,
  validTargets = [],
  lastMove,
  inCheckCell,
  promotion = null,
  onPromotionChoose,
}: HexBoardProps) {
  const corners = useMemo(() => cellCorners(size), [size])
  const lastMoveSet = useMemo(() => new Set(lastMove ?? []), [lastMove])

  // Roving focus: one cell is tabbable; arrows move it, Enter/Space act (T17).
  const rootRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState('f6')
  const interactive = Boolean(onCellClick)

  /* Motion (R16 / t66). What animates is the *transition* — the board as it was
     one render ago against the board now — and no prop carries that. So the last
     board is held in state and the plan adjusted during render, which is React's
     own recipe for state derived from a prop (it re-runs the component on the
     spot, before paint, instead of painting the piece at its destination and
     jumping it back). Keying it to the board reference also keeps a plan stable
     across the re-renders a running animation has to survive. */
  const [seen, setSeen] = useState<{
    key: string
    board: BoardPieces | null
    plan: MotionPlan
  }>({ key: '', board: null, plan: NO_MOTION })
  const key = boardKey(pieces)
  if (seen.key !== key) {
    setSeen({
      key,
      board: pieces,
      plan:
        seen.board && !prefersReducedMotion()
          ? planMotion(seen.board, pieces, lastMove)
          : NO_MOTION,
    })
  }
  const { motion, ghosts } = seen.plan

  // Legal-target fan: each dot waits in proportion to how far it is from the
  // selected piece, so the whole set lands inside TARGET_STAGGER ms.
  const targets = useMemo(() => {
    const source = selectedCell ? notationToAxial(selectedCell) : null
    const distances = validTargets.map((notation) => {
      const cell = notationToAxial(notation)
      return source && cell ? axialDistance(source, cell) : 0
    })
    const furthest = Math.max(0, ...distances)
    return validTargets.map((notation, index) => ({
      notation,
      delay: staggerDelay(distances[index] ?? 0, furthest),
    }))
  }, [validTargets, selectedCell])

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
      className="hxc-wrapper"
      // The selected ring draws itself by offsetting its own dashed outline;
      // the hexagon's perimeter is the dash length it animates to zero.
      style={{ '--hex-perimeter': `${6 * size}px` } as CSSProperties}
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
                interactive={interactive}
                tabIndex={notation === focused ? 0 : -1}
                onSelect={onCellClick}
                onKeyDown={onCellKey}
              />
            )
          })}
          {/* Last-move tints ride over the cells, so the three-colour shading
              underneath survives and the tint can simply fade in (t66). */}
          {[...lastMoveSet].map((notation) => {
            const cell = fileRankToCell(
              notation.slice(0, 1),
              Number(notation.slice(1)),
            )
            const center = cellCenter(cell, size)
            return (
              <polygon
                key={`tint-${notation}`}
                className="hxc-cell-tint"
                points={cellPoints(center.x, -center.y, corners)}
                fill="var(--orange)"
                aria-hidden="true"
              />
            )
          })}
          {targets.map(({ notation, delay }) => (
            <TargetMarker
              key={notation}
              notation={notation}
              size={size}
              delay={delay}
            />
          ))}
          {/* Captured pieces go under the arriving one, so paint order puts the
              ghost beneath the piece that takes its square. */}
          {ghosts.map((ghost) => (
            <PlacedPiece
              key={`ghost-${ghost.notation}`}
              notation={ghost.notation}
              kind={ghost.kind}
              color={ghost.color}
              size={size}
              ghost
            />
          ))}
          {Object.entries(pieces).map(([notation, piece]) => (
            <PlacedPiece
              key={notation}
              notation={notation}
              kind={piece.kind}
              color={piece.color}
              size={size}
              motion={motion[notation]}
            />
          ))}
        </g>
      </svg>
      {promotion ? (
        <PromotionBanner
          from={promotion.from}
          to={promotion.to}
          options={promotion.options}
          onChoose={(kind) => onPromotionChoose?.(kind)}
        />
      ) : null}
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

function TargetMarker({
  notation,
  size,
  delay,
}: {
  notation: string
  size: number
  delay: number
}) {
  const cell = fileRankToCell(notation.slice(0, 1), Number(notation.slice(1)))
  const center = cellCenter(cell, size)
  return (
    <circle
      data-testid={`target-${notation}`}
      cx={center.x}
      cy={-center.y}
      r={size * 0.3}
      fill="var(--target-dot)"
      pointerEvents="none"
      className="hxc-target"
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    />
  )
}

function PlacedPiece({
  notation,
  kind,
  color,
  size,
  motion,
  ghost = false,
}: {
  notation: string
  kind: PieceKind
  color: PieceColor
  size: number
  motion?: PieceMotion | undefined
  ghost?: boolean
}) {
  const cell = fileRankToCell(notation.slice(0, 1), Number(notation.slice(1)))
  const center = cellCenter(cell, size)
  // Size the box so the *drawn* silhouette (y 1.9..23 of the box, not the box
  // itself) lands at INK_HEIGHT_RATIO of the cell's √3·size height, then centre
  // that silhouette — not the box — on the cell (t64 defect 3).
  const cellHeight = Math.sqrt(3) * size
  const scale = (cellHeight * INK_HEIGHT_RATIO) / (INK_BOTTOM - INK_TOP)
  const height = scale * PIECE_BOX.h
  const width = scale * PIECE_BOX.w
  const inkMid = ((INK_TOP + INK_BOTTOM) / 2) * scale
  const drawn = { x: center.x, y: -center.y }
  // A piece that moved is wrapped so the slide and the capture shrink turn about
  // its own centre rather than the board's.
  const moving = motion ? slideStyle(motion.from, size, drawn) : null
  return (
    <g
      className={
        ghost
          ? 'hxc-piece-ghost'
          : moving
            ? 'hxc-piece-move'
            : undefined
      }
      style={moving ? (moving as CSSProperties) : undefined}
      aria-hidden={ghost ? true : undefined}
      /* The cell polygon stays the hit target; theme.css says the same, and the
         attribute is what a test can see (jsdom does not hit-test) — t66. */
      pointerEvents="none"
    >
      <svg
        className="hxc-piece-box"
        x={center.x - width / 2}
        y={-center.y - inkMid}
        width={width}
        height={height}
        viewBox={`0 0 ${PIECE_BOX.w} ${PIECE_BOX.h}`}
        role="img"
        aria-label={`${color} ${kind} on ${notation}`}
      >
        {motion?.kind === 'promote' ? (
          <>
            {/* The pawn that travelled, then the piece it became. */}
            <g className="hxc-glyph--out">
              <PieceShape kind={motion.fromKind} color={color} />
            </g>
            <g className="hxc-glyph--in">
              <PieceShape kind={kind} color={color} />
            </g>
          </>
        ) : (
          <PieceShape kind={kind} color={color} />
        )}
      </svg>
    </g>
  )
}

export default HexBoard
