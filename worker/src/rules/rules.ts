/**
 * Move generation and legality for Gliński's hexagonal chess.
 *
 * Rule sources (verified 2026-09-30):
 * - https://en.wikipedia.org/wiki/Hexagonal_chess#Gli%C5%84ski's_hexagonal_chess
 *   · rook 6 orthogonal dirs, bishop 6 diagonal dirs (colour-bound),
 *     queen = both, king 1 step (12 dirs), knight = 12 jump targets,
 *     no castling
 *   · pawn: 1 forward; 2 from any pawn-start cell (no file exemptions);
 *     captures = the two orthogonal neighbours adjacent to the forward
 *     direction (NNW/NNE for White); en passant; promotion on the
 *     opposite back rank (11 cells)
 *   · stalemate is NOT a draw (3/4–1/4) — reported as a distinct status
 * - hexchess.club reference (scottbedard/hexchess) — cross-checked pawn
 *   capture geometry, double-step cells, ep and promotion zones
 */

import {
  DIAG_DIRS,
  isValidCell,
  KNIGHT_DIRS,
  mirrorCell,
  ORTHO_DIRS,
  type Axial,
} from '../board/axial'
import { axialToNotation, notationToAxial } from '../board/notation'
import { colorOf } from '../board/colors'
import {
  keyOf,
  PAWN_STARTS,
  STARTING_POSITION,
  type Color,
  type Piece,
  type PieceType,
} from '../board/pieces'

export interface Move {
  readonly from: Axial
  readonly to: Axial
  readonly promotion?: PieceType
}

/** Full game state. `epTarget` is the skipped cell of a pending double push. */
export interface GameState {
  readonly board: ReadonlyMap<string, Piece>
  readonly turn: Color
  readonly epTarget: Axial | null
  readonly halfmove: number
  readonly fullmove: number
  /** Positions (keyOf + turn) seen earlier, for repetition detection. */
  readonly history: readonly string[]
}

const ORTHO = ORTHO_DIRS
const DIAG = DIAG_DIRS
const ALL_DIRS = [...ORTHO, ...DIAG]

export function initialGame(): GameState {
  const board = new Map<string, Piece>()
  for (const [k, p] of STARTING_POSITION) board.set(k, { ...p })
  return {
    board,
    turn: 'w',
    epTarget: null,
    halfmove: 0,
    fullmove: 1,
    history: [positionKey(board, 'w', null)],
  }
}

/** Parse a "q,r" map key back to axial coords. */
function parseKey(k: string): Axial {
  const parts = k.split(',')
  return { q: Number(parts[0]), r: Number(parts[1]) }
}

export function pieceAt(state: GameState, cell: Axial): Piece | undefined {
  return state.board.get(keyOf(cell))
}

/* ------------------------------- attack map ------------------------------ */

function sliderAttacks(
  state: GameState,
  from: Axial,
  dirs: readonly Axial[],
  by: Color,
  targets: Set<string>,
): void {
  for (const d of dirs) {
    let q = from.q + d.q
    let r = from.r + d.r
    while (isValidCell({ q, r })) {
      const piece = state.board.get(keyOf({ q, r }))
      if (piece) {
        // Enemy pieces are attacked (capturable); friendly pieces are not.
        if (piece.color !== by) targets.add(keyOf({ q, r }))
        break
      }
      targets.add(keyOf({ q, r }))
      q += d.q
      r += d.r
    }
  }
}

/** All cells attacked by `by` (pawns: capture cells only; king: its 12). */
export function attackedCells(state: GameState, by: Color): Set<string> {
  const targets = new Set<string>()
  for (const [k, piece] of state.board) {
    if (piece.color !== by) continue
    const from = parseKey(k)
    const { q, r } = from
    switch (piece.type) {
      case 'R':
        sliderAttacks(state, from, ORTHO, by, targets)
        break
      case 'B':
        sliderAttacks(state, from, DIAG, by, targets)
        break
      case 'Q':
        sliderAttacks(state, from, ALL_DIRS, by, targets)
        break
      case 'N':
        for (const d of KNIGHT_DIRS) {
          const to = { q: q + d.q, r: r + d.r }
          if (isValidCell(to)) targets.add(keyOf(to))
        }
        break
      case 'K':
        for (const d of ALL_DIRS) {
          const to = { q: q + d.q, r: r + d.r }
          if (isValidCell(to)) targets.add(keyOf(to))
        }
        break
      case 'P': {
        const caps =
          piece.color === 'w'
            ? [
                { q: -1, r: 1 },
                { q: 1, r: 0 },
              ]
            : [
                { q: -1, r: -1 },
                { q: 1, r: 0 },
              ]
        for (const d of caps) {
          const to = { q: q + d.q, r: r + d.r }
          if (isValidCell(to)) targets.add(keyOf(to))
        }
        break
      }
    }
  }
  return targets
}

