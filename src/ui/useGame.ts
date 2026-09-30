import { useReducer } from 'react'
import { STARTING_POSITION, type PieceType, type Color } from '../board/pieces'
import { allCells, cellToFileRank } from './hexMath'
import type { PieceColor, PieceKind } from './hexMath'

/** Position keyed by Gliński notation, e.g. { f1: { kind: 'king', color: 'white' } }. */
export type BoardPieces = Record<string, { kind: PieceKind; color: PieceColor }>

export interface GameOver {
  kind: 'checkmate' | 'stalemate' | 'fifty-move' | 'repetition'
  /** Winner for checkmate and stalemate (3/4 point); absent for draws. */
  winner?: PieceColor
}

export interface GameMove {
  /** SAN-style: 'f5 f7' (pawn) or 'Bf3 b1' (piece letter prefixed to origin). */
  san: string
  color: PieceColor
}

/** Rules adapter. Legality and check/mate detection come from src/rules (T4);
    until it merges the lenient default lets the hotseat loop run so any
    piece of the side to move may travel to any cell (no own-cell landing).
    ponytail: swap in the T4 adapter the moment src/rules exists. */
export interface GameRules {
  /** Legal destinations for the piece on `from` (empty if none). */
  movesFor(position: BoardPieces, from: string): string[]
  /** Optional engine verdict (checkmate/stalemate); useGame itself detects
      the bookkeeping draws (50-move, threefold repetition). */
  statusAfter?(position: BoardPieces, turn: PieceColor): GameOver | null
  /** Optional cell of the king in check (empty/null if not in check). */
  inCheckCell?(position: BoardPieces, turn: PieceColor): string | null
}

const KIND_TO_LETTER: Record<Exclude<PieceKind, 'pawn'>, string> = {
  king: 'K',
  queen: 'Q',
  rook: 'R',
  bishop: 'B',
  knight: 'N',
}

const TYPE_TO_KIND: Record<PieceType, PieceKind> = {
  K: 'king',
  Q: 'queen',
  R: 'rook',
  B: 'bishop',
  N: 'knight',
  P: 'pawn',
}

const COLOR_MAP: Record<Color, PieceColor> = {
  w: 'white',
  b: 'black',
}

const ALL_NOTATIONS = allCells().map((cell) => {
  const { file, rank } = cellToFileRank(cell)
  return `${file}${rank}`
})

/** Lenient rules: any destination that is empty or holds an enemy piece. */
export const lenientRules: GameRules = {
  movesFor(position, from) {
    const own = position[from]?.color
    if (!own) return []
    return ALL_NOTATIONS.filter(
      (notation) => position[notation]?.color !== own,
    )
  },
}

const other = (color: PieceColor): PieceColor =>
  color === 'white' ? 'black' : 'white'

/** Stable position hash for repetition counting. */
function positionKey(position: BoardPieces): string {
  return Object.keys(position)
    .sort()
    .map((n) => `${n}:${position[n].color[0]}${position[n].kind[0]}`)
    .join('|')
}

function sanFor(piece: { kind: PieceKind }, from: string, to: string): string {
  const letter = piece.kind === 'pawn' ? '' : KIND_TO_LETTER[piece.kind]
  return `${letter}${from} ${to}`
}

export function initialPieces(): BoardPieces {
  const map: BoardPieces = {}
  for (const [cell, piece] of STARTING_POSITION) {
    const [q, r] = cell.split(',').map(Number)
    const { file, rank } = cellToFileRank({ q, r, s: -q - r })
    map[`${file}${rank}`] = {
      kind: TYPE_TO_KIND[piece.type],
      color: COLOR_MAP[piece.color],
    }
  }
  return map
}

interface GameState {
  position: BoardPieces
  turn: PieceColor
  selected: string | null
  validTargets: string[]
  moves: GameMove[]
  captured: { white: number; black: number }
  /** Halfmove clock: plies since the last pawn move or capture. */
  halfmove: number
  lastMove: [string, string] | null
  keyCounts: Record<string, number>
  gameOver: GameOver | null
}

function freshState(): GameState {
  const position = initialPieces()
  return {
    position,
    turn: 'white',
    selected: null,
    validTargets: [],
    moves: [],
    captured: { white: 0, black: 0 },
    halfmove: 0,
    lastMove: null,
    keyCounts: { [positionKey(position)]: 1 },
    gameOver: null,
  }
}

