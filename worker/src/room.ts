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
import {
  afterMove,
  clockWire,
  freezeAt,
  initialClock,
  other,
  remainingAt,
  type ClockState,
} from './clock'

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
 * frames. The room's terminal states are an agreed draw and a flag fall —
 * checkmate and the other engine game-overs are not yet enforced here.
 *
 * Clock (t56): the room holds one `ClockState` (clock.ts) and burns the side
 * to move while both seats are taken. `tick(now)` is called by the DO's 1 Hz
 * alarm; `now` is injectable (`new RoomCore(code, snap, () => t)`) so the
 * clock is tested without fake timers.
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
  /** The room is terminal: a draw was agreed or a clock ran out. */
  ended?: boolean
  /** The chess clock (t56); optional so a pre-t56 snapshot still hydrates. */
  clock?: ClockState
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
  /** The chess clock (t56). `since` is `null` until both seats are taken. */
  private clock: ClockState = initialClock()

  constructor(
    readonly room: string,
    snapshot?: RoomSnapshot,
    /** Time source, injectable so tests need no fake timers. */
    private now: () => number = Date.now,
  ) {
    if (snapshot) {
      this.fen = snapshot.fen
      this.moves = snapshot.moves.slice()
      this.revision = snapshot.revision
      this.drawOffer = snapshot.drawOffer ?? 'idle'
      this.drawBy = snapshot.drawBy ?? null
      this.ended = snapshot.ended ?? false
      this.clock = snapshot.clock ?? initialClock()
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
  /** A clock is burning — the DO keeps its 1 Hz alarm armed while true (t56). */
  get clockRunning(): boolean {
    return this.clock.since !== null
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
      clock: this.clock,
    }
  }

  /**
   * One clock tick (t56), driven by the DO's 1 Hz alarm. Broadcasts `clock`
   * and, when the side to move has run out, flags them: a final `clock` at
   * zero then the terminal `roomEnd{reason:'time'}`. Returns whether a clock
   * is still running, so the caller knows to arm the next tick.
   */
  tick(now: number): boolean {
    if (this.clock.since === null) return false
    const turn = fenTurn(this.fen)
    if (remainingAt(this.clock, turn, turn, now) <= 0) {
      this.clock = freezeAt(this.clock, turn, now)
      this.broadcast(this.clockFrame(now))
      this.ended = true
      this.broadcast({
        v: PROTOCOL_VERSION,
        type: 'roomEnd',
        code: this.room,
        reason: 'time',
        winner: other(turn),
      })
      return false
    }
    this.broadcast(this.clockFrame(now))
    return true
  }

  private clockFrame(now: number): ServerMsg {
    return {
      v: PROTOCOL_VERSION,
      type: 'clock',
      code: this.room,
      ...clockWire(this.clock, fenTurn(this.fen), now),
    }
  }

  /** Start the clock the moment both seats are taken (t56). Idempotent. */
  private startClock(): void {
    if (this.clock.since !== null || this.ended) return
    const taken = new Set(this.reserved.values())
    if (taken.has('white') && taken.has('black')) this.clock.since = this.now()
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
    this.startClock()
    conn.send({
      v: PROTOCOL_VERSION,
      type: 'welcome',
      room: this.room,
      clientId: conn.clientId,
      seat,
      protocol: PROTOCOL_VERSION,
      revision: this.revision,
      moves: this.moves.slice(),
      clock: clockWire(this.clock, fenTurn(this.fen), this.now()),
      ended: this.ended,
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
    if (this.ended) {
      // No play after a draw was agreed or a clock ran out (t56).
      this.nackInvalid(conn, 'the room has ended')
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
    // The mover burned their clock and earns the increment; the opponent is now on it.
    this.clock = afterMove(this.clock, seatColor, this.now())
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
    // The game is over: stop the clock too, or the DO keeps ticking a dead room.
    this.clock = freezeAt(this.clock, fenTurn(this.fen), this.now())
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
