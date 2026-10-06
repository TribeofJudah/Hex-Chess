import { act, fireEvent, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeSocketFactory, welcomeMsg } from '../test/fakeSocket'
import { glinskiRules } from '../rules/adapter'
import { allCells, cellToFileRank } from './hexMath'
import { PROTOCOL_VERSION } from './protocol'
import { initialPieces, lenientRules, useGame, type GameRules } from './useGame'
import { useRemoteGame } from './useRemoteGame'

const NOTATIONS = allCells().map((cell) => {
  const { file, rank } = cellToFileRank(cell)
  return `${file}${rank}`
})

function cellOf(
  hook: { result: { current: Game } },
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
    expect(result.current.moves[0]!.san).toBe('b1 b2')
    expect(result.current.moves[1]!.san).toBe('b7 b6')
    expect(result.current.moves[1]!.color).toBe('black')
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
      expect(moves[1]!.color).toBe('black')
      expect(turn).toBe('white')
      expect(aiThinking).toBe(false)
      expect(hook.result.current.position[lastMove![1]]!.color).toBe('black')

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

describe('useGame human promotion (t45)', () => {
  // White pawn on e9, one push from e10 (file e's top cell, in the engine's
  // promotion zone); a lone white king at f1 keeps the position legal.
  const PROMO_FEN = '1/3/1P3/7/9/11/11/11/11/11/5K5 w - 0 1'

  it('parks the move and raises pendingPromotion on a pawn-to-last-rank click', () => {
    const { result } = renderHook(() => useGame(glinskiRules))
    act(() => result.current.loadFen(PROMO_FEN))
    act(() => result.current.clickCell('e9'))
    act(() => result.current.clickCell('e10'))
    expect(result.current.pendingPromotion).toEqual({
      from: 'e9',
      to: 'e10',
      options: ['queen', 'rook', 'bishop', 'knight'],
    })
    // Nothing moved yet; highlights stay up like a normal two-click.
    expect(result.current.position.e9).toEqual({ kind: 'pawn', color: 'white' })
    expect(result.current.moves).toEqual([])
    expect(result.current.turn).toBe('white')
    expect(result.current.selected).toBe('e9')
    expect(result.current.validTargets).toContain('e10')
  })

  it('completes the parked move with the chosen kind', () => {
    const { result } = renderHook(() => useGame(glinskiRules))
    act(() => result.current.loadFen(PROMO_FEN))
    act(() => result.current.clickCell('e9'))
    act(() => result.current.clickCell('e10'))
    act(() => result.current.choosePromotion('rook'))
    expect(result.current.pendingPromotion).toBeNull()
    expect(result.current.position.e9).toBeUndefined()
    expect(result.current.position.e10).toEqual({
      kind: 'rook',
      color: 'white',
    })
    expect(result.current.moves[0]).toEqual({
      san: 'e9 e10=R',
      color: 'white',
      from: 'e9',
      to: 'e10',
      promotion: 'rook',
    })
    expect(result.current.turn).toBe('black')
  })

  it('cancels with Esc and lets normal play resume', () => {
    const { result } = renderHook(() => useGame(glinskiRules))
    act(() => result.current.loadFen(PROMO_FEN))
    act(() => result.current.clickCell('e9'))
    act(() => result.current.clickCell('e10'))
    expect(result.current.pendingPromotion).not.toBeNull()
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(result.current.pendingPromotion).toBeNull()
    expect(result.current.selected).toBeNull()
    expect(result.current.validTargets).toEqual([])
    expect(result.current.position.e9).toEqual({ kind: 'pawn', color: 'white' })
    expect(result.current.position.e10).toBeUndefined()
    expect(result.current.moves).toEqual([])
    // Play resumes normally after the cancel.
    act(() => result.current.clickCell('f1'))
    act(() => result.current.clickCell('g2'))
    expect(result.current.moves[0]!.san).toBe('Kf1 g2')
  })

  it('never parks AI-style moves played with their promotion kind', () => {
    const { result } = renderHook(() => useGame(glinskiRules))
    act(() => result.current.loadFen(PROMO_FEN))
    // The AI and remote peers apply moves via the 'move' action with the
    // promotion kind riding along — no banner for that path (t45).
    act(() => result.current.applyMove('e9', 'e10', 'queen'))
    expect(result.current.pendingPromotion).toBeNull()
    expect(result.current.position.e10).toEqual({
      kind: 'queen',
      color: 'white',
    })
    expect(result.current.moves[0]?.promotion).toBe('queen')
  })

  it('streams the chosen kind to the room as the wire promotion', () => {
    const factory = makeSocketFactory()
    const { result } = renderHook(() =>
      useRemoteGame('ROOM', { connect: factory.connect }),
    )
    act(() => factory.current().open())
    act(() => factory.current().recv(welcomeMsg()))
    // A solo welcome leaves the room 'waiting' — which is sendable
    // (SENDABLE = ['waiting', 'playing']) — so the move will still stream.
    expect(result.current.status).toBe('waiting')
    act(() => result.current.loadFen(PROMO_FEN))
    act(() => result.current.clickCell('e9'))
    act(() => result.current.clickCell('e10'))
    act(() => result.current.choosePromotion('queen'))
    expect(factory.current().last()).toEqual({
      v: PROTOCOL_VERSION,
      type: 'move',
      from: 'e9',
      to: 'e10',
      promotion: 'queen',
      revision: 0,
    })
  })
})

describe('useGame draw offer (t49)', () => {
  it('opens the offer for the side to move; a re-offer is a no-op', () => {
    const { result } = renderHook(() => useGame())
    expect(result.current.drawOffer).toBeNull()
    act(() => result.current.chooseOffer('offer'))
    expect(result.current.drawOffer).toEqual({ state: 'offered', by: 'white' })
    // Idempotent re-offer (t48): nothing stacks, nothing else changes.
    act(() => result.current.chooseOffer('offer'))
    expect(result.current.drawOffer).toEqual({ state: 'offered', by: 'white' })
    expect(result.current.moves).toEqual([])
    expect(result.current.turn).toBe('white')
    expect(result.current.gameOver).toBeNull()
  })

  it('lets the opponent decline and clear the offer', () => {
    const { result } = renderHook(() => useGame())
    act(() => result.current.chooseOffer('offer'))
    act(() => result.current.chooseOffer('decline'))
    expect(result.current.drawOffer).toBeNull()
    expect(result.current.gameOver).toBeNull()
    expect(result.current.moves).toEqual([])
  })

  it('lets the opponent accept and end the game by agreement', () => {
    const { result } = renderHook(() => useGame())
    act(() => result.current.chooseOffer('offer'))
    act(() => result.current.chooseOffer('accept'))
    expect(result.current.gameOver).toEqual({ kind: 'agreement' })
    expect(result.current.drawOffer).toBeNull()
    // Nothing opens after the game has ended.
    act(() => result.current.chooseOffer('offer'))
    expect(result.current.drawOffer).toBeNull()
  })

  it('only answers an offer that is open and answerable', () => {
    const { result } = renderHook(() => useGame())
    // Accept/decline with no offer open are no-ops (t48 no_open_offer).
    act(() => result.current.chooseOffer('accept'))
    expect(result.current.gameOver).toBeNull()
    // The offerer's own 'awaiting' view (mirrored from the wire) is theirs
    // to wait out — not to answer.
    act(() => result.current.recvDrawOffer({ state: 'awaiting', by: 'white' }))
    act(() => result.current.chooseOffer('accept'))
    expect(result.current.gameOver).toBeNull()
    expect(result.current.drawOffer).toEqual({ state: 'awaiting', by: 'white' })
  })

  it('the engine accepts an open human draw offer (AI path, t49)', () => {
    vi.useFakeTimers()
    try {
      const hook = renderHook(() => useGame(glinskiRules))
      act(() => hook.result.current.toggleAi())
      act(() => hook.result.current.chooseOffer('offer'))
      expect(hook.result.current.drawOffer).toEqual({
        state: 'offered',
        by: 'white',
      })
      act(() => vi.runAllTimers())
      expect(hook.result.current.gameOver).toEqual({ kind: 'agreement' })
      expect(hook.result.current.drawOffer).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('mirrors the drawOffer and roomEnd frames from the room (t48/t49)', () => {
    const { result } = renderHook(() => useGame())
    act(() => result.current.recvDrawOffer({ state: 'offered', by: 'black' }))
    expect(result.current.drawOffer).toEqual({ state: 'offered', by: 'black' })
    // The idle frame clears the offer.
    act(() => result.current.recvDrawOffer(null))
    expect(result.current.drawOffer).toBeNull()
    act(() => result.current.recvDrawOffer({ state: 'awaiting', by: 'white' }))
    act(() => result.current.recvRoomEnd())
    expect(result.current.gameOver).toEqual({ kind: 'agreement' })
    expect(result.current.drawOffer).toBeNull()
  })
})
