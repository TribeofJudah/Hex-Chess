/**
 * Grading pass over a match: for every ply, what the engine thought before the
 * move, what the move actually gave away, and the line it wanted to play.
 *
 * Written into `PlyRecord.engine`, which the runner leaves null (t87). Grades
 * are only comparable between records with the same `graderVersion` and the
 * same search options: cp-loss is relative to this engine at this depth, not a
 * reference evaluation (XCHESS_BENCH §3).
 */

import { parsePosition } from '../board/fen'
import {
  applyMove,
  legalMoves,
  moveToSan,
  type GameState,
  type Move,
} from '../rules/rules'
import { bestMove, scoreMove, type SearchOptions } from '../ai/ai'
import type { PlyRecord } from './runner'

/** Bump when the grade for the same ply + options can change. */
export const GRADER_VERSION = '1'

export interface EngineGrade {
  graderVersion: string
  /** Engine score for the mover before the ply, in centipawns (mover's view). */
  evalBefore: number | null
  /** Score of the move played, same scale and depth. */
  evalAfter: number | null
  /** Centipawns the mover gave up; 0 when it played the engine's choice. */
  cpLoss: number | null
  bestMove: string | null
  /** The engine's line, SAN, at most 3 plies; `pv[0]` is `bestMove`. */
  pv: string[]
}

export interface GradedPlyRecord extends Omit<PlyRecord, 'engine'> {
  engine: EngineGrade | null
}

/**
 * Grade one ply. Illegal or unplayable plies keep null scores but still get the
 * version stamp and the engine's recommendation, so a rejected attempt shows
 * what the model should have played.
 */
export function gradePly(
  record: PlyRecord,
  options: SearchOptions = {},
): GradedPlyRecord {
  const grade: EngineGrade = {
    graderVersion: GRADER_VERSION,
    evalBefore: null,
    evalAfter: null,
    cpLoss: null,
    bestMove: null,
    pv: [],
  }
  const state = stateOf(record.fen)
  const best = state ? bestMove(state, options) : null
  if (!state || !best?.move) return { ...record, engine: grade }

  grade.evalBefore = best.score
  grade.bestMove = moveToSan(state, best.move)
  grade.pv = sanLine(state, best.pv)

  const played = findPlayed(state, record.verdict.san)
  if (played) {
    // Exact at the same depth, so replaying the engine's own choice scores
    // cpLoss 0 rather than whatever bound the root search pruned to.
    const after = scoreMove(state, played, options)
    if (after) {
      grade.evalAfter = after.score
      grade.cpLoss = Math.max(0, grade.evalBefore - after.score)
    }
  }
  return { ...record, engine: grade }
}

/** Grade a whole match, plies in order. */
export function gradeMatch(
  plies: readonly PlyRecord[],
  options: SearchOptions = {},
): GradedPlyRecord[] {
  return plies.map((p) => gradePly(p, options))
}

/** The runner's fen is a full position; the search adds an empty history. */
function stateOf(fen: string): GameState | null {
  try {
    return { ...parsePosition(fen), history: [] }
  } catch {
    return null
  }
}

/** Match a record's SAN back to a legal move in this position. */
function findPlayed(state: GameState, san: string | null): Move | undefined {
  if (!san) return undefined
  return legalMoves(state).find((m) => moveToSan(state, m) === san)
}

/** Walk a move line into SAN text, one applyMove per ply. */
function sanLine(state: GameState, line: readonly Move[]): string[] {
  const out: string[] = []
  let s = state
  for (const m of line) {
    out.push(moveToSan(s, m))
    s = applyMove(s, m)
  }
  return out
}
