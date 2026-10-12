/**
 * TUI screens (XCHESS_BENCH §6): pure renderers over JSONL-derived
 * aggregates. No ANSI here — the CLI layer adds escape codes — no state,
 * and every number on every frame rebuilds from the corpus lines.
 */
import { keyOf } from '../../board/pieces'
import { boardCells, renderCells, renderFen, COLS } from './board'
import {
  EM_DASH,
  eloTable,
  evalSeries,
  gamesOf,
  heatOf,
  metricsOf,
  pairOutcomes,
  spark,
  watchOf,
  type CorpusLine,
  type ModelMetrics,
} from './aggregate'

/**
 * 4-step density ramp (XCHESS_BENCH §6): · ░ ▒ ▓, low → high. `t` is the
 * cell's count as a share of the busiest cell — one step per tercile.
 */
export function rampGlyph(t: number): string {
  if (t <= 0) return '·'
  if (t < 1 / 3) return '░'
  if (t < 2 / 3) return '▒'
  return '▓'
}

// -- formatting helpers -----------------------------------------------------

const pct = (v: number | null): string =>
  v === null ? EM_DASH : `${(v * 100).toFixed(1)}%`

const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? '' : 's'}`

const cp = (v: number | null): string =>
  v === null ? EM_DASH : String(Math.round(v))

const eloCell = (elo: number | null, ci: number | null): string => {
  if (elo === null) return EM_DASH
  return ci === null ? `${elo} (pin)` : `${elo} ±${Math.round(ci)}`
}

/** cp from the engine's white-perspective eval, for the watch eval line. */
const fmtCp = (v: number): string => `${v > 0 ? '+' : ''}${Math.round(v)}`

/** Zip a left column (board) with a right column (panel) side by side. */
function zip(
  left: readonly string[],
  right: readonly string[],
  gap = 2,
): string[] {
  const rows = Math.max(left.length, right.length)
  const width = Math.max(COLS, ...left.map((l) => l.length))
  const out: string[] = []
  for (let i = 0; i < rows; i++) {
    out.push(
      `${(left[i] ?? '').padEnd(width)}${' '.repeat(gap)}${right[i] ?? ''}`.trimEnd(),
    )
  }
  return out
}

// -- bench watch ------------------------------------------------------------

export interface WatchOptions {
  /** Game to show; default is the first game in the corpus. */
  gameId?: string
}

const RESULT_TEXT: Record<string, string> = {
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  draw50: 'draw (50-move)',
  repetition: 'draw (repetition)',
  illegal: 'forfeit (illegal move)',
  'max-plies': 'stopped (max plies)',
}

/**
 * `xc bench watch`: live match screen — board, model output, validator
 * verdicts, eval sparkline (mockup §5.1).
 */
export function watchScreen(
  lines: readonly CorpusLine[],
  opts: WatchOptions = {},
): string {
  const games = gamesOf(lines)
  const info = games.find((g) => g.gameId === opts.gameId) ?? games[0] ?? null
  if (!info) return 'XCHESS BENCH · watch\n(no games in corpus)'

  const last = info.lines.at(-1)!
  const over = info.result !== null
  const status = over
    ? `result: ${RESULT_TEXT[info.result ?? ''] ?? info.result}` +
      (info.winnerSide
        ? ` · ${info.winnerSide === 'w' ? 'white' : 'black'} wins`
        : '')
    : `ply ${last.ply} · ${last.side === 'w' ? 'black' : 'white'} to move`

  const title = 'XCHESS BENCH · watch'
  const subtitle = `game ${info.gameId} · ${info.lines.length} lines · ${status}`
  const board = renderFen(last.fen)

  const panel: string[] = []
  panel.push(`white ${info.models.w ?? EM_DASH}`)
  panel.push(`black ${info.models.b ?? EM_DASH}`)
  panel.push('─'.repeat(24))
  const watch = watchOf(info)
  for (const [no, sanW, sanB] of watch.pairs) {
    panel.push(
      `${String(no).padStart(3)}. ${(sanW ?? EM_DASH).padEnd(9)}${sanB ?? ''}`,
    )
  }
  if (watch.illegal.length > 0) {
    panel.push('repairs')
    for (const l of watch.illegal) {
      panel.push(` ply ${l.ply} · ${l.response.move} ✗ (retry ${l.retry})`)
    }
  }
  const series = evalSeries(info)
  panel.push(
    series.length === 0
      ? `eval ${EM_DASH}`
      : `eval ${spark(series)}  ${fmtCp(series[0]!)} → ${fmtCp(series.at(-1)!)}`,
  )
  if (over) panel.push('game over')

  return [title, subtitle, ...zip(board, panel)].join('\n')
}

// -- dash metrics -----------------------------------------------------------

/**
 * `xc dash metrics`: per-model scorecard (mockup §5.3). Engine-derived
 * columns show '—' while the engine is null (t91 fills them).
 */
export function metricsScreen(lines: readonly CorpusLine[]): string {
  const rows = metricsOf(lines)
  const games = gamesOf(lines)
  const width = Math.max('model'.length, ...rows.map((r) => r.model.length))
  const head =
    `${'model'.padEnd(width)} ` +
    ['legal%', 'retry', 'repair%', 'cp/mv', 'blun%', 'tok/mv', 'Elo±CI']
      .map((h) => h.padStart(8))
      .join('')
  const title =
    `XCHESS DASH · metrics · corpus: ${plural(lines.length, 'line')} · ` +
    `${plural(games.length, 'game')} · ${plural(rows.length, 'model')}`
  return [title, head, ...rows.map((r) => metricsRow(r, width))].join('\n')
}

function metricsRow(r: ModelMetrics, width: number): string {
  // tok/mv: no token telemetry in the corpus contract yet → always '—'.
  const cells = [
    pct(r.legalRate).padStart(8),
    String(r.retries).padStart(8),
    pct(r.repairRate).padStart(8),
    cp(r.cpLoss).padStart(8),
    pct(r.blunderRate).padStart(8),
    EM_DASH.padStart(8),
    eloCell(r.elo, r.ci).padStart(8),
  ]
  return `${r.model.padEnd(width)} ${cells.join(' ')}`
}

// -- dash heat --------------------------------------------------------------

export interface HeatOptions {
  /** Attribute illegal attempts to one model; default is all models. */
  model?: string
}

/**
 * `xc dash heat`: illegal-move density heatmap over the hex grid — one
 * 4-step ramp glyph per cell on the board's staggered geometry (§5.2).
 */
export function heatScreen(
  lines: readonly CorpusLine[],
  opts: HeatOptions = {},
): string {
  const data = heatOf(lines, opts.model)
  const title = 'XCHESS DASH · heat'
  const subtitle =
    `${opts.model ?? 'all models'} · illegal-move density · ` +
    `${data.n} illegal attempts` +
    (data.max > 0 ? ` · peak ${data.max}` : '')
  const legend = 'ramp · ░ ▒ ▓  (low → high)'

  const glyphs = boardCells().map((cell) => ({
    cell,
    glyph: rampGlyph(
      data.max > 0 ? (data.perCell.get(keyOf(cell)) ?? 0) / data.max : 0,
    ),
  }))
  return [title, ...zip(renderCells(glyphs), [subtitle, legend])].join('\n')
}

// -- dash ladder ------------------------------------------------------------

interface LadderRow {
  rank: number
  model: string
  elo: number
  ci: number | null
}

/**
 * `xc dash ladder`: Bradley–Terry Elo table with 95% CIs plus observed
 * head-to-head score rates (mockup §5.4).
 */
export function ladderScreen(lines: readonly CorpusLine[]): string {
  const games = gamesOf(lines)
  const rows: LadderRow[] = [...eloTable(lines).entries()]
    .sort((x, y) => y[1].elo - x[1].elo)
    .map(([model, e], i) => ({ rank: i + 1, model, ...e }))
  if (rows.length === 0) {
    return 'XCHESS DASH · ladder\n(no finished games in corpus)'
  }

  const width = Math.max('model'.length, ...rows.map((r) => r.model.length))
  const title =
    `XCHESS DASH · ladder · ${plural(games.length, 'game')} · ` +
    (rows.some((r) => r.model === 'shallow-ai')
      ? 'anchor shallow-ai @1500'
      : 'mean-centred @1500')
  const head =
    `${' #'.padEnd(3)}${'model'.padEnd(width + 1)}` +
    ['Elo', '95% CI', 'W/L/D', 'legal%'].map((h) => h.padStart(8)).join(' ')

  const byModel = new Map(metricsOf(lines).map((r) => [r.model, r]))
  const body = rows.map((r) => {
    const m = byModel.get(r.model)
    const wld = m ? `${m.wins}/${m.losses}/${m.draws}` : '0/0/0'
    return (
      `${String(r.rank).padStart(2)} ${r.model.padEnd(width + 1)}` +
      String(r.elo).padStart(8) +
      (r.ci === null
        ? '(pin)'.padStart(8)
        : `±${Math.round(r.ci)}`.padStart(8)) +
      wld.padStart(8) +
      (m ? pct(m.legalRate) : EM_DASH).padStart(8)
    )
  })

  return [
    title,
    head,
    ...body,
    '',
    ...h2hMatrix(
      rows.map((r) => r.model),
      pairOutcomes(lines),
    ),
    rankNote(rows[0]!, rows[1]),
  ].join('\n')
}

/** Observed head-to-head matrix: row model's score rate vs column model. */
function h2hMatrix(
  names: readonly string[],
  outcomes: ReturnType<typeof pairOutcomes>,
): string[] {
  const h2h = new Map<string, { n: number; score: number }>()
  for (const { a, b, winner } of outcomes) {
    const x = winner === null ? 0.5 : winner === a ? 1 : 0
    const k = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
    const loIsA = a < b
    const t = h2h.get(k) ?? { n: 0, score: 0 }
    t.n++
    t.score += loIsA ? x : 1 - x // canonicalize: score is the lo-name's rate
    h2h.set(k, t)
  }
  const cell = (rowName: string, colName: string): string => {
    if (rowName === colName) return '·'.padStart(8)
    const k =
      rowName < colName
        ? `${rowName}\u0000${colName}`
        : `${colName}\u0000${rowName}`
    const t = h2h.get(k)
    if (!t || t.n === 0) return EM_DASH.padStart(8)
    const x = rowName < colName ? t.score / t.n : 1 - t.score / t.n
    return `${Math.round(x * 100)}%`.padStart(8)
  }
  const short = (m: string): string => m.slice(0, 8).padStart(8)
  const w = Math.max(10, ...names.map((m) => m.length))
  return [
    ''.padEnd(w) + names.map(short).join(''),
    ...names.map(
      (rowName) =>
        rowName.padEnd(w) + names.map((c) => cell(rowName, c)).join(''),
    ),
  ]
}

/** Flag non-significant rank order between the top two CIs. */
function rankNote(
  top: LadderRow,
  second: LadderRow | undefined,
): string | null {
  if (!second || top.ci === null || second.ci === null) return null
  if (Math.abs(top.elo - second.elo) >= top.ci + second.ci) return null
  return `note · overlapping CIs ${top.rank}↔${second.rank} — rank order not significant at this n`
}
