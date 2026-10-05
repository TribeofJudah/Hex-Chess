import { useEffect, useMemo, useReducer, useState } from 'react'
import { bestMove } from '../ai/ai'
import { parsePosition, type Position } from '../board/fen'
import { axialToNotation, notationToAxial } from '../board/notation'
import {
  keyOf,
  STARTING_POSITION,
  type Color,
  type Piece,
  type PieceType,
} from '../board/pieces'
import type { GameState as RulesState } from '../rules/rules'
import { allCells, cellToFileRank } from './hexMath'
import type { PieceColor, PieceKind } from './hexMath'

/** Position keyed by Gliński notation, e.g. { f1: { kind: 'king', color: 'white' } }. */
export type BoardPieces = Record<string, { kind: PieceKind; color: PieceColor }>

export interface GameOver {
  kind:
    | 'checkmate'
    | 'stalemate'
    | 'fifty-move'
    | 'repetition'
    | 'resign'
    | 'agreement'
  /** Winner for checkmate, stalemate (3/4 point) and resign; absent for draws. */
  winner?: PieceColor
}

export interface GameMove {
  /** SAN-style: 'f5 f7' (pawn) or 'Bf3 b1' (piece letter prefixed to origin). */
  san: string
  color: PieceColor
  /** Origin and destination cells, kept for remote-play sync (T-remote-play). */
  from: string
  to: string
  promotion?: PieceKind
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
    return ALL_NOTATIONS.filter((notation) => position[notation]?.color !== own)
  },
}

const other = (color: PieceColor): PieceColor =>
  color === 'white' ? 'black' : 'white'

/** Clamp an AI search depth to the supported 1–5 range (T15). */
function clampDepth(depth: number): number {
  if (!Number.isFinite(depth)) return 3
  return Math.min(5, Math.max(1, Math.round(depth)))
}

/** Stable position hash for repetition counting. */
function positionKey(position: BoardPieces): string {
  return Object.keys(position)
    .sort()
    .map((n) => {
      const p = position[n]!
      return `${n}:${p.color[0]}${p.kind[0]}`
    })
    .join('|')
}

function sanFor(piece: { kind: PieceKind }, from: string, to: string): string {
  const letter = piece.kind === 'pawn' ? '' : KIND_TO_LETTER[piece.kind]
  return `${letter}${from} ${to}`
}

/** Rules-engine view of a UI position for the AI search. No en passant
    target: the UI does not track it, so the AI never plays e.p. either. */
function toRulesState(position: BoardPieces, turn: PieceColor): RulesState {
  const board = new Map<string, Piece>()
  for (const [notation, p] of Object.entries(position)) {
    const type = (Object.keys(TYPE_TO_KIND) as PieceType[]).find(
      (t) => TYPE_TO_KIND[t] === p.kind,
    )!
    board.set(keyOf(notationToAxial(notation)!), {
      type,
      color: p.color === 'white' ? 'w' : 'b',
    })
  }
  return {
    board,
    turn: turn === 'white' ? 'w' : 'b',
    epTarget: null,
    halfmove: 0,
    fullmove: 1,
    history: [],
  }
}

export function initialPieces(): BoardPieces {
  const map: BoardPieces = {}
  for (const [cell, piece] of STARTING_POSITION) {
    const [q, r] = cell.split(',').map(Number) as [number, number]
    const { file, rank } = cellToFileRank({ q, r, s: -q - r })
    map[`${file}${rank}`] = {
      kind: TYPE_TO_KIND[piece.type],
      color: COLOR_MAP[piece.color],
    }
  }
  return map
}

