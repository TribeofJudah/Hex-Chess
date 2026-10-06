/**
 * Wire protocol for remote play (T-remote-play, t39/t40/t41).
 *
 * This is the client-side copy of the contract documented in
 * claudedocs/ROOM_PROTO.md; the Worker keeps its own copy in
 * worker/src/protocol.ts. The spec is the source of truth — change it first,
 * then both copies.
 *
 * Transport: one WebSocket per room at `<worker>/room/<ROOM>`.
 */

import type { PieceColor, PieceKind } from './hexMath'

/** Bumped whenever a message shape changes incompatibly. */
export const PROTOCOL_VERSION = 1

export type Seat = 'white' | 'black' | 'spectator'

export type ErrCode =
  | 'version_mismatch'
  | 'room_full'
  | 'bad_message'
  | 'invalid_move'
  | 'invalid_draw'
  | 'stale_move'
  | 'unknown_room'
  | 'internal'

export const ERROR_CODES: readonly ErrCode[] = [
  'version_mismatch',
  'room_full',
  'bad_message',
  'invalid_move',
  'invalid_draw',
  'stale_move',
  'unknown_room',
  'internal',
]

/** A move on the wire: notation cells + the ply it produces. */
export interface WireMove {
  from: string
  to: string
  promotion?: PieceKind
  /** 1-based half-move index this move produces (index in the move list + 1). */
  ply: number
  color: PieceColor
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
  /** Revision the client believes is current; the server rejects stale ones. */
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

/** Draw agreement (t48). `by` is advisory: the DO uses the connection's seat. */
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

export interface WelcomeMsg {
  v: number
  type: 'welcome'
  room: string
  clientId: string
  seat: Seat
  protocol: number
  revision: number
  moves: WireMove[]
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
 * Draw-offer state, delivered **per seat** (t48): the offerer receives
 * `awaiting` (they wait), the opponent and spectators receive `offered` (it is
 * open to them). `idle` clears the offer.
 */
export interface DrawOfferMsg {
  v: number
  type: 'drawOffer'
  code: string
  state: 'offered' | 'awaiting' | 'idle'
  by: Seat
}
/** Terminal frame: the room is over. Only `draw_agreement` exists in v1 (t48). */
export interface RoomEndMsg {
  v: number
  type: 'roomEnd'
  code: string
  reason: 'draw_agreement'
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
      return raw as ServerMsg
    default:
      return null
  }
}
