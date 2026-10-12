import { keyOf, type PieceType } from '../board/pieces'
import type { Agent, LegalMove } from './adapter'

/** Uniform choice over legal moves. */
export const randomBot: Agent = {
  id: 'random',
  decide: ({ legal, rng }) => ({ move: pick(legal, rng).text }),
}

const VALUE: Record<PieceType, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 }

/**
 * Takes the most valuable capture; random among ties. With no capture
 * available it plays randomly.
 * ponytail: en passant counts as a zero-value capture; add when it matters.
 */
export const greedyCaptureBot: Agent = {
  id: 'greedy-capture',
  decide({ state, legal, rng }) {
    let best = -1
    let pool: LegalMove[] = []
    for (const m of legal) {
      const victim = state.board.get(keyOf(m.move.to))
      const gain = victim ? VALUE[victim.type] : 0
      if (gain > best) {
        best = gain
        pool = []
      }
      if (gain === best) pool.push(m)
    }
    return { move: pick(pool, rng).text }
  },
}

function pick(moves: readonly LegalMove[], rng: () => number): LegalMove {
  return moves[Math.floor(rng() * moves.length)]!
}
