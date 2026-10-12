import { serializePosition } from '../board/fen'
import {
  applyMove,
  initialGame,
  legalMoves,
  moveToSan,
  status,
  type GameState,
} from '../rules/rules'
import {
  mulberry32,
  type Agent,
  type AgentDecision,
  type LegalMove,
} from './adapter'

/** An agent that reports cumulative tokens spent across all its calls. */
export interface MeteredAgent extends Agent {
  readonly tokensUsed: number
}

export interface MatchConfig {
  seed: number
  white: Agent
  black: Agent
  /** Hard cap so a stuck pair of agents still terminates. */
  maxPlies?: number
  /**
   * Re-prompts allowed per ply after an illegal move (XCHESS_BENCH §4a.2).
   * 0 = the first illegal move ends the game.
   */
  maxRetries?: number
  /**
   * Token budget for the whole game, summed over every attempt of both
   * agents. Charged only by agents that expose `tokensUsed`. Exceeding it
   * ends the game 'token-cap'; the over-budget attempt is not applied.
   */
  tokenCap?: number
  gameId?: string
}

export interface GameOver {
  over: boolean
  /**
   * checkmate | stalemate | draw50 | repetition | illegal | max-plies |
   * token-cap | null while live.
   */
  result: string | null
  winner: 'w' | 'b' | null
}

/**
 * One JSONL line per attempt. A ply that is re-prompted has one line per
 * attempt; its final outcome is the last line for that ply.
 * Field names follow the XCHESS_BENCH §4a.1 contract.
 */
export interface PlyRecord {
  gameId: string
  model: string
  ply: number
  /** 0 on the first attempt at this ply. */
  retry: number
  side: 'w' | 'b'
  /** Position before the ply. */
  fen: string
  response: AgentDecision
  verdict: { legal: boolean; san: string | null }
  /** Reserved for the grader (t91); always null here. */
  engine: null
  game: GameOver
}

export interface MatchResult {
  gameId: string
  plies: PlyRecord[]
  game: GameOver
}

const LIVE: GameOver = { over: false, result: null, winner: null }

/**
 * Plays one game from the initial position. Same seed + same agents →
 * identical records. An illegal move re-prompts the agent up to maxRetries
 * times, then forfeits the game.
 */
export async function runMatch(
  config: MatchConfig,
  onPly?: (record: PlyRecord) => void,
): Promise<MatchResult> {
  const rng = mulberry32(config.seed)
  const maxPlies = config.maxPlies ?? 400
  const maxRetries = config.maxRetries ?? 0
  const tokenCap = config.tokenCap ?? Infinity
  const gameId = config.gameId ?? `g${config.seed}`
  const plies: PlyRecord[] = []
  const history: string[] = []
  let state: GameState = initialGame()
  let tokens = 0

  const emit = (record: PlyRecord) => {
    plies.push(record)
    onPly?.(record)
  }

  for (let ply = 1; ; ply++) {
    const side = state.turn
    const agent = side === 'w' ? config.white : config.black
    const legal = legalMoves(state).map((move) => ({
      move,
      text: moveToSan(state, move),
    }))
    const fen = serializePosition(state)
    const line = (
      response: AgentDecision,
      chosen: LegalMove | undefined,
      retry: number,
      game: GameOver,
    ): PlyRecord => ({
      gameId,
      model: agent.id,
      ply,
      retry,
      side,
      fen,
      response,
      verdict: { legal: chosen !== undefined, san: chosen?.text ?? null },
      engine: null,
      game,
    })

    const rejected: string[] = []
    const ask = async (attempt: number) => {
      const before = meter(agent)
      const response = await agent.decide({
        state,
        legal,
        history,
        rng,
        retry: attempt,
        rejected,
      })
      tokens += meter(agent) - before
      return response
    }

    let retry = 0
    let response = await ask(retry)
    let chosen = legal.find((m) => m.text === response.move)
    while (!chosen && tokens <= tokenCap && retry < maxRetries) {
      rejected.push(response.move)
      emit(line(response, undefined, retry, LIVE))
      retry++
      response = await ask(retry)
      chosen = legal.find((m) => m.text === response.move)
    }

    let game: GameOver = LIVE
    if (tokens > tokenCap) {
      game = { over: true, result: 'token-cap', winner: null }
    } else if (!chosen) {
      game = { over: true, result: 'illegal', winner: other(side) }
    } else {
      state = applyMove(state, chosen.move)
      history.push(chosen.text)
      const s = status(state)
      if (s === 'checkmate' || s === 'stalemate') {
        // Gliński: stalemate is a win for the side that stalemated.
        game = { over: true, result: s, winner: side }
      } else if (s === 'draw50' || s === 'repetition') {
        game = { over: true, result: s, winner: null }
      } else if (ply >= maxPlies) {
        game = { over: true, result: 'max-plies', winner: null }
      }
    }

    emit(line(response, chosen, retry, game))
    if (game.over) return { gameId, plies, game }
  }
}

/** One line per attempt, newline-terminated. */
export function toJsonl(plies: readonly PlyRecord[]): string {
  return plies.map((p) => JSON.stringify(p) + '\n').join('')
}

function meter(agent: Agent): number {
  return (agent as Partial<MeteredAgent>).tokensUsed ?? 0
}

function other(side: 'w' | 'b'): 'w' | 'b' {
  return side === 'w' ? 'b' : 'w'
}
