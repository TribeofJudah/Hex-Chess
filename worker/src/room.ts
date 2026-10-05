import {
  PROTOCOL_VERSION,
  type ClientMsg,
  type DrawMsg,
  type MoveMsg,
  type Seat,
  type ServerMsg,
  type WireMove,
} from './protocol'
import { serializePosition } from './board/fen'
import { initialGame } from './rules/rules'
import { validateDraw, validateMove } from './validate'

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
 *
 * `snapshot()`/the constructor's `snapshot` option (t44) let the DO persist
 * this state and revive the room after eviction; the class itself stays
 * storage-agnostic.
 *
 * Draw agreement (t48): `offerDraw`/`acceptDraw`/`declineDraw` are pure state
 * transitions returning a `DrawResult`; `receive` turns that into the wire
 * frames. The room has one terminal state (an agreed draw) — checkmate and
 * the other engine game-overs are not yet enforced here.
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

/** A refused draw action (t48), shared by the three draw methods. */
function drawFail(reason: DrawReason): Extract<DrawResult, { ok: false }> {
  return { ok: false, error: 'invalid_draw', reason }
}

/**
 * A room's durable state (t44): everything needed to revive the room in a
 * fresh Durable Object after eviction. Seats are deliberately NOT included —
 * they are live-connection state, re-derived on rejoin (see ROOM_PROTO §4).
 * The draw fields are optional so a pre-t48 snapshot still hydrates.
 */
export interface RoomSnapshot {
  fen: string
  moves: WireMove[]
  revision: number
  /** An offer is open (t48). */
  drawOffer?: 'idle' | 'awaiting'
  /** Seat that owns the open offer, or null. */
  drawBy?: Seat | null
  /** A draw has been agreed; the room is terminal. */
  ended?: boolean
}

/** Why a draw frame was refused (t48). */
export type DrawReason = 'not_your_turn' | 'no_open_offer' | 'game_over'

/**
 * The draw-agreement return shape (t48), mirroring `MoveVerdict`: `ok` is the
 * caller's permission to act. On success `drawOffer` is the room-level state
 * after the call and `end` is present only when the room just ended.
 */
