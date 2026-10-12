import { describe, expect, it } from 'vitest'

import {
  applyMove,
  initialGame,
  legalMoves,
  status,
  type GameState,
  type Move,
} from '../rules/rules'
import { axialToNotation, notationToAxial } from '../board/notation'
import { keyOf, type Piece, type PieceType } from '../board/pieces'
import { bestMove, scoreMove } from './ai'

const coord = (m: Move) => axialToNotation(m.from) + axialToNotation(m.to)

function play(state: GameState, ...coords: string[]): GameState {
  let s = state
  for (const c of coords) {
    const m = legalMoves(s).find((x) => coord(x) === c)
    expect(m, `expected ${c} to be legal`).toBeDefined()
    s = applyMove(s, m!)
  }
  return s
}

/** Position from "cell": piece, uppercase = White; White to move. */
function pos(pieces: Record<string, string>): GameState {
  const board = new Map<string, Piece>()
  for (const [cell, p] of Object.entries(pieces)) {
    board.set(keyOf(notationToAxial(cell)!), {
      type: p.toUpperCase() as PieceType,
      color: p === p.toUpperCase() ? 'w' : 'b',
    })
  }
  return {
    board,
    turn: 'w',
    epTarget: null,
    halfmove: 0,
    fullmove: 1,
    history: [],
  }
}

// Gliński fool's mate set-up: White can mate with Qc3xf9 or grab the
// black queen with Qc3xc6.
const foolsMate = () =>
  play(initialGame(), 'e1c3', 'e10c6', 'b1b2', 'b7b6', 'f3b1', 'e7e6')

// Black rook f8 is loose: f6xf8 is the only capture on the board and nothing
// can take the queen back (the black king on h9 is two cells away).
const hangingRook = () => pos({ g1: 'K', h9: 'k', f6: 'Q', f8: 'r' })

// Pawn e5 is bait: defended by the rook behind it, so f6xe5 loses the queen.
const defendedPawn = () => pos({ g1: 'K', h9: 'k', f6: 'Q', e5: 'p', e8: 'r' })

const isLegal = (s: GameState, m: Move | null) =>
  m !== null &&
  legalMoves(s).some(
    (x) => coord(x) === coord(m) && x.promotion === m.promotion,
  )

describe('bestMove', () => {
  it('returns a legal move from non-terminal positions', () => {
    let s = initialGame()
    for (let i = 0; i < 6; i++) {
      const { move } = bestMove(s, { depth: 2, seed: i + 1 })
      expect(isLegal(s, move)).toBe(true)
      s = applyMove(s, move!)
    }
  })

  it('returns null when the game is over', () => {
    const mated = play(foolsMate(), 'c3f9')
    expect(status(mated)).toBe('checkmate')
    expect(bestMove(mated).move).toBeNull()
  })

  it('finds a forced mate in one', () => {
    const { move } = bestMove(foolsMate(), { depth: 2 })
    expect(coord(move!)).toBe('c3f9')
  })

  it('prefers mate over grabbing the queen', () => {
    // Qc3xc6 is not free: the black knight on d9 recaptures on c6, so leaf
    // capture resolution refutes the grab at depth 1 too — depth no longer
    // decides this one, both depths mate.
    expect(coord(bestMove(foolsMate(), { depth: 1 }).move!)).toBe('c3f9')
    expect(coord(bestMove(foolsMate(), { depth: 3 }).move!)).toBe('c3f9')
  })

  it('respects the depth cap', () => {
    const s = foolsMate()
    // depth 1 visits the root plus each legal reply, nothing deeper.
    expect(bestMove(s, { depth: 1 }).nodes).toBe(1 + legalMoves(s).length)
    expect(bestMove(s, { depth: 3 }).nodes).toBeGreaterThan(
      bestMove(s, { depth: 2 }).nodes,
    )
  })

  it('picks the capture when a piece is hanging', () => {
    const s = hangingRook()
    expect(coord(bestMove(s, { depth: 2 }).move!)).toBe('f6f8')
    expect(bestMove(s, { depth: 3 }).score).toBeGreaterThan(0)
  })

  it('resolves captures at the leaf instead of hanging a piece', () => {
    const s = defendedPawn()
    const grab = legalMoves(s).find((m) => coord(m) === 'f6e5')!

    // Plain depth-1 leaf eval sees only the pawn: it plays f6xe5.
    expect(coord(bestMove(s, { depth: 1, quiescence: false }).move!)).toBe(
      'f6e5',
    )
    expect(scoreMove(s, grab, { depth: 1, quiescence: false })!.score).toBe(
      bestMove(s, { depth: 1, quiescence: false }).score,
    )

    // With the recapture resolved, the same move loses the queen.
    const best = bestMove(s, { depth: 1 })
    expect(coord(best.move!)).not.toBe('f6e5')
    expect(scoreMove(s, grab, { depth: 1 })!.score).toBeLessThan(-500)
    expect(best.score).toBeGreaterThan(scoreMove(s, grab, { depth: 1 })!.score)
  })

  it('returns a principal variation headed by the chosen move', () => {
    const s = hangingRook()
    const { move, pv } = bestMove(s, { depth: 3 })
    expect(pv[0]).toEqual(move)
    expect(pv.length).toBeGreaterThan(0)
    expect(pv.length).toBeLessThanOrEqual(3)
    let walked = s
    for (const m of pv) {
      expect(isLegal(walked, m)).toBe(true)
      walked = applyMove(walked, m)
    }
  })

  it('scores any legal move exactly, and null for a move that is not legal', () => {
    const s = hangingRook()
    const best = bestMove(s, { depth: 2 })
    expect(scoreMove(s, best.move!, { depth: 2 })!.score).toBe(best.score)
    // h7 is empty: nothing of White's can move from there.
    const nowhere = { from: notationToAxial('h7')!, to: notationToAxial('h8')! }
    expect(scoreMove(s, nowhere)).toBeNull()
  })

  it('counts leaf capture nodes outside the main search count', () => {
    const s = defendedPawn()
    expect(bestMove(s, { depth: 2, quiescence: false }).qnodes).toBe(0)
    expect(bestMove(s, { depth: 2 }).qnodes).toBeGreaterThan(0)
  })

  it('is deterministic for a fixed position and seed', () => {
    const s = initialGame()
    const a = bestMove(s, { depth: 2, seed: 42 })
    const b = bestMove(s, { depth: 2, seed: 42 })
    expect(coord(a.move!)).toBe(coord(b.move!))
    expect(a.score).toBe(b.score)
    expect(a.nodes).toBe(b.nodes)
  })
})
