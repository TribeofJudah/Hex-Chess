import type { GameMove, GameOver } from './useGame'

/** PGN result token. Glinski stalemate scores 3/4 to the stalemating side. */
export function pgnResult(gameOver: GameOver | null): string {
  if (!gameOver) return '*'
  const white = gameOver.winner === 'white'
  if (gameOver.kind === 'checkmate' || gameOver.kind === 'resign')
    return white ? '1-0' : '0-1'
  if (gameOver.kind === 'stalemate') return white ? '3/4-1/4' : '1/4-3/4'
  return '1/2-1/2'
}

/**
 * Wire reason for the multiplayer `roomEnd` frame (t48 + t56). The
 * client translates the wire `roomEnd.reason` into one of these before
 * calling `toPgn` so the PGN comment line is human-readable.
 *
 * - `draw_agreement` is the only terminal cause the server emits in v1
 *   (t48). Both seats agreed; no winner.
 * - `time` is what the Worker emits for a clock timeout (t56). The wire
 *   `winner` field names the side that WON (the OPPOSITE of the seat
 *   that ran out of time).
 */
export type RoomEndReason = 'draw_agreement' | 'time'

/**
 * PGN text using the move list's SAN, one `n. white black` line per move pair.
 *
 * The optional `roomEndReason` (t56) threads the multiplayer `roomEnd`
 * cause through to a single comment line immediately above the trailing
 * result token. Hotseat stays comment-free.
 *
 * - `roomEndReason === 'draw_agreement'` => result `1/2-1/2` (overriding
 *   `pgnResult(gameOver)`, even with no snapshot — the room is
 *   authoritative, t55); comment `*[Draw by agreement]*` only when the
 *   `gameOver` snapshot corroborates the reason.
 * - `roomEndReason === 'time'` => comment `*[White/Black ran out of time]*`
 *   naming the LOSER. The wire's `winner` names the OPPOSITE side, so we
 *   flip it here. `timeLoser` is required when `roomEndReason === 'time'`;
 *   ignored otherwise.
 * - `roomEndReason === undefined` => no comment; header is the source of
 *   truth from `pgnResult(gameOver)` (unchanged from Rounds 1-8).
 *
 * Tests in `pgn.test.ts` cover each branch.
 */
export function toPgn(
  moves: GameMove[],
  gameOver: GameOver | null | undefined,
  roomEndReason?: RoomEndReason,
  timeLoser?: 'white' | 'black',
  date = new Date(),
): string {
  // t55: the room is authoritative about a drawn game — a mirrored draw
  // agreement overrides the result even when the local snapshot missed the
  // end (undefined `gameOver`).
  const result =
    roomEndReason === 'draw_agreement'
      ? '1/2-1/2'
      : pgnResult(gameOver ?? null)
  const lines = [
    '[Event "Hex Chess"]',
    '[Variant "Glinski"]',
    `[Date "${date.toISOString().slice(0, 10).replace(/-/g, '.')}"]`,
    `[Result "${result}"]`,
    '',
  ]
  for (let i = 0; i < moves.length; i += 2) {
    const black = moves[i + 1]
    lines.push(`${i / 2 + 1}. ${moves[i]!.san}${black ? ` ${black.san}` : ''}`)
  }
  // Multiplayer terminal annotation (t56): a single comment line above
  // the trailing result token. Hotseat stays comment-free.
  if (
    roomEndReason === 'draw_agreement' &&
    gameOver?.kind === 'agreement'
  )
    // t55: only corroborated ends are annotated — never narrate an end the
    // client has not seen.
    lines.push('*[Draw by agreement]*')
  else if (roomEndReason === 'time' && timeLoser) {
    const loser = timeLoser === 'white' ? 'White' : 'Black'
    lines.push(`*[${loser} ran out of time]*`)
  }
  lines.push(result, '')
  return lines.join('\n')
}

/** Save `text` as a .pgn file via a temporary download link. */
export function downloadPgn(text: string, filename = 'hex-chess.pgn'): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'application/x-chess-pgn' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
