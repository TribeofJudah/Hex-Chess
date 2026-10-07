import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { notationToAxial } from '../src/board/notation'
import { keyOf, type Piece } from '../src/board/pieces'
import { serializePosition } from '../src/board/fen'
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '../src/protocol'
import type { RoomSnapshot } from '../src/room'
import type { GameState } from '../src/rules/rules'
import { roomStub } from './setup'

/**
 * t67 (Round 15): the terminal paths exercised across the **real Durable
 * Object boundary** — a live WebSocket to `RoomDO`, not the pure `RoomCore`
 * (that coverage lives in room.test.ts / terminals.test.ts). Proves the DO
 * adapter decodes frames, forwards them to the core and broadcasts the
 * terminal back out to both sockets.
 */

/** Open a WebSocket into the room DO (same shape the Worker routes). */
async function connect(stub: DurableObjectStub) {
  const res = await stub.fetch('http://do/room', {
    headers: { Upgrade: 'websocket' },
  })
  const ws = res.webSocket
  if (!ws) throw new Error('expected a websocket upgrade response')
  ws.accept()

  const buffered: ServerMsg[] = []
  const waiters: Array<{
    type: ServerMsg['type']
    resolve: (m: ServerMsg) => void
  }> = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMsg
    const i = waiters.findIndex((w) => w.type === msg.type)
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(msg)
    else buffered.push(msg)
  })

  return {
    send: (msg: ClientMsg) => ws.send(JSON.stringify(msg)),
    /** Resolve on the next frame of `type`, reusing anything already buffered. */
    waitFor: (type: ServerMsg['type']): Promise<ServerMsg> => {
      const i = buffered.findIndex((m) => m.type === type)
      if (i >= 0) return Promise.resolve(buffered.splice(i, 1)[0]!)
      return new Promise((resolve, reject) => {
        waiters.push({ type, resolve })
        setTimeout(
          () => reject(new Error(`timeout waiting for ${type}`)),
          2000,
        )
      })
    },
    close: () => ws.close(),
  }
}

type Client = Awaited<ReturnType<typeof connect>>

/** Join a seat under a stable clientId; the DO keys the conn on this frame. */
const join = (clientId: string): ClientMsg => ({
  v: PROTOCOL_VERSION,
  type: 'join',
  room: 'ABCD',
  clientId,
  protocol: PROTOCOL_VERSION,
})

const move = (from: string, to: string, revision: number): ClientMsg => ({
  v: PROTOCOL_VERSION,
  type: 'move',
  from,
  to,
  revision,
})

/** Seat two players on one room and drain both welcomes. */
async function seated(code: string): Promise<[Client, Client]> {
  const stub = roomStub(code)
  const w = await connect(stub)
  const b = await connect(stub)
  w.send(join('w'))
  await w.waitFor('welcome')
  b.send(join('b'))
  await b.waitFor('welcome')
  return [w, b]
}

/** Sparse custom position (mirrors `customPos` in terminals.test.ts). */
function customPos(
  pieces: Array<[string, Piece]>,
  turn: 'w' | 'b' = 'w',
): GameState {
  const board = new Map<string, Piece>()
  for (const [n, p] of pieces) board.set(keyOf(notationToAxial(n)!), p)
  return { board, turn, epTarget: null, halfmove: 0, fullmove: 1, history: [] }
}

describe('RoomDO terminals (t67, real DO boundary)', () => {
  it('broadcasts a checkmate terminal to both sockets', async () => {
    const [w, b] = await seated('MATE')
    // Wikipedia Fool's mate: 1.Qe1c3 Qe10c6 2.b1b2 b7b6 3.Bf3b1 e7e6 4.Qc3xf9#
    const plies: Array<[Client, string, string]> = [
      [w, 'e1', 'c3'],
      [b, 'e10', 'c6'],
      [w, 'b1', 'b2'],
      [b, 'b7', 'b6'],
      [w, 'f3', 'b1'],
      [b, 'e7', 'e6'],
      [w, 'c3', 'f9'],
    ]
    let revision = 0
    for (const [client, from, to] of plies) {
      client.send(move(from, to, revision))
      await client.waitFor('move')
      revision += 1
    }
    // The mated side is black; the deliverer (and wire winner) is white.
    expect(await w.waitFor('roomEnd')).toMatchObject({
      type: 'roomEnd',
      code: 'MATE',
      reason: 'checkmate',
      winner: 'white',
    })
    expect(await b.waitFor('roomEnd')).toMatchObject({
      reason: 'checkmate',
      winner: 'white',
    })
  })

  it('broadcasts a Gliński stalemate with winner = the trapping side', async () => {
    const stub = roomStub('STALE')
    // Seed a pre-stalemate position straight into the DO's storage — the t44
    // revive path the DO itself hydrates from on the next fetch.
    const fen = serializePosition(
      customPos([
        ['d8', { type: 'Q', color: 'w' }],
        ['c8', { type: 'K', color: 'b' }],
        ['l1', { type: 'K', color: 'w' }],
      ]),
    )
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put('room', { fen, moves: [], revision: 0 })
    })

    const w = await connect(stub)
    const b = await connect(stub)
    w.send(join('w'))
    await w.waitFor('welcome')
    b.send(join('b'))
    await b.waitFor('welcome')

    // White captures black's last piece; black is then to move with no legal
    // move and no check → stalemate. Gliński scores 3/4 to the trapping side,
    // so `winner` is `other(turn after)` = white (mirrors R12).
    w.send(move('d8', 'c8', 0))
    await w.waitFor('move')
    expect(await w.waitFor('roomEnd')).toMatchObject({
      type: 'roomEnd',
      code: 'STALE',
      reason: 'stalemate',
      winner: 'white',
    })
    expect(await b.waitFor('roomEnd')).toMatchObject({
      reason: 'stalemate',
      winner: 'white',
    })
  })

  it('ends the room on resign and persists the terminal', async () => {
    const [w, b] = await seated('RSGN')
    b.send({ v: PROTOCOL_VERSION, type: 'resign' })

    // Black conceded → the wire winner is the opponent (white), and both
    // sockets see the same terminal.
    expect(await w.waitFor('roomEnd')).toMatchObject({
      type: 'roomEnd',
      code: 'RSGN',
      reason: 'resign',
      winner: 'white',
    })
    expect(await b.waitFor('roomEnd')).toMatchObject({
      reason: 'resign',
      winner: 'white',
    })

    // The DO wrote the snapshot (t44): a revived object would hydrate ended.
    const snap = await runInDurableObject(roomStub('RSGN'), (_i, state) =>
      state.storage.get<RoomSnapshot>('room'),
    )
    expect(snap?.ended).toBe(true)
    expect(snap?.clock?.since).toBeNull() // clock stopped on the terminal
  })
})
