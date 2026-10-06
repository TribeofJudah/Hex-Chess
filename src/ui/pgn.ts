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
 * Wire reason for the multiplayer `roomEnd` frame (t48 + t56 + R12).
 * The client translates the wire `roomEnd.reason` into one of these
 * before calling `toPgn` so the PGN comment line is human-readable.
 *
 * - `draw_agreement` (t48): both seats agreed; no winner.
 * - `time` (t56): the worker emits this for a clock timeout. The wire
 *   `winner` field names the side that WON (the OPPOSITE of the seat
 *   that ran out of time).
 * - `checkmate` / `stalemate` / `draw50` / `repetition` (R12): the worker
 *   now enforces the rule-book terminals. `checkmate` and `stalemate`
 *   carry a `winner` on the wire; `stalemate` is the Gliński 3/4–1/4
 *   split (NOT a draw — see `src/rules/adapter.ts` and §5 of
 *   `claudedocs/PGN_DRAW.md`). `draw50` and `repetition` have no winner.
 */
export type RoomEndReason =
  | 'draw_agreement'
  | 'time'
  | 'checkmate'
  | 'stalemate'
  | 'draw50'
  | 'repetition'

/**
 * PGN text using the move list's SAN, one `n. white black` line per move pair.
 *
 * The optional `roomEndReason` (t56 + R12) threads the multiplayer
 * `roomEnd` cause through to a single comment line immediately above the
 * trailing result token. Hotseat stays comment-free.
 *
 * - `roomEndReason === 'draw_agreement'` => result `1/2-1/2` (overriding
 *   `pgnResult(gameOver)`, even with no snapshot — the room is
 *   authoritative, t55); comment `*[Draw by agreement]*` only when the
 *   `gameOver` snapshot corroborates the reason.
 * - `roomEndReason === 'time'` => comment `*[White/Black ran out of time]*`
 *   naming the LOSER. The wire's `winner` names the OPPOSITE side, so we
 *   flip it here. `timeLoser` is required when `roomEndReason === 'time'`;
 *   ignored otherwise.
 * - `roomEndReason === 'checkmate'` (R12) => comment `*[Checkmate, {winner}
 *   wins]*` naming the winner. `timeLoser` is ignored.
 * - `roomEndReason === 'stalemate'` (R12) => comment `*[Stalemate — Gliński
 *   3/4 to {winner}]*` naming the winner. `timeLoser` is ignored. The
 *   result token is `3/4-1/4` / `1/4-3/4` from `pgnResult(gameOver)`,
 *   which already encodes the Gliński split.
 * - `roomEndReason === 'draw50'` (R12) => comment `*[Draw by 50-move
 *   rule]*`; no winner.
 * - `roomEndReason === 'repetition'` (R12) => comment `*[Draw by threefold
 *   repetition]*`; no winner.
 * - `roomEndReason === undefined` => no comment; header is the source of
 *   truth from `pgnResult(gameOver)` (unchanged from Rounds 1-8).
 *
 * Each multiplayer annotation only fires when the `gameOver.kind`
 * corroborates the reason — never narrate an end the local snapshot has
 * not seen (a defensive guard from t55).
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
  // Multiplayer terminal annotation (t56 + R12): a single comment line
  // above the trailing result token. Hotseat stays comment-free. Each
  // branch corroborates against `gameOver.kind` so a stale reason on a
  // non-matching snapshot is rendered without a comment (t55 guard).
  if (
    roomEndReason === 'draw_agreement' &&
    gameOver?.kind === 'agreement'
  ) {
    // t55: only corroborated ends are annotated — never narrate an end the
    // client has not seen.
    lines.push('*[Draw by agreement]*')
  } else if (roomEndReason === 'time' && timeLoser) {
    const loser = timeLoser === 'white' ? 'White' : 'Black'
    lines.push(`*[${loser} ran out of time]*`)
  } else if (
    roomEndReason === 'checkmate' &&
    gameOver?.kind === 'checkmate' &&
    gameOver.winner
  ) {
    // R12: server-delivered checkmate. Comment names the winner (the
    // side that delivered mate), mirroring the wire's `winner` field.
    const winnerName = gameOver.winner === 'white' ? 'White' : 'Black'
    lines.push(`*[Checkmate, ${winnerName} wins]*`)
  } else if (
    roomEndReason === 'stalemate' &&
    gameOver?.kind === 'stalemate' &&
    gameOver.winner
  ) {
    // R12: server-delivered stalemate. Gliński's rule scores 3/4 to the
    // side that trapped the opponent's king — see `src/rules/rules.ts`
    // status() and `src/rules/adapter.ts` statusAfter. The wire's
    // `winner` is the trapping side (matches `pgnResult`'s 3/4 side).
    const winnerName = gameOver.winner === 'white' ? 'White' : 'Black'
    lines.push(`*[Stalemate — Gliński 3/4 to ${winnerName}]*`)
  } else if (
    roomEndReason === 'draw50' &&
    gameOver?.kind === 'fifty-move'
  ) {
    // R12: server-enforced 50-move rule. The result is already `1/2-1/2`
    // via pgnResult(); the line is annotation, not metadata.
    lines.push('*[Draw by 50-move rule]*')
  } else if (
    roomEndReason === 'repetition' &&
    gameOver?.kind === 'repetition'
  ) {
    // R12: server-enforced threefold repetition. Result is `1/2-1/2`.
    lines.push('*[Draw by threefold repetition]*')
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
