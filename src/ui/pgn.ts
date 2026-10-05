import type { GameMove, GameOver } from './useGame'

/** PGN result token. Gliński stalemate scores 3/4 to the stalemating side. */
export function pgnResult(gameOver: GameOver | null): string {
  if (!gameOver) return '*'
  const white = gameOver.winner === 'white'
  if (gameOver.kind === 'checkmate' || gameOver.kind === 'resign')
    return white ? '1-0' : '0-1'
  if (gameOver.kind === 'stalemate') return white ? '3/4-1/4' : '1/4-3/4'
  return '1/2-1/2'
}

/** PGN text using the move list's SAN, one `n. white black` line per move pair. */
export function toPgn(
  moves: GameMove[],
  gameOver: GameOver | null,
  date = new Date(),
): string {
  const result = pgnResult(gameOver)
  const lines = [
    '[Event "Hex Chess"]',
    '[Variant "Glinski"]',
    `[Date "${date.toISOString().slice(0, 10).replace(/-/g, '.')}"]`,
    `[Result "${result}"]`,
    '',
  ]
  for (let i = 0; i < moves.length; i += 2) {
    const black = moves[i + 1] ? ` ${moves[i + 1].san}` : ''
    lines.push(`${i / 2 + 1}. ${moves[i].san}${black}`)
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
