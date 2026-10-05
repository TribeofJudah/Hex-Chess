/**
 * AI opponent: negamax with alpha-beta over the Gliński rules engine.
 * Eval = material + a small mobility term (pseudo-move count difference).
 * ponytail: no transposition table, no quiescence, no opening book — beats a
 * beginner at depth 3; add a TT + quiescence if it needs to play stronger.
 */

import { keyOf, type PieceType } from '../board/pieces'
import {
  applyMove,
  inCheck,
  legalMoves,
  pseudoMoves,
  type GameState,
  type Move,
} from '../rules/rules'

const VALUE: Record<PieceType, number> = {
  P: 100,
  N: 300,
  B: 300,
  R: 500,
  Q: 900,
  K: 0,
}
const MOBILITY = 2
const MATE = 100_000
// Gliński: stalemate is a 3/4 win for the stalemating side, so the
// stalemated side to move scores it as a loss short of mate.
const STALEMATE = -300

export interface SearchOptions {
  /** Plies to search (default 3). */
  depth?: number
  /** Seed for tie-breaking among equally scored moves (default 1). */
  seed?: number
}

export interface SearchResult {
  move: Move | null
  score: number
  /** Positions visited; useful to check the depth cap. */
  nodes: number
}

/** Static eval from the side-to-move's perspective. */
export function evaluate(state: GameState): number {
  let score = 0
  for (const p of state.board.values()) {
    score += p.color === state.turn ? VALUE[p.type] : -VALUE[p.type]
  }
  const them = state.turn === 'w' ? 'b' : 'w'
  return (
    score +
    MOBILITY *
      (pseudoMoves(state, state.turn).length - pseudoMoves(state, them).length)
  )
}

/** Pick a move for the side to move; `move` is null when the game is over. */
export function bestMove(
  state: GameState,
  { depth = 3, seed = 1 }: SearchOptions = {},
): SearchResult {
  // Search never consults history; dropping it keeps applyMove cheap.
  const root: GameState = { ...state, history: [] }
  let nodes = 0

  const order = (s: GameState, moves: Move[]) =>
    moves.sort((a, b) => captureGain(s, b) - captureGain(s, a))

  function negamax(
    s: GameState,
    d: number,
    ply: number,
    alpha: number,
    beta: number,
  ): number {
    nodes++
    if (d === 0) return evaluate(s)
    const moves = legalMoves(s)
    if (moves.length === 0) return inCheck(s, s.turn) ? -MATE + ply : STALEMATE
    for (const m of order(s, moves)) {
      const score = -negamax(applyMove(s, m), d - 1, ply + 1, -beta, -alpha)
      if (score >= beta) return score
      if (score > alpha) alpha = score
    }
    return alpha
  }

  nodes++
  const moves = legalMoves(root)
  if (moves.length === 0) {
    return {
      move: null,
      score: inCheck(root, root.turn) ? -MATE : STALEMATE,
      nodes,
    }
  }

  let best: Move = moves[0]!
  let alpha = -Infinity
  for (const m of order(root, shuffle(moves, seed))) {
    const score = -negamax(
      applyMove(root, m),
      Math.max(depth, 1) - 1,
      1,
      -Infinity,
      -alpha,
    )
    if (score > alpha) {
      alpha = score
      best = m
    }
  }
  return { move: best, score: alpha, nodes }
}

/** MVV-LVA-ish ordering key: captures (and promotions) first. */
function captureGain(s: GameState, m: Move): number {
  const victim = s.board.get(keyOf(m.to))
  const promo = m.promotion ? VALUE[m.promotion] : 0
  return (victim ? VALUE[victim.type] * 10 : 0) + promo
}

/** Seeded Fisher–Yates (mulberry32) so equal moves break ties reproducibly. */
function shuffle<T>(items: T[], seed: number): T[] {
  let a = seed >>> 0
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}
