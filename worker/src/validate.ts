/**
 * Server-side move validation bridge (t43).
 *
 * Single entry point between the wire protocol and the Gliński rules engine:
 * parse a FEN, match (from, to, promotion) against the engine's legal moves
 * for the side to move, and answer with the engine's own next FEN and
 * coordinate SAN — or a reason on rejection.
 *
 * The engine modules (./board/*, ./rules) are verbatim copies of the UI's
 * pure sources, so the server and the client can never disagree about
 * legality; see worker/README.md ("Move validation") for the vendoring
 * contract and how to regenerate the copies.
 */

import { axialEquals } from './board/axial'
import { parsePosition, serializePosition } from './board/fen'
import { notationToAxial } from './board/notation'
import { keyOf, type PieceType } from './board/pieces'
import type { DrawMsg, PieceKind } from './protocol'
import { applyMove, legalMoves, moveToSan, type GameState } from './rules/rules'

/** The validateMove answer. Pure: `ok` is the caller's permission to mutate. */
export type MoveVerdict =
  { ok: true; nextFen: string; san: string } | { ok: false; reason: string }

/** The validateDraw answer (t48). Shape-only; see validateDraw. */
export type DrawVerdict = { ok: true } | { ok: false; reason: string }

/** Wire promotion kind → rules piece type, for matching generated moves. */
const KIND_TO_TYPE: Record<PieceKind, PieceType> = {
  king: 'K',
  queen: 'Q',
  rook: 'R',
  bishop: 'B',
  knight: 'N',
  pawn: 'P',
}

/**
 * GameState for a serialized position. History is not reconstructed: the
 * bridge judges moves, not draw statuses — repetition/50-move bookkeeping
 * stays with the UI, and legality (incl. checkmate = no legal moves) needs
 * board, turn, ep and counters only.
 */
function gameFromFen(fen: string): GameState {
  const pos = parsePosition(fen)
  return { ...pos, history: [] }
}

/**
 * Validate one client move frame against `fen`.
 *
 * Never mutates and never throws: a malformed FEN or cell is an
 * `{ ok: false }` answer with a human-readable reason, mirroring how the UI
 * resolves moves through the same engine's `legalMoves` list.
 */
export function validateMove(
  fen: string,
  from: string,
  to: string,
  promotion?: PieceKind,
): MoveVerdict {
  let state: GameState
  try {
    state = gameFromFen(fen)
  } catch (error) {
    return { ok: false, reason: `bad fen: ${(error as Error).message}` }
  }

  const fromAxial = notationToAxial(from)
  if (!fromAxial) return { ok: false, reason: `bad cell '${from}'` }
  const toAxial = notationToAxial(to)
  if (!toAxial) return { ok: false, reason: `bad cell '${to}'` }

  const piece = state.board.get(keyOf(fromAxial))
  if (!piece) return { ok: false, reason: `no piece at ${from}` }
  if (piece.color !== state.turn) {
    const theirs = piece.color === 'w' ? 'white' : 'black'
    const ours = state.turn === 'w' ? 'white' : 'black'
    return {
      ok: false,
      reason: `${from} holds a ${theirs} piece, it is ${ours}'s turn`,
    }
  }

  const wanted = promotion ? KIND_TO_TYPE[promotion] : undefined
  const legal = legalMoves(state).find(
    (m) =>
      axialEquals(m.from, fromAxial) &&
      axialEquals(m.to, toAxial) &&
      m.promotion === wanted,
  )
  if (!legal) return { ok: false, reason: `illegal move ${from}${to}` }

  const next = applyMove(state, legal)
  return {
    ok: true,
    nextFen: serializePosition(next),
    san: moveToSan(state, legal),
  }
}

/**
 * Structural check for the three draw-agreement frames (t48).
 *
 * Shape only: `code` must be a non-empty string and, for an `offerDraw`, `by`
 * must name a real seat. There is no engine call — a draw has no legality
 * beyond who may act, which is the room's job (RoomCore gates turn and seat
 * from the connection, never from the wire `by`). A malformed payload answers
 * `invalid_draw`, kept distinct from `invalid_move` on the wire.
 */
export function validateDraw(msg: DrawMsg): DrawVerdict {
  if (typeof msg.code !== 'string' || msg.code.length === 0) {
    return { ok: false, reason: 'missing room code' }
  }
  if (msg.type === 'offerDraw' && msg.by !== 'white' && msg.by !== 'black') {
    return { ok: false, reason: `bad seat '${String(msg.by)}'` }
  }
  return { ok: true }
}