export function findKing(state: GameState, color: Color): Axial | null {
  for (const [k, piece] of state.board) {
    if (piece.type === 'K' && piece.color === color) return parseKey(k)
  }
  return null
}

export function inCheck(state: GameState, color: Color): boolean {
  const king = findKing(state, color)
  if (!king) return false
  return attackedCells(state, color === 'w' ? 'b' : 'w').has(keyOf(king))
}

/* --------------------------- pseudo-move washen --------------------------- */

function pushWithPromotions(
  out: Move[],
  from: Axial,
  to: Axial,
  color: Color,
  capture: boolean,
): void {
  const zone = promotionZone(color)
  if (zone.has(keyOf(to))) {
    for (const promotion of ['Q', 'R', 'B', 'N'] as const) {
      out.push({ from, to, promotion })
    }
  } else {
    void capture
    out.push({ from, to })
  }
}

function promotionZone(color: Color): Set<string> {
  // White promotes on the top cell of each file; Black on rank 1.
  const notations =
    color === 'w'
      ? ['a6', 'b7', 'c8', 'd9', 'e10', 'f11', 'g10', 'h9', 'i8', 'k7', 'l6']
      : ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'i1', 'k1', 'l1']
  const cells = new Set<string>()
  for (const n of notations) {
    const axial = notationToAxial(n)
    if (axial) cells.add(keyOf(axial))
  }
  return cells
}

function pawnStarts(color: Color): Set<string> {
  return new Set(PAWN_STARTS[color].map((n) => keyOf(notationToAxial(n)!)))
}

export function pseudoMoves(state: GameState, color: Color): Move[] {
  const out: Move[] = []
  for (const [k, piece] of state.board) {
    if (piece.color !== color) continue
    const from = parseKey(k)
    const { q, r } = from
    switch (piece.type) {
      case 'R':
        genSlider(state, from, ORTHO, color, out)
        break
      case 'B':
        genSlider(state, from, DIAG, color, out)
        break
      case 'Q':
        genSlider(state, from, ALL_DIRS, color, out)
        break
      case 'N':
        for (const d of KNIGHT_DIRS) {
          const to = { q: q + d.q, r: r + d.r }
          if (isValidCell(to) && !friendly(state, to, color)) {
            out.push({ from, to })
          }
        }
        break
      case 'K':
        for (const d of ALL_DIRS) {
          const to = { q: q + d.q, r: r + d.r }
          if (isValidCell(to) && !friendly(state, to, color)) {
            out.push({ from, to })
          }
        }
        break
      case 'P':
        genPawn(state, from, piece.color, out)
        break
    }
  }
  return out
}

function friendly(state: GameState, cell: Axial, color: Color): boolean {
  return state.board.get(keyOf(cell))?.color === color
}

function genSlider(
  state: GameState,
  from: Axial,
  dirs: readonly Axial[],
  color: Color,
  out: Move[],
): void {
  for (const d of dirs) {
    let q = from.q + d.q
    let r = from.r + d.r
    while (isValidCell({ q, r })) {
      const occupied = state.board.get(keyOf({ q, r }))
      if (occupied) {
        if (occupied.color !== color) out.push({ from, to: { q, r } })
        break
      }
      out.push({ from, to: { q, r } })
      q += d.q
      r += d.r
    }
  }
}

function genPawn(
  state: GameState,
  from: Axial,
  color: Color,
  out: Move[],
): void {
  const fwd = color === 'w' ? { q: 0, r: 1 } : { q: 0, r: -1 }
  const caps =
    color === 'w'
      ? [
          { q: -1, r: 1 },
          { q: 1, r: 0 },
        ]
      : [
          { q: -1, r: -1 },
          { q: 1, r: 0 },
        ]

  // single push
  const one = { q: from.q + fwd.q, r: from.r + fwd.r }
  if (isValidCell(one) && !state.board.has(keyOf(one))) {
    pushWithPromotions(out, from, one, color, false)
    // double push from ANY pawn-start cell (no file exemptions)
    if (pawnStarts(color).has(keyOf(from))) {
      const two = { q: one.q + fwd.q, r: one.r + fwd.r }
      if (isValidCell(two) && !state.board.has(keyOf(two))) {
        out.push({ from, to: two })
      }
    }
  }

  // captures + en passant
  for (const d of caps) {
    const to = { q: from.q + d.q, r: from.r + d.r }
    if (!isValidCell(to)) continue
    const target = state.board.get(keyOf(to))
    if (target && target.color !== color) {
      pushWithPromotions(out, from, to, color, true)
    } else if (
      !target &&
      state.epTarget &&
      state.epTarget.q === to.q &&
      state.epTarget.r === to.r
    ) {
      out.push({ from, to })
    }
  }
}

