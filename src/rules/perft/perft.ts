import { applyMove, legalMoves, type GameState } from '../rules'

/**
 * Recursive perft (performance test) node counter.
 * Returns the number of leaf nodes at `depth`.
 */
export function perft(state: GameState, depth: number): number {
  if (depth <= 0) return 1
  const moves = legalMoves(state)
  if (depth === 1) return moves.length

  let nodes = 0
  for (const move of moves) {
    const next = applyMove(state, move)
    nodes += perft(next, depth - 1)
  }
  return nodes
}

/**
 * Perft divide helper — counts subtree sizes per root move.
 */
export function perftDivide(
  state: GameState,
  depth: number,
): Map<string, number> {
  const divide = new Map<string, number>()
  const moves = legalMoves(state)
  for (const move of moves) {
    const next = applyMove(state, move)
    const count = depth <= 1 ? 1 : perft(next, depth - 1)
    const key = `${move.from.q},${move.from.r}->${move.to.q},${move.to.r}`
    divide.set(key, count)
  }
  return divide
}
