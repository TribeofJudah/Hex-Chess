import { fireEvent, render, screen } from '@testing-library/react'
// The app tsconfig carries vite/client types only, so the one node builtin a
// test needs has to be opted in here rather than project-wide. (t66)
// @ts-expect-error - node:fs is untyped under tsconfig.app.json
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axialDistance } from '../board/axial'
import { notationToAxial } from '../board/notation'
import { HexBoard } from './HexBoard'
import { cellCenter, fileRankToCell } from './hexMath'
import { Piece } from './pieces/Piece'

describe('HexBoard', () => {
  it('mounts the 91-cell board with per-cell a11y ids', () => {
    const { container } = render(<HexBoard />)
    expect(container.querySelectorAll('polygon')).toHaveLength(91)
    expect(screen.getByTestId('cell-f11')).toBeTruthy()
    expect(screen.getByTestId('cell-a1')).toBeTruthy()
    expect(screen.getByTestId('cell-l6')).toBeTruthy()
  })

  it('places pieces by notation and labels them', () => {
    render(
      <HexBoard
        pieces={{ f1: { kind: 'king', color: 'white' } }}
        legend={false}
      />,
    )
    expect(screen.getByLabelText('white king on f1')).toBeTruthy()
    expect(screen.queryByLabelText('piece-legend')).toBeNull()
  })

  it('shows the 12-glyph legend by default and hides it on demand', () => {
    const { rerender, container } = render(<HexBoard />)
    expect(screen.getByTestId('piece-legend')).toBeTruthy()
    expect(
      screen.getAllByRole('img', {
        name: /^(white|black) (king|queen|rook|bishop|knight|pawn)$/,
      }),
    ).toHaveLength(12)
    rerender(
      <HexBoard pieces={{ f1: { kind: 'king', color: 'white' } }} legend={false} />,
    )
    expect(container.querySelector('[data-testid="piece-legend"]')).toBeNull()
  })

  it('drops the removed CRT scanline hook (t64)', () => {
    const { container } = render(<HexBoard legend={false} />)
    expect(container.querySelector('.hxc-wrapper')?.className).toBe(
      'hxc-wrapper',
    )
  })

  it('sizes and centres the drawn piece, not the piece box (t64)', () => {
    render(
      <HexBoard
        legend={false}
        pieces={{ f1: { kind: 'king', color: 'white' } }}
      />,
    )
    const piece = screen.getByLabelText('white king on f1')
    // Ink spans y 1.9..23 of the box, so the box itself is taller than the
    // 72% of the cell height the silhouette should cover.
    const cellHeight = Math.sqrt(3) * 30
    const scale = (cellHeight * 0.72) / (23 - 1.9)
    const height = Number(piece.getAttribute('height'))
    expect(height).toBeCloseTo(scale * 24, 3)
    // …so the drawn silhouette covers 72% of the cell height.
    expect((23 - 1.9) * (height / 24)).toBeCloseTo(cellHeight * 0.72, 3)
    // Centred: the ink's own midpoint sits on the cell centre, so the plinth
    // hangs exactly as far below the centre as the head rises above it.
    const y = Number(piece.getAttribute('y'))
    const inkMid = ((1.9 + 23) / 2) * scale
    expect(y + inkMid).toBeCloseTo(-cellCenter(fileRankToCell('f', 1), 30).y, 3)
  })
})

