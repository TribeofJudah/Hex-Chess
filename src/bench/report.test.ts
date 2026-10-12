/**
 * Report tests (t93): the snapshot is allowed here because the HTML *is*
 * the artifact — the committed t90 fixture corpus is the only input, and
 * the page must be self-contained (its only URL is the SVG xmlns).
 */
import { describe, expect, it } from 'vitest'

import corpusJsonl from './tui/__fixtures__/corpus.jsonl?raw'
import type { CorpusLine } from './tui/aggregate'
import { EM_DASH } from './tui/aggregate'
import { sessionReport } from './report'

const fixtureLines = (): CorpusLine[] =>
  corpusJsonl
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as CorpusLine)

describe('session report', () => {
  const html = sessionReport(fixtureLines(), { runId: 'r19-fixture' })

  it('snapshot: the artifact on the fixture corpus', () => {
    expect(html).toMatchSnapshot()
  })

  it('contains no http(s) URLs except the SVG xmlns', () => {
    const urls = html.match(/https?:\/\/[^"'\s<>]+/g) ?? []
    expect(urls).toContain('http://www.w3.org/2000/svg')
    expect(
      urls.every((u) => u === 'http://www.w3.org/2000/svg'),
      `unexpected URLs: ${urls.filter((u) => u !== 'http://www.w3.org/2000/svg').join(', ')}`,
    ).toBe(true)
  })

  it('renders — for engine fields the grader has not filled', () => {
    // 'random' has no engine grading anywhere in the fixture.
    const row = html.split('\n').find((l) => l.includes('<td>random</td>'))
    expect(row).toBeDefined()
    expect(row).toContain(`<td>${EM_DASH}</td>`)
  })

  it('escapes untrusted strings', () => {
    const html2 = sessionReport([], { runId: '"<script>' })
    expect(html2).not.toContain('<script>')
    expect(html2).toContain('&quot;&lt;script&gt;')
  })
})
