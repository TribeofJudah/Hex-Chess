import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeSocketFactory, welcomeMsg } from '../test/fakeSocket'
import { PROTOCOL_VERSION } from './protocol'
import { useRemoteGame } from './useRemoteGame'

afterEach(() => {
  vi.useRealTimers()
})

describe('useRemoteGame handshake', () => {
  it('opens a socket, sends join, and applies welcome', () => {
    const { connect, sockets, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    expect(result.current.status).toBe('connecting')
    expect(sockets[0]!.url).toContain('/room/ABCD')

    act(() => current().open())
    expect(current().last()).toMatchObject({
      type: 'join',
      room: 'ABCD',
      protocol: PROTOCOL_VERSION,
    })

    act(() => current().recv(welcomeMsg({ seat: 'black', moves: [] })))
    expect(result.current.status).toBe('waiting')
    expect(result.current.seat).toBe('black')
  })

  it('rebuilds the board from the authoritative move list in welcome', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() =>
      current().recv(
        welcomeMsg({
          revision: 2,
          moves: [
            { from: 'g1', to: 'f6', ply: 1, color: 'white' },
            { from: 'b7', to: 'b6', ply: 2, color: 'black' },
          ],
        }),
      ),
    )
    expect(result.current.moves).toHaveLength(2)
    expect(result.current.turn).toBe('white')
    expect(result.current.lastMove).toEqual(['b7', 'b6'])
  })

  it('goes to playing only when both seats are filled', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() => current().recv(welcomeMsg()))

    act(() =>
      current().recv({
        v: 1,
        type: 'peer',
        connected: true,
        seats: { white: true, black: false },
      }),
    )
    expect(result.current.status).toBe('waiting')
    expect(result.current.peerConnected).toBe(false)

    act(() =>
      current().recv({
        v: 1,
        type: 'peer',
        connected: true,
        seats: { white: true, black: true },
      }),
    )
    expect(result.current.status).toBe('playing')
    expect(result.current.peerConnected).toBe(true)
  })
})

describe('useRemoteGame move sync', () => {
  it('streams a local move out once the socket is ready', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() => current().recv(welcomeMsg()))

    act(() => result.current.applyMove('g1', 'f6'))
    expect(current().last()).toMatchObject({
      type: 'move',
      from: 'g1',
      to: 'f6',
      revision: 0,
    })
  })

  it('does not echo a local move back after an inbound broadcast bumps the ply', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() => current().recv(welcomeMsg()))

    // Inbound move for ply 1 lands on the board.
    act(() =>
      current().recv({
        v: 1,
        type: 'move',
        from: 'g1',
        to: 'f6',
        ply: 1,
        color: 'white',
        revision: 1,
        by: 'peer',
      }),
    )
    expect(result.current.moves).toHaveLength(1)
    // The echo of our own move must not be re-sent.
    const before = current().sent.length
    act(() =>
      current().recv({
        v: 1,
        type: 'move',
        from: 'g1',
        to: 'f6',
        ply: 1,
        color: 'white',
        revision: 1,
        by: 'me',
      }),
    )
    expect(result.current.moves).toHaveLength(1)
    expect(current().sent.length).toBe(before)
  })

  it('requests a resync when a broadcast ply skips ahead (gap)', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() => current().recv(welcomeMsg({ revision: 0, moves: [] })))
    act(() => result.current.applyMove('g1', 'f6')) // now have 1 move, revision 0

    act(() =>
      current().recv({
        v: 1,
        type: 'move',
        from: 'a1',
        to: 'a2',
        ply: 5,
        color: 'black',
        revision: 4,
        by: 'peer',
      }),
    )
    expect(result.current.moves).toHaveLength(1)
    expect(current().last()).toMatchObject({ type: 'resync', revision: 1 })
  })

  it('applies a state frame (server-side resync answer)', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() => current().recv(welcomeMsg()))
    act(() =>
      current().recv({
        v: 1,
        type: 'state',
        revision: 9,
        reason: 'resync',
        moves: [
          { from: 'g1', to: 'f6', ply: 1, color: 'white' },
          { from: 'b7', to: 'b6', ply: 2, color: 'black' },
          { from: 'f6', to: 'g7', ply: 3, color: 'white' },
        ],
      }),
    )
    expect(result.current.moves).toHaveLength(3)
    expect(result.current.turn).toBe('black')
  })
})

