/**
 * PGN import for the local hotseat game (t61).
 *
 * The exporter (`./pgn.ts`) writes one SAN per half-move in the
 * `sanFor` shape `{letter}{origin} {destination}{=promo}` (e.g. `f5 f6`,
 * `Qe1 c3`, `f10 f11=Q`) — a space-separated pair of Gliński cells, with
 * the moving piece's letter (omitted for pawns) and an optional `=X`
 * promotion suffix. `parsePgn` recovers those SAN strings and the header
 * block; `replayPgn` resolves each one against the real rule-book
 * generator in `src/rules`, never trusting the text: an illegal,
 * out-of-turn, mislabelled or ambiguous SAN is reported with its ply.
 */

import { axialToNotation, notationToAxial } from '../board/notation'
import { keyOf, type PieceType } from '../board/pieces'
import {
  applyMove,
  initialGame,
  legalMoves,
  type GameState,
  type Move,
} from '../rules/rules'
import { glinskiRules } from '../rules/adapter'
import type { GameMove, GameRules } from './useGame'
import type { PieceKind } from './hexMath'

const RESULT_TOKENS = new Set([
  '1-0',
  '0-1',
  '1/2-1/2',
  '3/4-1/4',
  '1/4-3/4',
  '*',
])

const TYPE_TO_KIND: Record<PieceType, PieceKind> = {
  K: 'king',
  Q: 'queen',
  R: 'rook',
  B: 'bishop',
  N: 'knight',
  P: 'pawn',
}

/** Parsed PGN: the header block, the SAN of each half-move, and the result. */
export interface ParsedPgn {
  headers: Record<string, string>
  /** One entry per half-move, e.g. `Qe1 c3` (the `sanFor` shape). */
  sans: string[]
  result: string
}

/**
 * Parse PGN text emitted by `toPgn`. Tolerates `{...}` comments, the
 * exporter's `*[...]*` annotation lines, `;` line comments, move numbers,
 * CRLF and extra whitespace. Never throws — a malformed move survives as a
 * lone SAN token and is rejected later by `replayPgn`.
 */
export function parsePgn(text: string): ParsedPgn {
  const headers: Record<string, string> = {}
  const tokens: string[] = []
  let movetextResult: string | null = null

  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/\{[^}]*\}/g, ' ') // brace comments
    .replace(/\*\[[^\]]*\]\*/g, ' ') // *[Draw by agreement]* annotations
    .replace(/;[^\n]*/g, '') // semicolon comments

  for (const line of clean.split('\n')) {
    const header = /^\s*\[(\w+)\s+"([^"]*)"\]\s*$/.exec(line)
    if (header) {
      headers[header[1]!] = header[2]!
      continue
    }
    for (const raw of line.split(/\s+/)) {
      const token = raw.replace(/^\d+\.+/, '') // "1." / "12..." move numbers
      if (token === '') continue
      if (RESULT_TOKENS.has(token)) {
        movetextResult ??= token
        continue
      }
      tokens.push(token)
    }
  }

  // Each half-move is exactly two whitespace-separated tokens; a lone
  // trailing token (malformed input) is kept so replayPgn can report it.
  const sans: string[] = []
  for (let i = 0; i < tokens.length; i += 2) {
    sans.push(
      i + 1 < tokens.length ? `${tokens[i]} ${tokens[i + 1]}` : tokens[i]!,
    )
  }

  const result =
    movetextResult && movetextResult !== '*'
      ? movetextResult
      : (headers['Result'] ?? '*')

  return { headers, sans, result }
}

/** One SAN in the `sanFor` shape: letter ('' for pawns), origin, destination, promo. */
interface ParsedSan {
  letter: string
  from: string
  to: string
  promotion?: PieceType
}

const SAN_RE = /^([KQRBN]?)([a-l]\d{1,2}) ([a-l]\d{1,2})(?:=([QRBN]))?$/

function parseSan(token: string): ParsedSan | null {
  const m = SAN_RE.exec(token)
  if (!m) return null
  return {
    letter: m[1]!,
    from: m[2]!,
    to: m[3]!,
    ...(m[4] ? { promotion: m[4] as PieceType } : {}),
  }
}

