import { describe, expect, it } from 'vitest'

import { serializePosition } from '../board/fen'
import { axialToNotation, notationToAxial } from '../board/notation'
import { keyOf, type Piece, type PieceType } from '../board/pieces'
import {
  applyMove,
  initialGame,
  legalMoves,
  moveToSan,
  status,
  type GameState,
  type Move,
} from '../rules/rules'
import { bestMove } from '../ai/ai'
import type { Agent } from './adapter'
import { runMatch, type PlyRecord } from './runner'
import { GRADER_VERSION, gradeMatch, gradePly } from './grader'

const coord = (m: Move) => axialToNotation(m.from) + axialToNotation(m.to)

/** Position from "cell": piece, uppercase = White. */
function pos(pieces: Record<string, string>, turn: 'w' | 'b' = 'w'): GameState {
  const board = new Map<string, Piece>()
  for (const [cell, p] of Object.entries(pieces)) {
    board.set(keyOf(notationToAxial(cell)!), {
      type: p.toUpperCase() as PieceType,
      color: p === p.toUpperCase() ? 'w' : 'b',
    })
  }
  return { board, turn, epTarget: null, halfmove: 0, fullmove: 1, history: [] }
}

function play(state: GameState, ...coords: string[]): GameState {
  let s = state
  for (const c of coords) {
    const m = legalMoves(s).find((x) => coord(x) === c)
    expect(m, `expected ${c} to be legal`).toBeDefined()
    s = applyMove(s, m!)
  }
  return s
}

const sanOf = (s: GameState, coords: string) =>
  moveToSan(
    s,
    legalMoves(s).find((m) => coord(m) === coords)!,
  )

/** A record as the runner emits it: the fen, and the SAN the agent played. */
function record(fen: string, san: string | null): PlyRecord {
  return {
    gameId: 'g1',
    model: 'stub',
    ply: 1,
    retry: 0,
    side: fen.split(' ')[1] as 'w' | 'b',
    fen,
    response: { move: san ?? '' },
    verdict: { legal: san !== null, san },
    engine: null,
    game: { over: false, result: null, winner: null },
  }
}

// Black rook f8 is loose: f6xf8 is the only capture and nothing can take back.
const hangingRook = () => pos({ g1: 'K', h9: 'k', f6: 'Q', f8: 'r' })

// Pawn e5 is bait, defended by the rook behind it: f6xe5 loses the queen.
const defendedPawn = () => pos({ g1: 'K', h9: 'k', f6: 'Q', e5: 'p', e8: 'r' })

// Gliński fool's mate: Qc3xf9 is mate.
const mated = () =>
  play(
    initialGame(),
    'e1c3',
    'e10c6',
    'b1b2',
    'b7b6',
    'f3b1',
    'e7e6',
    'c3f9',
  )

describe('gradePly', () => {
  it('grades a tactical capture: bestMove, pv[0] and cpLoss 0 when it is played', () => {
    const s = hangingRook()
    const capture = sanOf(s, 'f6f8')
    const { engine } = gradePly(record(serializePosition(s), capture), {
      depth: 2,
    })

    expect(engine!.graderVersion).toBe(GRADER_VERSION)
    expect(engine!.bestMove).toBe(capture)
    expect(engine!.pv[0]).toBe(engine!.bestMove)
    expect(engine!.cpLoss).toBe(0)
    expect(engine!.evalBefore).toBe(engine!.evalAfter)
  })

  it('charges the horizon blunder of grabbing defended bait', () => {
    const s = defendedPawn()
    const grab = sanOf(s, 'f6e5')
    const { engine } = gradePly(record(serializePosition(s), grab), {
      depth: 1,
    })

    // The queen hangs to the rook behind the pawn; the engine's own choice
    // keeps the material, so the ply costs most of a queen.
    expect(engine!.bestMove).not.toBe(grab)
    expect(engine!.evalAfter!).toBeLessThan(0)
    expect(engine!.evalBefore!).toBeGreaterThan(engine!.evalAfter!)
    expect(engine!.cpLoss!).toBeGreaterThan(500)
  })

  it('grades the same ply differently with quiescence off — grades are engine-pinned', () => {
    const s = defendedPawn()
    const grab = sanOf(s, 'f6e5')
    const plain = gradePly(record(serializePosition(s), grab), {
      depth: 1,
      quiescence: false,
    })

    // Without leaf capture resolution the grab looks free, so the grader
    // would call it the engine's own move.
    expect(plain.engine!.bestMove).toBe(grab)
    expect(plain.engine!.cpLoss).toBe(0)
  })

  it('keeps null scores for a ply whose move is not legal in the position', () => {
    const { engine } = gradePly(record(serializePosition(hangingRook()), 'Qh9h8'))

    expect(engine!.graderVersion).toBe(GRADER_VERSION)
    expect(engine!.evalAfter).toBeNull()
    expect(engine!.cpLoss).toBeNull()
    // It still reports what the engine wanted.
    expect(engine!.bestMove).toBe('Qf6xf8')
  })

  it('stamps the version on a finished game and on an unreadable position', () => {
    expect(status(mated())).toBe('checkmate')

    const empty = {
      graderVersion: GRADER_VERSION,
      evalBefore: null,
      evalAfter: null,
      cpLoss: null,
      bestMove: null,
      pv: [],
    }
    expect(gradePly(record(serializePosition(mated()), null)).engine).toEqual(
      empty,
    )
    expect(gradePly(record('not a position', null)).engine).toEqual(empty)
  })
})

describe('gradeMatch', () => {
  /** Plays whatever the engine would have played. */
  const engineAgent = (depth = 1): Agent => ({
    id: 'engine',
    decide: ({ state }) => ({
      move: moveToSan(state, bestMove(state, { depth }).move!),
    }),
  })

  it('grades every ply of a real match without touching the runner fields', async () => {
    const match = await runMatch({
      seed: 5,
      white: engineAgent(),
      black: engineAgent(),
      maxPlies: 2,
    })
    const graded = gradeMatch(match.plies, { depth: 1 })

    expect(graded).toHaveLength(2)
    for (const [i, g] of graded.entries()) {
      expect(g.engine!.graderVersion).toBe(GRADER_VERSION)
      expect(g.engine!.pv[0]).toBe(g.engine!.bestMove)
      expect(g.engine!.cpLoss).toBe(0)
      expect({ ...g, engine: null }).toEqual(match.plies[i])
    }
  })
})
