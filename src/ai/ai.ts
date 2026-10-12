/**
 * AI opponent: negamax with alpha-beta over the Gliński rules engine,
 * quiescence over captures at the leaves, principal variation at the root.
 * Eval = material + a small mobility term (pseudo-move count difference).
 * ponytail: still no transposition table or opening book. Quiescence is
 * captures-only and bounded by QMAX; give it check evasions or promotions
 * if the grader's cp-loss turns out to be noisy.
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
/** Capture plies the leaf search may extend beyond the nominal depth. */
const QMAX = 6
/** Moves returned for a line (XCHESS_BENCH §3: "PV top-3"). */
const PVLEN = 3

export interface SearchOptions {
  /** Plies to search (default 3). */
  depth?: number
  /** Seed for tie-breaking among equally scored moves (default 1). */
  seed?: number
  /** Resolve captures at the leaves (default true). */
  quiescence?: boolean
}

export interface SearchResult {
  move: Move | null
  score: number
  /** Positions visited; useful to check the depth cap. */
  nodes: number
  /** Nodes visited by the leaf capture search (excluded from `nodes`). */
  qnodes: number
  /** Best line, `pv[0]` is `move` itself; empty when the game is over. */
  pv: Move[]
}

/** Exact score of one chosen move, and the line the engine expects after it. */
export interface MoveScore {
  score: number
  /** `pv[0]` is the move itself. */
  pv: Move[]
}

/** Node counters, threaded through the search so callers can report them. */
interface Counters {
  nodes: number
  qnodes: number
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
  { depth = 3, seed = 1, quiescence = true }: SearchOptions = {},
): SearchResult {
  const root = searchRoot(state)
  const counters: Counters = { nodes: 0, qnodes: 0 }
  counters.nodes++
  const moves = legalMoves(root)
  if (moves.length === 0) {
    return {
      move: null,
      score: inCheck(root, root.turn) ? -MATE : STALEMATE,
      nodes: counters.nodes,
      qnodes: counters.qnodes,
      pv: [],
    }
  }

  // Shared alpha across root moves: a move that fails high is pruned, and
  // every move that does improve alpha was searched into an exact score.
  let best: Move = moves[0]!
  let bestPv: Move[] = []
  let alpha = -Infinity
  for (const m of order(root, shuffle(moves, seed))) {
    const child = negamax(
      applyMove(root, m),
      Math.max(depth, 1) - 1,
      1,
      -Infinity,
      -alpha,
      quiescence,
      counters,
    )
    if (-child.score > alpha) {
      alpha = -child.score
      best = m
      bestPv = [m, ...child.pv]
    }
  }
  return {
    move: best,
    score: alpha,
    nodes: counters.nodes,
    qnodes: counters.qnodes,
    pv: bestPv.slice(0, PVLEN),
  }
}

/**
 * Exact score for one specific move — the grader's "what did the played move
 * cost?" query. Null when `move` is not legal in `state`. Full window, so the
 * score is comparable with `bestMove`'s (same depth) without bound noise.
 */
export function scoreMove(
  state: GameState,
  move: Move,
  { depth = 3, quiescence = true }: SearchOptions = {},
): MoveScore | null {
  const root = searchRoot(state)
  if (!legalMoves(root).some((m) => sameMove(m, move))) return null
  const counters: Counters = { nodes: 1, qnodes: 0 }
  const child = negamax(
    applyMove(root, move),
    Math.max(depth, 1) - 1,
    1,
    -Infinity,
    Infinity,
    quiescence,
    counters,
  )
  return { score: -child.score, pv: [move, ...child.pv].slice(0, PVLEN) }
}

/** Search never consults history; dropping it keeps applyMove cheap. */
function searchRoot(state: GameState): GameState {
  return { ...state, history: [] }
}

function sameMove(a: Move, b: Move): boolean {
  return (
    a.from.q === b.from.q &&
    a.from.r === b.from.r &&
    a.to.q === b.to.q &&
    a.to.r === b.to.r &&
    a.promotion === b.promotion
  )
}

/** Sort moves best-first by a cheap MVV-LVA-ish key (captures first). */
function order(s: GameState, moves: Move[]): Move[] {
  return moves.sort((a, b) => captureGain(s, b) - captureGain(s, a))
}

function negamax(
  s: GameState,
  d: number,
  ply: number,
  alpha: number,
  beta: number,
  quiescence: boolean,
  counters: Counters,
): { score: number; pv: Move[] } {
  counters.nodes++
  if (d === 0) {
    return {
      score: quiescence ? quiesce(s, alpha, beta, 0, counters) : evaluate(s),
      pv: [],
    }
  }
  const moves = legalMoves(s)
  if (moves.length === 0) {
    return {
      score: inCheck(s, s.turn) ? -MATE + ply : STALEMATE,
      pv: [],
    }
  }
  let bestPv: Move[] = []
  for (const m of order(s, moves)) {
    const child = negamax(
      applyMove(s, m),
      d - 1,
      ply + 1,
      -beta,
      -alpha,
      quiescence,
      counters,
    )
    const score = -child.score
    if (score >= beta) return { score, pv: [m, ...child.pv] }
    if (score > alpha) {
      alpha = score
      bestPv = [m, ...child.pv]
    }
  }
  return { score: alpha, pv: bestPv }
}

/**
 * Stand-pat leaf search over captures only, bounded by QMAX extra plies,
 * scoring from the side to move's perspective. Deliberately does not detect
 * mate/stalemate: a leaf stays worth its material, exactly as a plain
 * `evaluate` leaf, so a depth cap keeps meaning what it always meant.
 */
function quiesce(
  s: GameState,
  alpha: number,
  beta: number,
  qd: number,
  counters: Counters,
): number {
  counters.qnodes++
  const stand = evaluate(s)
  if (qd >= QMAX || stand >= beta) return stand
  if (stand > alpha) alpha = stand
  // Pseudo-legal capture scan: one generation, then a legality test only for
  // the (usually zero or one) moves that actually take something.
  for (const m of order(s, pseudoMoves(s, s.turn))) {
    if (!isCapture(s, m)) continue
    const child = applyMove(s, m)
    if (inCheck(child, s.turn)) continue
    const score = -quiesce(child, -beta, -alpha, qd + 1, counters)
    if (score >= beta) return score
    if (score > alpha) alpha = score
  }
  return alpha
}

/** A move that takes a piece — including en passant, whose target is empty. */
function isCapture(s: GameState, m: Move): boolean {
  if (s.board.has(keyOf(m.to))) return true
  return s.epTarget !== null && keyOf(s.epTarget) === keyOf(m.to)
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