/** Convert a parsed FEN position into the notation-keyed UI board (T13). */
function fenToPieces(pos: Position): BoardPieces {
  const pieces: BoardPieces = {}
  for (const [key, piece] of pos.board) {
    const [q, r] = key.split(',').map(Number) as [number, number]
    pieces[axialToNotation({ q, r })] = {
      kind: TYPE_TO_KIND[piece.type],
      color: COLOR_MAP[piece.color],
    }
  }
  return pieces
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

/** A fresh game state around an arbitrary starting position. */
function stateFor(position: BoardPieces, turn: PieceColor): GameState {
  return {
    position,
    turn,
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

function freshState(): GameState {
  return stateFor(initialPieces(), 'white')
}

/** Resolve end-of-game state after `next` was produced. */
function evaluate(next: GameState, rules: GameRules): GameOver | null {
  const key = positionKey(next.position)
  if ((next.keyCounts[key] ?? 0) >= 3) return { kind: 'repetition' }
  if (next.halfmove >= 100) return { kind: 'fifty-move' }
  return rules.statusAfter?.(next.position, next.turn) ?? null
}

type GameAction =
  | { type: 'click'; notation: string; rules: GameRules }
  | {
      type: 'move'
      from: string
      to: string
      promotion?: PieceKind
      rules: GameRules
    }
  | { type: 'undo'; pair: boolean }
  | { type: 'newGame' }
  | { type: 'jumpTo'; ply: number }
  | { type: 'loadPosition'; position: BoardPieces; turn: PieceColor }
  | { type: 'resign' }
  | { type: 'draw' }

interface GameStore {
  game: GameState
  /** Snapshots of `game` before each applied move — the undo stack. */
  history: GameState[]
  /** Move-list browse cursor: half-move shown, or null for the live game (T14). */
  viewPly: number | null
}

/** Apply from→to (human or AI) and push the undo snapshot. */
function play(
  store: GameStore,
  from: string,
  to: string,
  rules: GameRules,
  promotion?: PieceKind,
): GameStore {
  const { game } = store
  const moving = game.position[from]
  if (!moving) return store
  const target = game.position[to]
  const position: BoardPieces = { ...game.position }
  delete position[from]
  // Human promotion choice is not wired yet; AI moves carry their promotion.
  position[to] = promotion ? { ...moving, kind: promotion } : moving
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
      {
        san: sanFor(moving, from, to),
        color: moving.color,
        from,
        to,
        ...(promotion ? { promotion } : {}),
      },
    ],
    captured,
    halfmove,
    lastMove: [from, to],
    keyCounts: { ...game.keyCounts, [key]: (game.keyCounts[key] ?? 0) + 1 },
    gameOver: null,
  }
  game2.gameOver = evaluate(game2, rules)
  // A new move always drops the browse cursor back to the live game.
  return { game: game2, history: [...store.history, game], viewPly: null }
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
        return play(store, game.selected, action.notation, rules)
      }
      // Select / deselect own piece.
      if (game.position[action.notation]?.color === game.turn) {
        if (game.selected === action.notation) {
          return {
            ...store,
            game: { ...game, selected: null, validTargets: [] },
          }
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
    case 'move':
      if (store.game.gameOver) return store
      return play(store, action.from, action.to, action.rules, action.promotion)
    case 'undo': {
      // vs AI: also take back the AI reply so the human is to move again.
      const n =
        action.pair &&
        store.history.length >= 2 &&
        store.history[store.history.length - 1]!.turn === 'black'
          ? 2
          : 1
      const last = store.history[store.history.length - n]
      if (!last) return store
      return {
        game: { ...last, gameOver: null },
        history: store.history.slice(0, -n),
        viewPly: null,
      }
    }
    case 'newGame':
      return { game: freshState(), history: [], viewPly: null }
    case 'jumpTo': {
      const live = store.game.moves.length
      return {
        ...store,
        viewPly: action.ply >= live ? null : Math.max(0, action.ply),
      }
    }
    case 'loadPosition':
      return {
        game: stateFor(action.position, action.turn),
        history: [],
        viewPly: null,
      }
    case 'resign': {
      // The side to move resigns; the opponent wins (T16).
      const { game } = store
      if (game.gameOver) return store
      return {
        ...store,
        game: {
          ...game,
          gameOver: { kind: 'resign', winner: other(game.turn) },
        },
      }
    }
    case 'draw': {
      // Hotseat: both players share the screen, so a draw offer is agreed at once.
      const { game } = store
      if (game.gameOver) return store
      return { ...store, game: { ...game, gameOver: { kind: 'agreement' } } }
    }
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
  inCheckCell?: string | undefined
  canUndo: boolean
  /** Half-move index currently viewed; equals `moves.length` when live (T14). */
  viewPly: number
  /** Black is played by the AI (White human vs Black AI). */
  aiEnabled: boolean
  /** AI is searching; board input is ignored meanwhile. */
  aiThinking: boolean
  /** AI search depth, 1–5, applied while `aiEnabled` (T15). */
  aiDepth: number
  toggleAi(): void
  setAiDepth(depth: number): void
  clickCell(notation: string): void
  /** Apply a from→to move directly (remote-play sync); no-op if the game is over. */
  applyMove(from: string, to: string, promotion?: PieceKind): void
  undo(): void
  newGame(): void
  /** Jump the board view back to the position after `ply` half-moves (T14). */
  jumpTo(ply: number): void
  /** Load a FEN-like position into the live board; reports parse errors (T13). */
  loadFen(text: string): { ok: true } | { ok: false; error: string }
  /** The side to move resigns; the opponent wins (T16). */
  resign(): void
  /** Both players agree to a draw (T16). */
  agreeDraw(): void
}

export function useGame(rules: GameRules = lenientRules): UseGameResult {
  const [store, dispatch] = useReducer(reducer, undefined, () => ({
    game: freshState(),
    history: [],
    viewPly: null,
  }))
  const { game, history, viewPly } = store
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiDepth, setAiDepth] = useState(3)
  const aiThinking = aiEnabled && game.turn === 'black' && !game.gameOver

  // Browse cursor (T14) lives in the store, so moves reset it in the reducer.
  const timeline = useMemo(() => [...history, game], [history, game])
  const livePly = game.moves.length
  const shown =
    viewPly !== null && viewPly < livePly ? (timeline[viewPly] ?? game) : game
  const browsing = shown !== game

  useEffect(() => {
    if (!aiThinking) return
    // ponytail: search runs on the main thread; move it to a worker if a
    // depth-5 search measurably freezes the UI.
    const id = setTimeout(() => {
      const { move } = bestMove(toRulesState(game.position, game.turn), {
        depth: aiDepth,
      })
      if (!move) return
      const promotion = move.promotion ? TYPE_TO_KIND[move.promotion] : undefined
      dispatch({
        type: 'move',
        from: axialToNotation(move.from),
        to: axialToNotation(move.to),
        rules,
        ...(promotion ? { promotion } : {}),
      })
    }, 0)
    return () => clearTimeout(id)
  }, [aiThinking, game, rules, aiDepth])

  const clickCell = (notation: string) => {
    // A board click while browsing returns to the live position first.
    if (browsing) {
      dispatch({ type: 'jumpTo', ply: livePly })
      return
    }
    if (!aiThinking) dispatch({ type: 'click', notation, rules })
  }
  const applyMove = (from: string, to: string, promotion?: PieceKind) =>
    dispatch({
      type: 'move',
      from,
      to,
      rules,
      ...(promotion ? { promotion } : {}),
    })
  const undo = () => dispatch({ type: 'undo', pair: aiEnabled })
  const newGame = () => dispatch({ type: 'newGame' })
  const jumpTo = (ply: number) => dispatch({ type: 'jumpTo', ply })
  const loadFen = (
    text: string,
  ): { ok: true } | { ok: false; error: string } => {
    try {
      const parsed = parsePosition(text.trim())
      dispatch({
        type: 'loadPosition',
        position: fenToPieces(parsed),
        turn: COLOR_MAP[parsed.turn],
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }
  const inCheckCell =
    rules.inCheckCell?.(shown.position, shown.turn) ?? undefined

  return {
    position: shown.position,
    turn: shown.turn,
    selected: shown.selected,
    validTargets: shown.validTargets,
    moves: game.moves,
    captured: shown.captured,
    halfmove: shown.halfmove,
    gameOver: shown.gameOver,
    lastMove: shown.lastMove,
    inCheckCell,
    canUndo: history.length > 0,
    viewPly: viewPly ?? livePly,
    aiEnabled,
    aiThinking,
    aiDepth,
    toggleAi: () => setAiEnabled((on) => !on),
    setAiDepth: (depth) => setAiDepth(clampDepth(depth)),
    clickCell,
    applyMove,
    undo,
    newGame,
    jumpTo,
    loadFen,
    resign: () => dispatch({ type: 'resign' }),
    agreeDraw: () => dispatch({ type: 'draw' }),
  }
}

export default useGame
