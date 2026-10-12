/**
 * Corpus aggregation (XCHESS_BENCH §6.1: the JSONL is the only authority).
 * Every TUI screen renders from these aggregates; no screen keeps state.
 */
import { keyOf } from '../../board/pieces'
import type { Axial } from '../../board/axial'
import { notationToAxial } from '../../board/notation'
import type { PlyRecord } from '../runner'

/**
 * One parsed JSONL line. Same shape as the runner's PlyRecord, with
 * `engine` widened: the runner always logs null and t91's grader later
 * fills per-ply evaluations (evalBefore/evalAfter/cpLoss).
 */
export type CorpusLine = Omit<PlyRecord, 'engine'> & {
  engine: Record<string, unknown> | null
}

/** Parse JSONL text into corpus lines (blank lines skipped). */
export function parseCorpus(text: string): CorpusLine[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as CorpusLine)
}

/** A cell reference inside a move text, e.g. "f5" in "Pf5f6=Q". */
const CELL_RE = /[a-ikl](?:1[01]|[1-9])/g

/** First cell reference in a move text (null if none), normalized to axial. */
export function moveCell(text: string): Axial | null {
  const m = CELL_RE.exec(text)
  CELL_RE.lastIndex = 0 // module-level /g regex: reset after every use
  return m ? notationToAxial(m[0]) : null
}

/** A game extracted from the corpus: its lines plus the side→model map. */
export interface GameInfo {
  gameId: string
  lines: CorpusLine[]
  /** Side → model id; absent when that side never emitted a line. */
  models: Partial<Record<'w' | 'b', string>>
  /** The game's last game.over line carries the outcome. */
  winnerSide: 'w' | 'b' | null
  result: string | null
}

/** Group corpus lines into games, first-seen order. */
export function gamesOf(lines: readonly CorpusLine[]): GameInfo[] {
  const games = new Map<string, GameInfo>()
  for (const line of lines) {
    let game = games.get(line.gameId)
    if (!game) {
      game = {
        gameId: line.gameId,
        lines: [],
        models: {},
        winnerSide: null,
        result: null,
      }
      games.set(line.gameId, game)
    }
    game.lines.push(line)
    if (!game.models[line.side]) game.models[line.side] = line.model
    if (line.game.over) {
      game.winnerSide = line.game.winner
      game.result = line.game.result
    }
  }
  return [...games.values()]
}

/** Outcome of one finished game between two known models. */
export interface PairOutcome {
  a: string
  b: string
  /** Model id of the winner, null on a draw. */
  winner: string | null
}

