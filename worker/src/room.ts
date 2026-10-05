import {
  PROTOCOL_VERSION,
  type ClientMsg,
  type MoveMsg,
  type Seat,
  type ServerMsg,
  type WireMove,
} from './protocol'
import { serializePosition } from './board/fen'
import { initialGame } from './rules/rules'
import { validateMove } from './validate'

/**
 * Pure room state machine (t41). No sockets, no timers, no Durable Object
 * bindings — so it is fully unit-testable (worker/test/room.test.ts). The DO
 * adapter in index.ts supplies `Conn.send` and forwards frames here.
 *
 * Rules per claudedocs/ROOM_PROTO.md: append-only ordered move list, sticky
 * seats reclaimed by clientId, spectator overflow, revision-gated moves.
 * Moves are validated server-side through the SAME pure engine the UI uses
 * (t43, vendored verbatim under worker/src/board + worker/src/rules): the
 * room holds the authoritative FEN, advances it only on an ok verdict, and
 * NACKs an illegal, out-of-turn or mis-seated move with `invalid_move` —
 * a rejected frame is never broadcast.
 */

/**
 * The room's authoritative state is the position FEN itself — the same
 * serialization the UI carries over the wire (t43).
 */
const INITIAL_FEN = serializePosition(initialGame())

/** Side to move, from the FEN's second field (src/board/fen.ts format). */
function fenTurn(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

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
  /** Authoritative position (FEN), advanced only on validated moves (t43). */
  private fen = INITIAL_FEN
  private live = new Map<string, LiveConn>()
  /**
   * Seat reserved per clientId for the life of the room, so a reconnect
   * reclaims it and no second client is ever handed the same colour (t40 §4/§7).
   */
  private reserved = new Map<string, Seat>()

  constructor(
    readonly room: string,
    fen?: string,
  ) {
    if (fen !== undefined) this.fen = fen
  }

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
    const seatColor = mover.seat === 'black' ? 'black' : 'white'
    const turn = fenTurn(this.fen)
    if (seatColor !== turn) {
      // A seat must never push the other side's pieces — otherwise the
      // broadcast could carry the wrong colour and the two clients diverge.
      this.nackInvalid(conn, `it is ${turn}'s turn, not ${seatColor}'s`)
      return
    }
    const verdict = validateMove(this.fen, msg.from, msg.to, msg.promotion)
    if (!verdict.ok) {
      this.nackInvalid(conn, verdict.reason)
      return
    }
    this.fen = verdict.nextFen
    const move: WireMove = {
      from: msg.from,
      to: msg.to,
      ply: this.moves.length + 1,
      color: seatColor,
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

  /** A rejected move: NACK the sender, re-sync it, mutate nothing. */
  private nackInvalid(conn: Conn, message: string): void {
    conn.send({
      v: PROTOCOL_VERSION,
      type: 'error',
      code: 'invalid_move',
      message,
    })
    this.sendState(conn, 'invalid_move')
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
