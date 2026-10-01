/**
 * Gliński position serialization (FEN-like). No standard hex FEN exists;
 * this format follows the hexchess.club convention for piece placement
 * and adds FEN's trailing fields.
 *
 * Format: `<placement> <turn> <ep> <halfmove> <fullmove>`, single spaces.
 *
 * - placement: 11 ranks from rank 11 down to rank 1, separated by `/`.
 *   Each rank lists its cells left to right (file a → l, j omitted), so
 *   rank lengths are 1, 3, 5, 7, 9, then 11 × 6 (RANK_CELL_COUNTS
 *   reversed) — 91 cells in all. A piece is one of `KQRBNP` (White) or
 *   `kqrbnp` (Black); a decimal number (1–11) is a run of empty cells.
 * - turn: `w` or `b`, the side to move.
 * - ep: the en passant target cell in Gliński notation (e.g. `e5`), the
 *   cell skipped by the last double pawn push, or `-` if none.
 * - halfmove: plies since the last pawn move or capture (integer ≥ 0).
 * - fullmove: move number, starts at 1, increments after Black moves.
 *
 * Starting position:
 *   b/qbk/n1b1n/r5r/ppppppppp/11/5P5/4P1P4/3P1B1P3/2P2B2P2/1PRNQBKNRP1 w - 0 1
 */

import type { Axial } from './axial'
import { axialToNotation, notationToAxial, rankCells } from './notation'
import { keyOf, type Color, type Piece, type PieceType } from './pieces'

/** Serializable position; structurally a subset of rules' GameState. */
export interface Position {
  readonly board: ReadonlyMap<string, Piece>
  readonly turn: Color
  readonly epTarget: Axial | null
  readonly halfmove: number
  readonly fullmove: number
}

const PIECE_CHARS = 'KQRBNP'

export function serializePosition(pos: Position): string {
  const ranks: string[] = []
  for (let rank = 11; rank >= 1; rank--) {
    let s = ''
    let empty = 0
    for (const n of rankCells(rank)) {
      const piece = pos.board.get(keyOf(notationToAxial(n)!))
      if (!piece) {
        empty++
        continue
      }
      if (empty) s += empty
      empty = 0
      s += piece.color === 'w' ? piece.type : piece.type.toLowerCase()
    }
    if (empty) s += empty
    ranks.push(s)
  }
  const ep = pos.epTarget ? axialToNotation(pos.epTarget) : '-'
  return `${ranks.join('/')} ${pos.turn} ${ep} ${pos.halfmove} ${pos.fullmove}`
}

/** Parse a serialized position; throws an Error describing the first problem. */
export function parsePosition(text: string): Position {
  const fields = text.split(' ')
  if (fields.length !== 5)
    throw new Error(`expected 5 fields, got ${fields.length}`)
  const [placement, turn, ep, half, full] = fields

  const rows = placement.split('/')
  if (rows.length !== 11)
    throw new Error(`expected 11 ranks, got ${rows.length}`)
  const board = new Map<string, Piece>()
  rows.forEach((row, i) => {
    const rank = 11 - i
    const cells = rankCells(rank)
    let at = 0
    for (const tok of row.match(/\d+|./g) ?? []) {
      if (/^\d+$/.test(tok)) {
        const run = Number(tok)
        if (run < 1) throw new Error(`rank ${rank}: empty run must be ≥ 1`)
        at += run
      } else {
        const type = tok.toUpperCase() as PieceType
        if (!PIECE_CHARS.includes(type))
          throw new Error(`rank ${rank}: bad piece '${tok}'`)
        if (at < cells.length) {
          board.set(keyOf(notationToAxial(cells[at])!), {
            type,
            color: tok === type ? 'w' : 'b',
          })
        }
        at++
      }
      if (at > cells.length)
        throw new Error(`rank ${rank}: more than ${cells.length} cells`)
    }
    if (at < cells.length)
      throw new Error(`rank ${rank}: ${at} of ${cells.length} cells`)
  })

  if (turn !== 'w' && turn !== 'b')
    throw new Error(`bad side to move '${turn}'`)

  let epTarget: Axial | null = null
  if (ep !== '-') {
    epTarget = notationToAxial(ep)
    if (!epTarget) throw new Error(`bad en passant cell '${ep}'`)
  }

  const halfmove = counter(half, 'halfmove', 0)
  const fullmove = counter(full, 'fullmove', 1)
  return { board, turn, epTarget, halfmove, fullmove }
}

function counter(s: string, name: string, min: number): number {
  if (!/^\d+$/.test(s)) throw new Error(`bad ${name} '${s}'`)
  const n = Number(s)
  if (n < min || !Number.isSafeInteger(n))
    throw new Error(`${name} out of range: ${s}`)
  return n
}