/** Finished games whose outcome line names both models. */
export function pairOutcomes(lines: readonly CorpusLine[]): PairOutcome[] {
  const out: PairOutcome[] = []
  for (const game of gamesOf(lines)) {
    if (game.result === null) continue
    const w = game.models.w
    const b = game.models.b
    if (!w || !b || w === b) continue
    const winnerSide = game.winnerSide
    out.push({
      a: w,
      b,
      winner: winnerSide ? (game.models[winnerSide] ?? null) : null,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Metrics per model
// ---------------------------------------------------------------------------

interface MetricsAcc extends ModelMetricsRaw {
  lossSum: number
}

interface ModelMetricsRaw {
  model: string
  attempts: number
  legalAttempts: number
  retries: number
  wins: number
  losses: number
  draws: number
}

export interface ModelMetrics {
  model: string
  attempts: number
  legalAttempts: number
  legalRate: number | null
  /** Attempts that were re-prompts (retry > 0). */
  retries: number
  /** Re-prompts that ended legal / plies with any illegal attempt. */
  repairRate: number | null
  /** Mean engine cp-loss over graded plies; null while engine is null. */
  cpLoss: number | null
  /** Graded plies with cpLoss > 300; null while engine is null. */
  blunderRate: number | null
  wins: number
  losses: number
  draws: number
  elo: number | null
  ci: number | null
}

/**
 * Per-model scorecard over the whole corpus, sorted by Elo (desc, nulls
 * last, then model id). A legal attempt is always final — the runner stops
 * retrying at the first legal response — and a ply's final attempt carries
 * repair and grading.
 */
export function metricsOf(lines: readonly CorpusLine[]): ModelMetrics[] {
  const rows = new Map<string, MetricsAcc>()
  const rowOf = (model: string): MetricsAcc => {
    let r = rows.get(model)
    if (!r) {
      r = {
        model,
        attempts: 0,
        legalAttempts: 0,
        retries: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        lossSum: 0,
      }
      rows.set(model, r)
    }
    return r
  }

  const contested = new Map<string, { plies: number; repaired: number }>()
  const graded = new Map<
    string,
    { plies: number; lossSum: number; blunders: number }
  >()

  for (const game of gamesOf(lines)) {
    // Group attempts by (ply, side); the group's last line is the outcome.
    const groups = new Map<string, CorpusLine[]>()
    for (const line of game.lines) {
      const r = rowOf(line.model)
      r.attempts++
      if (line.verdict.legal) r.legalAttempts++
      if (line.retry > 0) r.retries++
      const key = `${line.ply}:${line.side}`
      const group = groups.get(key)
      if (group) group.push(line)
      else groups.set(key, [line])
    }
    for (const group of groups.values()) {
      const final = group.at(-1)!
      if (group.some((l) => !l.verdict.legal)) {
        const c = contested.get(final.model) ?? { plies: 0, repaired: 0 }
        c.plies++
        if (final.verdict.legal) c.repaired++
        contested.set(final.model, c)
      }
      if (final.verdict.legal) {
        const loss = engineNumber(final.engine, 'cpLoss')
        if (loss !== null) {
          const g = graded.get(final.model) ?? {
            plies: 0,
            lossSum: 0,
            blunders: 0,
          }
          g.plies++
          g.lossSum += loss
          if (loss > 300) g.blunders++
          graded.set(final.model, g)
        }
      }
    }
  }

  for (const { a, b, winner } of pairOutcomes(lines)) {
    if (winner === null) {
      rowOf(a).draws++
      rowOf(b).draws++
    } else {
      rowOf(winner).wins++
      rowOf(winner === a ? b : a).losses++
    }
  }

  const elo = eloTable(lines)
  const out: ModelMetrics[] = []
  for (const r of rows.values()) {
    const c = contested.get(r.model)
    const g = graded.get(r.model)
    out.push({
      model: r.model,
      attempts: r.attempts,
      legalAttempts: r.legalAttempts,
      legalRate: r.attempts > 0 ? r.legalAttempts / r.attempts : null,
      retries: r.retries,
      repairRate: c && c.plies > 0 ? c.repaired / c.plies : null,
      cpLoss: g && g.plies > 0 ? g.lossSum / g.plies : null,
      blunderRate: g && g.plies > 0 ? g.blunders / g.plies : null,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      elo: elo.get(r.model)?.elo ?? null,
      ci: elo.get(r.model)?.ci ?? null,
    })
  }
  out.sort(
    (x, y) =>
      (y.elo ?? -Infinity) - (x.elo ?? -Infinity) ||
      x.model.localeCompare(y.model),
  )
  return out
}

/** First number under a key in an engine payload, null if absent. */
function engineNumber(
  engine: Record<string, unknown> | null,
  key: string,
): number | null {
  const v = engine?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// ---------------------------------------------------------------------------
// Bradley–Terry Elo with CIs (order-independent, unlike naive K-factor Elo)
// ---------------------------------------------------------------------------

export interface EloEntry {
  elo: number
  /** Half-width of the 95% CI (diagonal Fisher approximation). */
  ci: number | null
}

/**
 * Maximum-likelihood Bradley–Terry Elo over pairwise game outcomes: damped
 * Newton on the log-likelihood with a diagonal-Fisher CI. 'shallow-ai' is
 * pinned at 1500 when present (the t95 anchor); otherwise the field is
 * mean-centred at 1500. A player winning everything is degenerate in BT;
 * the θ clamp bounds the estimate instead of diverging.
 */
export function eloTable(lines: readonly CorpusLine[]): Map<string, EloEntry> {
  // Pairwise tally keyed 'a\0b' with a < b; score = a's wins + half draws.
  const tally = new Map<string, { n: number; score: number }>()
  const players = new Set<string>()
  for (const { a, b, winner } of pairOutcomes(lines)) {
    players.add(a)
    players.add(b)
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const x = winner === null ? 0.5 : winner === lo ? 1 : 0
    const t = tally.get(pairKey(lo, hi)) ?? { n: 0, score: 0 }
    t.n++
    t.score += x
    tally.set(pairKey(lo, hi), t)
  }

  const elo = new Map<string, EloEntry>()
  if (players.size === 0 || tally.size === 0) return elo

  const k = Math.LN10 / 400
  const pin = players.has('shallow-ai')
  const names = [...players].sort()
  const free = names.filter((n) => !(pin && n === 'shallow-ai'))
  // Pinned players keep an entry at their anchor (θ=0 ↔ 1500) so score()/CI
  // math sees a real number on both sides; only free rows update.
  const theta = new Map<string, number>(names.map((n) => [n, 0]))
  const pinned = (n: string): boolean => pin && n === 'shallow-ai'

  const score = (p: string, q: string): number =>
    1 / (1 + Math.exp(-(theta.get(p)! - theta.get(q)!) * k))

  // Newton on the free parameters: G_p = Σ_q n_pq(ŝ−s)k, H = k²(diag − W⁺).
  // RIDGE damps the exact singularity of the Laplacian (the all-ones
  // direction is in its null space) so the solve never divides by ~0; it only
  // biases the common shift, which the mean-centre removes below.
  const RIDGE = 1e-9
  for (let iter = 0; iter < 100; iter++) {
    const grad = new Map<string, number>()
    const hess = new Map<string, Map<string, number>>()
    for (const p of free) {
      grad.set(p, 0)
      hess.set(p, new Map(names.map((q) => [q, 0])))
    }
    for (const [pair, t] of tally) {
      const [lo, hi] = pair.split('\u0000') as [string, string]
      for (const [p, q] of [
        [lo, hi],
        [hi, lo],
      ] as const) {
        if (pinned(p)) continue // pinned player has no free row
        const obs = q === hi ? t.score / t.n : 1 - t.score / t.n
        grad.set(p, grad.get(p)! + (obs - score(p, q)) * t.n * k)
        const c = score(p, q) * (1 - score(p, q)) * t.n * k * k
        const hp = hess.get(p)!
        hp.set(p, hp.get(p)! - c + RIDGE)
        if (!pinned(q)) hp.set(q, hp.get(q)! + c)
      }
    }
    const maxAbsGrad = Math.max(...free.map((p) => Math.abs(grad.get(p)!)))
    if (maxAbsGrad < 1e-10) break
    const step = solveLinear(hess, grad, free)
    for (const p of free) {
      const s = step.get(p)!
      if (!Number.isFinite(s)) continue // singular system: keep the clamped value
      theta.set(p, clamp(theta.get(p)! - s, -2400, 2400))
    }
  }

  const mean = pin
    ? 0
    : free.reduce((s, n) => s + theta.get(n)!, 0) / Math.max(free.length, 1)
  for (const name of names) {
    let info = 0
    for (const [pair, { n }] of tally) {
      const [lo, hi] = pair.split('\u0000') as [string, string]
      if (lo !== name && hi !== name) continue
      const q = lo === name ? hi : lo
      const s = score(name, q)
      info += n * s * (1 - s)
    }
    info *= k * k
    const isPin = pin && name === 'shallow-ai'
    // A winless/undefeated player diverges in BT; the CI explodes with it.
    // Cap the half-width so a table column stays readable.
    const ci = Math.min(9999, 1.96 / Math.sqrt(Math.max(info, 1e-12)))
    elo.set(name, {
      elo: Math.round(theta.get(name)! - mean + 1500),
      ci: isPin ? null : ci,
    })
  }
  return elo
}

function pairKey(a: string, b: string): string {
  return `${a}\u0000${b}`
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Solve H·x = g (Gaussian elimination with partial pivoting). */
function solveLinear(
  hess: Map<string, Map<string, number>>,
  grad: Map<string, number>,
  names: readonly string[],
): Map<string, number> {
  const n = names.length
  const m: number[][] = names.map((p) =>
    names.map((q) => hess.get(p)!.get(q) ?? 0),
  )
  const rhs = names.map((p) => grad.get(p) ?? 0)
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r
    }
    if (piv !== col) {
      const row = m[col]!
      m[col] = m[piv]!
      m[piv] = row
      const v = rhs[col]!
      rhs[col] = rhs[piv]!
      rhs[piv] = v
    }
    const d = m[col]![col]!
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col]! / d
      for (let c = col; c < n; c++) {
        m[r]![c] = m[r]![c]! - f * m[col]![c]!
      }
      rhs[r] = rhs[r]! - f * rhs[col]!
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let s = rhs[row]!
    for (let c = row + 1; c < n; c++) {
      s -= m[row]![c]! * x[c]!
    }
    x[row] = s / m[row]![row]!
  }
  const out = new Map<string, number>()
  names.forEach((p, i) => out.set(p, x[i]!))
  return out
}

// ---------------------------------------------------------------------------
// Heat: per-cell illegal-move density
// ---------------------------------------------------------------------------

export interface HeatData {
  /** Illegal attempts counted. */
  n: number
  /** Attempts per source cell, keyed by cell keyOf ("q,r"). */
  perCell: Map<string, number>
  /** Max per-cell count (0 when none). */
  max: number
}

/** Tally illegal attempts by the source cell named in the attempt's move text. */
export function heatOf(lines: readonly CorpusLine[], model?: string): HeatData {
  const perCell = new Map<string, number>()
  let n = 0
  for (const line of lines) {
    if (line.verdict.legal) continue
    if (model !== undefined && line.model !== model) continue
    const cell = moveCell(line.response.move)
    if (!cell) continue
    const k = keyOf(cell)
    perCell.set(k, (perCell.get(k) ?? 0) + 1)
    n++
  }
  const max = Math.max(0, ...perCell.values())
  return { n, perCell, max }
}

// ---------------------------------------------------------------------------
// Watch: per-game extraction
// ---------------------------------------------------------------------------

export interface WatchGame {
  game: GameInfo
  /** Legal plies in play order (a legal attempt is always final). */
  moves: CorpusLine[]
  /** Attempts rejected as illegal. */
  illegal: CorpusLine[]
  /** White/black move pairs: [moveNo, sanW, sanB | null]. */
  pairs: Array<[number, string | null, string | null]>
}

/** Extract one game's display data. */
export function watchOf(game: GameInfo): WatchGame {
  const moves = game.lines.filter((l) => l.verdict.legal)
  const illegal = game.lines.filter((l) => !l.verdict.legal)
  const pairs: Array<[number, string | null, string | null]> = []
  for (const white of moves.filter((m) => m.side === 'w')) {
    const black =
      moves.find((m) => m.side === 'b' && m.ply === white.ply + 1) ?? null
    pairs.push([
      Math.ceil(white.ply / 2),
      white.verdict.san,
      black?.verdict.san ?? null,
    ])
  }
  return { game, moves, illegal, pairs }
}

/**
 * White-perspective engine evaluation per played ply (sparkline input):
 * mover-side evalAfter negated for Black. Field names follow the t91
 * grader contract (evalAfter/cpLoss camelCase per the runner's style).
 */
export function evalSeries(game: GameInfo): number[] {
  const values: number[] = []
  for (const line of watchOf(game).moves) {
    const v = engineNumber(line.engine, 'evalAfter')
    if (v !== null) values.push(line.side === 'w' ? v : -v)
  }
  return values
}

/** ▁▂▃▄▅▆▇█ sparkline over a numeric series (flat series → mid step). */
export function spark(values: readonly number[]): string {
  const ramp = '▁▂▃▄▅▆▇█'
  if (values.length === 0) return ''
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  return [...values]
    .map((v) => {
      if (hi === lo) return ramp[3]!
      return ramp[
        Math.min(
          ramp.length - 1,
          Math.floor(((v - lo) / (hi - lo)) * ramp.length),
        )
      ]!
    })
    .join('')
}

/** '—' for engine-derived fields while the engine is null (XCHESS_BENCH). */
export const EM_DASH = '—'
