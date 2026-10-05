import { PROTOCOL_VERSION, decodeClient, encode } from './protocol'
import { RoomCore, type Conn, type RoomSnapshot } from './room'

/**
 * Worker entry + Durable Object adapter (t41).
 *
 * The Worker routes `/room/<CODE>` WebSocket upgrades to the room's Durable
 * Object. The DO is a thin shell over the pure RoomCore in room.ts: it accepts
 * sockets, decodes frames, and forwards them; all room logic lives in RoomCore.
 *
 * Persistence (t44): the DO's storage holds one `RoomSnapshot`. A respawned
 * object (after eviction) hydrates its RoomCore from it, so the room keeps its
 * code and move history. Writes are fire-and-forget — DO storage is coalesced
 * and flushed before eviction, so awaiting would only add latency.
 */

const STORAGE_KEY = 'room'

export interface Env {
  ROOMS: DurableObjectNamespace
}

const ROOM_PATH = /^\/room\/([A-Za-z0-9]{4,8})$/

export default {
  fetch(req: Request, env: Env): Promise<Response> | Response {
    const { pathname } = new URL(req.url)
    const match = ROOM_PATH.exec(pathname)
    if (!match) return new Response('not found', { status: 404 })
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 })
    }
    const code = (match[1] ?? '').toUpperCase()
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req)
  },
} satisfies ExportedHandler<Env>

/** One instance per room, addressed by name. */
export class RoomDO {
  private core: RoomCore | null = null

  constructor(private ctx: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname
    const code = (path.split('/').pop() ?? '').toUpperCase()
    if (!this.core) {
      const saved = await this.ctx.storage.get<RoomSnapshot>(STORAGE_KEY)
      this.core = new RoomCore(code, saved)
    }
    const core = this.core

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()

    const conn: Conn = {
      clientId: '',
      protocol: PROTOCOL_VERSION,
      send: (msg) => server.send(encode(msg)),
    }

    server.addEventListener('message', (event: MessageEvent) => {
      const raw = typeof event.data === 'string' ? event.data : ''
      const msg = decodeClient(raw)
      if (!msg) {
        conn.send({
          v: PROTOCOL_VERSION,
          type: 'error',
          code: 'bad_message',
          message: 'unparseable frame',
        })
        return
      }
      if (msg.type === 'join') {
        conn.clientId = msg.clientId
        conn.protocol = msg.protocol
      } else if (!conn.clientId) {
        return // must join before any other frame
      }
      core.receive(conn, msg)
      // join/resync/ping never change room state; a move or a draw frame might.
      if (msg.type !== 'join' && msg.type !== 'resync' && msg.type !== 'ping') {
        this.persist(core)
      }
    })

    server.addEventListener('close', () => {
      if (conn.clientId) core.leave(conn.clientId)
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  /** Write the room's state so an evicted DO resumes with history (t44). */
  private persist(core: RoomCore): void {
    void this.ctx.storage.put(STORAGE_KEY, core.snapshot())
  }
}
