import { describe, expect, it } from 'vitest'

import {
  applyMove,
  initialGame,
  legalMoves,
  status,
  type GameState,
  type Move,
} from '../rules/rules'
import { axialToNotation } from '../board/notation'
import { bestMove } from './ai'

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

// Gliński fool's mate set-up: White can mate with Qc3xf9 or grab the
// black queen with Qc3xc6.
const foolsMate = () =>
  play(initialGame(), 'e1c3', 'e10c6', 'b1b2', 'b7b6', 'f3b1', 'e7e6')

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
    // At depth 1 it can't see mate and grabs the queen; at depth 3 it mates.
    expect(coord(bestMove(foolsMate(), { depth: 1 }).move!)).toBe('c3c6')
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

  it('is deterministic for a fixed position and seed', () => {
    const s = initialGame()
    const a = bestMove(s, { depth: 2, seed: 42 })
    const b = bestMove(s, { depth: 2, seed: 42 })
    expect(coord(a.move!)).toBe(coord(b.move!))
    expect(a.score).toBe(b.score)
    expect(a.nodes).toBe(b.nodes)
  })
})
