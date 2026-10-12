import { describe, expect, it } from 'vitest'
import { keyOf } from '../board/pieces'
import { mulberry32, type Agent } from './adapter'
import { greedyCaptureBot, randomBot } from './bots'
import { runMatch, toJsonl, type PlyRecord } from './runner'
import { applyMove, initialGame, legalMoves, moveToSan } from '../rules/rules'

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

describe('runMatch', () => {
  it('same seed gives identical toJsonl with retries enabled', async () => {
    const run = () =>
      runMatch({
        seed: 42,
        white: randomBot,
        black: greedyCaptureBot,
        maxPlies: 80,
        maxRetries: 2,
      })
    expect(toJsonl((await run()).plies)).toBe(toJsonl((await run()).plies))
  })

  it('re-prompts an illegal move and logs each attempt as its own line', async () => {
    const seenCtx: Array<{ retry: number; rejected: readonly string[] }> = []
    const flaky: Agent = {
      id: 'flaky',
      decide: (ctx) => {
        seenCtx.push({ retry: ctx.retry, rejected: [...ctx.rejected] })
        return ctx.retry === 0
          ? { move: 'zz9z9' }
          : { move: ctx.legal[0]!.text }
      },
    }
    const { game, plies } = await runMatch({
      seed: 9,
      white: flaky,
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
    expect(seenCtx).toEqual([
      { retry: 0, rejected: [] },
      { retry: 1, rejected: ['zz9z9'] },
    ])
    expect(plies[2]!.ply).toBe(2)
    expect(game.result).toBe('max-plies')
  })

  it('ends illegal after maxRetries rejected attempts', async () => {
    const cheat: Agent = { id: 'cheat', decide: () => ({ move: 'zz9z9' }) }
    const { game, plies } = await runMatch({
      seed: 1,
      white: cheat,
      black: randomBot,
      maxRetries: 2,
    })
    expect(plies.map((p) => [p.retry, p.verdict.legal, p.game.over])).toEqual([
      [0, false, false],
      [1, false, false],
      [2, false, true],
    ])
    expect(game).toEqual({ over: true, result: 'illegal', winner: 'b' })
  })

  it('same seed and agents give identical JSONL', async () => {
    const a = await runMatch({
      seed: 7,
      white: randomBot,
      black: randomBot,
      maxPlies: 60,
    })
    const b = await runMatch({
      seed: 7,
      white: randomBot,
      black: randomBot,
      maxPlies: 60,
    })
    expect(toJsonl(a.plies)).toBe(toJsonl(b.plies))
  })

  it('a different seed changes the game', async () => {
    const a = await runMatch({
      seed: 1,
      white: randomBot,
      black: randomBot,
      maxPlies: 60,
    })
    const b = await runMatch({
      seed: 2,
      white: randomBot,
      black: randomBot,
      maxPlies: 60,
    })
    expect(toJsonl(a.plies)).not.toBe(toJsonl(b.plies))
  })

  it('emits one JSONL line per ply with the contract shape', async () => {
    const seen: PlyRecord[] = []
    const { plies } = await runMatch(
      { seed: 3, white: randomBot, black: greedyCaptureBot, maxPlies: 10 },
      (r) => seen.push(r),
    )
    const lines = toJsonl(plies).trimEnd().split('\n')
    expect(lines).toHaveLength(plies.length)
    expect(seen).toHaveLength(plies.length)
    lines.forEach((line, i) => {
      const rec = JSON.parse(line) as PlyRecord
      expect(Object.keys(rec).sort()).toEqual(PLY_KEYS)
      expect(rec.ply).toBe(i + 1)
      expect(rec.game.over).toBe(i === lines.length - 1)
      expect(rec.verdict.legal).toBe(true)
    })
    expect(plies[0]!.side).toBe('w')
    expect(plies[1]!.side).toBe('b')
    expect(plies[0]!.model).toBe('random')
    expect(plies[1]!.model).toBe('greedy-capture')
  })

  it('stops at maxPlies with a max-plies result', async () => {
    const { game, plies } = await runMatch({
      seed: 5,
      white: randomBot,
      black: randomBot,
      maxPlies: 2,
    })
    expect(plies).toHaveLength(2)
    expect(game).toEqual({ over: true, result: 'max-plies', winner: null })
  })

  it('an illegal move forfeits the game to the other side', async () => {
    const cheat: Agent = { id: 'cheat', decide: () => ({ move: 'zz9z9' }) }
    const { game, plies } = await runMatch({
      seed: 1,
      white: cheat,
      black: randomBot,
    })
    expect(plies).toHaveLength(1)
    expect(plies[0]!.verdict).toEqual({ legal: false, san: null })
    expect(game).toEqual({ over: true, result: 'illegal', winner: 'b' })
  })
})

describe('bots', () => {
  it('greedy bot takes the most valuable available capture', async () => {
    // Play random plies until some side has a capture on the board.
    const rng = mulberry32(11)
    let state = initialGame()
    for (let i = 0; i < 400; i++) {
      const legal = legalMoves(state)
      const captures = legal.filter((m) => state.board.has(keyOf(m.to)))
      if (captures.length > 0) break
      state = applyMove(state, legal[Math.floor(rng() * legal.length)]!)
    }
    const legal = legalMoves(state).map((move) => ({
      move,
      text: moveToSan(state, move),
    }))
    const { move } = await greedyCaptureBot.decide({
      state,
      legal,
      history: [],
      rng,
      retry: 0,
      rejected: [],
    })
    const chosen = legal.find((m) => m.text === move)!
    const gainOf = (m: (typeof legal)[number]) => {
      const v = state.board.get(keyOf(m.move.to))
      return v ? { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 }[v.type] : 0
    }
    const best = Math.max(...legal.map(gainOf))
    expect(gainOf(chosen)).toBe(best)
    expect(best).toBeGreaterThan(0)
  })
})
