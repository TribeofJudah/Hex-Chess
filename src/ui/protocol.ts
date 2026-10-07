/**
 * Wire types for the HexChess multiplayer room. Mirrors `worker/src/protocol.ts`
 * (t48 adds the draw frames; t56 adds the clock frames and bumps
 * `PROTOCOL_VERSION` to 2; R12 adds the server-side terminal reasons
 * `checkmate` / `stalemate` / `draw50` / `repetition` and bumps
 * `PROTOCOL_VERSION` to 3).
 */
import type { GameMove } from './useGame'
import type { PieceColor, PieceKind } from './hexMath'

export type Seat = 'white' | 'black' | 'spectator'

/** PGN-friendly display SAN, kept for type clarity on the wire. */
export interface WireMove {
  san: string
  color: PieceColor
  from: string
  to: string
  promotion?: PieceKind
}

/** Per-seat wire view of the move clock (t56). */
export interface ClockWire {
  whiteMs: number
  blackMs: number
  lastTickAt: number
  /** 1 Hz tick cadence on the server. */
  tickMs: number
  /** Optional increment applied on the side-to-move's move. */
  incrementMs?: number
}

// ---- client → server -------------------------------------------------------

export interface JoinMsg {
  v: number
  type: 'join'
  room: string
  clientId: string
  protocol: number
}
export interface MoveMsg {
  v: number
  type: 'move'
  from: string
  to: string
  promotion?: PieceKind
  revision: number
}
export interface ResyncMsg {
  v: number
  type: 'resync'
  revision: number
}
export interface PingMsg {
  v: number
  type: 'ping'
  t: number
}
export interface OfferDrawMsg {
  v: number
  type: 'offerDraw'
  code: string
  by: Seat
}
export interface AcceptDrawMsg {
  v: number
  type: 'acceptDraw'
  code: string
}
export interface DeclineDrawMsg {
  v: number
  type: 'declineDraw'
  code: string
}
export type DrawMsg = OfferDrawMsg | AcceptDrawMsg | DeclineDrawMsg

export type ClientMsg = JoinMsg | MoveMsg | ResyncMsg | PingMsg | DrawMsg

// ---- server → client -------------------------------------------------------

/**
 * Welcome frame carries the rebuild snapshot plus the (optional) clock
 * and the (optional) ended flag (t56). A v2 welcome always has clock if
 * the room had one at creation; a v1 client gets a version mismatch.
 */
export interface WelcomeMsg {
  v: number
  type: 'welcome'
  room: string
  clientId: string
  seat: Seat
  protocol: number
  revision: number
  moves: WireMove[]
  /** Snapshot of the room clock at the moment of join (t56). */
  clock?: ClockWire
  /** True when the room is already over (t56). */
  ended?: boolean
}
export interface StateMsg {
  v: number
  type: 'state'
  revision: number
  moves: WireMove[]
  reason?: string
}
export interface MoveBroadcast {
  v: number
  type: 'move'
  from: string
  to: string
  promotion?: PieceKind
  ply: number
  color: PieceColor
  revision: number
  /** clientId that produced the move (echo-suppression on the sender). */
  by: string
}
export interface PeerMsg {
  v: number
  type: 'peer'
  connected: boolean
  seats: { white: boolean; black: boolean }
}
export interface ErrorMsg {
  v: number
  type: 'error'
  code: ErrCode
  message: string
  expectedProtocol?: number
  receivedProtocol?: number
}
export interface PongMsg {
  v: number
  type: 'pong'
  t: number
}

/**
 * Draw-offer state, delivered per seat (t48): the offerer receives
 * `awaiting` (they wait), the opponent and spectators receive `offered`
 * (it is open to them). `idle` clears the offer.
 */
export interface DrawOfferMsg {
  v: number
  type: 'drawOffer'
  code: string
  state: 'offered' | 'awaiting' | 'idle'
  by: Seat
}
/**
 * Terminal frame: the room is over.
 * - `draw_agreement` (t48): both seats agreed; no winner.
 * - `time` (t56): a clock ran out; `winner` names the OPPOSITE side.
 * - `checkmate` / `stalemate` / `draw50` / `repetition` (R12): the server-side
 *   engine now enforces the rule-book terminals. `checkmate` and `stalemate`
 *   carry a `winner` (Gliński stalemate is a 3/4–1/4 split, NOT a draw —
 *   `winner` is the side that trapped the opponent's king). `draw50` and
 *   `repetition` have no winner.
 */
export interface RoomEndMsg {
  v: number
  type: 'roomEnd'
  code: string
  reason:
    | 'draw_agreement'
    | 'time'
    | 'checkmate'
    | 'stalemate'
    | 'draw50'
    | 'repetition'
  winner?: PieceColor
}
/**
 * Periodic clock update (t56). Sent on every accepted move and every
 * server tick while the clock is running. Clients mirror this verbatim;
 * the clock is server-authoritative.
 */
export interface ClockMsg {
  v: number
  type: 'clock'
  code: string
  clock: ClockWire
}

export type ServerMsg =
  | WelcomeMsg
  | StateMsg
  | MoveBroadcast
  | PeerMsg
  | ErrorMsg
  | PongMsg
  | DrawOfferMsg
  | RoomEndMsg
  | ClockMsg

/**
 * Bumped to 2 in t56 (clock + ended on welcome; clock frames; roomEnd.reason
 * gained 'time' + optional winner). Bumped to 3 in R12: the server now
 * enforces checkmate / stalemate / 50-move / threefold repetition, so
 * `roomEnd.reason` widens to include all six. v2 clients are rejected at
 * join with `version_mismatch` because their `RoomEndMsg.reason` cannot
 * represent the new terminals.
 */
export const PROTOCOL_VERSION = 3

export type ErrCode =
  | 'version_mismatch'
  | 'stale_move'
  | 'invalid_move'
  | 'invalid_draw'
  | 'bad_join'

/** Same set as `ErrCode`, useful for the test suite (matches worker mirror). */
export const ERROR_CODES: readonly ErrCode[] = [
  'version_mismatch',
  'stale_move',
  'invalid_move',
  'invalid_draw',
  'bad_join',
]

/**
 * Convert a server `WelcomeMsg` into the local `GameMove[]` consumed by the
 * reducer. The wire's `WireMove` is structurally identical to `GameMove`;
 * this function exists so the call sites are explicit about the boundary.
 */
export function welcomeToMoves(welcome: WelcomeMsg): GameMove[] {
  return welcome.moves.map((m) => ({
    san: m.san,
    color: m.color,
    from: m.from,
    to: m.to,
    ...(m.promotion ? { promotion: m.promotion } : {}),
  }))
}

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg)
}

/**
 * Parse + minimally validate an inbound message. Returns null for anything
 * that is not a known server message, so a hostile/garbage frame can't crash
 * the client. Guards only the discriminator and `v`; field-level validation is
 * the reducer's job.
 */
export function decode(data: string): ServerMsg | null {
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const msg = raw as { type?: unknown; v?: unknown }
  if (typeof msg.v !== 'number') return null
  switch (msg.type) {
    case 'welcome':
    case 'state':
    case 'move':
    case 'peer':
    case 'error':
    case 'pong':
    case 'drawOffer':
    case 'roomEnd':
    case 'clock':
      return raw as ServerMsg
    default:
      return null
  }
}
