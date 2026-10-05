import { describe, expect, it } from 'vitest'
import type { ClientMsg, ServerMsg } from '../src/protocol'
import { RoomCore, type Conn } from '../src/room'

function fakeConn(clientId: string, protocol = 1) {
  const sent: ServerMsg[] = []
  const conn: Conn = { clientId, protocol, send: (m) => sent.push(m) }
  return {
    conn,
    sent,
    last: () => sent[sent.length - 1]!,
    find: (type: ServerMsg['type']) => sent.find((m) => m.type === type),
    types: () => sent.map((m) => m.type),
  }
}

const join = (room: string, conn: Conn): ClientMsg => ({
  v: 1,
  type: 'join',
  room,
  clientId: conn.clientId,
  protocol: conn.protocol,
})

const move = (from: string, to: string, revision: number): ClientMsg => ({
  v: 1,
  type: 'move',
  from,
  to,
  revision,
})

describe('RoomCore seating', () => {
  it('assigns white, then black, then spectator', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    const b = fakeConn('b')
    const c = fakeConn('c')
    for (const p of [a, b, c]) core.receive(p.conn, join('ABCD', p.conn))

    expect(a.find('welcome')).toMatchObject({
      type: 'welcome',
      seat: 'white',
      room: 'ABCD',
    })
    expect(b.find('welcome')).toMatchObject({ seat: 'black' })
    expect(c.find('welcome')).toMatchObject({ seat: 'spectator' })
  })

  it('broadcasts peer, connected only when both seats are filled', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    core.receive(a.conn, join('ABCD', a.conn))
    expect(a.last()).toMatchObject({
      type: 'peer',
      connected: false,
      seats: { white: true, black: false },
    })

    const b = fakeConn('b')
    core.receive(b.conn, join('ABCD', b.conn))
    expect(a.last()).toMatchObject({
      type: 'peer',
      connected: true,
      seats: { white: true, black: true },
    })
  })

  it('a known clientId reclaims its seat across a reconnect', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    core.receive(a.conn, join('ABCD', a.conn))
    core.leave('a')

    const again = fakeConn('a')
    core.receive(again.conn, join('ABCD', again.conn))
    expect(again.find('welcome')).toMatchObject({ seat: 'white' })
  })

  it('a brand-new client never takes a reserved colour', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    core.receive(a.conn, join('ABCD', a.conn)) // white
    core.leave('a')

    const d = fakeConn('d')
    core.receive(d.conn, join('ABCD', d.conn))
    expect(d.find('welcome')).toMatchObject({ seat: 'black' }) // not white
  })

  it('leaving frees the live seat and re-broadcasts peer', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    const b = fakeConn('b')
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(b.conn, join('ABCD', b.conn))

    core.leave('b')
    expect(a.last()).toMatchObject({
      type: 'peer',
      connected: false,
      seats: { white: true, black: false },
    })
  })
})

describe('RoomCore moves', () => {
  it('accepts a move and broadcasts it with ply, revision and colour', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    const b = fakeConn('b')
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(b.conn, join('ABCD', b.conn))

    core.receive(a.conn, move('g1', 'f6', 0))
    const frame = {
      type: 'move',
      from: 'g1',
      to: 'f6',
      ply: 1,
      revision: 1,
      color: 'white',
      by: 'a',
    }
    expect(a.last()).toMatchObject(frame) // echo to the sender
    expect(b.last()).toMatchObject(frame)
  })

  it('carries promotion when present', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(a.conn, {
      v: 1,
      type: 'move',
      from: 'a1',
      to: 'a2',
      promotion: 'queen',
      revision: 0,
    })
    expect(a.last()).toMatchObject({ type: 'move', promotion: 'queen' })
  })

  it('rejects a stale move with stale_move and pushes fresh state', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    const b = fakeConn('b')
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(b.conn, join('ABCD', b.conn))
    core.receive(a.conn, move('g1', 'f6', 0)) // revision now 1

    core.receive(b.conn, move('b7', 'b6', 0)) // stale: server at 1
    const tail = b.sent.slice(-2)
    expect(tail[0]).toMatchObject({ type: 'error', code: 'stale_move' })
    expect(tail[1]).toMatchObject({
      type: 'state',
      revision: 1,
      reason: 'stale_move',
    })
    expect(core.moveCount).toBe(1) // not forked
  })

  it('serves the full move list on resync', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(a.conn, move('g1', 'f6', 0))

    const c = fakeConn('c')
    core.receive(c.conn, join('ABCD', c.conn))
    core.receive(c.conn, { v: 1, type: 'resync', revision: 1 })
    expect(c.last()).toMatchObject({
      type: 'state',
      revision: 1,
      moves: [{ from: 'g1', to: 'f6', ply: 1, color: 'white' }],
    })
  })

  it('welcome to a late joiner carries the accumulated moves', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(a.conn, move('g1', 'f6', 0))

    const c = fakeConn('c')
    core.receive(c.conn, join('ABCD', c.conn))
    expect(c.find('welcome')).toMatchObject({
      revision: 1,
      moves: [{ ply: 1 }],
    })
  })

  it('stops spectators from moving', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    const b = fakeConn('b')
    const c = fakeConn('c')
    for (const p of [a, b, c]) core.receive(p.conn, join('ABCD', p.conn))

    core.receive(c.conn, move('g1', 'f6', 0))
    expect(c.last()).toMatchObject({ type: 'error', code: 'bad_message' })
    expect(core.moveCount).toBe(0)
  })
})

describe('RoomCore protocol + ping', () => {
  it('rejects a join with a different protocol version', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a', 2)
    core.receive(a.conn, join('ABCD', a.conn))
    expect(a.last()).toMatchObject({
      type: 'error',
      code: 'version_mismatch',
      expectedProtocol: 1,
      receivedProtocol: 2,
    })
    expect(a.types()).not.toContain('welcome')
  })

  it('answers ping with the same timestamp', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(a.conn, { v: 1, type: 'ping', t: 42 })
    expect(a.last()).toMatchObject({ type: 'pong', t: 42 })
  })
})
