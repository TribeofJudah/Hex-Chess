import { describe, expect, it } from 'vitest'
import { pgnResult, toPgn } from './pgn'
import type { GameMove } from './useGame'

const moves: GameMove[] = [
  { san: 'f5 f6', color: 'white', from: 'f5', to: 'f6' },
  { san: 'f7 f6', color: 'black', from: 'f7', to: 'f6' },
  { san: 'Qe1 c3', color: 'white', from: 'e1', to: 'c3' },
]

describe('pgn', () => {
  it('maps game results to Gliński scores', () => {
    expect(pgnResult(null)).toBe('*')
    expect(pgnResult({ kind: 'checkmate', winner: 'white' })).toBe('1-0')
    expect(pgnResult({ kind: 'checkmate', winner: 'black' })).toBe('0-1')
    expect(pgnResult({ kind: 'stalemate', winner: 'white' })).toBe('3/4-1/4')
    expect(pgnResult({ kind: 'stalemate', winner: 'black' })).toBe('1/4-3/4')
    expect(pgnResult({ kind: 'repetition' })).toBe('1/2-1/2')
    expect(pgnResult({ kind: 'fifty-move' })).toBe('1/2-1/2')
    expect(pgnResult({ kind: 'resign', winner: 'white' })).toBe('1-0')
    expect(pgnResult({ kind: 'resign', winner: 'black' })).toBe('0-1')
    expect(pgnResult({ kind: 'agreement' })).toBe('1/2-1/2')
  })

  it('writes headers and one numbered line per move pair', () => {
    const text = toPgn(
      moves,
      { kind: 'checkmate', winner: 'white' },
      new Date('2026-10-01T12:00:00Z'),
    )
    expect(text).toBe(
      [
        '[Event "Hex Chess"]',
        '[Variant "Glinski"]',
        '[Date "2026.10.01"]',
        '[Result "1-0"]',
        '',
        '1. f5 f6 f7 f6',
        '2. Qe1 c3',
        '1-0',
        '',
      ].join('\n'),
    )
  })

  it('marks an ongoing game with *', () => {
    expect(toPgn([], null)).toContain('[Result "*"]\n\n*\n')
  })
})
