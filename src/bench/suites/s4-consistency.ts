import { initialGame } from '../../rules/rules'
import { mulberry32 } from '../adapter'
import { askAgent } from './ask'
import type { Suite, SuiteRecord, SuiteResult, SuiteRunOptions } from './registry'
import { entropyBits } from './stats'

export const S4_ID = 'S4'

export interface ConsistencyMetrics {
  samples: number
  /** Distinct replies seen — 1 for an agent that always answers the same. */
  distinct: number
  /** Shannon entropy of the reply distribution, in bits (§4). 0 = deterministic. */
  entropyBits: number
}

/** Aggregate a suite's records into suite metrics. */
const aggregate = (records: readonly SuiteRecord[]): ConsistencyMetrics => {
  const counts = new Map<string, number>()
  for (const r of records) {
    counts.set(r.response.move, (counts.get(r.response.move) ?? 0) + 1)
  }
  return {
    samples: records.length,
    distinct: counts.size,
    entropyBits: entropyBits(counts.values()),
  }
}

/**
 * S4 consistency: resample one fixed position K times and measure how much
 * the replies vary. The position is the game's start — legal from move one,
 * and unchanged across runs so the spread is the agent's own non-determinism,
 * not the position's. Each resample gets its own seed, so an agent that
 * branches on `rng` shows its true spread; a deterministic one scores 0 bits.
 */
export const s4Consistency: Suite<ConsistencyMetrics> = {
  id: S4_ID,
  async run({
    agent,
    seed = 1,
    count = 20,
    onRecord,
  }: SuiteRunOptions): Promise<SuiteResult<ConsistencyMetrics>> {
    const state = initialGame()
    const gameId = `${S4_ID}-${seed}`
    const records: SuiteRecord[] = []
    for (let i = 0; i < count; i++) {
      const record = await askAgent({
        agent,
        state,
        history: [],
        rng: mulberry32(seed * 977 + i),
        // Resample index, so every ask is its own line: the position is
        // always the first ply but the samples are not attempts of one ply.
        gameId,
        ply: i + 1,
        suite: S4_ID,
      })
      records.push(record)
      onRecord?.(record)
    }
    return { id: S4_ID, records, metrics: aggregate(records) }
  },
}
