import { describe, expect, it } from 'vitest'
import {
  decode,
  encode,
  ERROR_CODES,
  PROTOCOL_VERSION,
  type ClientMsg,
  type ServerMsg,
} from './protocol'

describe('protocol', () => {
  it('exposes the current version', () => {
    // Bumped to 2 in t56 (clock + ended on welcome; clock frames; roomEnd.reason
    // gained 'time' + optional winner).
    expect(PROTOCOL_VERSION).toBe(2)
  })

  it('encodes every client message shape as JSON', () => {
    const messages: ClientMsg[] = [
      { v: PROTOCOL_VERSION, type: 'join', room: 'ABCD', clientId: 'c1', protocol: PROTOCOL_VERSION },
      { v: PROTOCOL_VERSION, type: 'move', from: 'g1', to: 'f6', revision: 3 },
      {
        v: PROTOCOL_VERSION,
        type: 'move',
        from: 'a1',
        to: 'b1',
        promotion: 'queen',
        revision: 4,
      },
      { v: PROTOCOL_VERSION, type: 'resync', revision: 7 },
      { v: PROTOCOL_VERSION, type: 'ping', t: 123 },
    ]
    for (const msg of messages) {
      expect(JSON.parse(encode(msg))).toEqual(msg)
    }
  })

  it('rejects client-only frames (decode is inbound-only)', () => {
    expect(
      decode(
        encode({ v: PROTOCOL_VERSION, type: 'join', room: 'A', clientId: 'c', protocol: PROTOCOL_VERSION }),
      ),
    ).toBeNull()
    expect(decode(encode({ v: PROTOCOL_VERSION, type: 'resync', revision: 1 }))).toBeNull()
    expect(decode(encode({ v: PROTOCOL_VERSION, type: 'ping', t: 1 }))).toBeNull()
  })

  it('round-trips every server message shape', () => {
    const messages: ServerMsg[] = [
      {
        v: PROTOCOL_VERSION,
        type: 'welcome',
        room: 'ABCD',
        clientId: 'c1',
        seat: 'white',
        protocol: PROTOCOL_VERSION,
        revision: 0,
        moves: [],
      },
      { v: PROTOCOL_VERSION, type: 'state', revision: 2, moves: [], reason: 'resync' },
      {
        v: PROTOCOL_VERSION,
        type: 'move',
        from: 'g1',
        to: 'f6',
        ply: 1,
        color: 'white',
        revision: 1,
        by: 'c1',
      },
      {
        v: PROTOCOL_VERSION,
        type: 'peer',
        connected: true,
        seats: { white: true, black: false },
      },
      {
        v: PROTOCOL_VERSION,
        type: 'error',
        code: 'version_mismatch',
        message: 'nope',
        expectedProtocol: 2,
      },
      { v: PROTOCOL_VERSION, type: 'pong', t: 123 },
    ]
    for (const msg of messages) {
      expect(decode(encode(msg))).toEqual(msg)
    }
  })

  it('returns null for anything that is not a known server message', () => {
    expect(decode('not json')).toBeNull()
    expect(decode('null')).toBeNull()
    expect(decode('42')).toBeNull()
    expect(decode('"hello"')).toBeNull()
    expect(decode('{}')).toBeNull()
    expect(decode('{ "type": "welcome" }')).toBeNull() // missing v
    expect(decode('{ "v": 1, "type": "welcome", "v2": 3 }')).not.toBeNull()
    expect(decode('{ "v": 1, "type": "surprise" }')).toBeNull() // unknown type
  })

  it('round-trips the draw-agreement frames (t48)', () => {
    const messages: Array<ClientMsg | ServerMsg> = [
      // client -> server
      { v: PROTOCOL_VERSION, type: 'offerDraw', code: 'ABCD', by: 'white' },
      { v: PROTOCOL_VERSION, type: 'acceptDraw', code: 'ABCD' },
      { v: PROTOCOL_VERSION, type: 'declineDraw', code: 'ABCD' },
      // server -> client
      {
        v: PROTOCOL_VERSION,
        type: 'drawOffer',
        code: 'ABCD',
        state: 'offered',
        by: 'white',
      },
      {
        v: PROTOCOL_VERSION,
        type: 'drawOffer',
        code: 'ABCD',
        state: 'awaiting',
        by: 'black',
      },
      { v: PROTOCOL_VERSION, type: 'drawOffer', code: 'ABCD', state: 'idle', by: 'black' },
      { v: PROTOCOL_VERSION, type: 'roomEnd', code: 'ABCD', reason: 'draw_agreement' },
    ]
    for (const msg of messages) {
      expect(JSON.parse(encode(msg))).toEqual(msg)
      if (
        msg.type === 'offerDraw' ||
        msg.type === 'acceptDraw' ||
        msg.type === 'declineDraw'
      ) {
        // The client decode() is inbound-only: client frames never parse.
        expect(decode(encode(msg))).toBeNull()
      } else {
        expect(decode(encode(msg))).toEqual(msg)
      }
    }
  })

  it('round-trips the clock frames (t56)', () => {
    const messages: Array<ClientMsg | ServerMsg> = [
      // Welcome now carries the (optional) clock + ended flag.
      {
        v: PROTOCOL_VERSION,
        type: 'welcome',
        room: 'ABCD',
        clientId: 'c1',
        seat: 'white',
        protocol: PROTOCOL_VERSION,
        revision: 0,
        moves: [],
        clock: { whiteMs: 300_000, blackMs: 300_000, lastTickAt: 0, tickMs: 1000, incrementMs: 3_000 },
        ended: false,
      },
      // Clock update from the server.
      {
        v: PROTOCOL_VERSION,
        type: 'clock',
        code: 'ABCD',
        clock: { whiteMs: 295_000, blackMs: 300_000, lastTickAt: 5_000, tickMs: 1000, incrementMs: 3_000 },
      },
      // roomEnd gained 'time' + optional winner.
      { v: PROTOCOL_VERSION, type: 'roomEnd', code: 'ABCD', reason: 'time', winner: 'black' },
    ]
    for (const msg of messages) {
      expect(decode(encode(msg))).toEqual(msg)
    }
  })

  it('lists invalid_draw among the error codes (t48)', () => {
    expect(ERROR_CODES).toContain('invalid_draw')
  })
})
