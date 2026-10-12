import { notationToAxial, axialToNotation } from '../board/notation'
import { keyOf, type Piece, type PieceType } from '../board/pieces'
import { findKing, inCheck, movesFrom, status, type GameState } from './rules'
import type { PieceColor, PieceKind } from '../ui/hexMath'
import type { BoardPieces, GameOver, GameRules } from '../ui/useGame'

const KIND_TO_TYPE: Record<PieceKind, PieceType> = {
  king: 'K',
  queen: 'Q',
  rook: 'R',
  bishop: 'B',
  knight: 'N',
  pawn: 'P',
}

function boardPiecesToState(
  position: BoardPieces,
  turnColor: PieceColor,
): GameState {
  const board = new Map<string, Piece>()
  for (const [notation, piece] of Object.entries(position)) {
    const axial = notationToAxial(notation)
    if (axial) {
      board.set(keyOf(axial), {
        type: KIND_TO_TYPE[piece.kind]!,
        color: piece.color === 'white' ? 'w' : 'b',
      })
    }
  }

  return {
    board,
    turn: turnColor === 'white' ? 'w' : 'b',
    epTarget: null,
    halfmove: 0,
    fullmove: 1,
    history: [],
  }
}

export const glinskiRules: GameRules = {
  movesFor(position: BoardPieces, from: string): string[] {
    const piece = position[from]
    if (!piece) return []
    const state = boardPiecesToState(position, piece.color)
    const axial = notationToAxial(from)
    if (!axial) return []
    const moves = movesFrom(state, axial)
    const targets = new Set<string>()
    for (const m of moves) {
      targets.add(axialToNotation(m.to))
    }
    return Array.from(targets)
  },

  statusAfter(position: BoardPieces, turn: PieceColor): GameOver | null {
    const state = boardPiecesToState(position, turn)
    const s = status(state)
    const opponent: PieceColor = turn === 'white' ? 'black' : 'white'
    if (s === 'checkmate') {
      return { kind: 'checkmate', winner: opponent }
    }
    if (s === 'stalemate') {
      return { kind: 'stalemate', winner: opponent }
    }
    return null
  },

  inCheckCell(position: BoardPieces, turn: PieceColor): string | null {
    const state = boardPiecesToState(position, turn)
    const color = turn === 'white' ? 'w' : 'b'
    if (inCheck(state, color)) {
      const king = findKing(state, color)
      if (king) return axialToNotation(king)
    }
    return null
  },
}
