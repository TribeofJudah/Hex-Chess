import type { Agent } from '../adapter'
import type { PlyRecord } from '../runner'
import { s1Legality } from './s1-legality'
import { s4Consistency } from './s4-consistency'

/**
 * A §4a.1 line as `runner.ts` implements it, plus the suite that produced it.
 * Additive: a SuiteRecord is assignable to `readonly PlyRecord[]`, so
 * `toJsonl` and the graders work on suite output unchanged.
 */
export type SuiteRecord = PlyRecord & { suite: string }

export interface SuiteRunOptions {
  agent: Agent
  /** Fixes the sampled positions and each sample's rng. */
  seed?: number
  /** S1: positions to ask about. S4: resamples of the fixed position. */
  count?: number
  /** Called once per record, as the runner's `onPly` does. */
  onRecord?: (record: SuiteRecord) => void
}

export interface SuiteResult<M = unknown> {
  id: string
  records: SuiteRecord[]
  /** Computed from `records` alone, so it is rebuildable from the JSONL. */
  metrics: M
}

export interface Suite<M = unknown> {
  readonly id: string
  run(options: SuiteRunOptions): Promise<SuiteResult<M>>
}

const registry = new Map<string, Suite>(
  [s1Legality, s4Consistency].map((suite) => [suite.id, suite]),
)

/** The suite with this id, or a loud error naming the ones that exist. */
export function getSuite(id: string): Suite {
  const suite = registry.get(id)
  if (!suite) {
    throw new Error(
      `unknown suite "${id}" — known suites: ${[...registry.keys()].join(', ')}`,
    )
  }
  return suite
}

/** Every registered suite, in registration order. */
export function listSuites(): readonly Suite[] {
  return [...registry.values()]
}
