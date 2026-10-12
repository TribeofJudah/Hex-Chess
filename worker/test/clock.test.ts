import { describe, expect, it } from 'vitest'
import {
  INCREMENT_MS,
  INITIAL_MS,
  freezeAt,
  initialClock,
  remainingAt,
} from '../src/clock'
import {
  PROTOCOL_VERSION,
  type ClientMsg,
  type ClockMsg,
  type ServerMsg,
} from '../src/protocol'
import { RoomCore, type Conn } from '../src/room'

/** An arbitrary epoch; every test drives `now` by hand. */
const T0 = 1_700_000_000_000

function fakeConn(clientId: string) {
  const sent: ServerMsg[] = []
  const conn: Conn = {
    clientId,
    protocol: PROTOCOL_VERSION,
    send: (m) => sent.push(m),
  }
  return {
    conn,
    sent,
    last: () => sent[sent.length - 1]!,
    find: (type: ServerMsg['type']) => sent.find((m) => m.type === type),
    clocks: () => sent.filter((m): m is ClockMsg => m.type === 'clock'),
  }
}

const join = (conn: Conn): ClientMsg => ({
  v: PROTOCOL_VERSION,
  type: 'join',
  room: 'ABCD',
  clientId: conn.clientId,
  protocol: conn.protocol,
})
const move = (from: string, to: string, revision: number): ClientMsg => ({
  v: PROTOCOL_VERSION,
  type: 'move',
  from,
  to,
  revision,
})

/** A room with both seats taken and the clock started at the current `now`. */
function seated() {
  let now = T0
  const core = new RoomCore('ABCD', undefined, () => now)
  const w = fakeConn('w')
  const b = fakeConn('b')
  core.receive(w.conn, join(w.conn))
  core.receive(b.conn, join(b.conn))
  return {
    core,
    w,
    b,
    /** Move the injected clock source. */
    at: (t: number) => {
      now = t
    },
  }
}

describe('clock arithmetic', () => {
  it('burns only the side to move, and freezes at zero', () => {
    const c = { ...initialClock(), since: T0 }
    expect(remainingAt(c, 'white', 'white', T0 + 2_000)).toBe(
      INITIAL_MS - 2_000,
    )
    expect(remainingAt(c, 'black', 'white', T0 + 2_000)).toBe(INITIAL_MS)
    // Frozen well past zero: clamped, and stopped.
    expect(freezeAt(c, 'white', T0 + INITIAL_MS + 5_000)).toEqual({
      white: 0,
      black: INITIAL_MS,
      since: null,
    })
  })
})