describe('HexBoard interactivity', () => {
  it('reports cell clicks by notation', () => {
    const onCellClick = vi.fn()
    render(<HexBoard onCellClick={onCellClick} legend={false} />)
    fireEvent.click(screen.getByTestId('cell-e2'))
    expect(onCellClick).toHaveBeenCalledWith('e2')
  })

  it('activates cells with keyboard as well', () => {
    const onCellClick = vi.fn()
    render(<HexBoard onCellClick={onCellClick} legend={false} />)
    const cell = screen.getByTestId('cell-f1')
    fireEvent.keyDown(cell, { key: 'Enter' })
    fireEvent.keyDown(screen.getByTestId('cell-k5'), { key: ' ' })
    expect(onCellClick).toHaveBeenCalledWith('f1')
    expect(onCellClick).toHaveBeenCalledWith('k5')
  })

  it('is not interactive without onCellClick', () => {
    const { container } = render(<HexBoard legend={false} />)
    const interactive = container.querySelectorAll('polygon[tabindex]')
    expect(interactive).toHaveLength(0)
  })

  it('moves the roving focus with arrow keys and activates with Enter (T17)', () => {
    const onCellClick = vi.fn()
    render(<HexBoard onCellClick={onCellClick} legend={false} />)
    expect(screen.getByTestId('cell-f6').getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(screen.getByTestId('cell-f6'), { key: 'ArrowRight' })
    expect(screen.getByTestId('cell-g6').getAttribute('tabindex')).toBe('0')
    expect(screen.getByTestId('cell-f6').getAttribute('tabindex')).toBe('-1')
    fireEvent.keyDown(screen.getByTestId('cell-g6'), { key: 'ArrowUp' })
    expect(screen.getByTestId('cell-g7').getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(screen.getByTestId('cell-g7'), { key: 'Enter' })
    expect(onCellClick).toHaveBeenCalledWith('g7')
  })

  it('highlights selection, targets, last move, and check', () => {
    render(
      <HexBoard
        legend={false}
        onCellClick={() => {}}
        selectedCell="e2"
        validTargets={['e4', 'd4']}
        lastMove={['g10', 'g9']}
        inCheckCell="k7"
      />,
    )
    expect(screen.getByTestId('cell-e2').getAttribute('class')).toContain(
      'hxc-cell--selected',
    )
    expect(screen.getByTestId('target-e4')).toBeTruthy()
    expect(screen.getByTestId('target-d4')).toBeTruthy()
    expect(screen.getByTestId('cell-g10').getAttribute('class')).toContain(
      'hxc-cell--last',
    )
    expect(screen.getByTestId('cell-g9').getAttribute('class')).toContain(
      'hxc-cell--last',
    )
    expect(screen.getByTestId('cell-k7').getAttribute('class')).toContain(
      'hxc-cell--check',
    )
  })

  it('renders the promotion banner and forwards the chosen kind (t45)', () => {
    const onChoose = vi.fn()
    const { rerender } = render(<HexBoard legend={false} />)
    expect(screen.queryByTestId('promotion-banner')).toBeNull()
    rerender(
      <HexBoard
        legend={false}
        promotion={{
          from: 'e9',
          to: 'e10',
          options: ['queen', 'rook', 'bishop', 'knight'],
        }}
        onPromotionChoose={onChoose}
      />,
    )
    expect(screen.getByTestId('promotion-banner')).toBeTruthy()
    expect(screen.getByTestId('promo-queen')).toBeTruthy()
    expect(screen.getByTestId('promo-knight')).toBeTruthy()
    fireEvent.click(screen.getByTestId('promo-rook'))
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith('rook')
  })
})

/* --- Motion (R16 / t66) ----------------------------------------------------
   jsdom has no hit-testing, no layout and no CSS, so the two things a real
   browser enforces — which element a click lands on, and which declarations
   reach it — are checked here as facts about the markup and the stylesheet.
   The rest is behaviour: what HexBoard renders for a given pair of boards. */

const THEME_CSS: string = readFileSync('src/ui/theme.css', 'utf8')

/** Every `selectors { declarations }` block, comments stripped. */
const CSS_BLOCKS = [
  ...THEME_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g),
]

/** Does any rule for `selector` (alone or in a list) declare this? */
function declares(selector: string, declaration: string): boolean {
  return CSS_BLOCKS.some(
    (block) =>
      (block[1] ?? '')
        .split(',')
        .map((name) => name.trim())
        .includes(selector) &&
      (block[2] ?? '').replace(/\s+/g, '').includes(declaration),
  )
}

const ROOK = { kind: 'rook', color: 'white' } as const

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HexBoard pointer targets (t66)', () => {
  it('gives a click on a piece glyph to the cell under it', () => {
    render(
      <HexBoard legend={false} pieces={{ f5: { kind: 'pawn', color: 'white' } }} />,
    )
    const piece = screen.getByLabelText('white pawn on f5')
    const centre = cellCenter(fileRankToCell('f', 5), 30)
    // It sits squared over the cell centre, so it *would* be the hit target…
    expect(
      Number(piece.getAttribute('x')) + Number(piece.getAttribute('width')) / 2,
    ).toBeCloseTo(centre.x, 3)
    // …but the layer it draws in takes no pointer, so the cell polygon stays
    // the target (theme.css, and the attribute the browser reads either way).
    expect(piece.closest('[pointer-events="none"]')).toBe(piece.parentElement)
    expect(declares('.hxc-piece', 'pointer-events:none')).toBe(true)
    expect(declares('.hxc-piece-box', 'pointer-events:none')).toBe(true)
  })

  it('keeps the legal-target dot above 3:1 on every cell it is drawn on (t66)', () => {
    // WCAG 1.4.11 for a non-text indicator. The dot is the ink token, so this
    // holds for all three cell tints at once — including the 0.9 composite over
    // the lightest dark cell — and the check is that it stays that way.
    const luminance = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16)
      const channel = (v: number) => {
        const c = v / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      return (
        0.2126 * channel((n >> 16) & 255) +
        0.7152 * channel((n >> 8) & 255) +
        0.0722 * channel(n & 255)
      )
    }
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (hi! + 0.05) / (lo! + 0.05)
    }
    // The three dark cells: black, 8% white, 16% white.
    expect(ratio('#f4f1ea', '#000')).toBeGreaterThanOrEqual(3)
    expect(ratio('#f4f1ea', '#292929')).toBeGreaterThanOrEqual(3)
    const { container } = render(
      <HexBoard
        legend={false}
        onCellClick={() => {}}
        selectedCell="f6"
        validTargets={['f7']}
      />,
    )
    expect(container.querySelector('.hxc-target')?.getAttribute('fill')).toBe(
      'var(--target-dot)',
    )
    // Ink in light mode — the accents never reach 3:1 on every tint — and the
    // same near-white, near-opaque, in both dark blocks.
    expect(declares(':root', '--target-dot:var(--ink)')).toBe(true)
    expect(THEME_CSS.match(/--target-dot:\s*#f4f1ea/g)).toHaveLength(2)
  })
})

