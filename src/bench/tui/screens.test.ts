/**
 * Golden-frame tests (XCHESS_BENCH §6): each screen is a pure function of
 * the committed fixture corpus, frozen against its golden file. Synthetic
 * line sets cover paths the fixture doesn't reach: the pin path, empty
 * corpora, and null-engine dashes.
 */
import { describe, expect, it } from 'vitest'

import corpusJsonl from './__fixtures__/corpus.jsonl?raw'
import goldenHeatAll from './__fixtures__/goldens/heat-all.txt?raw'
import goldenHeatFlaky from './__fixtures__/goldens/heat-flaky.txt?raw'
import goldenLadder from './__fixtures__/goldens/ladder.txt?raw'
import goldenMetrics from './__fixtures__/goldens/metrics.txt?raw'
import goldenWatch1 from './__fixtures__/goldens/watch-r19-0001.txt?raw'
import goldenWatch3 from './__fixtures__/goldens/watch-r19-0003.txt?raw'
import type { CorpusLine } from './aggregate'
import { EM_DASH, spark } from './aggregate'
import {
  heatScreen,
  ladderScreen,
  metricsScreen,
  rampGlyph,
  watchScreen,
} from './screens'

const START_FEN =
  'b/qbk/n1b1n/r5r/ppppppppp/11/5P5/4P1P4/3P1B1P3/2P2B2P2/1PRNQBKNRP1 w - 0 1'

const GOLDENS: Record<string, string> = {
  'heat-all': goldenHeatAll,
  'heat-flaky': goldenHeatFlaky,
  ladder: goldenLadder,
  metrics: goldenMetrics,
  'watch-r19-0001': goldenWatch1,
  'watch-r19-0003': goldenWatch3,
}

// ?raw keeps the fixture text verbatim; JSONL lines end with '\n', so the
// file body is already a newline-joined list.
const fixtureLines = (): CorpusLine[] =>
  corpusJsonl
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as CorpusLine)

const golden = (name: string): string => GOLDENS[name]!

/** One synthetic corpus line; missing fields get inert defaults. */
const line = (
  over: Partial<CorpusLine> &
    Pick<CorpusLine, 'gameId' | 'model' | 'ply' | 'side'>,
): CorpusLine => ({
  retry: 0,
  fen: START_FEN,
  response: { move: 'Ke1e6' },
  verdict: { legal: false, san: null },
  engine: null,
  game: { over: false, result: null, winner: null },
  ...over,
})

describe('golden frames over the fixture corpus', () => {
  const lines = fixtureLines()

  it('watch: forfeit, repairs, partial grade', () => {
    expect(watchScreen(lines, { gameId: 'r19-0001' })).toBe(
      golden('watch-r19-0001'),
    )
  })

  it('watch: engine-graded game with full eval series', () => {
    expect(watchScreen(lines, { gameId: 'r19-0003' })).toBe(
      golden('watch-r19-0003'),
    )
  })

  it('watch defaults to the first game (r19-0001)', () => {
    expect(watchScreen(lines)).toBe(golden('watch-r19-0001'))
  })

  it('watch r19-0002 is a max-plies draw with no engine data anywhere', () => {
    const screen = watchScreen(lines, { gameId: 'r19-0002' })
    expect(screen).toContain('stopped (max plies)')
    expect(screen).toContain('eval ' + EM_DASH)
  })

  it('metrics: frozen scorecard', () => {
    expect(metricsScreen(lines)).toBe(golden('metrics'))
  })

  it('heat: frozen density map, all models and per-model', () => {
    expect(heatScreen(lines)).toBe(golden('heat-all'))
    expect(heatScreen(lines, { model: 'flaky' })).toBe(golden('heat-flaky'))
  })

  it('heat: model with no illegal attempts renders an empty ramp', () => {
    const screen = heatScreen(lines, { model: 'greedy-capture' })
    expect(screen).toContain('0 illegal attempts')
    expect(screen).not.toMatch('[░▒▓]')
  })

  it('ladder: frozen Bradley–Terry table', () => {
    expect(ladderScreen(lines)).toBe(golden('ladder'))
  })
})

describe('screen edge paths', () => {
  it('empty corpus: no games / no finished games', () => {
    expect(watchScreen([])).toBe('XCHESS BENCH · watch\n(no games in corpus)')
    expect(ladderScreen([])).toBe(
      'XCHESS DASH · ladder\n(no finished games in corpus)',
    )
    const metrics = metricsScreen([])
    expect(metrics).toContain('corpus: 0 lines · 0 games · 0 models')
    expect(metrics).toContain('legal%   retry')
    expect(metrics.split('\n')).toHaveLength(2) // title + header, no rows
    expect(heatScreen([])).toContain('0 illegal attempts')
  })

  it('ladder pins shallow-ai at 1500 when present', () => {
    const lines: CorpusLine[] = [
      line({ gameId: 'g1', model: 'shallow-ai', ply: 1, side: 'w' }),
      line({
        gameId: 'g1',
        model: 'flaky',
        ply: 2,
        side: 'b',
        response: { move: 'Ke1e6' },
      }),
      line({ gameId: 'g1', model: 'flaky', ply: 2, side: 'b', retry: 1 }),
      line({
        gameId: 'g1',
        model: 'flaky',
        ply: 2,
        side: 'b',
        retry: 2,
        game: { over: true, result: 'illegal', winner: 'w' },
      }),
    ]
    const screen = ladderScreen(lines)
    expect(screen).toContain('anchor shallow-ai @1500')
    expect(screen).toMatch(/1 shallow-ai\s+1500\s+\(pin\)/)
    expect(screen).toMatch(/2 flaky\s+-\d{3}/) // flaky ranked below the pin
  })

  it('ramp/spark helpers', () => {
    expect(rampGlyph(0)).toBe('·')
    expect(rampGlyph(0.2)).toBe('░')
    expect(rampGlyph(0.5)).toBe('▒')
    expect(rampGlyph(1)).toBe('▓')
    expect(spark([5, 5, 5])).toBe('▄▄▄')
    expect(spark([5])).toBe('▄')
    expect(spark([])).toBe('')
  })
})