/** Replay failure: the offending half-move index and a human-readable cause. */
export interface ReplayError {
  error: string
  ply: number
}

function isEnPassant(state: GameState, move: Move): boolean {
  const piece = state.board.get(keyOf(move.from))
  return (
    piece?.type === 'P' &&
    state.epTarget !== null &&
    state.epTarget.q === move.to.q &&
    state.epTarget.r === move.to.r &&
    !state.board.has(keyOf(move.to))
  )
}

/**
 * Replay SAN half-moves from the initial position against the rule-book
 * generator. Returns the resolved `GameMove[]`, or the first failure as
 * `{ error, ply }`. `rules` is the game's adapter — the destination is
 * cross-checked against it (a UI-model guard), except for en-passant,
 * which the hotseat adapter does not model.
 */
export function replayPgn(
  sans: string[],
  rules: GameRules = glinskiRules,
): GameMove[] | ReplayError {
  let state = initialGame()
  const moves: GameMove[] = []

  for (let ply = 0; ply < sans.length; ply++) {
    const token = sans[ply]!
    const parsed = parseSan(token)
    if (!parsed) return { error: `unreadable SAN "${token}"`, ply }

    const from = notationToAxial(parsed.from)
    const to = notationToAxial(parsed.to)
    if (!from || !to)
      return { error: `invalid cell in "${token}"`, ply }

    const piece = state.board.get(keyOf(from))
    if (!piece) return { error: `no piece on ${parsed.from} ("${token}")`, ply }
    if (piece.color !== state.turn)
      return { error: `"${token}" moves ${piece.color} out of turn`, ply }

    const expectedLetter = piece.type === 'P' ? '' : piece.type
    if (parsed.letter !== expectedLetter)
      return {
        error: `"${token}" mislabels the ${piece.type} on ${parsed.from}`,
        ply,
      }

    const matches = legalMoves(state).filter(
      (m) =>
        m.from.q === from.q &&
        m.from.r === from.r &&
        m.to.q === to.q &&
        m.to.r === to.r,
    )
    if (matches.length === 0) return { error: `illegal move "${token}"`, ply }

    // A promotion arrival offers Q/R/B/N (rules.pushWithPromotions); the
    // SAN must name one of them, otherwise the ply is ambiguous.
    const promos = matches.filter((m) => m.promotion)
    let chosen: Move
    if (promos.length > 0) {
      if (!parsed.promotion)
        return {
          error: `"${token}" is a promotion but names no piece`,
          ply,
        }
      const found = promos.find((m) => m.promotion === parsed.promotion)
      if (!found)
        return {
          error: `"${token}" cannot promote to ${parsed.promotion}`,
          ply,
        }
      chosen = found
    } else {
      if (parsed.promotion)
        return { error: `"${token}" promotes a non-promotion move`, ply }
      chosen = matches[0]!
    }

    // UI-model cross-check: the adapter must also reach `to` from `from`.
    // En passant is exempt — the hotseat position never carries an ep target.
    if (!isEnPassant(state, chosen) && !rules.movesFor(boardPieces(state), parsed.from).includes(parsed.to))
      return { error: `illegal move "${token}"`, ply }

    moves.push({
      san: `${expectedLetter}${parsed.from} ${parsed.to}${
        parsed.promotion ? `=${parsed.promotion}` : ''
      }`,
      color: piece.color === 'w' ? 'white' : 'black',
      from: parsed.from,
      to: parsed.to,
      ...(parsed.promotion ? { promotion: TYPE_TO_KIND[parsed.promotion] } : {}),
    })
    state = applyMove(state, chosen)
  }

  return moves
}

/** Notation-keyed piece map for the adapter's `movesFor` cross-check. */
function boardPieces(state: GameState): Record<
  string,
  { kind: PieceKind; color: 'white' | 'black' }
> {
  const out: Record<string, { kind: PieceKind; color: 'white' | 'black' }> = {}
  for (const [key, piece] of state.board) {
    const parts = key.split(',')
    out[
      axialToNotation({ q: Number(parts[0]), r: Number(parts[1]) })
    ] = {
      kind: TYPE_TO_KIND[piece.type],
      color: piece.color === 'w' ? 'white' : 'black',
    }
  }
  return out
}

export default parsePgn
