import { describe, expect, it } from 'vitest'
import { parsePosition, serializePosition } from '../src/board/fen'
import { notationToAxial } from '../src/board/notation'
import { keyOf } from '../src/board/pieces'
import { applyMove } from '../src/rules/rules'
import { validateMove } from '../src/validate'

const START_FEN =
  'b/qbk/n1b1n/r5r/ppppppppp/11/5P5/4P1P4/3P1B1P3/2P2B2P2/1PRNQBKNRP1 w - 0 1'

/** Start position with the b1 pawn relocated to a5, one step from the a6
    promotion zone (Gliński promotions land on the top cell of the file). */
function fenWithPawnAtA5(): string {
  const board = new Map(parsePosition(START_FEN).board)
  board.delete(keyOf(notationToAxial('b1')!))
  board.set(keyOf(notationToAxial('a5')!), { type: 'P', color: 'w' })
  return serializePosition({
    board,
    turn: 'w',
    epTarget: null,
    halfmove: 0,
    fullmove: 1,
  })
}

describe('validateMove', () => {
  it('round-trips the starting FEN through the vendored engine', () => {
    expect(serializePosition(parsePosition(START_FEN))).toBe(START_FEN)
  })

  it('accepts the standard opening pawn double push (the e2e4 equivalent)', () => {
    // b1 → b3 is White's two-cell push from a pawn-start cell.
    const verdict = validateMove(START_FEN, 'b1', 'b3')
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.san).toBe('b1b3')
    expect(verdict.nextFen.split(' ')[1]).toBe('b') // black to reply
    expect(verdict.nextFen.split(' ')[2]).toBe('b2') // ep: the skipped cell
  })

  it("the next FEN equals the engine's own serialize after the same move", () => {
    const verdict = validateMove(START_FEN, 'b1', 'b3')
    if (!verdict.ok) throw new Error(verdict.reason)

    const state = { ...parsePosition(START_FEN), history: [] }
    const expected = serializePosition(
      applyMove(state, {
        from: notationToAxial('b1')!,
        to: notationToAxial('b3')!,
      }),
    )
    expect(verdict.nextFen).toBe(expected)
  })

  it('accepts a single pawn push and records no en passant', () => {
    const verdict = validateMove(START_FEN, 'b1', 'b2')
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.san).toBe('b1b2')
    expect(verdict.nextFen.split(' ')[2]).toBe('-')
  })

  it('rejects a five-cell leap the piece cannot make', () => {
    // A king cannot slide five cells g1 → g6 — the hostile frame the room
    // must NACK instead of broadcasting.
    expect(validateMove(START_FEN, 'g1', 'g6')).toEqual({
      ok: false,
      reason: 'illegal move g1g6',
    })
  })

  it('rejects moving a black piece while White is to move', () => {
    // b7 → b6 is the black pawn's reply; it is not black's turn yet.
    const verdict = validateMove(START_FEN, 'b7', 'b6')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toContain('black')
    expect(verdict.reason).toContain('white')
  })

  it('demands a promotion kind on the last cell and records the choice', () => {
    const fen = fenWithPawnAtA5()
    expect(validateMove(fen, 'a5', 'a6').ok).toBe(false) // choice is mandatory

    const verdict = validateMove(fen, 'a5', 'a6', 'queen')
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.san).toBe('a5a6=Q')
    expect(verdict.nextFen.split(' ')[0]?.split('/')[5]).toBe('Q10')
    expect(verdict.nextFen.split(' ')[1]).toBe('b')
  })

  it('rejects a malformed FEN with a reason, not a throw', () => {
    const verdict = validateMove('not a fen', 'b1', 'b3')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toMatch(/^bad fen:/)
  })

  it('rejects unknown cell notation', () => {
    expect(validateMove(START_FEN, 'z9', 'b3')).toEqual({
      ok: false,
      reason: "bad cell 'z9'",
    })
  })

  it('rejects a move from an empty cell', () => {
    expect(validateMove(START_FEN, 'f6', 'f5')).toEqual({
      ok: false,
      reason: 'no piece at f6',
    })
  })
})
