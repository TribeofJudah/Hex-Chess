import { serializePosition } from '../../board/fen'
import {
  legalMoves,
  moveToSan,
  type GameState,
} from '../../rules/rules'
import type { Agent } from '../adapter'
import type { SuiteRecord } from './registry'

export interface AskInput {
  agent: Agent
  state: GameState
  /** Move texts played to reach this position, oldest first. */
  history: readonly string[]
  /** Stream for this one sample; a fresh one keeps samples independent. */
  rng: () => number
  gameId: string
  ply: number
  /** Suite id, stamped on the record (XCHESS_BENCH §4a.1 + suite). */
  suite: string
}

/**
 * Ask the agent once for a move and turn the reply into a JSONL record.
 * No retry loop: a suite measures the first answer, the runner's retry loop
 * is a match concern (§4a.2).
 */
export async function askAgent({
  agent,
  state,
  history,
  rng,
  gameId,
  ply,
  suite,
}: AskInput): Promise<SuiteRecord> {
  const legal = legalMoves(state).map((move) => ({
    move,
    text: moveToSan(state, move),
  }))
  const response = await agent.decide({
    state,
    legal,
    history,
    rng,
    retry: 0,
    rejected: [],
  })
  const chosen = legal.find((m) => m.text === response.move)
  return {
    suite,
    gameId,
    model: agent.id,
    ply,
    retry: 0,
    side: state.turn,
    fen: serializePosition(state),
    response,
    verdict: { legal: chosen !== undefined, san: chosen?.text ?? null },
    engine: null,
    game: { over: false, result: null, winner: null },
  }
}
