import { describe, expect, it } from 'vitest'

import {
  keyOf,
  notationToAxial,
  parsePosition,
  serializePosition,
  STARTING_POSITION,
  type Piece,
  type Position,
} from './board'

const START_FEN =
  'b/qbk/n1b1n/r5r/ppppppppp/11/5P5/4P1P4/3P1B1P3/2P2B2P2/1PRNQBKNRP1 w - 0 1'

const cell = (n: string) => notationToAxial(n)!
const start: Position = {
  board: STARTING_POSITION,
  turn: 'w',
  epTarget: null,
  halfmove: 0,
  fullmove: 1,
}

// Start, then White e4-e6 (double step, ep target e5), White knight on d1
// relocated to empty g8, counters advanced.
function midGame(): Position {
  const board = new Map<string, Piece>(STARTING_POSITION)
  board.delete(keyOf(cell('e4')))
  board.set(keyOf(cell('e6')), { type: 'P', color: 'w' })
  board.delete(keyOf(cell('d1')))
  board.set(keyOf(cell('g8')), { type: 'N', color: 'w' })
  return { board, turn: 'b', epTarget: cell('e5'), halfmove: 3, fullmove: 12 }
}

describe('position serialization', () => {
  it('serializes the starting position to the documented string', () => {
    expect(serializePosition(start)).toBe(START_FEN)
  })

  it('round-trips the starting position', () => {
    const parsed = parsePosition(START_FEN)
    expect(parsed.board.size).toBe(36)
    expect(new Map(parsed.board)).toEqual(new Map(STARTING_POSITION))
    expect(serializePosition(parsed)).toBe(START_FEN)
  })

  it('round-trips a mid-game position with side, ep and counters', () => {
    const pos = midGame()
    const text = serializePosition(pos)
    expect(text).toBe(
      'b/qbk/n1b1n/r3N1r/ppppppppp/4P6/5P5/6P4/3P1B1P3/2P2B2P2/1PR1QBKNRP1 b e5 3 12',
    )
    const parsed = parsePosition(text)
    expect(parsed.turn).toBe('b')
    expect(parsed.epTarget).toEqual(cell('e5'))
    expect(parsed.halfmove).toBe(3)
    expect(parsed.fullmove).toBe(12)
    expect(new Map(parsed.board)).toEqual(new Map(pos.board))
    expect(serializePosition(parsed)).toBe(text)
  })

  it.each([
    ['bad piece char', START_FEN.replace('qbk', 'qxk')],
    ['digit-only token zero', START_FEN.replace('/11/', '/0/')],
    ['too few ranks', START_FEN.replace('b/qbk/', 'qbk/')],
    ['too many ranks', 'b/' + START_FEN],
    ['rank too short', START_FEN.replace('/11/', '/10/')],
    ['rank too long', START_FEN.replace('/11/', '/12/')],
    ['piece past rank end', START_FEN.replace('qbk', 'qbkq')],
    ['bad side to move', START_FEN.replace(' w ', ' x ')],
    ['ep off board', START_FEN.replace(' - ', ' a11 ')],
    ['ep on omitted file j', START_FEN.replace(' - ', ' j5 ')],
    ['negative halfmove', START_FEN.replace(' 0 1', ' -1 1')],
    ['fullmove zero', START_FEN.replace(' 0 1', ' 0 0')],
    ['non-numeric counter', START_FEN.replace(' 0 1', ' 0 x')],
    ['missing field', START_FEN.replace(' 0 1', ' 0')],
    ['empty string', ''],
  ])('rejects %s', (_name, text) => {
    expect(() => parsePosition(text)).toThrow()
  })
})