export type DrawResult =
  | {
      ok: true
      drawOffer: 'offered' | 'awaiting' | 'idle'
      by: Seat
      end?: { reason: 'draw_agreement' }
    }
  | { ok: false; error: 'invalid_draw'; reason: DrawReason }

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
  /** Draw agreement (t48): open offer, its owner, and the terminal flag. */
  private drawOffer: 'idle' | 'awaiting' = 'idle'
  private drawBy: Seat | null = null
  private ended = false

  constructor(
    readonly room: string,
    snapshot?: RoomSnapshot,
  ) {
    if (snapshot) {
      this.fen = snapshot.fen
      this.moves = snapshot.moves.slice()
      this.revision = snapshot.revision
      this.drawOffer = snapshot.drawOffer ?? 'idle'
      this.drawBy = snapshot.drawBy ?? null
      this.ended = snapshot.ended ?? false
    }
  }

  get moveCount(): number {
    return this.moves.length
  }
  get currentRevision(): number {
    return this.revision
  }
  /** Room-level draw state: `awaiting` iff an offer is open (t48). */
  get drawOfferState(): 'idle' | 'awaiting' {
    return this.drawOffer
  }

  /** State a respawned DO hydrates from (t44) — the inverse of the constructor. */
  snapshot(): RoomSnapshot {
    return {
      fen: this.fen,
      moves: this.moves.slice(),
      revision: this.revision,
      drawOffer: this.drawOffer,
      drawBy: this.drawBy,
      ended: this.ended,
    }
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
      case 'offerDraw':
      case 'acceptDraw':
      case 'declineDraw':
        this.draw(conn, msg)
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

  /**
   * Route one draw-agreement frame (t48). The acting seat comes from the live
   * connection, never the wire `by`; the payload is only shape-checked. A
   * refused frame is NACKed with `invalid_draw` and re-synced, like a move.
   */
  private draw(conn: Conn, msg: DrawMsg): void {
    const check = validateDraw(msg)
    if (!check.ok) {
      this.nackDraw(conn, check.reason)
      return
    }
    const seat = this.live.get(conn.clientId)?.seat ?? 'spectator'
    const result =
      msg.type === 'offerDraw'
        ? this.offerDraw(seat)
        : msg.type === 'acceptDraw'
          ? this.acceptDraw(seat)
          : this.declineDraw(seat)
    if (!result.ok) {
      this.nackDraw(conn, result.reason)
      return
    }
    this.emitDraw(result)
  }

  /**
   * Open a draw offer. Only the side to move may offer (chess etiquette); a
   * second offer while one is open is an idempotent no-op.
   */
  offerDraw(by: Seat): DrawResult {
    if (this.ended) return drawFail('game_over')
    if (by === 'spectator' || by !== fenTurn(this.fen)) {
      return drawFail('not_your_turn')
    }
    if (this.drawOffer === 'awaiting') {
      return { ok: true, drawOffer: 'awaiting', by: this.drawBy ?? by }
    }
    this.drawOffer = 'awaiting'
    this.drawBy = by
    return { ok: true, drawOffer: 'awaiting', by }
  }

  /** Accept the open offer; the room ends. Only the opponent may accept. */
  acceptDraw(by: Seat): DrawResult {
    const open = this.openOfferFor(by)
    if (!open.ok) return open
    this.ended = true
    this.drawOffer = 'idle'
    this.drawBy = null
    return {
      ok: true,
      drawOffer: 'idle',
      by,
      end: { reason: 'draw_agreement' },
    }
  }

  /** Decline the open offer; the room returns to `idle`. Only the opponent may. */
  declineDraw(by: Seat): DrawResult {
    const open = this.openOfferFor(by)
    if (!open.ok) return open
    this.drawOffer = 'idle'
    this.drawBy = null
    return { ok: true, drawOffer: 'idle', by }
  }

  /** Shared guard for accept/decline: a terminal room or a non-opponent fails. */
  private openOfferFor(
    by: Seat,
  ): Extract<DrawResult, { ok: false }> | { ok: true } {
    if (this.ended) return drawFail('game_over')
    if (by === 'spectator') return drawFail('not_your_turn')
    // No offer open *to this seat*: none was made, or it is the offerer's own.
    if (this.drawOffer !== 'awaiting' || by === this.drawBy) {
      return drawFail('no_open_offer')
    }
    return { ok: true }
  }

  /** Send the frames a successful draw action produces. */
  private emitDraw(result: Extract<DrawResult, { ok: true }>): void {
    if (result.end) {
      this.broadcastDrawOffer('idle', result.by) // clear the offer first
      this.broadcast({
        v: PROTOCOL_VERSION,
        type: 'roomEnd',
        code: this.room,
        reason: result.end.reason,
      })
      return
    }
    if (result.drawOffer === 'awaiting') {
      // Per seat: the offerer waits, everyone else may answer.
      for (const c of this.live.values()) {
        c.send({
          v: PROTOCOL_VERSION,
          type: 'drawOffer',
          code: this.room,
          state: c.seat === result.by ? 'awaiting' : 'offered',
          by: result.by,
        })
      }
      return
    }
    this.broadcastDrawOffer('idle', result.by)
  }

  private broadcastDrawOffer(
    state: 'offered' | 'awaiting' | 'idle',
    by: Seat,
  ): void {
    this.broadcast({
      v: PROTOCOL_VERSION,
      type: 'drawOffer',
      code: this.room,
      state,
      by,
    })
  }

  /** A rejected draw frame: NACK the sender, re-sync it, mutate nothing. */
  private nackDraw(conn: Conn, message: string): void {
    conn.send({
      v: PROTOCOL_VERSION,
      type: 'error',
      code: 'invalid_draw',
      message,
    })
    this.sendState(conn, 'invalid_draw')
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