describe('HexBoard motion (t66)', () => {
  const slideOf = (wrapper: HTMLElement, axis: string) =>
    Number.parseFloat(wrapper.style.getPropertyValue(axis))

  it('slides the moved piece from the square it came from', () => {
    const { rerender } = render(<HexBoard legend={false} pieces={{ g10: ROOK }} />)
    rerender(
      <HexBoard legend={false} pieces={{ g9: ROOK }} lastMove={['g10', 'g9']} />,
    )
    const wrapper = screen.getByLabelText('white rook on g9').parentElement!
    expect(wrapper.getAttribute('class')).toBe('hxc-piece-move')
    const origin = cellCenter(fileRankToCell('g', 10), 30)
    const dest = cellCenter(fileRankToCell('g', 9), 30)
    // FLIP: the wrapper starts back on the source square (screen y is negated).
    expect(slideOf(wrapper, '--slide-x')).toBeCloseTo(origin.x - dest.x, 6)
    expect(slideOf(wrapper, '--slide-y')).toBeCloseTo(dest.y - origin.y, 6)
    // …and turns about its own middle, not the board's.
    expect(declares('.hxc-piece-move', 'transform-box:fill-box')).toBe(true)
  })

  it('leaves a piece that did not move alone', () => {
    const { rerender } = render(
      <HexBoard legend={false} pieces={{ g10: ROOK, f1: { kind: 'king', color: 'white' } }} />,
    )
    rerender(
      <HexBoard
        legend={false}
        pieces={{ g9: ROOK, f1: { kind: 'king', color: 'white' } }}
        lastMove={['g10', 'g9']}
      />,
    )
    expect(
      screen.getByLabelText('white king on f1').parentElement?.getAttribute('class'),
    ).toBeNull()
  })

  it('fades the captured piece out under the one arriving on its square', () => {
    const { rerender, container } = render(
      <HexBoard legend={false} pieces={{ g10: ROOK, g9: { kind: 'pawn', color: 'black' } }} />,
    )
    rerender(
      <HexBoard legend={false} pieces={{ g9: ROOK }} lastMove={['g10', 'g9']} />,
    )
    const ghost = container.querySelector('.hxc-piece-ghost')
    expect(ghost?.getAttribute('aria-hidden')).toBe('true')
    expect(ghost?.querySelector('[aria-label="black pawn on g9"]')).toBeTruthy()
    // Ghost first in document order, so paint puts the arriving piece on top.
    const pieces = container.querySelectorAll('.hxc-piece-ghost, .hxc-piece-move')
    expect(pieces[0]).toBe(ghost)
  })

  it('slides a pawn en passant and drops the pawn it took beside it', () => {
    const { rerender, container } = render(
      <HexBoard
        legend={false}
        pieces={{ e5: { kind: 'pawn', color: 'white' }, f5: { kind: 'pawn', color: 'black' } }}
      />,
    )
    rerender(
      <HexBoard
        legend={false}
        pieces={{ f6: { kind: 'pawn', color: 'white' } }}
        lastMove={['e5', 'f6']}
      />,
    )
    expect(container.querySelector('.hxc-piece-ghost [aria-label="black pawn on f5"]')).toBeTruthy()
    expect(screen.getByLabelText('white pawn on f6').parentElement?.getAttribute('class')).toBe(
      'hxc-piece-move',
    )
  })

  it('slides the pawn on a promotion, then swaps in the chosen kind', () => {
    const { rerender, container } = render(
      <HexBoard legend={false} pieces={{ e9: { kind: 'pawn', color: 'white' } }} />,
    )
    rerender(
      <HexBoard
        legend={false}
        pieces={{ e10: { kind: 'queen', color: 'white' } }}
        lastMove={['e9', 'e10']}
      />,
    )
    const wrapper = screen.getByLabelText('white queen on e10').parentElement!
    expect(wrapper.getAttribute('class')).toBe('hxc-piece-move')
    // Both glyphs ride the journey: the pawn, then the queen over it.
    const { container: lone } = render(<Piece kind="pawn" color="white" />)
    const pawnPath = lone.querySelector('path')?.getAttribute('d')
    expect(container.querySelector('.hxc-glyph--out path')?.getAttribute('d')).toBe(
      pawnPath,
    )
    expect(container.querySelector('.hxc-glyph--in path')?.getAttribute('d')).not.toBe(
      pawnPath,
    )
    // At rest — reduced motion, or before the slide finishes — the pawn is
    // gone and the chosen piece is in place.
    expect(declares('.hxc-glyph--out', 'opacity:0')).toBe(true)
    expect(declares('.hxc-glyph--in', 'opacity:1')).toBe(true)
  })

  it('snaps when the board goes backwards — undo and move-list browsing (t66)', () => {
    const { rerender, container } = render(
      <HexBoard
        legend={false}
        pieces={{ g10: ROOK, c3: { kind: 'pawn', color: 'white' } }}
        lastMove={['g9', 'g10']}
      />,
    )
    // Undo the pawn move: the board goes back and `lastMove` becomes the older
    // move, whose `from` is empty in both frames — so nothing travelled and the
    // pawn that left is not a capture.
    rerender(
      <HexBoard legend={false} pieces={{ g10: ROOK }} lastMove={['g9', 'g10']} />,
    )
    expect(container.querySelector('.hxc-piece-move')).toBeNull()
    expect(container.querySelector('.hxc-piece-ghost')).toBeNull()
    // …and the same for a first-move undo, where the pair is dropped outright.
    rerender(<HexBoard legend={false} pieces={{ g9: ROOK }} />)
    expect(container.querySelector('.hxc-piece-move')).toBeNull()
    expect(container.querySelector('.hxc-piece-ghost')).toBeNull()
  })

  it('snaps when a whole position lands at once — PGN load, remote resync (t66)', () => {
    // `loadMoves` and the remote `rebuild` both hand down a finished position
    // with `lastMove` on the final ply. The final move's own pair looks
    // legitimate against the *old* board — a piece left `from`, `to` is
    // occupied — so without a size check this reads as one slide plus a ghost
    // for every square the intervening moves emptied.
    const START = {
      f1: { kind: 'king', color: 'white' },
      g1: { kind: 'queen', color: 'white' },
      f2: { kind: 'pawn', color: 'white' },
      e7: { kind: 'pawn', color: 'black' },
      g10: { kind: 'rook', color: 'black' },
    } as const
    const LATE = {
      f1: { kind: 'king', color: 'white' },
      k5: { kind: 'queen', color: 'white' },
      f4: { kind: 'pawn', color: 'white' },
      e3: { kind: 'pawn', color: 'black' },
      a4: { kind: 'rook', color: 'black' },
    } as const
    const { rerender, container } = render(
      <HexBoard legend={false} pieces={START} />,
    )
    rerender(
      <HexBoard legend={false} pieces={LATE} lastMove={['e7', 'e3']} />,
    )
    expect(container.querySelector('.hxc-piece-move')).toBeNull()
    expect(container.querySelector('.hxc-piece-ghost')).toBeNull()
  })

  it('snaps a two-move jump that happens to end on a legal-looking pair', () => {
    // Two moves between renders, so the board is one move older than `lastMove`
    // says. `e7`-`e5` is a genuine pair on its own — the white rook simply moved
    // first, and under the old diff both it and the black pawn left ghosts.
    const { rerender, container } = render(
      <HexBoard
        legend={false}
        pieces={{
          g10: ROOK,
          e7: { kind: 'pawn', color: 'black' },
        }}
      />,
    )
    rerender(
      <HexBoard
        legend={false}
        pieces={{
          g9: ROOK,
          e5: { kind: 'pawn', color: 'black' },
        }}
        lastMove={['e7', 'e5']}
      />,
    )
    expect(container.querySelector('.hxc-piece-move')).toBeNull()
    expect(container.querySelector('.hxc-piece-ghost')).toBeNull()
  })

  it('animates nothing when the reader asked for less motion', () => {
    stubReducedMotion(true)
    const { rerender, container } = render(
      <HexBoard legend={false} pieces={{ g10: ROOK, g9: { kind: 'pawn', color: 'black' } }} />,
    )
    rerender(<HexBoard legend={false} pieces={{ g9: ROOK }} lastMove={['g10', 'g9']} />)
    expect(container.querySelector('.hxc-piece-move')).toBeNull()
    expect(container.querySelector('.hxc-piece-ghost')).toBeNull()
    // The final state is already on the board.
    expect(screen.getByLabelText('white rook on g9')).toBeTruthy()
  })

  it('stages the legal-target fan by distance, inside the 120ms budget', () => {
    const { container } = render(
      <HexBoard
        legend={false}
        onCellClick={() => {}}
        selectedCell="f6"
        validTargets={['f7', 'g7', 'h8']}
      />,
    )
    const delayOf = (notation: string) =>
      Number.parseInt(
        screen.getByTestId(`target-${notation}`).style.animationDelay || '0',
        10,
      )
    const distanceOf = (notation: string) =>
      axialDistance(notationToAxial('f6')!, notationToAxial(notation)!)
    const near = delayOf('f7')
    const mid = delayOf('g7')
    const far = delayOf('h8')
    // Ordered by how far each one is from the selected piece…
    expect(distanceOf('f7')).toBeLessThan(distanceOf('h8'))
    expect(near).toBeLessThan(mid)
    expect(mid).toBeLessThan(far)
    // …and the whole fan still lands inside one --motion-fast.
    expect(far).toBe(120)
    // The ring animates its dash the length of the cell's own perimeter.
    expect(
      container.querySelector('.hxc-wrapper')?.getAttribute('style'),
    ).toContain('--hex-perimeter: 180px')
  })
})

