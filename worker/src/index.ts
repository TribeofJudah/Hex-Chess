import { PROTOCOL_VERSION, decodeClient, encode } from './protocol'
import { RoomCore, type Conn } from './room'

/**
 * Worker entry + Durable Object adapter (t41).
 *
 * The Worker routes `/room/<CODE>` WebSocket upgrades to the room's Durable
 * Object. The DO is a thin shell over the pure RoomCore in room.ts: it accepts
 * sockets, decodes frames, and forwards them; all room logic lives in RoomCore.
 */

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

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname
    const code = (path.split('/').pop() ?? '').toUpperCase()
    const core = (this.core ??= new RoomCore(code))

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
    })

    server.addEventListener('close', () => {
      if (conn.clientId) core.leave(conn.clientId)
    })

    return new Response(null, { status: 101, webSocket: client })
  }
}
