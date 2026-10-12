/**
 * Golden-frame tests for the TUI board renderer plus the cross-module
 * invariant XCHESS_BENCH §6 demands: a cell in the TUI is the same cell as
 * the rules core's, so the glyph grid covers exactly allCells().
 */
import { describe, expect, it } from 'vitest'

import { allCells, serializePosition } from '../../board/board'
import { STARTING_POSITION, keyOf } from '../../board/pieces'
import { boardCells, glyphOf, renderFen, ROWS, screenPos } from './board'
// Golden frame: the documented start position (fen.ts header) as-is.
const START_FEN =
  'b/qbk/n1b1n/r5r/ppppppppp/11/5P5/4P1P4/3P1B1P3/2P2B2P2/1PRNQBKNRP1 w - 0 1'

const START_BOARD = [
  '          ♝',
  '        ♛   ♚',
  '      ♞   ♝   ♞',
  '    ♜   ·   ·   ♜',
  '  ♟   ·   ♝   ·   ♟',
  '·   ♟   ·   ·   ♟   ·',
  '  ·   ♟   ·   ♟   ·',
  '·   ·   ♟   ♟   ·   ·',
  '  ·   ·   ♟   ·   ·',
  '·   ·   ·   ·   ·   ·',
  '  ·   ·   ·   ·   ·',
  '·   ·   ·   ·   ·   ·',
  '  ·   ·   ♙   ·   ·',
  '·   ·   ♙   ♙   ·   ·',
  '  ·   ♙   ·   ♙   ·',
  '·   ♙   ·   ·   ♙   ·',
  '  ♙   ·   ♗   ·   ♙',
  '    ♖   ·   ·   ♖',
  '      ♘   ♗   ♘',
  '        ♕   ♔',
  '          ♗',
]

describe('tui board geometry', () => {
  it('renders the same cell set as the rules core (XCHESS_BENCH §6)', () => {
    expect(boardCells().map(keyOf).sort()).toEqual(allCells().map(keyOf).sort())
  })

  it('places every cell inside the ROWS × COLS grid', () => {
    for (const cell of boardCells()) {
      const { row, col } = screenPos(cell)
      expect(row).toBeGreaterThanOrEqual(0)
      expect(row).toBeLessThan(ROWS)
      expect(col).toBeGreaterThanOrEqual(0)
      expect(col).toBeLessThan(2 * (5 + 5) + 1)
    }
  })

  it('renders the documented start position as a golden frame', () => {
    expect(renderFen(START_FEN)).toEqual(START_BOARD)
  })

  it('reaches the same golden via the core start map', () => {
    const fen = serializePosition({
      board: STARTING_POSITION,
      turn: 'w',
      epTarget: null,
      halfmove: 0,
      fullmove: 1,
    })
    expect(fen).toBe(START_FEN)
    expect(renderFen(fen)).toEqual(START_BOARD)
  })

  it('throws on a malformed FEN instead of rendering a lie', () => {
    expect(() => renderFen('not a fen')).toThrow()
  })
})

describe('glyphs', () => {
  it('uses empty dot / white outline / black filled', () => {
    expect(glyphOf(undefined)).toBe('·')
    expect(glyphOf({ type: 'K', color: 'w' })).toBe('♔')
    expect(glyphOf({ type: 'K', color: 'b' })).toBe('♚')
  })
})