/* The lobby markup ships from t67 with bare class names; this is where they get
   their poster clothes. Checked here because this file is the one that scans
   theme.css — a rule that goes missing is invisible to every other test. */
describe('theme.css lobby (t66b)', () => {
  it('dresses every lobby class, in the board-frame language', () => {
    for (const selector of [
      '.hxc-lobby',
      '.hxc-lobby__notice',
      '.hxc-lobby__row',
      '.hxc-lobby__label',
      '.hxc-lobby__share',
    ]) {
      expect(declares(selector, 'font-family') || declares(selector, 'display'), selector).toBe(
        true,
      )
    }
    // The card: hairline rule, offset shadow — the board frame's own tokens.
    expect(declares('.hxc-lobby', 'border:1.5pxsolidvar(--ink)')).toBe(true)
    expect(declares('.hxc-lobby', 'box-shadow:var(--shadow)')).toBe(true)
    expect(declares('.hxc-lobby__notice', 'color:var(--ink-dim)')).toBe(true)
    // The room code is the one thing on the page a player reads out loud.
    expect(declares('.hxc-room__code', 'font-family:var(--font-mono)')).toBe(true)
    expect(declares('.hxc-room__code', 'font-weight:700')).toBe(true)
    expect(declares('.hxc-room__code', 'letter-spacing:var(--track-label)')).toBe(true)
  })
})

