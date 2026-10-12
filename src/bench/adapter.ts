import type { GameState, Move } from '../rules/rules'

/** One ply of model output: move text plus optional trace and self-rated confidence. */
export interface AgentDecision {
  move: string
  trace?: string
  confidence?: number
}

export interface LegalMove {
  move: Move
  /** SAN-style text the agent must echo back, e.g. "Pf5f6=Q". */
  text: string
}

export interface AgentContext {
  state: GameState
  legal: readonly LegalMove[]
  /** Move texts played so far in this game, oldest first. */
  history: readonly string[]
  /** Match-scoped PRNG: one stream per match, consumed in ply order. */
  rng: () => number
  /** 0 on the first attempt at a ply; n on the n-th re-prompt after an illegal move. */
  retry: number
  /** Texts this ply's earlier attempts returned that were rejected as illegal. */
  rejected: readonly string[]
}

/** Anything that picks a move: a bot now, a model adapter later. */
export interface Agent {
  readonly id: string
  decide(ctx: AgentContext): AgentDecision | Promise<AgentDecision>
}

/** mulberry32: small seeded PRNG so one seed fixes every random choice. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
