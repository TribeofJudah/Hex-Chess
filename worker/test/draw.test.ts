import { describe, expect, it } from 'vitest'
import {
  PROTOCOL_VERSION,
  type ClientMsg,
  type ServerMsg,
} from '../src/protocol'
import { RoomCore, type Conn } from '../src/room'
import { validateDraw } from '../src/validate'

const START_FEN =
  'b/qbk/n1b1n/r5r/ppppppppp/11/5P5/4P1P4/3P1B1P3/2P2B2P2/1PRNQBKNRP1 w - 0 1'

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
    types: () => sent.map((m) => m.type),
  }
}

const join = (conn: Conn): ClientMsg => ({
  v: 1,
  type: 'join',
  room: 'ABCD',
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
const offer = (by: 'white' | 'black' | 'spectator'): ClientMsg => ({
  v: 1,
  type: 'offerDraw',
  code: 'ABCD',
  by,
})
const accept: ClientMsg = { v: 1, type: 'acceptDraw', code: 'ABCD' }
const decline: ClientMsg = { v: 1, type: 'declineDraw', code: 'ABCD' }

/** A room with both seats taken: `w` = white, `b` = black. */
function seated() {
  const core = new RoomCore('ABCD')
  const w = fakeConn('w')
  const b = fakeConn('b')
  core.receive(w.conn, join(w.conn))
  core.receive(b.conn, join(b.conn))
  return { core, w, b }
}

describe('RoomCore draw agreement (t48)', () => {
  it('white offers on white’s turn, black accepts, the room ends', () => {
    const { core, w, b } = seated()

    core.receive(w.conn, offer('white'))
    // Per seat: the offerer is `awaiting`, the opponent is `offered`.
    expect(w.last()).toMatchObject({
      type: 'drawOffer',
      code: 'ABCD',
      state: 'awaiting',
      by: 'white',
    })
    expect(b.last()).toMatchObject({
      type: 'drawOffer',
      state: 'offered',
      by: 'white',
    })
    expect(core.drawOfferState).toBe('awaiting')

    core.receive(b.conn, accept)
    expect(w.find('roomEnd')).toMatchObject({
      type: 'roomEnd',
      code: 'ABCD',
      reason: 'draw_agreement',
    })
    expect(b.find('roomEnd')).toMatchObject({ reason: 'draw_agreement' })
    // The offer is cleared, terminal state recorded, snapshot carries it.
    expect(w.last()).toMatchObject({ type: 'roomEnd' })
    expect(core.drawOfferState).toBe('idle')
    expect(core.snapshot()).toMatchObject({ drawOffer: 'idle', ended: true })
  })

  it('white offers, black declines, the offer clears with no roomEnd', () => {
    const { core, w, b } = seated()

    core.receive(w.conn, offer('white'))
    core.receive(b.conn, decline)
    expect(b.last()).toMatchObject({
      type: 'drawOffer',
      state: 'idle',
      by: 'black',
    })
    expect(b.find('roomEnd')).toBeUndefined()
    expect(core.drawOfferState).toBe('idle')
    expect(core.snapshot().ended).toBe(false)
  })

  it('refuses an offer on the opponent’s turn', () => {
    const { core, w } = seated()
    core.receive(w.conn, move('b1', 'b2', 0)) // white moved; black to move

    core.receive(w.conn, offer('white'))
    expect(w.find('error')).toMatchObject({
      type: 'error',
      code: 'invalid_draw',
      message: 'not_your_turn',
    })
    expect(w.last()).toMatchObject({ type: 'state', reason: 'invalid_draw' })
    expect(core.drawOfferState).toBe('idle')
    expect(core.currentRevision).toBe(1)
  })

  it('refuses accept with no offer, and an offerer answering their own offer', () => {
    const { core, w } = seated()

    core.receive(w.conn, accept) // nothing was offered
    expect(w.find('error')).toMatchObject({
      code: 'invalid_draw',
      message: 'no_open_offer',
    })

    core.receive(w.conn, offer('white'))
    core.receive(w.conn, accept) // the offerer cannot accept their own offer
    expect(w.find('error')).toMatchObject({
      code: 'invalid_draw',
      message: 'no_open_offer',
    })
    expect(core.snapshot().ended).toBe(false)
  })

  it('refuses a spectator on both offer and accept', () => {
    const { core } = seated()
    const s = fakeConn('s')
    core.receive(s.conn, join(s.conn))
    expect(s.find('welcome')).toMatchObject({ seat: 'spectator' })

    core.receive(s.conn, offer('white')) // a real seat must be derived, not claimed
    expect(s.find('error')).toMatchObject({
      code: 'invalid_draw',
      message: 'not_your_turn',
    })
    core.receive(s.conn, accept)
    expect(s.find('error')).toMatchObject({
      code: 'invalid_draw',
      message: 'not_your_turn',
    })
  })

  it('refuses an offer once the room is over', () => {
    const core = new RoomCore('ABCD', {
      fen: START_FEN,
      moves: [],
      revision: 0,
      ended: true,
    })
    const w = fakeConn('w')
    core.receive(w.conn, join(w.conn))
    core.receive(w.conn, offer('white'))
    expect(w.find('error')).toMatchObject({
      code: 'invalid_draw',
      message: 'game_over',
    })
  })

  it('a revived room keeps its open offer', () => {
    const { core, w } = seated()
    core.receive(w.conn, offer('white'))

    const revived = new RoomCore('ABCD', core.snapshot())
    expect(revived.drawOfferState).toBe('awaiting')
    // The offer survives, so the opponent can still accept it after eviction.
    expect(revived.acceptDraw('black')).toMatchObject({
      ok: true,
      end: { reason: 'draw_agreement' },
    })
    expect(revived.snapshot().ended).toBe(true)
  })

  it('rejects a malformed draw payload with invalid_draw', () => {
    expect(
      validateDraw({ v: 1, type: 'offerDraw', by: 'white' } as never),
    ).toMatchObject({ ok: false, reason: 'missing room code' })
    expect(
      validateDraw({
        v: 1,
        type: 'offerDraw',
        code: 'ABCD',
        by: 'king',
      } as never),
    ).toMatchObject({ ok: false })

    const { core, w } = seated()
    core.receive(w.conn, { v: 1, type: 'acceptDraw', code: '' } as ClientMsg)
    expect(w.find('error')).toMatchObject({ code: 'invalid_draw' })
    core.receive(w.conn, { v: 1, type: 'declineDraw' } as ClientMsg)
    expect(w.find('error')).toMatchObject({ code: 'invalid_draw' })
  })
})
