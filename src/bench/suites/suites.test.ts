import { describe, expect, it } from 'vitest'
import type { Agent } from '../adapter'
import { randomBot } from '../bots'
import { toJsonl } from '../runner'
import { getSuite, listSuites } from './registry'
import { s1Legality } from './s1-legality'
import { s4Consistency } from './s4-consistency'
import { entropyBits, wilson } from './stats'

/** Always the first legal move: the deterministic agent of S4's definition. */
const firstBot: Agent = {
  id: 'first',
  decide: ({ legal }) => ({ move: legal[0]!.text }),
}

/** Answers something that cannot be a legal move. */
const wildBot: Agent = {
  id: 'wild',
  decide: () => ({ move: 'zz9z9' }),
}

const PLY_KEYS = [
  'engine',
  'fen',
  'game',
  'gameId',
  'model',
  'ply',
  'response',
  'retry',
  'side',
  'verdict',
]

describe('stats', () => {
  it('Wilson interval matches the worked value for 8/10', () => {
    const [lo, hi] = wilson(8, 10)
    expect(lo).toBeCloseTo(0.49, 2)
    expect(hi).toBeCloseTo(0.943, 2)
  })

  it('Wilson interval stays inside [0, 1] at the extremes', () => {
    expect(wilson(0, 10)[0]).toBe(0)
    expect(wilson(0, 10)[1]).toBeCloseTo(0.278, 2)
    // A 10/10 run is not proof of certainty: the upper bound is 1, the lower is not.
    expect(wilson(10, 10)[1]).toBeCloseTo(1, 12)
    expect(wilson(10, 10)[0]).toBeGreaterThan(0.7)
  })

  it('entropy is 0 for one outcome and 1 bit for an even split', () => {
    expect(entropyBits([10])).toBe(0)
    expect(entropyBits([5, 5])).toBeCloseTo(1, 12)
    expect(entropyBits([])).toBe(0)
  })
})

describe('S1 legality gauntlet', () => {
  it('a fully legal bot scores a rate of 1.0', async () => {
    const { records, metrics } = await s1Legality.run({
      agent: randomBot,
      seed: 7,
      count: 5,
    })
    expect(records).toHaveLength(5)
    expect(metrics).toEqual({
      positions: 5,
      legal: 5,
      legalRate: 1,
      ci95: wilson(5, 5),
    })
    expect(metrics.legalRate).toBe(1)
    expect(metrics.ci95[1]).toBeCloseTo(1, 12)
  })

  it('a bot that cannot answer legally scores a rate of 0', async () => {
    const { metrics } = await s1Legality.run({
      agent: wildBot,
      seed: 7,
      count: 5,
    })
    expect(metrics.legalRate).toBe(0)
    expect(metrics.ci95[0]).toBe(0)
  })

  it('asks in non-terminal positions and names each ply', async () => {
    const { records } = await s1Legality.run({
      agent: randomBot,
      seed: 3,
      count: 5,
    })
    expect(records.map((r) => r.ply)).toEqual([1, 2, 3, 4, 5])
    expect(records.map((r) => r.side)).toEqual(['w', 'b', 'w', 'b', 'w'])
    for (const r of records) {
      expect(r.suite).toBe('S1')
      expect(r.verdict.san).toBe(r.response.move)
    }
  })

  it('same seed gives identical JSONL', async () => {
    const run = () => s1Legality.run({ agent: randomBot, seed: 11, count: 5 })
    const [a, b] = await Promise.all([run(), run()])
    expect(toJsonl(a.records)).toBe(toJsonl(b.records))
  })

  it('emits §4a.1 lines plus the suite tag', async () => {
    const { records } = await s1Legality.run({
      agent: randomBot,
      seed: 7,
      count: 1,
    })
    expect(Object.keys(records[0]!).sort()).toEqual([...PLY_KEYS, 'suite'].sort())
    expect(JSON.parse(toJsonl(records))).toEqual(records[0])
  })
})

describe('S4 consistency', () => {
  it('is 0 bits for a deterministic agent', async () => {
    const { records, metrics } = await s4Consistency.run({
      agent: firstBot,
      seed: 5,
      count: 8,
    })
    expect(records).toHaveLength(8)
    expect(metrics).toEqual({ samples: 8, distinct: 1, entropyBits: 0 })
    expect(records.every((r) => r.verdict.legal)).toBe(true)
  })

  it('is positive for an agent that varies', async () => {
    const { metrics } = await s4Consistency.run({
      agent: randomBot,
      seed: 5,
      count: 8,
    })
    expect(metrics.distinct).toBeGreaterThan(1)
    expect(metrics.entropyBits).toBeGreaterThan(0)
  })

  it('resamples one fixed position with varying seeds', async () => {
    const { records } = await s4Consistency.run({
      agent: randomBot,
      seed: 5,
      count: 4,
    })
    expect(new Set(records.map((r) => r.fen)).size).toBe(1)
    expect(records.map((r) => r.ply)).toEqual([1, 2, 3, 4])
    expect(records.every((r) => r.suite === 'S4')).toBe(true)
  })
})

describe('suite registry', () => {
  it('lists the registered suites', () => {
    expect(listSuites().map((s) => s.id)).toEqual(['S1', 'S4'])
  })

  it('looks a suite up by id', () => {
    expect(getSuite('S1')).toBe(s1Legality)
    expect(getSuite('S4')).toBe(s4Consistency)
  })

  it('fails loudly on an unknown id', () => {
    expect(() => getSuite('S9')).toThrow(/unknown suite "S9".*S1, S4/)
  })
})
