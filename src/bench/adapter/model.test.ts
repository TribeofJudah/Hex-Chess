import { describe, expect, it } from 'vitest'
import { serializePosition } from '../../board/fen'
import { initialGame, legalMoves, moveToSan } from '../../rules/rules'
import type { AgentContext } from '../adapter'
import { randomBot } from '../bots'
import { runMatch } from '../runner'
import { buildPrompt, modelAgent, parseReply, type ModelClient } from './model'

function ctxAt(retry = 0, rejected: string[] = []): AgentContext {
  const state = initialGame()
  return {
    state,
    legal: legalMoves(state).map((move) => ({
      move,
      text: moveToSan(state, move),
    })),
    history: [],
    rng: () => 0.5,
    retry,
    rejected,
  }
}

/** Mock ModelClient: replies in order (empty after that) and records calls. */
function scripted(replies: string[]) {
  const prompts: string[] = []
  const maxTokens: number[] = []
  const client: ModelClient = {
    async complete(prompt, opts) {
      prompts.push(prompt)
      maxTokens.push(opts.maxTokens)
      return replies.shift() ?? ''
    },
  }
  return { client, prompts, maxTokens }
}

const FIRST_LEGAL = (() => {
  const s = initialGame()
  return moveToSan(s, legalMoves(s)[0]!)
})()

describe('buildPrompt', () => {
  it('is deterministic and carries the FEN and legal list', () => {
    const ctx = ctxAt()
    expect(buildPrompt(ctx)).toBe(buildPrompt(ctxAt()))
    const prompt = buildPrompt(ctx)
    expect(prompt).toContain(serializePosition(ctx.state))
    expect(prompt).toContain(FIRST_LEGAL)
    expect(prompt).not.toContain('Retry')
  })

  it('adds a retry note naming the rejected text when retry > 0', () => {
    const prompt = buildPrompt(ctxAt(1, ['zz9z9']))
    expect(prompt).toContain('Retry 1')
    expect(prompt).toContain('"zz9z9" is not a legal move')
  })
})

describe('parseReply', () => {
  it('reads bare move text from the first line', () => {
    expect(parseReply('  e1c3  \nbecause it is good')).toEqual({ move: 'e1c3' })
  })

  it('reads JSON move, trace and in-range confidence', () => {
    expect(
      parseReply('{"move":"e1c3","trace":"centre","confidence":0.8}'),
    ).toEqual({ move: 'e1c3', trace: 'centre', confidence: 0.8 })
  })

  it('drops out-of-range confidence instead of failing', () => {
    const d = parseReply('{"move":"e1c3","confidence":1.5}')
    expect(d).toEqual({ move: 'e1c3' })
    expect('confidence' in d).toBe(false)
  })

  it('treats malformed replies as text that matches no legal move', () => {
    expect(parseReply('{"move": ')).toEqual({ move: '{"move":' })
    expect(parseReply('42')).toEqual({ move: '42' })
    expect(parseReply('')).toEqual({ move: '' })
  })
})

describe('modelAgent in a match', () => {
  it('re-prompts after an illegal reply and logs both attempts', async () => {
    const mock = scripted(['{"move": ', FIRST_LEGAL])
    const white = modelAgent({ id: 'mock', client: mock.client })
    const { plies } = await runMatch({
      seed: 4,
      white,
      black: randomBot,
      maxPlies: 2,
      maxRetries: 2,
    })
    expect(
      plies.slice(0, 2).map((p) => [p.ply, p.retry, p.verdict.legal]),
    ).toEqual([
      [1, 0, false],
      [1, 1, true],
    ])
    expect(mock.prompts[1]).toContain('Retry 1')
    expect(mock.maxTokens[0]).toBe(256)
  })

  it('ends the game token-cap when the game budget is exceeded', async () => {
    const mock = scripted([FIRST_LEGAL, FIRST_LEGAL])
    const white = modelAgent({ id: 'mock', client: mock.client })
    const { game, plies } = await runMatch({
      seed: 4,
      white,
      black: randomBot,
      tokenCap: 10,
    })
    expect(plies).toHaveLength(1)
    expect(plies[0]!.verdict).toEqual({ legal: true, san: FIRST_LEGAL })
    expect(game).toEqual({ over: true, result: 'token-cap', winner: null })
  })
})
