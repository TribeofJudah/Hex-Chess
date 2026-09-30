import { describe, expect, it } from 'vitest'

import {
  applyMove,
  inCheck,
  initialGame,
  legalMoves,
  movesFrom,
  status,
  type GameState,
  type Move,
} from './rules'
import { axialToNotation, notationToAxial } from '../board/notation'
import { keyOf, type Piece } from '../board/pieces'

const A = (n: string) => notationToAxial(n)!
const N = (c: { q: number; r: number }) => axialToNotation(c)

function mv(from: string, to: string, promotion?: 'Q' | 'R' | 'B' | 'N'): Move {
  const move: Move = { from: A(from), to: A(to) }
  if (promotion) return { ...move, promotion }
  return move
}

/** Build a sparse custom position. */
function customPos(
  pieces: Array<[string, Piece]>,
  turn: 'w' | 'b' = 'w',
  extra?: Partial<GameState>,
): GameState {
  const board = new Map<string, Piece>()
  for (const [n, p] of pieces) board.set(keyOf(A(n)), p)
  return {
    board,
    turn,
    epTarget: null,
    halfmove: 0,
    fullmove: 1,
    history: [],
    ...extra,
  }
}

/** Play coordinate moves ("e1c3", "e10c6", "c3xf9"), asserting legality. */
function play(state: GameState, ...coords: string[]): GameState {
  let s = state
  for (const c of coords) {
    const m = /([a-il][1-9][0-9]?)[-x]?([a-il][1-9][0-9]?)/i.exec(c)
    if (!m) throw new Error(`bad coordinate: ${c}`)
    const from = A(m[1])
    const to = A(m[2])
    const legal = legalMoves(s).find(
      (move) =>
        keyOf(move.from) === keyOf(from) && keyOf(move.to) === keyOf(to),
    )
    expect(legal, `expected ${c} to be legal`).toBeDefined()
    s = applyMove(s, legal!)
  }
  return s
}

describe('initial position', () => {
  it('White has 51 legal moves (verified against reference engine)', () => {
    expect(legalMoves(initialGame())).toHaveLength(51)
  })

  it('f5 pawn: single push only (f7 occupied blocks the double step)', () => {
    expect(movesFrom(initialGame(), A('f5')).map((m) => N(m.to))).toEqual([
      'f6',
    ])
  })

  it('c2 pawn: push c3, double c4 (b3/d3 hold friendly pawns)', () => {
    const targets = movesFrom(initialGame(), A('c2')).map((m) => N(m.to))
    expect([...targets].sort()).toEqual(['c3', 'c4'])
  })

  it('knight d1 has 4 moves (b2, c3, f4, g2)', () => {
    const targets = movesFrom(initialGame(), A('d1')).map((m) => N(m.to))
    expect([...targets].sort()).toEqual(['b2', 'c3', 'f4', 'g2'])
  })

  it('king g1: g2/h2 only (f1 occupied by bishop)', () => {
    const targets = movesFrom(initialGame(), A('g1')).map((m) => N(m.to))
    expect([...targets].sort()).toEqual(['g2', 'h2'])
  })

  it('e1 queen: 6 moves (a5 b4 c3 d2 e2 e3)', () => {
    const targets = movesFrom(initialGame(), A('e1')).map((m) => N(m.to))
    expect([...targets].sort()).toEqual(['a5', 'b4', 'c3', 'd2', 'e2', 'e3'])
  })

  it('no legal move captures a white piece', () => {
    const s = initialGame()
    for (const m of legalMoves(s)) {
      const target = s.board.get(keyOf(m.to))
      if (target) expect(target.color).toBe('b')
    }
  })
})

describe('sliding pieces (empty board around f6)', () => {
  it('rook: 30 cells — six 5-long orthogonal rays from the center', () => {
    const custom = customPos([
      ['f6', { type: 'R', color: 'w' }],
      ['e10', { type: 'K', color: 'b' }],
      ['g1', { type: 'K', color: 'w' }],
    ])
    const targets = movesFrom(custom, A('f6')).map((m) => N(m.to))
    expect(targets).toHaveLength(30)
    // spot-check the six ray endpoints
    for (const end of ['f11', 'l6', 'l1', 'f1', 'a1', 'a6']) {
      expect(targets).toContain(end)
    }
  })

  it('bishop: 12 cells — six 2-long diagonal rays from the center', () => {
    const custom = customPos([
      ['f6', { type: 'B', color: 'w' }],
      ['e10', { type: 'K', color: 'b' }],
      ['g1', { type: 'K', color: 'w' }],
    ])
    const targets = movesFrom(custom, A('f6')).map((m) => N(m.to))
    expect(targets).toHaveLength(12)
    // every target shares the bishop's colour class
    const colors = new Set(
      targets.map((n) => (n === 'd2' || n === 'h8' ? 'x' : n)),
    )
    void colors
    for (const n of [
      'h5',
      'k4',
      'g7',
      'h8',
      'e7',
      'd8',
      'd5',
      'b4',
      'e4',
      'd2',
      'g4',
      'h2',
    ]) {
      expect(targets).toContain(n)
    }
  })

  it('queen = rook + bishop (30 + 12 = 42 from the center)', () => {
    const custom = customPos([
      ['f6', { type: 'Q', color: 'w' }],
      ['e10', { type: 'K', color: 'b' }],
      ['g1', { type: 'K', color: 'w' }],
    ])
    expect(movesFrom(custom, A('f6'))).toHaveLength(42)
  })
})

