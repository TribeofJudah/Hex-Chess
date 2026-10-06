import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { pgnResult, toPgn } from './pgn'
import { PROTOCOL_VERSION } from './protocol'
import type { GameMove } from './useGame'
import { useRemoteGame } from './useRemoteGame'

const moves: GameMove[] = [
  { san: 'f5 f6', color: 'white', from: 'f5', to: 'f6' },
  { san: 'f7 f6', color: 'black', from: 'f7', to: 'f6' },
  { san: 'Qe1 c3', color: 'white', from: 'e1', to: 'c3' },
]

/** Minimal connect() stub (t55): open() fires onopen, recv() feeds frames. */
class StubSocket {
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {}
  open(): void {
    this.onopen?.()
  }
  recv(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

describe('pgn', () => {
  it('maps game results to Glinski scores', () => {
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
    // `date` now sits at position 4 (after the new roomEndReason/timeLoser
    // arguments). The header text is unchanged.
    const text = toPgn(
      moves,
      { kind: 'checkmate', winner: 'white' },
      undefined,
      undefined,
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

  // t56 additions: roomEndReason threading.

  it('threads a draw_agreement roomEnd into a comment + 1/2-1/2', () => {
    const text = toPgn(
      moves,
      { kind: 'agreement' },
      'draw_agreement',
    )
    // Comment line sits between the last move-pair and the trailing result.
    expect(text).toContain('*[Draw by agreement]*\n1/2-1/2')
    expect(text).toContain('[Result "1/2-1/2"]')
    // Hotseat render stays comment-free when no reason is provided.
    const hotseat = toPgn(moves, { kind: 'agreement' })
    expect(hotseat).not.toContain('*[Draw by agreement]*')
    expect(hotseat).toContain('1/2-1/2')
  })

  it('threads a time roomEnd into a comment naming the loser', () => {
    const whiteRanOut = toPgn(
      moves,
      { kind: 'agreement' }, // wire mapping happens at the call site
      'time',
      'white', // white ran out, black won
    )
    expect(whiteRanOut).toContain('*[White ran out of time]*')
    // The header result is taken from pgnResult(gameOver); the call site
    // is expected to translate window.{reason, winner} into the right
    // `gameOver` (e.g. {kind:'resign', winner:'black'} for the timeout).
    expect(whiteRanOut).toContain('1/2-1/2')

    const blackRanOut = toPgn(moves, null, 'time', 'black')
    expect(blackRanOut).toContain('*[Black ran out of time]*')
  })

  it('omits the comment when roomEndReason is undefined', () => {
    // Pre-t56 behaviour: no comment. The resign + checkmate renderings
    // must be byte-for-byte identical to what toPgn produced in Rounds 1-8.
    const resign = toPgn(moves, { kind: 'resign', winner: 'white' })
    expect(resign).not.toContain('*[')
    expect(resign).toContain('1-0')
    const checkmate = toPgn(moves, { kind: 'checkmate', winner: 'white' })
    expect(checkmate).not.toContain('*[')
    expect(checkmate).toContain('1-0')
  })

  it('omits the time comment when timeLoser is missing', () => {
    // Defensive: if the caller forgets the loser, render the result without
    // the comment rather than emit something nonsensical.
    const text = toPgn(moves, null, 'time')
    expect(text).not.toContain('*[')
  })

  it('annotates a mirrored draw agreement and forces the drawn result (t55)', () => {
    const text = toPgn(
      moves,
      { kind: 'agreement' },
      'draw_agreement',
      undefined,
      new Date('2026-10-01T12:00:00Z'),
    )
    expect(text).toContain('[Result "1/2-1/2"]')
    expect(text.endsWith('*[Draw by agreement]*\n1/2-1/2\n')).toBe(true)
  })

  it('a draw meeting a timeout reason falls through to plain agreement rendering', () => {
    const withTimeout = toPgn(moves, { kind: 'agreement' }, 'time')
    expect(withTimeout).toContain('[Result "1/2-1/2"]')
    expect(withTimeout).toBe(toPgn(moves, { kind: 'agreement' }))
    expect(withTimeout).not.toContain('*[')
  })

  it('annotates a clock loss from the wire winner (t56 wire, t55 rendering)', () => {
    // The wire names the winner; the annotation names the loser.
    const blackRanOut = toPgn(
      moves,
      { kind: 'resign', winner: 'white' },
      'time',
      'black',
    )
    expect(blackRanOut).toContain('[Result "1-0"]')
    expect(blackRanOut.endsWith('*[Black ran out of time]*\n1-0\n')).toBe(true)
    const whiteRanOut = toPgn(
      moves,
      { kind: 'resign', winner: 'black' },
      'time',
      'white',
    )
    expect(whiteRanOut).toContain('[Result "0-1"]')
    expect(whiteRanOut.endsWith('*[White ran out of time]*\n0-1\n')).toBe(true)
  })

  it('overrides the drawn result from the reason alone when the snapshot missed the end', () => {
    const text = toPgn(moves, undefined, 'draw_agreement')
    expect(text).toContain('[Result "1/2-1/2"]')
    expect(text.endsWith('\n1/2-1/2\n')).toBe(true)
    expect(text).not.toContain('*[')
  })

  it('annotates draw agreement only when the snapshot corroborates it', () => {
    // Corroborated: agreement gameOver + the draw_agreement reason.
    expect(
      toPgn(moves, { kind: 'agreement' }, 'draw_agreement'),
    ).toContain('*[Draw by agreement]*')
    // Un-corroborated: another gameOver kind carries the reason — no
    // annotation (and the result renders from the snapshot).
    expect(
      toPgn(moves, { kind: 'repetition' }, 'draw_agreement'),
    ).not.toContain('*[')
    expect(
      toPgn(moves, { kind: 'repetition' }, 'draw_agreement'),
    ).toContain('[Result "1/2-1/2"]')
  })
})

describe('remote export threading (t55)', () => {
  it('threads the mirrored roomEnd reason from the hook into the export', async () => {
    const socket = new StubSocket()
    const { result } = renderHook(() =>
      useRemoteGame('DRAW', {
        connect: () => socket,
        urlFor: (code) => `ws://room/${code}`,
      }),
    )
    act(() => socket.open())
    act(() =>
      socket.recv({
        v: PROTOCOL_VERSION,
        type: 'welcome',
        seat: 'white',
        protocol: PROTOCOL_VERSION,
        revision: 0,
        moves: [],
      }),
    )
    act(() =>
      socket.recv({
        v: PROTOCOL_VERSION,
        type: 'peer',
        seats: { white: true, black: true },
      }),
    )
    act(() =>
      socket.recv({
        v: PROTOCOL_VERSION,
        type: 'roomEnd',
        code: 'DRAW',
        reason: 'draw_agreement',
      }),
    )
    await waitFor(() =>
      expect(result.current.roomEndReason).toBe('draw_agreement'),
    )
    expect(result.current.gameOver).toEqual({ kind: 'agreement' })
    // The exact expression RemoteRoom's export button calls (with the same
    // null-shim, since useGame's reason is `'draw_agreement' | 'time' | null`):
    const text = toPgn(
      result.current.moves,
      result.current.gameOver,
      result.current.roomEndReason ?? undefined,
    )
    expect(text.endsWith('*[Draw by agreement]*\n1/2-1/2\n')).toBe(true)
  })
})
