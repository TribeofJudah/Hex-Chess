/**
 * The room's chess clock (t56) — pure arithmetic, no timers, no storage.
 *
 * `RoomCore` owns one `ClockState`; the Durable Object owns the 1 Hz alarm
 * that calls `RoomCore.tick(now)`. The split keeps the clock testable with an
 * injected `now` instead of fake timers.
 *
 * The clock is **derived, never counted**: `since` is the epoch millisecond at
 * which the side to move started burning, and a seat's remaining time at any
 * later instant is `stored - (now - since)`. Nothing has to be written per
 * tick, so an evicted room resumes with the correct time on its next wake-up
 * (see claudedocs/CLOCK.md §4).
 */

import type { ClockWire, PieceColor } from './protocol'

/** Default time control: 5 minutes + 3 s Fischer increment per accepted move. */
export const INITIAL_MS = 5 * 60 * 1000
export const INCREMENT_MS = 3 * 1000
/** Tick cadence — the gate's 1 Hz broadcast. */
export const TICK_MS = 1000

/** A seat's clock is never usefully below zero, and the wire should not say so. */
const FLOOR = 0

/** Persisted clock (t56): remaining ms per seat, and when the running seat started. */
export interface ClockState {
  white: number
  black: number
  /** Epoch ms the side to move started burning, or `null` when no clock runs. */
  since: number | null
}

export function initialClock(): ClockState {
  return { white: INITIAL_MS, black: INITIAL_MS, since: null }
}

/** The other seat. */
export function other(seat: PieceColor): PieceColor {
  return seat === 'white' ? 'black' : 'white'
}

/**
 * `seat`'s remaining time at `now`. Only the side to move burns; the other
 * clock is already frozen in storage, so it is returned untouched.
 */
export function remainingAt(
  clock: ClockState,
  seat: PieceColor,
  turn: PieceColor,
  now: number,
): number {
  if (clock.since === null || seat !== turn) return clock[seat]
  return clock[seat] - (now - clock.since)
}

/** Both seats at `now`, floored at zero, with the clock stopped. */
export function freezeAt(
  clock: ClockState,
  turn: PieceColor,
  now: number,
): ClockState {
  return {
    white: Math.max(FLOOR, remainingAt(clock, 'white', turn, now)),
    black: Math.max(FLOOR, remainingAt(clock, 'black', turn, now)),
    since: null,
  }
}

/**
 * A move by `mover` (the side to move) landed at `now`: freeze their clock,
 * add the increment, and hand the running clock to the opponent. A clock that
 * is not running (the second seat has not joined yet) is returned untouched —
 * nothing burns and nothing is earned before the game starts.
 */
export function afterMove(
  clock: ClockState,
  mover: PieceColor,
  now: number,
): ClockState {
  if (clock.since === null) return clock
  const frozen = freezeAt(clock, mover, now)
  return { ...frozen, [mover]: frozen[mover] + INCREMENT_MS, since: now }
}

/** The wire view of the clock at `now`. */
export function clockWire(
  clock: ClockState,
  turn: PieceColor,
  now: number,
): ClockWire {
  const frozen = freezeAt(clock, turn, now)
  return {
    white: frozen.white,
    black: frozen.black,
    turn,
    running: clock.since !== null,
  }
}
