import { TICK_MS } from './clock'
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
 *
 * Clock (t56): the DO owns the 1 Hz tick. An alarm is a Durable Object's only
 * timer and it survives eviction, so a woken object re-hydrates its core and
 * keeps counting from the persisted `since` — the core itself holds no timers.
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
  /** A 1 Hz clock alarm is scheduled (t56). */
  private ticking = false

  constructor(private ctx: DurableObjectState) {}

  /** The room's core, hydrated from storage on a cold start (t44). */
  private async load(): Promise<RoomCore> {
    if (!this.core) {
      const saved = await this.ctx.storage.get<RoomSnapshot>(STORAGE_KEY)
      // The DO id is the room code (`idFromName(code)` in the Worker).
      this.core = new RoomCore(this.ctx.id.name ?? '', saved)
    }
    return this.core
  }

  async fetch(_req: Request): Promise<Response> {
    const core = await this.load()

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
      // resync/ping never change room state; a join may start the clock, a
      // move or draw frame may stop it.
      if (msg.type !== 'resync' && msg.type !== 'ping') {
        this.persist(core)
      }
      this.arm(core)
    })

    server.addEventListener('close', () => {
      if (conn.clientId) core.leave(conn.clientId)
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  /** The 1 Hz tick (t56): broadcast the clock, flag a seat, re-arm. */
  async alarm(): Promise<void> {
    const core = await this.load()
    if (core.tick(Date.now())) {
      this.ticking = true
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS)
    } else {
      // No clock running (the room ended, or it never started).
      this.ticking = false
      this.persist(core)
    }
  }

  /** Arm the tick alarm iff a clock is burning and none is armed (t56). */
  private arm(core: RoomCore): void {
    if (!core.clockRunning || this.ticking) return
    this.ticking = true
    void this.ctx.storage.setAlarm(Date.now() + TICK_MS)
  }

  /** Write the room's state so an evicted DO resumes with history (t44). */
  private persist(core: RoomCore): void {
    void this.ctx.storage.put(STORAGE_KEY, core.snapshot())
  }
}
