import { describe, expect, it } from 'vitest'
import {
  decode,
  encode,
  PROTOCOL_VERSION,
  type ClientMsg,
  type ServerMsg,
} from './protocol'

describe('protocol', () => {
  it('exposes the current version', () => {
    expect(PROTOCOL_VERSION).toBe(1)
  })

  it('encodes every client message shape as JSON', () => {
    const messages: ClientMsg[] = [
      { v: 1, type: 'join', room: 'ABCD', clientId: 'c1', protocol: 1 },
      { v: 1, type: 'move', from: 'g1', to: 'f6', revision: 3 },
      {
        v: 1,
        type: 'move',
        from: 'a1',
        to: 'b1',
        promotion: 'queen',
        revision: 4,
      },
      { v: 1, type: 'resync', revision: 7 },
      { v: 1, type: 'ping', t: 123 },
    ]
    for (const msg of messages) {
      expect(JSON.parse(encode(msg))).toEqual(msg)
    }
  })

  it('rejects client-only frames (decode is inbound-only)', () => {
    expect(
      decode(
        encode({ v: 1, type: 'join', room: 'A', clientId: 'c', protocol: 1 }),
      ),
    ).toBeNull()
    expect(decode(encode({ v: 1, type: 'resync', revision: 1 }))).toBeNull()
    expect(decode(encode({ v: 1, type: 'ping', t: 1 }))).toBeNull()
  })

  it('round-trips every server message shape', () => {
    const messages: ServerMsg[] = [
      {
        v: 1,
        type: 'welcome',
        room: 'ABCD',
        clientId: 'c1',
        seat: 'white',
        protocol: 1,
        revision: 0,
        moves: [],
      },
      { v: 1, type: 'state', revision: 2, moves: [], reason: 'resync' },
      {
        v: 1,
        type: 'move',
        from: 'g1',
        to: 'f6',
        ply: 1,
        color: 'white',
        revision: 1,
        by: 'c1',
      },
      {
        v: 1,
        type: 'peer',
        connected: true,
        seats: { white: true, black: false },
      },
      {
        v: 1,
        type: 'error',
        code: 'version_mismatch',
        message: 'nope',
        expectedProtocol: 2,
      },
      { v: 1, type: 'pong', t: 123 },
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
})
