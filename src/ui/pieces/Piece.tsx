import type { PieceColor, PieceKind } from '../hexMath'

/**
 * Poster piece set (R14 / t60) — geometric silhouettes in place of the T7
 * pixel bitmaps.
 *
 * Every piece shares one plinth, so the twelve read as a family at board
 * size and the head alone tells them apart. Each glyph is two paths: the
 * body (stem + head) in the piece fill, the plinth in the accent — the
 * "rim at the base" of the art direction. Colours come from CSS tokens
 * (`src/ui/theme.css`), so the same markup prints as a risograph in light
 * mode and as an outline-only wireframe in dark.
 *
 * Paths are authored in a 22 x 24 box with the plinth sitting on y = 23.
 */

export const PIECE_BOX = { w: 22, h: 24 } as const

/** Plinth + collar. Identical on every piece; filled in the accent ink. */
const PLINTH =
  'M 2.4 23 L 19.6 23 L 17.2 19.2 L 4.8 19.2 Z' +
  ' M 5.8 19.2 L 16.2 19.2 L 15 16.8 L 7 16.8 Z'

/** Stem + head, one silhouette per kind. */
const BODIES: Record<PieceKind, string> = {
  pawn:
    'M 9.4 16.8 L 12.6 16.8 L 11.7 11.6 L 10.3 11.6 Z' +
    ' M 7.6 8.8 A 3.4 3.4 0 0 1 14.4 8.8 A 3.4 3.4 0 0 1 7.6 8.8 Z',
  rook:
    'M 7.6 16.8 L 14.4 16.8 L 12.8 10.4 L 9.2 10.4 Z' +
    ' M 6.2 10.4 L 15.8 10.4 L 15.8 4.4 L 13.3 4.4 L 13.3 6.6 L 11.7 6.6' +
    ' L 11.7 4.4 L 10.3 4.4 L 10.3 6.6 L 8.7 6.6 L 8.7 4.4 L 6.2 4.4 Z',
  bishop:
    'M 8.4 16.8 L 13.6 16.8 L 12.3 11.8 L 9.7 11.8 Z' +
    ' M 9.7 12.2 C 7.2 10.4 7.6 6.2 11 2.6 C 14.4 6.2 14.8 10.4 12.3 12.2 Z' +
    ' M 10 1.9 A 1 1 0 0 1 12 1.9 A 1 1 0 0 1 10 1.9 Z',
  knight:
    'M 8.6 16.8 L 13.6 16.8 L 12.8 11.2 L 12.2 9.4 L 13.4 6.2 L 14.6 9.8' +
    ' L 10.4 10.3 L 6.4 9.2 L 7.6 11.9 L 10.4 13.8 Z',
  queen:
    'M 8.4 16.8 L 13.6 16.8 L 12.4 11.4 L 9.6 11.4 Z' +
    ' M 6.4 11.4 L 5 3.8 L 8 7.6 L 9.4 2.6 L 11 6.8 L 12.6 2.6 L 14 7.6' +
    ' L 17 3.8 L 15.6 11.4 Z',
  king:
    'M 8.4 16.8 L 13.6 16.8 L 12.4 11.6 L 9.6 11.6 Z' +
    ' M 6.6 11.6 L 6.6 8.4 L 15.4 8.4 L 15.4 11.6 Z' +
    ' M 10 8.4 L 12 8.4 L 12 5.7 L 14.2 5.7 L 14.2 3.7 L 12 3.7 L 12 2' +
    ' L 10 2 L 10 3.7 L 7.8 3.7 L 7.8 5.7 L 10 5.7 Z',
}

export const PIECE_KINDS: PieceKind[] = [
  'king',
  'queen',
  'rook',
  'bishop',
  'knight',
  'pawn',
]
export const PIECE_COLORS: PieceColor[] = ['white', 'black']

/** The piece as SVG paths, for embedding in any 22x24-viewBox svg. */
export function PieceShape({
  kind,
  color,
}: {
  kind: PieceKind
  color: PieceColor
}) {
  const ink = `var(--piece-${color})`
  const accent = `var(--piece-${color}-accent)`
  return (
    <g className={`hxc-piece hxc-piece--${color}`} fill={ink} stroke={accent}>
      <path d={BODIES[kind]} />
      <path d={PLINTH} fill={accent} />
    </g>
  )
}

export interface PieceProps {
  kind: PieceKind
  color: PieceColor
  /** Rendered width in px; height follows the 22x24 box ratio. */
  width?: number
  className?: string
}

/** One piece as a standalone SVG (also used in the legend). */
export function Piece({ kind, color, width = 24, className }: PieceProps) {
  return (
    <svg
      viewBox={`0 0 ${PIECE_BOX.w} ${PIECE_BOX.h}`}
      width={width}
      height={(width * PIECE_BOX.h) / PIECE_BOX.w}
      className={className}
      role="img"
      aria-label={`${color} ${kind}`}
    >
      <PieceShape kind={kind} color={color} />
    </svg>
  )
}

/** All twelve glyphs in a strip, under a caption, for preview and test. */
export function PieceLegend({ width = 24 }: { width?: number }) {
  return (
    <div className="hxc-legend" data-testid="piece-legend">
      {/* The caption is what keeps the strip reading as a key rather than as a
          row of captured pieces (B6). `aria-hidden` so the twelve glyphs stay
          the only images in the legend. */}
      <span className="hxc-legend__label" aria-hidden="true">
        Pieces
      </span>
      <div className="hxc-legend__strip">
        {PIECE_COLORS.map((color) =>
          PIECE_KINDS.map((kind) => (
            <Piece
              key={`${color}-${kind}`}
              kind={kind}
              color={color}
              width={width}
            />
          )),
        )}
      </div>
    </div>
  )
}
