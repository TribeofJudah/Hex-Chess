import { describe, expect, it } from 'vitest'
import { glinskiRules } from '../rules/adapter'
import { toPgn } from './pgn'
import { parsePgn, replayPgn } from './pgnImport'
import type { GameMove } from './useGame'

/**
 * Legal reference games, verified against the rule-book generator. The
 * promotion line was found by playout search; the en-passant line uses the
 * exporter's SAN shape (`f5 f6` = origin, destination).
 */
const EP_GAME = ['f5 f6', 'e7 e5', 'f6 e6']
const PROMO_GAME = [
  'b1 b3',
  'Qe10 c6',
  'b3 b4',
  'Qc6 a6',
  'b4 b5',
  'e7 e5',
  'b5 b6',
  'g7 g6',
  'b6 a6=Q',
]

/**
 * The `moves` array `pgn.test.ts` uses for its export-format assertions. It
 * is NOT a legal game (Black's `f7 f6` walks into White's `f5 f6` pawn), so
 * it only round-trips through the parser — replaying it is expected to fail,
 * which is itself covered below.
 */
const EXPORT_FIXTURE: GameMove[] = [
  { san: 'f5 f6', color: 'white', from: 'f5', to: 'f6' },
  { san: 'f7 f6', color: 'black', from: 'f7', to: 'f6' },
  { san: 'Qe1 c3', color: 'white', from: 'e1', to: 'c3' },
]

describe('parsePgn', () => {
  it('reads headers, half-moves and the result token', () => {
    const text = toPgn(EXPORT_FIXTURE, { kind: 'checkmate', winner: 'white' })
    const parsed = parsePgn(text)
    expect(parsed.headers['Variant']).toBe('Glinski')
    expect(parsed.headers['Result']).toBe('1-0')
    expect(parsed.sans).toEqual(['f5 f6', 'f7 f6', 'Qe1 c3'])
    expect(parsed.result).toBe('1-0')
  })

  it('tolerates CRLF, brace comments, move numbers and extra whitespace', () => {
    const text =
      '[Event "x"]\r\n\r\n1. {opening} f5 f6   1...  e7 e5\r\n2. f6 e6 {ep}\r\n*'
    const parsed = parsePgn(text)
    expect(parsed.sans).toEqual(['f5 f6', 'e7 e5', 'f6 e6'])
    expect(parsed.result).toBe('*')
  })

  it('strips the exporter annotation line and keeps the drawn result', () => {
    const moves = replayPgn(EP_GAME, glinskiRules)
    expect(Array.isArray(moves)).toBe(true)
    const text = toPgn(moves as GameMove[], { kind: 'agreement' }, 'draw_agreement')
    const parsed = parsePgn(text)
    expect(parsed.result).toBe('1/2-1/2')
    expect(parsed.sans).toEqual(EP_GAME)
  })

  it('never throws on malformed input', () => {
    const parsed = parsePgn('not a pgn at all ;; {')
    expect(parsed.sans.length).toBeGreaterThan(0)
    expect(parsed.result).toBe('*')
  })
})

describe('replayPgn', () => {
  it('resolves a legal game to GameMove[] with the exporter SAN shape', () => {
    const moves = replayPgn(EP_GAME, glinskiRules)
    expect(moves).toEqual([
      { san: 'f5 f6', color: 'white', from: 'f5', to: 'f6' },
      { san: 'e7 e5', color: 'black', from: 'e7', to: 'e5' },
      { san: 'f6 e6', color: 'white', from: 'f6', to: 'e6' },
    ])
  })

  it('carries a promotion ply with its kind', () => {
    const moves = replayPgn(PROMO_GAME, glinskiRules)
    expect(Array.isArray(moves)).toBe(true)
    const last = (moves as GameMove[]).at(-1)!
    expect(last).toEqual({
      san: 'b6 a6=Q',
      color: 'white',
      from: 'b6',
      to: 'a6',
      promotion: 'queen',
    })
  })

  it('reports an illegal move with its ply', () => {
    // Black's second move walks the f7 pawn into the pawn on f6.
    expect(replayPgn(['f5 f6', 'f7 f6'], glinskiRules)).toEqual({
      error: 'illegal move "f7 f6"',
      ply: 1,
    })
  })

  it('reports an unreadable SAN', () => {
    expect(replayPgn(['zz9 qq'], glinskiRules)).toEqual({
      error: 'unreadable SAN "zz9 qq"',
      ply: 0,
    })
  })

  it('reports a move out of turn', () => {
    expect(replayPgn(['e7 e5'], glinskiRules)).toEqual({
      error: '"e7 e5" moves b out of turn',
      ply: 0,
    })
  })

  it('reports a mislabelled piece', () => {
    // f3 holds a bishop, not a knight.
    expect(replayPgn(['Nf3 b1'], glinskiRules)).toMatchObject({ ply: 0 })
  })

  it('reports a promotion that names no piece', () => {
    const withoutPiece = PROMO_GAME.slice(0, -1).concat('b6 a6')
    expect(replayPgn(withoutPiece, glinskiRules)).toEqual({
      error: '"b6 a6" is a promotion but names no piece',
      ply: PROMO_GAME.length - 1,
    })
  })
})

describe('parse/replay round trip', () => {
  const games: Array<{ name: string; line: string[] }> = [
    { name: 'en passant', line: EP_GAME },
    { name: 'promotion', line: PROMO_GAME },
  ]

  for (const { name, line } of games) {
    it(`replays ${name} back to the same move list`, () => {
      const expected = replayPgn(line, glinskiRules)
      expect(Array.isArray(expected)).toBe(true)
      const moves = expected as GameMove[]
      const reparsed = replayPgn(parsePgn(toPgn(moves, null)).sans, glinskiRules)
      expect(reparsed).toEqual(moves)
    })
  }

  it('round-trips the pgn.test.ts export fixture through the parser', () => {
    const parsed = parsePgn(toPgn(EXPORT_FIXTURE, null))
    expect(parsed.sans).toEqual(EXPORT_FIXTURE.map((m) => m.san))
  })

  it('reparses the fixture-shaped move numbers and result', () => {
    // toPgn emits "1. f5 f6 f7 f6" — the parser must not mistake the move
    // number or the trailing result token for SAN.
    const parsed = parsePgn(toPgn(EXPORT_FIXTURE, null))
    expect(parsed.result).toBe('*')
    expect(parsed.sans).toHaveLength(3)
  })
})
