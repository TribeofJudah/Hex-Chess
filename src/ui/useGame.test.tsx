import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { allCells, cellToFileRank } from './hexMath'
import { initialPieces, lenientRules, useGame, type GameRules } from './useGame'

const NOTATIONS = allCells().map((cell) => {
  const { file, rank } = cellToFileRank(cell)
  return `${file}${rank}`
})

function cellOf(
  hook: ReturnType<typeof renderHook<ReturnType<typeof useGame>, unknown>>,
  color: 'white' | 'black',
): string {
  const entries = Object.entries(hook.result.current.position)
  return entries.find(([, p]) => p.color === color && p.kind === 'king')![0]
}

type Game = ReturnType<typeof useGame>

function move(hook: { result: { current: Game } }, from: string, to: string) {
  act(() => hook.result.current.clickCell(from))
  act(() => hook.result.current.clickCell(to))
}

/** A currently-empty cell this color's king has not used yet. */
function freshCell(
  hook: { result: { current: Game } },
  used: Set<string>,
): string {
  const position = hook.result.current.position
  for (const notation of NOTATIONS) {
    if (used.has(notation) || position[notation]) continue
    return notation
  }
  throw new Error('no free cell left')
}

describe('useGame', () => {
  it('starts from the Gliński position with White to move', () => {
    const { result } = renderHook(() => useGame())
    expect(Object.keys(result.current.position)).toHaveLength(36)
    expect(result.current.turn).toBe('white')
    expect(result.current.position.f1).toEqual({
      kind: 'bishop',
      color: 'white',
    })
    expect(result.current.moves).toEqual([])
    expect(result.current.gameOver).toBeNull()
    expect(result.current.canUndo).toBe(false)
  })

  it('selects an own piece and lists lenient targets', () => {
    const { result } = renderHook(() => useGame())
    act(() => result.current.clickCell('g1'))
    expect(result.current.selected).toBe('g1')
    // Lenient rules: every empty or enemy cell of the 91.
    expect(result.current.validTargets).toHaveLength(91 - 18)
    expect(result.current.validTargets).not.toContain('e1') // own queen
    expect(result.current.validTargets).toContain('f6')
  })

  it('deselects when the selected cell is clicked again', () => {
    const { result } = renderHook(() => useGame())
    act(() => result.current.clickCell('g1'))
    act(() => result.current.clickCell('g1'))
    expect(result.current.selected).toBeNull()
    expect(result.current.validTargets).toEqual([])
  })

  it('applies a move, flips the turn, records SAN and last move', () => {
    const { result } = renderHook(() => useGame())
    move({ result }, 'g1', 'f6')
    expect(result.current.position.f6).toEqual({ kind: 'king', color: 'white' })
    expect(result.current.position.g1).toBeUndefined()
    expect(result.current.turn).toBe('black')
    expect(result.current.moves[0]).toEqual({
      san: 'Kg1 f6',
      color: 'white',
      from: 'g1',
      to: 'f6',
    })
    expect(result.current.lastMove).toEqual(['g1', 'f6'])
    expect(result.current.canUndo).toBe(true)
  })

  it('records Black replies and pawn SAN without a letter prefix', () => {
    const { result } = renderHook(() => useGame())
    move({ result }, 'b1', 'b2')
    move({ result }, 'b7', 'b6')
    expect(result.current.moves[0].san).toBe('b1 b2')
    expect(result.current.moves[1].san).toBe('b7 b6')
    expect(result.current.moves[1].color).toBe('black')
    expect(result.current.turn).toBe('white')
  })

  it('counts captures and resets the halfmove clock', () => {
    const { result } = renderHook(() => useGame())
    // White knight leaps onto a black pawn (lenient rules allow it).
    move({ result }, 'd1', 'd7')
    expect(result.current.captured.black).toBe(1)
    expect(result.current.halfmove).toBe(0)
    // Black must respond before White can move again.
    const blackHome = cellOf({ result }, 'black')
    const away = freshCell({ result }, new Set([blackHome]))
    move({ result }, blackHome, away)
    move({ result }, 'g1', 'f6') // quiet moves tick the clock (2 plies)
    expect(result.current.halfmove).toBe(2)
    move({ result }, 'b7', 'b6') // pawn move resets the clock
    expect(result.current.halfmove).toBe(0)
  })

  it('undoes the last move', () => {
    const { result } = renderHook(() => useGame())
    move({ result }, 'g1', 'f6')
    act(() => result.current.undo())
    expect(result.current.position.g1).toEqual({ kind: 'king', color: 'white' })
    expect(result.current.position.f6).toBeUndefined()
    expect(result.current.turn).toBe('white')
    expect(result.current.moves).toEqual([])
    expect(result.current.lastMove).toBeNull()
    expect(result.current.canUndo).toBe(false)
  })

  it('resets everything on newGame', () => {
    const { result } = renderHook(() => useGame())
    move({ result }, 'g1', 'f6')
    act(() => result.current.newGame())
    expect(result.current.position).toEqual(initialPieces())
    expect(result.current.turn).toBe('white')
    expect(result.current.moves).toEqual([])
    expect(result.current.canUndo).toBe(false)
  })

  it('stops accepting clicks after game over', () => {
    const rules: GameRules = {
      ...lenientRules,
      statusAfter: () => ({ kind: 'checkmate', winner: 'black' }),
    }
    const hook = renderHook(() => useGame(rules))
    act(() => hook.result.current.clickCell('g1'))
    act(() => hook.result.current.clickCell('f6'))
    expect(hook.result.current.gameOver).toEqual({
      kind: 'checkmate',
      winner: 'black',
    })
    const frozen = hook.result.current
    act(() => hook.result.current.clickCell('g10'))
    expect(hook.result.current).toBe(frozen)
  })

  it('honours a custom adapter for targets', () => {
    const rules: GameRules = {
      ...lenientRules,
      movesFor: (_position, from) => (from === 'g1' ? ['f6'] : []),
    }
    const { result } = renderHook(() => useGame(rules))
    act(() => result.current.clickCell('g1'))
    expect(result.current.validTargets).toEqual(['f6'])
  })

  it('declares game over on threefold repetition', () => {
    const { result } = renderHook(() => useGame())
    const blackHome = cellOf({ result }, 'black')
    const away = freshCell({ result }, new Set([blackHome]))
    // White king and black king shuttle back to the start three times.
    for (let cycle = 0; cycle < 3; cycle++) {
      move({ result }, 'g1', 'f6')
      move({ result }, blackHome, away)
      move({ result }, 'f6', 'g1')
      move({ result }, away, blackHome)
    }
    expect(result.current.gameOver).toEqual({ kind: 'repetition' })
  })

  it('declares game over on the fifty-move rule', () => {
    const { result } = renderHook(() => useGame())
    const whiteUsed = new Set(['g1'])
    const blackHome = cellOf({ result }, 'black')
    const blackUsed = new Set([blackHome])
    // 100 plies, both kings always landing on never-visited squares so the
    // full-position key never repeats before the clock hits 100.
    for (let i = 0; i < 50; i++) {
      const white = cellOf({ result }, 'white')
      const whiteTo = freshCell({ result }, whiteUsed)
      move({ result }, white, whiteTo)
      whiteUsed.add(whiteTo)
      const black = cellOf({ result }, 'black')
      const blackTo = freshCell({ result }, blackUsed)
      move({ result }, black, blackTo)
      blackUsed.add(blackTo)
    }
    expect(result.current.gameOver).toEqual({ kind: 'fifty-move' })
    expect(result.current.halfmove).toBeGreaterThanOrEqual(100)
  })

  it('builds the starting position the same way every call', () => {
    expect(initialPieces()).toEqual(initialPieces())
    expect(Object.keys(initialPieces())).toHaveLength(36)
  })
})

