import { describe, expect, it } from 'vitest'
import { parsePosition, serializePosition } from '../src/board/fen'
import { notationToAxial } from '../src/board/notation'
import { keyOf } from '../src/board/pieces'
import type { ClientMsg, ServerMsg } from '../src/protocol'
import { RoomCore, type Conn } from '../src/room'

const START_FEN =
  'b/qbk/n1b1n/r5r/ppppppppp/11/5P5/4P1P4/3P1B1P3/2P2B2P2/1PRNQBKNRP1 w - 0 1'

/** Start position with the b1 pawn relocated to a5, one step from the a6
    promotion zone (Gliński promotions land on the top cell of the file). */
function fenWithPawnAtA5(): string {
  const board = new Map(parsePosition(START_FEN).board)
  board.delete(keyOf(notationToAxial('b1')!))
  board.set(keyOf(notationToAxial('a5')!), { type: 'P', color: 'w' })
  return serializePosition({
    board,
    turn: 'w',
    epTarget: null,
    halfmove: 0,
    fullmove: 1,
  })
}

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
  // b1→b2 (White pawn push) and b7→b6 (Black reply) are legal from the start.
  it('accepts a move and broadcasts it with ply, revision and colour', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    const b = fakeConn('b')
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(b.conn, join('ABCD', b.conn))

    core.receive(a.conn, move('b1', 'b2', 0))
    const frame = {
      type: 'move',
      from: 'b1',
      to: 'b2',
      ply: 1,
      revision: 1,
      color: 'white',
      by: 'a',
    }
    expect(a.last()).toMatchObject(frame) // echo to the sender
    expect(b.last()).toMatchObject(frame)
    expect(core.currentRevision).toBe(1)
  })

  it('rejects an illegal move with invalid_move and does not bump the revision', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    const b = fakeConn('b')
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(b.conn, join('ABCD', b.conn))

    // A king cannot reach f6 from g1 — a hostile/buggy client frame.
    core.receive(a.conn, move('g1', 'f6', 0))
    expect(a.find('error')).toMatchObject({
      type: 'error',
      code: 'invalid_move',
    })
    expect(a.last()).toMatchObject({ type: 'state', reason: 'invalid_move' })
    expect(core.moveCount).toBe(0)
    expect(core.currentRevision).toBe(0)
    expect(b.types()).not.toContain('move') // never broadcast
  })

  it('rejects a move from the side not to move', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    const b = fakeConn('b')
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(b.conn, join('ABCD', b.conn))

    core.receive(b.conn, move('b7', 'b6', 0)) // White is to move first
    expect(b.find('error')).toMatchObject({
      type: 'error',
      code: 'invalid_move',
    })
    expect(core.moveCount).toBe(0)
  })

  it('rejects a seat playing the other colour, even at that colour’s turn', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a') // white seat
    const b = fakeConn('b') // black seat
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(b.conn, join('ABCD', b.conn))

    core.receive(a.conn, move('b1', 'b2', 0)) // white's push; black to move now
    const peerSeen = b.sent.length
    core.receive(a.conn, move('b7', 'b6', 1)) // the white seat moving for black

    expect(a.find('error')).toMatchObject({
      type: 'error',
      code: 'invalid_move',
    })
    expect(core.moveCount).toBe(1)
    expect(core.currentRevision).toBe(1)
    expect(b.sent.length).toBe(peerSeen) // the hostile frame never spreads
  })

  it('a rejected move does not corrupt the following legal one', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    const b = fakeConn('b')
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(b.conn, join('ABCD', b.conn))

    core.receive(a.conn, move('g1', 'f6', 0)) // illegal, rejected
    core.receive(a.conn, move('b1', 'b2', 0)) // legal, same revision 0
    expect(a.last()).toMatchObject({
      type: 'move',
      from: 'b1',
      to: 'b2',
      revision: 1,
    })
    expect(core.currentRevision).toBe(1)
  })

  it('rejects a stale move with stale_move and pushes fresh state', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    const b = fakeConn('b')
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(b.conn, join('ABCD', b.conn))
    core.receive(a.conn, move('b1', 'b2', 0)) // revision now 1

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
    core.receive(a.conn, move('b1', 'b2', 0))

    const c = fakeConn('c')
    core.receive(c.conn, join('ABCD', c.conn))
    core.receive(c.conn, { v: 1, type: 'resync', revision: 1 })
    expect(c.last()).toMatchObject({
      type: 'state',
      revision: 1,
      moves: [{ from: 'b1', to: 'b2', ply: 1, color: 'white' }],
    })
  })

  it('welcome to a late joiner carries the accumulated moves', () => {
    const core = new RoomCore('ABCD')
    const a = fakeConn('a')
    core.receive(a.conn, join('ABCD', a.conn))
    core.receive(a.conn, move('b1', 'b2', 0))

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

    core.receive(c.conn, move('b1', 'b2', 0))
    expect(c.last()).toMatchObject({ type: 'error', code: 'bad_message' })
    expect(core.moveCount).toBe(0)
  })
})

