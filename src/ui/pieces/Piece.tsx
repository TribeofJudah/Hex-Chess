import type { PieceColor, PieceKind } from '../hexMath'

/**
 * Pixel-art piece glyphs, one 8-wide bitmap per kind, rendered as SVG
 * rects. Shared by both colors; a pixel is '#' (main fill) or '='
 * (accent detail: eye, slit, crown jewels).
 */

const GLYPHS: Record<PieceKind, string[]> = {
  pawn: [
    '...##...',
    '..####..',
    '..####..',
    '...##...',
    '...##...',
    '..####..',
    '.######.',
    '########',
    '########',
    '########',
  ],
  rook: [
    '##.##.##',
    '##.##.##',
    '.######.',
    '..####..',
    '..####..',
    '..####..',
    '..=#==#.',
    '.######.',
    '.######.',
    '########',
  ],
  bishop: [
    '...##...',
    '..####..',
    '.##==##.',
    '.##==##.',
    '..####..',
    '...##...',
    '..####..',
    '.######.',
    '.######.',
    '########',
  ],
  knight: [
    '....##..',
    '...####.',
    '..##.##.',
    '..#=#...',
    '.#####..',
    '.#####..',
    '..####..',
    '.######.',
    '.######.',
    '########',
  ],
  queen: [
    '#..##..#',
    '.#=#=#=.',
    '.######.',
    '.#====#.',
    '..####..',
    '...##...',
    '..####..',
    '.######.',
    '.######.',
    '########',
  ],
  king: [
    '...##...',
    '...==...',
    '.######.',
    '...##...',
    '..####..',
    '...##...',
    '..####..',
    '.######.',
    '.######.',
    '########',
  ],
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

/** The bitmap as SVG rects, for embedding in any 8x10-viewBox svg. */
export function GlyphRects({
  kind,
  color,
}: {
  kind: PieceKind
  color: PieceColor
}) {
  const main = `var(--piece-${color})`
  const accent = `var(--piece-${color}-accent)`
  return (
    <>
      {GLYPHS[kind].flatMap((row, y) =>
        [...row].map((pixel, x) =>
          pixel === '#' || pixel === '=' ? (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={pixel === '#' ? main : accent}
            />
          ) : null,
        ),
      )}
    </>
  )
}

export interface PieceProps {
  kind: PieceKind
  color: PieceColor
  /** Rendered width in px; height follows the 8x10 bitmap ratio. */
  width?: number
  className?: string
}

/** One pixel-art piece as a standalone SVG (also used in the legend). */
export function Piece({ kind, color, width = 24, className }: PieceProps) {
  return (
    <svg
      viewBox="0 0 8 10"
      width={width}
      height={(width * 10) / 8}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`${color} ${kind}`}
    >
      <GlyphRects kind={kind} color={color} />
    </svg>
  )
}

/** All twelve glyphs in a strip, for preview and test. */
export function PieceLegend({ width = 24 }: { width?: number }) {
  return (
    <div className="hxc-legend" data-testid="piece-legend">
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
  )
}