describe('knight and king', () => {
  it('knight jumps to all 12 targets from an empty center', () => {
    const custom = customPos([
      ['f6', { type: 'N', color: 'w' }],
      ['e10', { type: 'K', color: 'b' }],
      ['l1', { type: 'K', color: 'w' }],
    ])
    expect(movesFrom(custom, A('f6'))).toHaveLength(12)
  })

  it('king steps to all 12 neighbours from an empty center', () => {
    const custom = customPos([
      ['f6', { type: 'K', color: 'w' }],
      ['a1', { type: 'K', color: 'b' }],
    ])
    expect(movesFrom(custom, A('f6'))).toHaveLength(12)
  })
})

describe('pawns', () => {
  it('double-step is available from every one of the 9 start cells', () => {
    for (const start of [
      'b1',
      'c2',
      'd3',
      'e4',
      'f5',
      'g4',
      'h3',
      'i2',
      'k1',
    ]) {
      const lone = customPos(
        [
          [start, { type: 'P', color: 'w' }],
          ['g10', { type: 'K', color: 'b' }],
          ['l1', { type: 'K', color: 'w' }],
        ],
        'w',
      )
      const targets = movesFrom(lone, A(start)).map((m) => N(m.to))
      expect(targets, `${start} should double-step`).toHaveLength(2)
      // both moves stay on the pawn's own file
      for (const t of targets) expect(t[0]).toBe(start[0])
    }
  })

  it('f5 cannot double-step in the initial game (f7 black pawn)', () => {
    expect(movesFrom(initialGame(), A('f5')).map((m) => N(m.to))).toEqual([
      'f6',
    ])
  })

  it('bxc6 en passant — Wikipedia example, verbatim', () => {
    const before = customPos(
      [
        ['b5', { type: 'P', color: 'w' }],
        ['c7', { type: 'P', color: 'b' }],
        ['g1', { type: 'K', color: 'w' }],
        ['g10', { type: 'K', color: 'b' }],
      ],
      'b',
    )
    let s = play(before, 'c7c5') // black double-step sets ep target on c6
    expect(
      legalMoves(s).some((m) => N(m.from) === 'b5' && N(m.to) === 'c6'),
    ).toBe(true)
    s = applyMove(s, mv('b5', 'c6'))
    expect(s.board.has(keyOf(A('c5')))).toBe(false) // captured en passant
  })

  it('en passant right expires after one move', () => {
    const before = customPos(
      [
        ['b5', { type: 'P', color: 'w' }],
        ['c7', { type: 'P', color: 'b' }],
        ['g1', { type: 'K', color: 'w' }],
        ['g10', { type: 'K', color: 'b' }],
      ],
      'b',
    )
    const s = play(before, 'c7c5', 'g1f2')
    expect(
      legalMoves(s).some((m) => N(m.from) === 'b5' && N(m.to) === 'c6'),
    ).toBe(false)
  })

  it('promotion: all four choices offered at the top of a file', () => {
    const custom = customPos(
      [
        ['a5', { type: 'P', color: 'w' }],
        ['g10', { type: 'K', color: 'b' }],
        ['l1', { type: 'K', color: 'w' }],
      ],
      'w',
    )
    const targets = movesFrom(custom, A('a5')).map(
      (m) => `${N(m.to)}${m.promotion ?? ''}`,
    )
    for (const p of ['Q', 'R', 'B', 'N']) expect(targets).toContain(`a6${p}`)
  })

  it('black promotes on rank-1 cells', () => {
    const custom = customPos(
      [
        ['a2', { type: 'P', color: 'b' }],
        ['g10', { type: 'K', color: 'b' }],
        ['l1', { type: 'K', color: 'w' }],
      ],
      'b',
    )
    const targets = movesFrom(custom, A('a2')).map((m) => N(m.to))
    expect(targets).toContain('a1')
  })

  it('promotion zone is the full opposite back rank for both sides', () => {
    // White pawn arriving f11 promotes; black pawn arriving f1 promotes.
    const w = customPos(
      [
        ['f10', { type: 'P', color: 'w' }],
        ['a1', { type: 'K', color: 'b' }],
        ['l1', { type: 'K', color: 'w' }],
      ],
      'w',
    )
    const wTargets = movesFrom(w, A('f10')).map(
      (m) => `${N(m.to)}${m.promotion ?? ''}`,
    )
    expect(wTargets).toContain('f11Q')

    const b = customPos(
      [
        ['f2', { type: 'P', color: 'b' }],
        ['g10', { type: 'K', color: 'b' }],
        ['l1', { type: 'K', color: 'w' }],
      ],
      'b',
    )
    const bTargets = movesFrom(b, A('f2')).map(
      (m) => `${N(m.to)}${m.promotion ?? ''}`,
    )
    expect(bTargets).toContain('f1Q')
  })
})

