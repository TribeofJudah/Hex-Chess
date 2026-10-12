import {
  applyMove,
  initialGame,
  legalMoves,
  moveToSan,
  type GameState,
} from '../../rules/rules'
import { mulberry32 } from '../adapter'
import { askAgent } from './ask'
import type { Suite, SuiteRecord, SuiteResult, SuiteRunOptions } from './registry'
import { wilson } from './stats'

export const S1_ID = 'S1'

export interface LegalityMetrics {
  positions: number
  legal: number
  legalRate: number
  /** Wilson 95% interval on the rate (XCHESS_BENCH §4). */
  ci95: [number, number]
}

interface Sample {
  state: GameState
  /** Move texts to reach the position, for the agent's context. */
  history: string[]
  ply: number
}

const MAX_PLIES = 400

/**
 * N seeded positions along a random playout from the initial position, so
 * both sides and a range of phases are covered. Only non-terminal positions
 * are returned: with no legal move there is nothing to name, and counting a
 * forced position against the agent would be wrong.
 */
export function samplePositions(seed: number, n: number): Sample[] {
  const out: Sample[] = []
  // A playout can end early (mate, stalemate); restart with a derived seed.
  for (let attempt = 0; attempt < 8 && out.length < n; attempt++) {
    const rng = mulberry32(seed + attempt * 7919)
    const history: string[] = []
    let state = initialGame()
    for (let ply = 1; ply <= MAX_PLIES && out.length < n; ply++) {
      const moves = legalMoves(state)
      if (moves.length === 0) break
      out.push({ state, history: [...history], ply })
      const move = moves[Math.floor(rng() * moves.length)]!
      history.push(moveToSan(state, move))
      state = applyMove(state, move)
    }
  }
  if (out.length < n) {
    throw new Error(`S1: could not sample ${n} positions from seed ${seed}`)
  }
  return out
}

/** Legal-move rate over the sampled positions, with its 95% interval. */
function aggregate(records: readonly SuiteRecord[]): LegalityMetrics {
  const positions = records.length
  const legal = records.filter((r) => r.verdict.legal).length
  return {
    positions,
    legal,
    legalRate: positions === 0 ? 0 : legal / positions,
    ci95: wilson(legal, positions),
  }
}

/**
 * S1 legality gauntlet: ask the agent for a move in each of N seeded
 * positions and measure how often it names one that is legal. One ask per
 * position — no retry loop, the first answer is the measurement.
 */
export const s1Legality: Suite<LegalityMetrics> = {
  id: S1_ID,
  async run({
    agent,
    seed = 1,
    count = 20,
    onRecord,
  }: SuiteRunOptions): Promise<SuiteResult<LegalityMetrics>> {
    const gameId = `${S1_ID}-${seed}`
    const records: SuiteRecord[] = []
    for (const [i, sample] of samplePositions(seed, count).entries()) {
      const record = await askAgent({
        agent,
        state: sample.state,
        history: sample.history,
        rng: mulberry32(seed * 31 + i),
        gameId,
        ply: sample.ply,
        suite: S1_ID,
      })
      records.push(record)
      onRecord?.(record)
    }
    return { id: S1_ID, records, metrics: aggregate(records) }
  },
}