/* --- Board polish (R17 / t79) ----------------------------------------------
   The board is the page's hero and its only interactive surface: it carries
   coordinate gutters, a captioned legend, focus that shows a hexagon instead
   of a box, and state strokes that clear the 3:1 a non-text indicator owes.
   js-dom does no layout and no colour, so the geometry is checked against
   `cellCenter` and the contrast against the WCAG formula directly. */

const INDEX_CSS: string = readFileSync('src/index.css', 'utf8')

/** WCAG 2.x relative luminance of an opaque `#rrggbb`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (hi + 0.05) / (lo + 0.05)
}

describe('HexBoard board polish (t79)', () => {
  it('rules the board with a coordinate gutter, hidden from the a11y tree', () => {
    const { container } = render(<HexBoard legend={false} />)
    const coords = container.querySelector('.hxc-coords')
    expect(coords?.getAttribute('aria-hidden')).toBe('true')
    // Eleven files — 'j' is not a file in Gliński's — and eleven ranks.
    expect(
      [...(coords?.querySelectorAll('text') ?? [])].map((t) => t.textContent),
    ).toEqual([
      ...'abcdefghikl',
      ...Array.from({ length: 11 }, (_, i) => `${i + 1}`),
    ])
  })

  it('anchors each coordinate to its own file and rank', () => {
    const { container } = render(<HexBoard size={24} legend={false} />)
    const at = (text: string) =>
      [...container.querySelectorAll('.hxc-coords text')].find(
        (node) => node.textContent === text,
      )
    const attr = (text: string, name: string) => at(text)?.getAttribute(name)
    const centre = (notation: string) =>
      cellCenter(
        fileRankToCell(notation.slice(0, 1), Number(notation.slice(1))),
        24,
      )
    // Letters sit on the file's own bottom cell, left edge to right.
    expect(attr('a', 'x')).toBe(String(centre('a1').x))
    expect(attr('f', 'x')).toBe(String(centre('f1').x))
    expect(attr('l', 'x')).toBe(String(centre('l1').x))
    // Numbers sit on the rank's own leftmost cell, outboard of the board.
    expect(attr('1', 'y')).toBe(String(-centre('a1').y))
    expect(attr('6', 'y')).toBe(String(-centre('a6').y))
    expect(attr('11', 'y')).toBe(String(-centre('f11').y))
    expect(Number(attr('11', 'x'))).toBeLessThan(-8.5 * 24)
  })

  it('captions the legend and keeps its twelve glyphs the only images (B6)', () => {
    render(<HexBoard />)
    const caption = screen
      .getByTestId('piece-legend')
      .querySelector('.hxc-legend__label')
    expect(caption?.textContent).toBe('Pieces')
    // Decoration, not content: the caption stays out of the a11y tree.
    expect(caption?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getAllByRole('img', { name: /^(white|black) / })).toHaveLength(
      12,
    )
  })

  it('draws the hex focus ring for :focus-visible only, never a box (B5)', () => {
    // The UA outline rings the polygon's bounding *box* — the faint square that
    // shows over a cell after a click — and it shows for `:focus`, which a
    // mouse click also sets. Suppressed on the plain state; the hexagon rides
    // the `:focus-visible` stroke, so Tab still shows it.
    expect(declares('.hxc-cell[tabindex]', 'outline:none')).toBe(true)
    expect(declares('.hxc-cell[tabindex]', 'stroke:var(--cobalt)')).toBe(false)
    expect(declares('.hxc-cell[tabindex]', 'stroke-dasharray')).toBe(false)
    expect(declares('.hxc-cell[tabindex]:focus-visible', 'outline:none')).toBe(
      true,
    )
    expect(
      declares('.hxc-cell[tabindex]:focus-visible', 'stroke:var(--cobalt)'),
    ).toBe(true)
  })

  it('keeps every board state stroke at 3:1 on every cell it crosses (t79)', () => {
    const cells = { light: '#f3e9d6', mid: '#e9b98f', dark: '#b9b2a6' }
    const strokes = {
      '--cobalt': '#2a56bd',
      '--last-move': '#9e3f16',
      '--check': '#a92c24',
    }
    for (const [token, value] of Object.entries(strokes)) {
      for (const [cell, fill] of Object.entries(cells)) {
        expect(
          contrast(value, fill),
          `${token} on the ${cell} cell`,
        ).toBeGreaterThanOrEqual(3)
      }
    }
    // …and those are the values the sheets ship, wired to the cell states.
    expect(INDEX_CSS).toContain(`--cobalt: ${strokes['--cobalt']}`)
    expect(THEME_CSS).toContain(`--last-move: ${strokes['--last-move']}`)
    expect(THEME_CSS).toContain(`--check: ${strokes['--check']}`)
    expect(declares('.hxc-cell--last', 'stroke:var(--last-move)')).toBe(true)
    expect(declares('.hxc-cell--check', 'stroke:var(--check)')).toBe(true)
    // Dark is monochrome: both strokes fall back to the brand pair, which is
    // the cream line there. Once in the media query, once in the override.
    expect(THEME_CSS.match(/--last-move: var\(--orange\)/g)).toHaveLength(2)
    expect(THEME_CSS.match(/--check: var\(--alert\)/g)).toHaveLength(2)
  })

  it('sizes the board as the hero and keeps the legend on one line', () => {
    expect(declares('.hxc-svg', 'width:min(92vw,72vh,760px)')).toBe(true)
    expect(declares('.hxc-svg', 'max-width:100%')).toBe(true)
    expect(declares('.hxc-wrapper', 'width:calc(100vw-16px)')).toBe(true)
    expect(declares('.hxc-wrapper', 'box-sizing:border-box')).toBe(true)
    // The strip, not the page, is what gives — and the legend must not set the
    // frame's own width, or the board sits in a band of empty paper.
    expect(declares('.hxc-legend__strip', 'overflow-x:auto')).toBe(true)
    expect(declares('.hxc-legend__strip', 'min-width:0')).toBe(true)
    expect(declares('.hxc-legend', 'contain:inline-size')).toBe(true)
    expect(declares('.hxc-legend', 'border-top:1.5pxsolidvar(--cell-border)')).toBe(
      true,
    )
    // The browser makes a scroll container keyboard-focusable; a UA box over
    // the strip is the same defect as one over a cell (B5).
    expect(
      declares('.hxc-legend__strip:focus-visible', 'outline:2pxsolidvar(--cobalt)'),
    ).toBe(true)
  })
})