describe('RoomCore promotion', () => {
  it('accepts a promotion move from a seeded position and broadcasts the kind', () => {
    const core = new RoomCore('ABCD', {
      fen: fenWithPawnAtA5(),
      moves: [],
      revision: 0,
    })
    const a = fakeConn('a')
    core.receive(a.conn, join('ABCD', a.conn))

    // On the promotion zone a choice is mandatory.
    core.receive(a.conn, move('a5', 'a6', 0))
    expect(a.find('error')).toMatchObject({
      type: 'error',
      code: 'invalid_move',
    })
    expect(core.moveCount).toBe(0)

    core.receive(a.conn, {
      v: 1,
      type: 'move',
      from: 'a5',
      to: 'a6',
      promotion: 'queen',
      revision: 0,
    })
    expect(a.last()).toMatchObject({
      type: 'move',
      from: 'a5',
      to: 'a6',
      promotion: 'queen',
      color: 'white',
      revision: 1,
    })
  })
})

describe('RoomCore persistence (t44)', () => {
  // Eviction = the DO is gone; a respawn hydrates a fresh RoomCore from the
  // stored snapshot. The DO wrapper only gets/puts that snapshot, so the
  // revive path is exercised here at the core the DO delegates to.
  it('a snapshot revives the room with the same code, revision and history', () => {
    const live = new RoomCore('ABCD')
    const a = fakeConn('a')
    const b = fakeConn('b')
    live.receive(a.conn, join('ABCD', a.conn))
    live.receive(b.conn, join('ABCD', b.conn))
    live.receive(a.conn, move('b1', 'b2', 0))
    live.receive(b.conn, move('b7', 'b6', 1))

    const revived = new RoomCore('ABCD', live.snapshot())
    expect(revived.currentRevision).toBe(2)
    expect(revived.moveCount).toBe(2)

    const c = fakeConn('c')
    revived.receive(c.conn, join('ABCD', c.conn))
    expect(c.find('welcome')).toMatchObject({
      room: 'ABCD',
      revision: 2,
      moves: [
        { from: 'b1', to: 'b2', ply: 1 },
        { from: 'b7', to: 'b6', ply: 2 },
      ],
    })
  })

  it('a revived room continues from the restored position, not just the list', () => {
    const live = new RoomCore('ABCD')
    const a = fakeConn('a')
    live.receive(a.conn, join('ABCD', a.conn))
    live.receive(a.conn, move('b1', 'b2', 0)) // White moved; Black to play

    const revived = new RoomCore('ABCD', live.snapshot())
    const w = fakeConn('w')
    const bl = fakeConn('b')
    revived.receive(w.conn, join('ABCD', w.conn)) // reclaims white
    revived.receive(bl.conn, join('ABCD', bl.conn)) // black
    // Legal only if the FEN — not just the move list — was restored.
    revived.receive(bl.conn, move('b7', 'b6', 1))
    expect(bl.last()).toMatchObject({
      type: 'move',
      from: 'b7',
      to: 'b6',
      revision: 2,
    })
  })

  it('a revived room still rejects a stale move', () => {
    const live = new RoomCore('ABCD')
    const a = fakeConn('a')
    live.receive(a.conn, join('ABCD', a.conn))
    live.receive(a.conn, move('b1', 'b2', 0)) // revision 1

    const revived = new RoomCore('ABCD', live.snapshot())
    const w = fakeConn('w')
    const bl = fakeConn('b')
    revived.receive(w.conn, join('ABCD', w.conn))
    revived.receive(bl.conn, join('ABCD', bl.conn))
    revived.receive(bl.conn, move('b7', 'b6', 1)) // revision 2
    revived.receive(bl.conn, move('b6', 'b5', 1)) // stale
    expect(bl.find('error')).toMatchObject({
      type: 'error',
      code: 'stale_move',
    })
    expect(revived.currentRevision).toBe(2)
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