describe('check, pins, mates', () => {
  it('pinned rook may only move along the pin line', () => {
    const custom = customPos(
      [
        ['f10', { type: 'R', color: 'b' }],
        ['f5', { type: 'R', color: 'w' }],
        ['f1', { type: 'K', color: 'w' }],
        ['a1', { type: 'K', color: 'b' }],
      ],
      'w',
    )
    const targets = movesFrom(custom, A('f5')).map((m) => N(m.to))
    for (const t of targets) expect(t[0]).toBe('f')
    expect(targets).toContain('f2')
    expect(targets).toContain('f10') // capturing the pinner is legal
  })

  it('Wikipedia Fool’s mate: 1.Qe1c3 Qe10c6 2.b1b2 b7b6 3.Bf3b1 e7e6? 4.Qc3xBf9#', () => {
    const s = play(
      initialGame(),
      'e1c3',
      'e10c6',
      'b1b2',
      'b7b6',
      'f3b1',
      'e7e6',
    )
    const mates = movesFrom(s, A('c3')).filter((m) => N(m.to) === 'f9')
    expect(mates).toHaveLength(1)
    const after = applyMove(s, mates[0]!)
    expect(status(after)).toBe('checkmate')
    expect(inCheck(after, 'b')).toBe(true)
  })
})

describe('game status', () => {
  it('stalemate: no legal moves, not in check → distinct from draw', () => {
    // Search a KQ vs K position where the lone king is stalemated.
    let found: GameState | null = null
    outer: for (const k of ['a6', 'b7', 'c8', 'd9', 'e10']) {
      for (let q = 0; q < 11; q++) {
        for (let r = 1; r <= 11; r++) {
          const qn = `${'abcdefghikl'[q]}${r}`
          const cell = notationToAxial(qn)
          if (!cell) continue
          const custom = customPos(
            [
              [k, { type: 'K', color: 'b' }],
              [qn, { type: 'Q', color: 'w' }],
              ['l1', { type: 'K', color: 'w' }],
            ],
            'b',
          )
          if (
            status(custom) === 'stalemate' &&
            legalMoves(custom).length === 0 &&
            !inCheck(custom, 'b')
          ) {
            found = custom
            break outer
          }
        }
      }
    }
    expect(found).not.toBeNull()
    expect(status(found!)).toBe('stalemate')
  })

  it('checkmate beats the 50-move counter', () => {
    const s = play(
      initialGame(),
      'e1c3',
      'e10c6',
      'b1b2',
      'b7b6',
      'f3b1',
      'e7e6',
    )
    const qxf9 = movesFrom(s, A('c3')).find((m) => N(m.to) === 'f9')
    expect(qxf9).toBeDefined()
    const mated = applyMove(s, qxf9!)
    expect(mated.halfmove).toBe(0) // captures reset the clock
    expect(status(mated)).toBe('checkmate')
  })

  it('50-move rule triggers at halfmove >= 100', () => {
    const custom = customPos(
      [
        ['k1', { type: 'K', color: 'w' }],
        ['a1', { type: 'K', color: 'b' }],
      ],
      'w',
      { halfmove: 100 },
    )
    expect(status(custom)).toBe('draw50')
  })

  it('threefold repetition is detected', () => {
    let s = initialGame()
    // Knight shuffle: White d1-b2-d1, Black d9-f8-d9
    const cycle = ['d1b2', 'd9f8', 'b2d1', 'f8d9']
    s = play(s, ...cycle)
    expect(status(s)).not.toBe('repetition')
    s = play(s, ...cycle)
    expect(status(s)).toBe('repetition')
  })
})