describe('RoomCore clock (t56)', () => {
  it('does not run until both seats are taken', () => {
    const core = new RoomCore('ABCD', undefined, () => T0)
    const w = fakeConn('w')
    core.receive(w.conn, join(w.conn))
    expect(core.clockRunning).toBe(false)
    expect(w.find('welcome')).toMatchObject({
      type: 'welcome',
      clock: {
        white: INITIAL_MS,
        black: INITIAL_MS,
        turn: 'white',
        running: false,
      },
    })
    expect(core.tick(T0 + 60_000)).toBe(false) // nothing runs, nothing sent
  })

  it('neither burns nor earns time for a move before the second seat joins', () => {
    const core = new RoomCore('ABCD', undefined, () => T0 + 60_000)
    const w = fakeConn('w')
    core.receive(w.conn, join(w.conn))
    core.receive(w.conn, move('b1', 'b2', 0)) // legal, but the game has not started
    expect(core.snapshot().clock).toEqual({
      white: INITIAL_MS,
      black: INITIAL_MS,
      since: null,
    })
  })

  it('ticks the side to move at 1 Hz', () => {
    const { core, w, at } = seated()
    expect(core.clockRunning).toBe(true)

    at(T0 + 1_000)
    expect(core.tick(T0 + 1_000)).toBe(true)
    expect(w.last()).toMatchObject({
      type: 'clock',
      code: 'ABCD',
      turn: 'white',
      running: true,
      white: INITIAL_MS - 1_000,
      black: INITIAL_MS,
    })

    at(T0 + 5_000)
    expect(core.tick(T0 + 5_000)).toBe(true)
    expect(w.last()).toMatchObject({ white: INITIAL_MS - 5_000 })
    expect(w.clocks()).toHaveLength(2)
    expect(w.last()).toMatchObject({ black: INITIAL_MS }) // black never burned
  })

  it('adds the increment to the mover and hands the clock over', () => {
    const { core, w, at } = seated()
    at(T0 + 10_000)
    core.receive(w.conn, move('b1', 'b2', 0)) // white moved, 10 s burned

    at(T0 + 12_000)
    expect(core.tick(T0 + 12_000)).toBe(true)
    expect(w.last()).toMatchObject({
      turn: 'black',
      white: INITIAL_MS - 10_000 + INCREMENT_MS,
      black: INITIAL_MS - 2_000,
    })
  })

  it('ends the room when the side to move runs out', () => {
    const { core, w, at } = seated()
    at(T0 + INITIAL_MS)
    expect(core.tick(T0 + INITIAL_MS)).toBe(false)

    expect(w.clocks().at(-1)).toMatchObject({ white: 0, running: false })
    expect(w.last()).toMatchObject({
      type: 'roomEnd',
      code: 'ABCD',
      reason: 'time',
      winner: 'black',
    })
    expect(core.clockRunning).toBe(false)
    expect(core.snapshot()).toMatchObject({ ended: true })
  })

  it('refuses a move once the clock has ended the room', () => {
    const { core, w, at } = seated()
    at(T0 + INITIAL_MS)
    core.tick(T0 + INITIAL_MS)

    core.receive(w.conn, move('b1', 'b2', 0))
    expect(w.find('error')).toMatchObject({
      type: 'error',
      code: 'invalid_move',
      message: 'the room has ended',
    })
    expect(core.moveCount).toBe(0)
  })

  it('survives eviction: a revived room keeps counting from `since`', () => {
    const { core, at } = seated()
    at(T0 + 30_000)
    core.tick(T0 + 30_000)
    const snap = core.snapshot()
    // Nothing is written per tick: the snapshot keeps the values as of `since`.
    expect(snap.clock).toMatchObject({
      white: INITIAL_MS,
      black: INITIAL_MS,
      since: T0,
    })

    // Respawn two minutes later; no tick ran in between.
    const revived = new RoomCore('ABCD', snap, () => T0 + 150_000)
    const w = fakeConn('w')
    revived.receive(w.conn, join(w.conn))
    expect(w.find('welcome')).toMatchObject({
      clock: {
        turn: 'white',
        running: true,
        white: INITIAL_MS - 150_000,
        black: INITIAL_MS,
      },
      ended: false,
    })
    expect(revived.clockRunning).toBe(true)
  })

  it('flags a clock that ran out while the DO was evicted', () => {
    const { core, at } = seated()
    at(T0 + 30_000)
    core.tick(T0 + 30_000)

    // Woken long after white's clock expired, before anyone rejoined.
    const revived = new RoomCore('ABCD', core.snapshot(), () => T0 + 400_000)
    expect(revived.tick(T0 + 400_000)).toBe(false)
    expect(revived.snapshot()).toMatchObject({
      ended: true,
      clock: { white: 0, since: null },
    })

    const w = fakeConn('w')
    revived.receive(w.conn, join(w.conn))
    expect(w.find('welcome')).toMatchObject({ ended: true })
  })

  it('stops the clock when a draw is agreed', () => {
    const { core, w, b, at } = seated()
    at(T0 + 20_000)
    core.receive(w.conn, {
      v: PROTOCOL_VERSION,
      type: 'offerDraw',
      code: 'ABCD',
      by: 'white',
    })
    core.receive(b.conn, {
      v: PROTOCOL_VERSION,
      type: 'acceptDraw',
      code: 'ABCD',
    })

    expect(core.clockRunning).toBe(false)
    expect(core.snapshot().clock).toMatchObject({ since: null })
    expect(core.tick(T0 + 25_000)).toBe(false) // no further tick, no second roomEnd
    expect(b.find('roomEnd')).toMatchObject({ reason: 'draw_agreement' })
  })
})