describe('useGame vs AI', () => {
  it('replies as Black after the human move, blocks input meanwhile, undoes the pair', async () => {
    vi.useFakeTimers()
    try {
      const { glinskiRules } = await import('../rules/adapter')
      const hook = renderHook(() => useGame(glinskiRules))
      act(() => hook.result.current.toggleAi())
      expect(hook.result.current.aiEnabled).toBe(true)

      move(hook, 'f5', 'f6')
      expect(hook.result.current.aiThinking).toBe(true)
      act(() => hook.result.current.clickCell('f7'))
      expect(hook.result.current.selected).toBeNull()

      act(() => vi.runAllTimers())
      const { moves, turn, lastMove, aiThinking } = hook.result.current
      expect(moves).toHaveLength(2)
      expect(moves[1].color).toBe('black')
      expect(turn).toBe('white')
      expect(aiThinking).toBe(false)
      expect(hook.result.current.position[lastMove![1]].color).toBe('black')

      act(() => hook.result.current.undo())
      expect(hook.result.current.moves).toEqual([])
      expect(hook.result.current.turn).toBe('white')
      expect(hook.result.current.canUndo).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('undoes a single ply in hotseat mode', () => {
    const hook = renderHook(() => useGame())
    move(hook, 'f5', 'f6')
    move(hook, 'f7', 'e6')
    act(() => hook.result.current.undo())
    expect(hook.result.current.moves).toHaveLength(1)
    expect(hook.result.current.turn).toBe('black')
  })
})

describe('useGame position editing (T13)', () => {
  // Ranks 11→1; a single white king on rank 1's sixth cell = f1.
  const KING_FEN = '1/3/5/7/9/11/11/11/11/11/5K5 w - 0 1'

  it('loads a FEN position, its side to move and clears history', () => {
    const { result } = renderHook(() => useGame())
    move({ result }, 'g1', 'f6')
    expect(result.current.moves).toHaveLength(1)
    let outcome: { ok: boolean } = { ok: false }
    act(() => {
      outcome = result.current.loadFen(KING_FEN)
    })
    expect(outcome.ok).toBe(true)
    expect(result.current.position).toEqual({
      f1: { kind: 'king', color: 'white' },
    })
    expect(result.current.turn).toBe('white')
    expect(result.current.moves).toEqual([])
    expect(result.current.canUndo).toBe(false)
  })

  it('reports a parse error and leaves the position untouched', () => {
    const { result } = renderHook(() => useGame())
    const before = result.current.position
    let outcome: { ok: boolean; error?: string } = { ok: true }
    act(() => {
      outcome = result.current.loadFen('nonsense')
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBeTruthy()
    expect(result.current.position).toBe(before)
  })
})

describe('useGame resign and draw (T16)', () => {
  it('ends the game when the side to move resigns', () => {
    const { result } = renderHook(() => useGame())
    act(() => result.current.resign())
    expect(result.current.gameOver).toEqual({ kind: 'resign', winner: 'black' })
    const frozen = result.current
    act(() => result.current.clickCell('g1'))
    expect(result.current).toBe(frozen)
  })

  it('ends the game on an agreed draw', () => {
    const { result } = renderHook(() => useGame())
    act(() => result.current.agreeDraw())
    expect(result.current.gameOver).toEqual({ kind: 'agreement' })
  })
})

describe('useGame AI depth (T15)', () => {
  it('defaults to 3 and clamps the selector range to 1–5', () => {
    const { result } = renderHook(() => useGame())
    expect(result.current.aiDepth).toBe(3)
    act(() => result.current.setAiDepth(9))
    expect(result.current.aiDepth).toBe(5)
    act(() => result.current.setAiDepth(0))
    expect(result.current.aiDepth).toBe(1)
  })
})

describe('useGame move-list jump (T14)', () => {
  it('jumps the view back and keeps the full move list', () => {
    const { result } = renderHook(() => useGame())
    move({ result }, 'g1', 'f6')
    move({ result }, 'b7', 'b6')
    expect(result.current.viewPly).toBe(2)
    act(() => result.current.jumpTo(1))
    expect(result.current.viewPly).toBe(1)
    expect(result.current.moves).toHaveLength(2)
    expect(result.current.position.g1).toBeUndefined()
    expect(result.current.position.f6).toEqual({ kind: 'king', color: 'white' })
    expect(result.current.turn).toBe('black')
    // A board click returns to the live position.
    act(() => result.current.clickCell('a1'))
    expect(result.current.viewPly).toBe(2)
  })
})
