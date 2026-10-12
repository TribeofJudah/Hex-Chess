/**
 * x5 — session report generator (XCHESS_BENCH §4a `xc report session`).
 *
 * Self-contained HTML: inline SVG, no external assets, no network — the
 * only URL allowed is the SVG xmlns. Reads a JSONL corpus only (§6.1):
 * every number on the page rebuilds from the lines. Engine columns render
 * '—' while the grader (x2) hasn't filled them.
 *
 * Publish is a manual step: save the HTML and upload it to the artifact
 * server yourself — this module never uploads anything.
 */
import { keyOf } from '../board/pieces'
import {
  EM_DASH,
  gamesOf,
  heatOf,
  metricsOf,
  type CorpusLine,
  type ModelMetrics,
} from './tui/aggregate'
import { boardCells, screenPos } from './tui/board'
import { rampGlyph } from './tui/screens'

/** Escape untrusted corpus strings (model ids, run ids) for HTML. */
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
        ? '&lt;'
        : c === '>'
          ? '&gt;'
          : c === '"'
            ? '&quot;'
            : '&#39;',
  )

const SVG_XMLNS = 'http://www.w3.org/2000/svg'
const RAMP_FILL: Record<string, string> = {
  '·': '#ececec',
  '░': '#bdbdbd',
  '▒': '#7d7d7d',
  '▓': '#323232',
}

const pct = (v: number | null): string =>
  v === null ? EM_DASH : `${(v * 100).toFixed(1)}%`

const cp = (v: number | null): string =>
  v === null ? EM_DASH : String(Math.round(v))

const eloCell = (r: ModelMetrics): string => {
  if (r.elo === null) return EM_DASH
  return r.ci === null
    ? `${Math.round(r.elo)} (pin)`
    : `${Math.round(r.elo)} ±${Math.round(r.ci)}`
}

/**
 * Illegal-move heat map as inline SVG: one pointy-top hexagon per cell on
 * the same staggered projection the TUI board uses (tui/board screenPos —
 * x ∝ q, y ∝ 2r+q), filled by the 4-step ·░▒▓ ramp.
 */
function heatSvg(lines: readonly CorpusLine[], model?: string): string {
  const data = heatOf(lines, model)
  const S = 24 // hex circumradius
  const DX = 0.75 * S // terminal col → x (files every 2 cols)
  const DY = (Math.sqrt(3) / 2) * S // terminal row → y
  const VX = (Math.sqrt(3) / 2) * S // hexagon half-width
  const polys: string[] = []
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const cell of boardCells()) {
    const step = rampGlyph(
      data.max > 0 ? (data.perCell.get(keyOf(cell)) ?? 0) / data.max : 0,
    )
    const { row, col } = screenPos(cell)
    const cx = col * DX
    const cy = row * DY
    minX = Math.min(minX, cx - VX)
    maxX = Math.max(maxX, cx + VX)
    minY = Math.min(minY, cy - S)
    maxY = Math.max(maxY, cy + S)
    const pt = (dx: number, dy: number): string =>
      `${(cx + dx).toFixed(1)},${(cy + dy).toFixed(1)}`
    const pts =
      `${pt(0, -S)} ${pt(VX, -S / 2)} ${pt(VX, S / 2)} ` +
      `${pt(0, S)} ${pt(-VX, S / 2)} ${pt(-VX, -S / 2)}`
    const n = data.perCell.get(keyOf(cell)) ?? 0
    const label =
      n > 0 ? `<title>${esc(keyOf(cell))} · ${n} illegal</title>` : ''
    polys.push(
      `<polygon points="${pts}" fill="${RAMP_FILL[step]!}" stroke="#ffffff" stroke-width="1">${label}</polygon>`,
    )
  }
  const pad = S / 2
  const vb =
    `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ` +
    `${(maxX - minX + 2 * pad).toFixed(1)} ${(maxY - minY + 2 * pad).toFixed(1)}`
  return (
    `<svg xmlns="${SVG_XMLNS}" viewBox="${vb}" role="img" ` +
    `aria-label="illegal-move heat map over the hex board">\n` +
    polys.join('\n') +
    `\n</svg>`
  )
}

const metricsTable = (rows: readonly ModelMetrics[]): string => {
  const head =
    '<tr><th>model</th><th>legal%</th><th>retry</th><th>repair%</th>' +
    '<th>cp/mv</th><th>blun%</th><th>tok/mv</th><th>Elo ±95% CI</th></tr>'
  const body = rows
    .map(
      (r) =>
        `<tr><td>${esc(r.model)}</td>` +
        [
          pct(r.legalRate),
          String(r.retries),
          pct(r.repairRate),
          cp(r.cpLoss),
          pct(r.blunderRate),
          // tok/mv: no token telemetry in the corpus contract yet → '—'.
          EM_DASH,
          eloCell(r),
        ]
          .map((v) => `<td>${v}</td>`)
          .join('') +
        '</tr>',
    )
    .join('\n')
  return `<table>\n<thead>${head}</thead>\n<tbody>${body}</tbody>\n</table>`
}

const ladderTable = (rows: readonly ModelMetrics[]): string => {
  const head =
    '<tr><th>#</th><th>model</th><th>Elo</th><th>95% CI</th><th>W/L/D</th><th>legal%</th></tr>'
  const body = rows
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${esc(r.model)}</td>` +
        [
          r.elo === null ? EM_DASH : String(Math.round(r.elo)),
          r.elo === null
            ? EM_DASH
            : r.ci === null
              ? '(pin)'
              : `±${Math.round(r.ci)}`,
          `${r.wins}/${r.losses}/${r.draws}`,
          pct(r.legalRate),
        ]
          .map((v) => `<td>${v}</td>`)
          .join('') +
        '</tr>',
    )
    .join('\n')
  return `<table>\n<thead>${head}</thead>\n<tbody>${body}</tbody>\n</table>`
}

export interface ReportOptions {
  /** Run label for the title; default 'session'. */
  runId?: string
}

const CSS = `body{font-family:system-ui,sans-serif;margin:2rem auto;max-width:60rem;padding:0 1rem;color:#222}
svg{max-width:100%;height:auto}
table{border-collapse:collapse;margin:1rem 0;font-variant-numeric:tabular-nums}
th,td{border:1px solid #ccc;padding:.25rem .6rem;text-align:left}
.meta{color:#666}
h2{margin-top:2rem}`

/**
 * Session report (XCHESS_BENCH §4a `xc report session`): a pure function
 * from JSONL lines to one self-contained HTML string.
 */
export function sessionReport(
  lines: readonly CorpusLine[],
  opts: ReportOptions = {},
): string {
  const rows = metricsOf(lines)
  const games = gamesOf(lines)
  const runId = opts.runId ?? 'session'
  const heat = heatSvg(lines)
  const n = heatOf(lines).n
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>Xchess session report — ${esc(runId)}</title>`,
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    '<h1>Xchess session report</h1>',
    `<p class="meta">run ${esc(runId)} · ${lines.length} lines · ` +
      `${games.length} games · ${rows.length} models</p>`,
    '<h2>Illegal-move heat</h2>',
    heat,
    `<p>${n} illegal attempts · ramp · ░ ▒ ▓ low → high</p>`,
    '<h2>Metrics</h2>',
    metricsTable(rows),
    '<h2>Ladder</h2>',
    ladderTable(rows),
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