describe('useRemoteGame version mismatch', () => {
  it('stops and does not reconnect when the server reports a version mismatch', () => {
    vi.useFakeTimers()
    const { connect, sockets, current } = makeSocketFactory()
    const { result } = renderHook(() =>
      useRemoteGame('ABCD', { connect, reconnectBaseMs: 50 }),
    )
    act(() => current().open())
    act(() =>
      current().recv({
        v: 1,
        type: 'error',
        code: 'version_mismatch',
        message: 'client too old',
        expectedProtocol: 2,
      }),
    )
    expect(result.current.status).toBe('version-mismatch')
    expect(result.current.serverProtocol).toBe(2)
    expect(current().closed).toBe(true)

    // The socket close that follows must NOT trigger a reconnect.
    act(() => current().drop())
    act(() => vi.advanceTimersByTime(10_000))
    expect(sockets).toHaveLength(1)
    expect(result.current.status).toBe('version-mismatch')
  })

  it('treats a welcome whose protocol differs as a mismatch', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    // Client is on v2 (t56); a v1 welcome is the canonical mismatch case.
    act(() => current().recv(welcomeMsg({ protocol: 1 })))
    expect(result.current.status).toBe('version-mismatch')
    expect(result.current.serverProtocol).toBe(1)
    expect(current().closed).toBe(true)
  })

  it('surfaces non-version errors as a plain error status', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() =>
      current().recv({
        v: 1,
        type: 'error',
        code: 'room_full',
        message: 'room ABCD is full',
      }),
    )
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('room ABCD is full')
  })
})

describe('useRemoteGame reconnect', () => {
  it('backs off and reconnects after an unexpected drop', () => {
    vi.useFakeTimers()
    const { connect, sockets, current } = makeSocketFactory()
    const { result } = renderHook(() =>
      useRemoteGame('ABCD', {
        connect,
        reconnectBaseMs: 100,
        reconnectMaxMs: 1000,
      }),
    )
    act(() => current().open())
    act(() => current().recv(welcomeMsg()))

    act(() => current().drop())
    expect(result.current.status).toBe('reconnecting')
    expect(sockets).toHaveLength(1)

    // Delay is in [50, 100); advancing 100ms fires it exactly once.
    act(() => vi.advanceTimersByTime(100))
    expect(sockets).toHaveLength(2)

    act(() => current().open())
    expect(result.current.status).toBe('waiting')
    expect(current().last()).toMatchObject({ type: 'join', room: 'ABCD' })
  })

  it('reuses the same clientId across a reconnect so the seat is reclaimed', () => {
    vi.useFakeTimers()
    const { connect, sockets, current } = makeSocketFactory()
    renderHook(() =>
      useRemoteGame('ABCD', {
        connect,
        reconnectBaseMs: 10,
        reconnectMaxMs: 10,
      }),
    )
    act(() => current().open())
    const firstJoin = current().last<{ clientId: string }>()
    act(() => current().drop())
    act(() => vi.advanceTimersByTime(10))
    expect(sockets).toHaveLength(2)
    act(() => current().open())
    expect(current().last<{ clientId: string }>().clientId).toBe(
      firstJoin.clientId,
    )
  })

  it('stays closed (no reconnect) after leave()', () => {
    vi.useFakeTimers()
    const { connect, sockets, current } = makeSocketFactory()
    const { result } = renderHook(() =>
      useRemoteGame('ABCD', { connect, reconnectBaseMs: 10 }),
    )
    act(() => current().open())
    act(() => result.current.leave())
    expect(result.current.status).toBe('closed')

    act(() => current().drop())
    act(() => vi.advanceTimersByTime(10_000))
    expect(sockets).toHaveLength(1)
    expect(result.current.status).toBe('closed')
  })

  it('ignores a malformed frame without crashing', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() => current().recv(welcomeMsg()))
    act(() => current().onmessage?.({ data: 'not json' }))
    act(() => current().recv({ v: 1, type: 'who-knows' }))
    expect(result.current.status).toBe('waiting')
  })
})