/** Resolve end-of-game state after `next` was produced. */
function evaluate(
  next: GameState,
  rules: GameRules,
): GameOver | null {
  const key = positionKey(next.position)
  if ((next.keyCounts[key] ?? 0) >= 3) return { kind: 'repetition' }
  if (next.halfmove >= 100) return { kind: 'fifty-move' }
  return rules.statusAfter?.(next.position, next.turn) ?? null
}

type GameAction =
  | { type: 'click'; notation: string; rules: GameRules }
  | { type: 'undo' }
  | { type: 'newGame' }

interface GameStore {
  game: GameState
  /** Snapshots of `game` before each applied move — the undo stack. */
  history: GameState[]
}

function reducer(store: GameStore, action: GameAction): GameStore {
  switch (action.type) {
    case 'click': {
      const { game } = store
      if (game.gameOver) return store
      const { rules } = action
      // Move attempt: selected origin, clicked a legal target.
      if (
        game.selected &&
        game.selected !== action.notation &&
        game.validTargets.includes(action.notation)
      ) {
        const from = game.selected
        const moving = game.position[from]
        if (!moving) return store
        const target = game.position[action.notation]
        const position: BoardPieces = { ...game.position }
        delete position[from]
        // Promotion handling arrives with the src/rules adapter (T4).
        position[action.notation] = moving
        const captured = { ...game.captured }
        if (target) captured[target.color] += 1
        const halfmove = moving.kind === 'pawn' || target ? 0 : game.halfmove + 1
        const key = positionKey(position)
        const game2: GameState = {
          position,
          turn: other(game.turn),
          selected: null,
          validTargets: [],
          moves: [
            ...game.moves,
            { san: sanFor(moving, from, action.notation), color: moving.color },
          ],
          captured,
          halfmove,
          lastMove: [from, action.notation],
          keyCounts: { ...game.keyCounts, [key]: (game.keyCounts[key] ?? 0) + 1 },
          gameOver: null,
        }
        game2.gameOver = evaluate(game2, rules)
        return { game: game2, history: [...store.history, game] }
      }
      // Select / deselect own piece.
      if (game.position[action.notation]?.color === game.turn) {
        if (game.selected === action.notation) {
          return { ...store, game: { ...game, selected: null, validTargets: [] } }
        }
        return {
          ...store,
          game: {
            ...game,
            selected: action.notation,
            validTargets: rules.movesFor(game.position, action.notation),
          },
        }
      }
      return store
    }
    case 'undo': {
      const history = store.history.slice(0, -1)
      const last = store.history[store.history.length - 1]
      if (!last) return store
      return { game: { ...last, gameOver: null }, history }
    }
    case 'newGame':
      return { game: freshState(), history: [] }
  }
}

export interface UseGameResult {
  position: BoardPieces
  turn: PieceColor
  selected: string | null
  validTargets: string[]
  moves: GameMove[]
  captured: { white: number; black: number }
  /** Plies since the last pawn move or capture (50-move rule counter). */
  halfmove: number
  gameOver: GameOver | null
  lastMove: [string, string] | null
  inCheckCell?: string
  canUndo: boolean
  clickCell(notation: string): void
  undo(): void
  newGame(): void
}

export function useGame(rules: GameRules = lenientRules): UseGameResult {
  const [store, dispatch] = useReducer(reducer, undefined, () => ({
    game: freshState(),
    history: [],
  }))
  const { game, history } = store

  const clickCell = (notation: string) =>
    dispatch({ type: 'click', notation, rules })
  const undo = () => dispatch({ type: 'undo' })
  const newGame = () => dispatch({ type: 'newGame' })
  const inCheckCell =
    rules.inCheckCell?.(game.position, game.turn) ?? undefined

  return {
    position: game.position,
    turn: game.turn,
    selected: game.selected,
    validTargets: game.validTargets,
    moves: game.moves,
    captured: game.captured,
    halfmove: game.halfmove,
    gameOver: game.gameOver,
    lastMove: game.lastMove,
    inCheckCell,
    canUndo: history.length > 0,
    clickCell,
    undo,
    newGame,
  }
}

export default useGame