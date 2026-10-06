import { describe, expect, it } from 'vitest'
import { decodeClient, encode, PROTOCOL_VERSION } from '../src/protocol'

describe('worker protocol codec', () => {
  it('exposes the current version', () => {
    expect(PROTOCOL_VERSION).toBe(2)
  })

  it('decodes every client frame shape', () => {
    const frames = [
      { v: 1, type: 'join', room: 'ABCD', clientId: 'c1', protocol: 1 },
      { v: 1, type: 'move', from: 'g1', to: 'f6', revision: 0 },
      {
        v: 1,
        type: 'move',
        from: 'a1',
        to: 'a2',
        promotion: 'queen',
        revision: 1,
      },
      { v: 1, type: 'resync', revision: 3 },
      { v: 1, type: 'ping', t: 7 },
    ]
    for (const frame of frames) {
      expect(decodeClient(JSON.stringify(frame))).toEqual(frame)
    }
  })

  it('rejects anything that is not a client frame', () => {
    expect(decodeClient('not json')).toBeNull()
    expect(decodeClient('null')).toBeNull()
    expect(decodeClient('{}')).toBeNull() // no v
    expect(decodeClient('{ "v": 1, "type": "welcome" }')).toBeNull() // server-only
    expect(decodeClient('{ "v": 1, "type": "surprise" }')).toBeNull()
  })

  it('encodes server frames as JSON', () => {
    const frame = { v: 1, type: 'pong', t: 7 } as const
    expect(JSON.parse(encode(frame))).toEqual(frame)
  })
})
