/**
 * `xc` — bench CLI (XCHESS_BENCH §6). Plain ANSI + Unicode, no TUI library,
 * no new deps. TS is loaded via the repo's ts-resolve hook (type stripping).
 *
 * Commands:
 *   xc bench run --white <bot> --black <bot> [--seed N] [--max-retries N]
 *                [--max-plies N] [--out file]     # play, log JSONL
 *   xc bench watch <file> [--game <id>]           # render a game from a corpus
 *   xc bench watch --live --white <bot> --black <bot> [--seed N]
 *   xc dash metrics <file...>                     # per-model scorecard
 *   xc dash heat <file...> [--model <m>]          # illegal-move heatmap
 *   xc dash ladder <file...>                      # BT Elo table
 *
 * Bots: random | greedy-capture
 */
/* global console, process, URL */
import { register } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
register(new URL('./ts-resolve.mjs', import.meta.url), import.meta.url)

const { runMatch } = await import('../src/bench/runner.ts')
const { randomBot, greedyCaptureBot } = await import('../src/bench/bots.ts')
const { watchScreen, metricsScreen, heatScreen, ladderScreen } =
  await import('../src/bench/tui/screens.ts')

const BOTS = { random: randomBot, 'greedy-capture': greedyCaptureBot }

const usage = () => {
  process.stderr.write(
    `usage: xc <command> [args]\n` +
      `  bench run  --white <bot> --black <bot> [--seed N] [--max-retries N] [--max-plies N] [--out file]\n` +
      `  bench watch <file> [--game <id>]\n` +
      `  bench watch --live --white <bot> --black <bot> [--seed N]\n` +
      `  dash metrics <file...>  dash heat <file...> [--model m]  dash ladder <file...>\n` +
      `bots: ${Object.keys(BOTS).join(' | ')}\n`,
  )
  process.exit(1)
}

// -- argv (hand-rolled; no deps) --------------------------------------------

const argv = process.argv.slice(2)
const [group, cmd] = argv
const args = argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  if (i === -1 || i + 1 >= args.length) return null
  return args[i + 1]
}
const has = (name) => args.includes(name)

if (!(group === 'bench' || group === 'dash') || !cmd) usage()

// -- corpus reading ----------------------------------------------------------

/** Read one JSONL file; a malformed line fails loudly with file:line. */
function readJsonl(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    process.stderr.write(`xc: cannot read ${file}: ${e.message}\n`)
    process.exit(1)
  }
  return text
    .split('\n')
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => l.trim() !== '')
    .map(({ l, n }) => {
      try {
        return JSON.parse(l)
      } catch (e) {
        throw new Error(`${file}:${n}: ${e.message}`, { cause: e })
      }
    })
}

function readCorpus(files) {
  if (!files || files.length === 0) usage()
  const lines = files.flatMap((f) => readJsonl(f))
  if (lines.length === 0) usage()
  return lines
}

// -- bench run / live watch --------------------------------------------------

function botOf(name) {
  if (!name || !BOTS[name]) {
    process.stderr.write(
      `xc: unknown bot '${name}' (bots: ${Object.keys(BOTS).join(', ')})\n`,
    )
    process.exit(1)
  }
  return BOTS[name]
}

function runConfig() {
  return {
    seed: Number(flag('--seed') ?? 1),
    white: botOf(flag('--white')),
    black: botOf(flag('--black')),
    maxRetries:
      flag('--max-retries') === null ? 2 : Number(flag('--max-retries')),
    maxPlies: flag('--max-plies') === null ? 400 : Number(flag('--max-plies')),
    gameId: flag('--game-id'),
  }
}

/** Positional file args: argv entries not consumed as a flag value. */
const valueFlags = [
  '--seed',
  '--max-retries',
  '--max-plies',
  '--out',
  '--game-id',
  '--game',
  '--model',
  '--white',
  '--black',
]
const positionalFiles = () =>
  args.filter(
    (a, i) => !a.startsWith('--') && !valueFlags.includes(args[i - 1] ?? ''),
  )

if (group === 'bench' && cmd === 'run') {
  if (!has('--white') || !has('--black')) usage()
  const config = runConfig()
  const records = []
  await runMatch(config, (record) => {
    records.push(record)
    process.stdout.write(JSON.stringify(record) + '\n')
  })
  const out = flag('--out')
  if (out)
    writeFileSync(out, records.map((r) => JSON.stringify(r) + '\n').join(''))
  process.exit(0)
}

if (group === 'bench' && cmd === 'watch') {
  if (has('--live')) {
    if (!has('--white') || !has('--black')) usage()
    const config = runConfig()
    const lines = []
    let first = true
    await runMatch(config, (record) => {
      lines.push(record)
      process.stdout.write(first ? '\x1b[2J' : '\x1b[H')
      first = false
      process.stdout.write(watchScreen(lines, { gameId: lines[0]?.gameId }))
    })
    process.stdout.write('\n')
    process.exit(0)
  }
  const files = positionalFiles()
  if (files.length !== 1) usage()
  const lines = readCorpus(files)
  console.log(watchScreen(lines, { gameId: flag('--game') ?? undefined }))
  process.exit(0)
}

// -- dash --------------------------------------------------------------------

if (group === 'dash') {
  const files = positionalFiles()
  if (files.length === 0) usage()
  const lines = readCorpus(files)
  const opts = { model: flag('--model') ?? undefined }
  if (cmd === 'metrics') console.log(metricsScreen(lines))
  else if (cmd === 'heat') console.log(heatScreen(lines, opts))
  else if (cmd === 'ladder') console.log(ladderScreen(lines))
  else usage()
  process.exit(0)
}

usage()