/* ------------------------------ legality -------------------------------- */

export function applyMove(state: GameState, move: Move): GameState {
  const board = new Map(state.board)
  const key = keyOf(move.from)
  const piece = board.get(key)
  if (!piece) throw new Error(`no piece at ${axialToNotation(move.from)}`)

  board.delete(key)
  board.set(keyOf(move.to), {
    type: move.promotion ?? piece.type,
    color: piece.color,
  })

  // en passant capture: pawn moved diagonally onto the empty ep target
  const wasPawn = piece.type === 'P'
  const isEnPassant =
    wasPawn &&
    state.epTarget !== null &&
    state.epTarget.q === move.to.q &&
    state.epTarget.r === move.to.r &&
    !state.board.has(keyOf(move.to))

  const isCapture = isEnPassant || state.board.has(keyOf(move.to))
  const halfmove = wasPawn || isCapture ? 0 : state.halfmove + 1

  if (isEnPassant) {
    const captured =
      piece.color === 'w'
        ? { q: move.to.q, r: move.to.r - 1 }
        : { q: move.to.q, r: move.to.r + 1 }
    board.delete(keyOf(captured))
  }

  // new ep target on double push
  let epTarget: Axial | null = null
  if (wasPawn && Math.abs(move.to.r - move.from.r) === 2) {
    epTarget = { q: move.from.q, r: (move.from.r + move.to.r) / 2 }
  }

  const turn: Color = state.turn === 'w' ? 'b' : 'w'
  const posKey = positionKey(board, turn, epTarget)
  return {
    board,
    turn,
    epTarget,
    halfmove,
    fullmove: state.turn === 'b' ? state.fullmove + 1 : state.fullmove,
    history: [...state.history, posKey],
  }
}

function positionKey(
  board: ReadonlyMap<string, Piece>,
  turn: Color,
  ep: Axial | null,
): string {
  const entries = [...board.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
  let s = `${turn}|${ep ? keyOf(ep) : '-'}|`
  for (const [k, p] of entries) s += `${k}:${p.color}${p.type},`
  return s
}

export function legalMoves(state: GameState): Move[] {
  const color = state.turn
  return pseudoMoves(state, color).filter((m) => {
    const next = applyMove(state, m)
    return !inCheck(next, color)
  })
}

export function movesFrom(state: GameState, from: Axial): Move[] {
  return legalMoves(state).filter(
    (m) => m.from.q === from.q && m.from.r === from.r,
  )
}

/* -------------------------------- status --------------------------------- */

export type GameStatus =
  | 'playing'
  | 'check'
  | 'checkmate'
  | 'stalemate' // Gliński: not a draw — 3/4 : 1/4
  | 'draw50'
  | 'repetition'

export function status(state: GameState): GameStatus {
  const moves = legalMoves(state)
  const checked = inCheck(state, state.turn)
  if (moves.length === 0) return checked ? 'checkmate' : 'stalemate'
  if (state.halfmove >= 100) return 'draw50'
  const current = state.history[state.history.length - 1]
  const seen = state.history.filter((h) => h === current).length
  if (seen >= 3) return 'repetition'
  return checked ? 'check' : 'playing'
}

/** San-style coordinate notation "Qe1c3" / "b1b2" / "Pf5f6=Q". */
export function moveToSan(state: GameState, move: Move): string {
  const piece = state.board.get(keyOf(move.from))
  const letter = piece && piece.type !== 'P' ? piece.type : ''
  const capture = state.board.has(keyOf(move.to))
  const cap = capture ? 'x' : ''
  const promo = move.promotion ? `=${move.promotion}` : ''
  return `${letter}${axialToNotation(move.from)}${cap}${axialToNotation(move.to)}${promo}`
}

export { mirrorCell, colorOf }
