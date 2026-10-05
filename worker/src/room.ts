import {
  PROTOCOL_VERSION,
  type ClientMsg,
  type MoveMsg,
  type Seat,
  type ServerMsg,
  type WireMove,
} from './protocol'

/**
 * Pure room state machine (t41). No sockets, no timers, no Durable Object
 * bindings — so it is fully unit-testable (worker/test/room.test.ts). The DO
 * adapter in index.ts supplies `Conn.send` and forwards frames here.
 *
 * Rules per claudedocs/ROOM_PROTO.md: append-only ordered move list, sticky
 * seats reclaimed by clientId, spectator overflow, revision-gated moves.
 */

/** A live client the room can send to. */
export interface Conn {
  clientId: string
  /** The protocol version this client announced at join. */
  protocol: number
  send(msg: ServerMsg): void
}

interface LiveConn extends Conn {
  seat: Seat
}

export class RoomCore {
  private moves: WireMove[] = []
  private revision = 0
  private live = new Map<string, LiveConn>()
  /**
   * Seat reserved per clientId for the life of the room, so a reconnect
   * reclaims it and no second client is ever handed the same colour (t40 §4/§7).
   */
  private reserved = new Map<string, Seat>()

  constructor(readonly room: string) {}

  get moveCount(): number {
    return this.moves.length
  }
  get currentRevision(): number {
    return this.revision
  }

  /** Route one already-decoded client frame. */
  receive(conn: Conn, msg: ClientMsg): void {
    switch (msg.type) {
      case 'join':
        this.join(conn)
        break
      case 'move':
        this.move(conn, msg)
        break
      case 'resync':
        this.sendState(conn, 'resync')
        break
      case 'ping':
        conn.send({ v: PROTOCOL_VERSION, type: 'pong', t: msg.t })
        break
    }
  }

  join(conn: Conn): void {
    if (conn.protocol !== PROTOCOL_VERSION) {
      conn.send({
        v: PROTOCOL_VERSION,
        type: 'error',
        code: 'version_mismatch',
        message: `server speaks protocol v${PROTOCOL_VERSION}, client sent v${conn.protocol}`,
        expectedProtocol: PROTOCOL_VERSION,
        receivedProtocol: conn.protocol,
      })
      return
    }
    const seat = this.reserved.get(conn.clientId) ?? this.freeSeat()
    this.reserved.set(conn.clientId, seat)
    this.live.set(conn.clientId, { ...conn, seat })
    conn.send({
      v: PROTOCOL_VERSION,
      type: 'welcome',
      room: this.room,
      clientId: conn.clientId,
      seat,
      protocol: PROTOCOL_VERSION,
      revision: this.revision,
      moves: this.moves.slice(),
    })
    this.broadcastPeer()
  }

  /** First seat never yet handed out; spectator once white and black are gone. */
  private freeSeat(): Seat {
    const taken = new Set(this.reserved.values())
    if (!taken.has('white')) return 'white'
    if (!taken.has('black')) return 'black'
    return 'spectator'
  }

  private move(conn: Conn, msg: MoveMsg): void {
    const mover = this.live.get(conn.clientId)
    if (!mover || mover.seat === 'spectator') {
      conn.send({
        v: PROTOCOL_VERSION,
        type: 'error',
        code: 'bad_message',
        message: 'spectators cannot move',
      })
      return
    }
    if (msg.revision !== this.revision) {
      conn.send({
        v: PROTOCOL_VERSION,
        type: 'error',
        code: 'stale_move',
        message: `move at revision ${msg.revision}, server at ${this.revision}`,
      })
      this.sendState(conn, 'stale_move')
      return
    }
    const move: WireMove = {
      from: msg.from,
      to: msg.to,
      ply: this.moves.length + 1,
      color: mover.seat === 'black' ? 'black' : 'white',
      ...(msg.promotion ? { promotion: msg.promotion } : {}),
    }
    this.moves.push(move)
    this.revision += 1
    this.broadcast({
      v: PROTOCOL_VERSION,
      type: 'move',
      from: move.from,
      to: move.to,
      ply: move.ply,
      color: move.color,
      revision: this.revision,
      by: conn.clientId,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    })
  }

  private sendState(conn: Conn, reason: string): void {
    conn.send({
      v: PROTOCOL_VERSION,
      type: 'state',
      revision: this.revision,
      moves: this.moves.slice(),
      reason,
    })
  }

  /** A socket closed: free the live slot; the seat stays reserved for reclaim. */
  leave(clientId: string): void {
    if (!this.live.delete(clientId)) return
    this.broadcastPeer()
  }

  private broadcastPeer(): void {
    const seats = { white: false, black: false }
    for (const c of this.live.values()) {
      if (c.seat === 'white') seats.white = true
      else if (c.seat === 'black') seats.black = true
    }
    this.broadcast({
      v: PROTOCOL_VERSION,
      type: 'peer',
      connected: seats.white && seats.black,
      seats,
    })
  }

  private broadcast(msg: ServerMsg): void {
    for (const c of this.live.values()) c.send(msg)
  }
}
