import { describe, expect, it } from 'vitest'

import {
  allCells,
  keyOf,
  parsePosition,
  serializePosition,
  type Piece,
  type Position,
} from './board'

/**
 * Pipeline-oriented FEN smoke (t37). Mirrors scripts/fen-smoke.mjs, which runs
 * the same invariants under plain `node` in the deploy pipeline. The detailed
 * parse/reject matrix lives in fen.test.ts; this file keeps the fixed-point and
 * extreme-board invariants guarded inside `npm test` too.
 */

const START =
  'b/qbk/n1b1n/r5r/ppppppppp/11/5P5/4P1P4/3P1B1P3/2P2B2P2/1PRNQBKNRP1 w - 0 1'
const MID =
  'b/qbk/n1b1n/r3N1r/ppppppppp/4P6/5P5/6P4/3P1B1P3/2P2B2P2/1PR1QBKNRP1 b e5 3 12'

const full: Position = {
  board: new Map(
    allCells().map((c): [string, Piece] => [
      keyOf(c),
      { type: 'P', color: 'w' },
    ]),
  ),
  turn: 'b',
  epTarget: null,
  halfmove: 100,
  fullmove: 9999,
}
const empty: Position = {
  board: new Map(),
  turn: 'w',
  epTarget: null,
  halfmove: 0,
  fullmove: 1,
}

/** serialize → parse → serialize must be a fixed point. */
function expectStable(position: Position): string {
  const text = serializePosition(position)
  expect(serializePosition(parsePosition(text))).toBe(text)
  return text
}

describe('FEN round-trip smoke', () => {
  it.each([
    ['start position', START],
    ['mid-game (ep + counters)', MID],
  ])('leaves a canonical %s unchanged', (_label, fen) => {
    expect(serializePosition(parsePosition(fen))).toBe(fen)
  })

  it('round-trips an empty board', () => {
    expectStable(empty)
    expect(parsePosition(serializePosition(empty)).board.size).toBe(0)
  })

  it('round-trips a full 91-piece board', () => {
    expectStable(full)
    expect(parsePosition(serializePosition(full)).board.size).toBe(91)
  })

  it('preserves side to move, ep target and counters', () => {
    const p = parsePosition(MID)
    expect([p.turn, p.halfmove, p.fullmove]).toEqual(['b', 3, 12])
    expect(p.epTarget).not.toBeNull()
  })
})
