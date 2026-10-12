#!/usr/bin/env node
/* global console, process */
/**
 * FEN round-trip smoke test for the deploy pipeline (t37).
 *
 * Runs the REAL src/board/fen.ts serialiser under plain `node` — no test
 * framework — so the pipeline gates on the module it actually ships, not on
 * vitest's copy of it. Fails closed: any unstable round-trip exits non-zero.
 *
 *   node scripts/fen-smoke.mjs
 *
 * Requires Node >= 22.18 (unflagged TypeScript type-stripping) — the same
 * version line as .github/workflows. Uses scripts/ts-resolve.mjs to resolve
 * the project's extensionless TS imports.
 */
import { register } from 'node:module'

register('./ts-resolve.mjs', import.meta.url)

const board = await import('../src/board/board.ts')
const { parsePosition, serializePosition, keyOf, allCells } = board

const START =
  'b/qbk/n1b1n/r5r/ppppppppp/11/5P5/4P1P4/3P1B1P3/2P2B2P2/1PRNQBKNRP1 w - 0 1'
const MID =
  'b/qbk/n1b1n/r3N1r/ppppppppp/4P6/5P5/6P4/3P1B1P3/2P2B2P2/1PR1QBKNRP1 b e5 3 12'

/** Every cell occupied — 91 pieces, the densest board the format allows. */
const FULL = {
  board: new Map(allCells().map((c) => [keyOf(c), { type: 'P', color: 'w' }])),
  turn: 'b',
  epTarget: null,
  halfmove: 100,
  fullmove: 9999,
}
const EMPTY = {
  board: new Map(),
  turn: 'w',
  epTarget: null,
  halfmove: 0,
  fullmove: 1,
}

const failures = []

/** assert() that records the failure instead of throwing out of the run. */
function check(name, fn) {
  try {
    fn()
    console.log(`  ok    ${name}`)
  } catch (err) {
    failures.push(name)
    console.log(`  FAIL  ${name}\n        ${err.message}`)
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

/** serialize → parse → serialize must be a fixed point, and the board must survive. */
function expectStable(label, position) {
  const text = serializePosition(position)
  const parsed = parsePosition(text)
  const again = serializePosition(parsed)
  assert(
    again === text,
    `${label}: not stable\n  first  ${text}\n  second ${again}`,
  )
  assert(
    parsed.board.size === position.board.size,
    `${label}: piece count ${parsed.board.size} != ${position.board.size}`,
  )
}

console.log('FEN round-trip smoke (real src/board/fen.ts)')

// Canonical strings must survive parse∘serialize unchanged.
for (const [label, fen] of [
  ['start position', START],
  ['mid-game (ep + counters)', MID],
]) {
  check(`canonical: ${label}`, () => {
    const out = serializePosition(parsePosition(fen))
    assert(out === fen, `changed:\n  in  ${fen}\n  out ${out}`)
  })
}

check('empty board round-trips (0 pieces)', () => expectStable('empty', EMPTY))
check('full board round-trips (91 pieces)', () => expectStable('full', FULL))
check('full board parses back to 91 pieces', () =>
  assert(parsePosition(serializePosition(FULL)).board.size === 91, 'not 91'),
)
check('start position parses back to 36 pieces', () =>
  assert(parsePosition(START).board.size === 36, 'not 36'),
)
check('counters and ep survive', () => {
  const p = parsePosition(MID)
  assert(p.turn === 'b', `turn ${p.turn}`)
  assert(p.halfmove === 3, `halfmove ${p.halfmove}`)
  assert(p.fullmove === 12, `fullmove ${p.fullmove}`)
  assert(p.epTarget !== null, 'ep lost')
})
check('rejects a malformed FEN', () => {
  let threw = false
  try {
    parsePosition('nonsense')
  } catch {
    threw = true
  }
  assert(threw, 'parsePosition did not throw on garbage')
})

if (failures.length) {
  console.error(`\nFEN smoke FAILED: ${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nFEN smoke PASSED')
