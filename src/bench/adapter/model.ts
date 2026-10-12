import { serializePosition } from '../../board/fen'
import type { AgentContext, AgentDecision } from '../adapter'
import type { MeteredAgent } from '../runner'

/** Provider-neutral completion call. Concrete clients live outside src/bench. */
export interface ModelClient {
  complete(prompt: string, opts: { maxTokens: number }): Promise<string>
}

export interface ModelAgentOptions {
  id: string
  client: ModelClient
  /** Completion budget per call. */
  maxTokens?: number
}

/**
 * Rough token count at ~4 characters per token. ponytail: complete() returns
 * only text, so spend is estimated; use provider usage once a client reports it.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Deterministic prompt: same context in, same string out. */
export function buildPrompt(ctx: AgentContext): string {
  const lines = [
    'You are playing Gliński hexagonal chess (Xchess).',
    `FEN: ${serializePosition(ctx.state)}`,
    `Moves so far: ${ctx.history.length ? ctx.history.join(' ') : '(none)'}`,
    `Legal moves: ${ctx.legal.map((m) => m.text).join(' ')}`,
    'Reply with JSON {"move": "<one legal move, exactly as listed>", ' +
      '"trace": "<optional reasoning>", "confidence": <optional number 0-1>}, ' +
      'or with the bare move text.',
  ]
  if (ctx.retry > 0) {
    const bad = ctx.rejected.map((r) => `"${r}"`).join(', ')
    lines.push(
      `Retry ${ctx.retry}: ${bad} is not a legal move. ` +
        'Choose one move from the legal list, copied exactly.',
    )
  }
  return lines.join('\n')
}

/**
 * Reads a reply into a decision. Never throws: anything that is not a JSON
 * object with a string `move` is taken as bare move text, which the runner
 * then accepts only if it matches a legal text exactly.
 */
export function parseReply(reply: string): AgentDecision {
  const text = reply.trim()
  let move = text.split('\n')[0]!.trim()
  let trace: string | undefined
  let confidence: number | undefined
  try {
    const obj: unknown = JSON.parse(text)
    if (obj && typeof obj === 'object' && 'move' in obj) {
      if (typeof obj.move === 'string') move = obj.move.trim()
      if ('trace' in obj && typeof obj.trace === 'string') trace = obj.trace
      if (
        'confidence' in obj &&
        typeof obj.confidence === 'number' &&
        obj.confidence >= 0 &&
        obj.confidence <= 1
      ) {
        confidence = obj.confidence
      }
    }
  } catch {
    // Not JSON: the bare-text reading above stands.
  }
  const decision: AgentDecision = { move }
  if (trace !== undefined) decision.trace = trace
  if (confidence !== undefined) decision.confidence = confidence
  return decision
}

/** An Agent backed by a ModelClient. Spend is metered for the runner's token cap. */
export function modelAgent({
  id,
  client,
  maxTokens = 256,
}: ModelAgentOptions): MeteredAgent {
  let tokensUsed = 0
  return {
    id,
    get tokensUsed() {
      return tokensUsed
    },
    async decide(ctx) {
      const prompt = buildPrompt(ctx)
      const reply = await client.complete(prompt, { maxTokens })
      tokensUsed += estimateTokens(prompt) + estimateTokens(reply)
      return parseReply(reply)
    },
  }
}