describe('useRemoteGame clock (round 11)', () => {
  it('seeds clock from welcome.clock', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() =>
      current().recv(
        welcomeMsg({
          clock: {
            whiteMs: 280_000,
            blackMs: 300_000,
            lastTickAt: 20_000,
            tickMs: 1000,
            incrementMs: 3000,
          },
        }),
      ),
    )
    expect(result.current.clock).toEqual({
      whiteMs: 280_000,
      blackMs: 300_000,
      lastTickAt: 20_000,
      tickMs: 1000,
      incrementMs: 3000,
    })
  })

  it('mirrors the per-tick clock frames', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() =>
      current().recv(
        welcomeMsg({
          clock: {
            whiteMs: 300_000,
            blackMs: 300_000,
            lastTickAt: 0,
            tickMs: 1000,
            incrementMs: 3000,
          },
        }),
      ),
    )
    act(() =>
      current().recv({
        v: PROTOCOL_VERSION,
        type: 'clock',
        code: 'ABCD',
        clock: {
          whiteMs: 295_000,
          blackMs: 300_000,
          lastTickAt: 5_000,
          tickMs: 1000,
          incrementMs: 3000,
        },
      }),
    )
    expect(result.current.clock?.whiteMs).toBe(295_000)
    expect(result.current.clock?.blackMs).toBe(300_000)
  })

  it('leaves clock undefined when welcome does not carry one', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() => current().recv(welcomeMsg()))
    expect(result.current.clock).toBeUndefined()
  })
})

describe('useRemoteGame draw agreement (t49)', () => {
  it('sends the offerDraw / acceptDraw / declineDraw wire frames', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() => current().recv(welcomeMsg()))
    // The offer names the room and this connection's seat (advisory `by`;
    // the room derives the acting seat from the connection).
    act(() => result.current.chooseOffer('offer'))
    expect(current().last()).toEqual({
      v: PROTOCOL_VERSION,
      type: 'offerDraw',
      code: 'ABCD',
      by: 'white',
    })
    // Accept/decline carry only the room code.
    act(() => result.current.chooseOffer('accept'))
    expect(current().last()).toEqual({
      v: PROTOCOL_VERSION,
      type: 'acceptDraw',
      code: 'ABCD',
    })
    act(() => result.current.chooseOffer('decline'))
    expect(current().last()).toEqual({
      v: PROTOCOL_VERSION,
      type: 'declineDraw',
      code: 'ABCD',
    })
    // A spectator's connection cannot open an offer (t48: seat-gated).
    act(() =>
      current().recv(welcomeMsg({ seat: 'spectator', revision: 0, moves: [] })),
    )
    const before = current().sent.length
    act(() => result.current.chooseOffer('offer'))
    expect(current().sent.length).toBe(before)
    // And there is nothing to offer once the socket is ours-but-closed.
    act(() => result.current.leave())
    const count = current().sent.length
    act(() => result.current.chooseOffer('accept'))
    expect(current().sent.length).toBe(count)
  })

  it('mirrors the per-seat drawOffer frames and the terminal roomEnd', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() => current().recv(welcomeMsg()))
    // The offerer's own view: awaiting (this seat offered).
    act(() =>
      current().recv({
        v: 1,
        type: 'drawOffer',
        code: 'ABCD',
        state: 'awaiting',
        by: 'white',
      }),
    )
    expect(result.current.drawOffer).toEqual({ state: 'awaiting', by: 'white' })
    // ...then the opponent opens one: the offered view answers it.
    act(() =>
      current().recv({
        v: 1,
        type: 'drawOffer',
        code: 'ABCD',
        state: 'offered',
        by: 'black',
      }),
    )
    expect(result.current.drawOffer).toEqual({ state: 'offered', by: 'black' })
    // The idle frame clears; offer -> roomEnd ends the game by agreement.
    act(() =>
      current().recv({
        v: 1,
        type: 'drawOffer',
        code: 'ABCD',
        state: 'idle',
        by: 'white',
      }),
    )
    expect(result.current.drawOffer).toBeNull()
    act(() =>
      current().recv({
        v: 1,
        type: 'drawOffer',
        code: 'ABCD',
        state: 'offered',
        by: 'white',
      }),
    )
    act(() =>
      current().recv({
        v: 1,
        type: 'roomEnd',
        code: 'ABCD',
        reason: 'draw_agreement',
      }),
    )
    expect(result.current.gameOver).toEqual({ kind: 'agreement' })
    expect(result.current.drawOffer).toBeNull()
  })

  it('treats an invalid_draw NACK as a soft refusal, not a room error', () => {
    const { connect, current } = makeSocketFactory()
    const { result } = renderHook(() => useRemoteGame('ABCD', { connect }))
    act(() => current().open())
    act(() => current().recv(welcomeMsg()))
    act(() =>
      current().recv({
        v: 1,
        type: 'error',
        code: 'invalid_draw',
        message: 'not_your_turn',
      }),
    )
    // The room keeps breathing; a follow-up state push resyncs the board.
    expect(result.current.status).toBe('waiting')
    expect(result.current.error).toBeUndefined()
  })
})
