import type { PieceColor } from './hexMath'
import type { ClockWire } from './protocol'
import './theme.css'

/**
 * Per-seat move clock (Round 11 — client mirror of the server-authoritative
 * `ClockMsg` from t56). The server is the only source of truth for the
 * numbers — this component is a pure renderer.
 *
 * Layout:
 * - The ACTIVE side (whose turn it is) is bigger and pulses if <30s left.
 * - The IDLE side is rendered smaller; its number keeps ticking but is
 *   dimmer (the server is still decrementing it during the opponent's move
 *   until the move lands — that's correct).
 * - When the room has ended (`ended === true`) the local reducer sets
 *   `gameOver` and the room bar already says "White/Black wins" or "Draw" —
 *   the clock freezes on whatever the last frame said.
 */
export interface ClockProps {
  /** Server mirror; null while waiting for the first frame. */
  clock: ClockWire | undefined
  /** Whose turn it is locally (or whoever the server says). Drives the
      active-side highlight. */
  turn: PieceColor
  /** Optional override: the room is already over (welcome.ended). */
  ended?: boolean
}

const LOW_TIME_MS = 30_000

/** mm:ss with a leading minus sign if the floor is below zero. */
export function formatClock(ms: number): string {
  const safe = Math.max(0, ms)
  const total = Math.floor(safe / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** ms since the server's `lastTickAt` — the running seat's remaining
    time hasn't been re-decremented until the next tick lands. The visual
    countdown inside a tick window is purely cosmetic; the server is
    the truth. We use Date.now() for the local animation; an offline
    client falls back to whatever the wire said. */
function liveRemaining(stored: number, lastTickAt: number, tickMs: number): number {
  const now = Date.now()
  // If the server's tickMs is missing or zero (shouldn't happen on t56+),
  // skip the local extrapolation.
  if (!tickMs) return stored
  const elapsed = now - lastTickAt
  // Cap at one tick window so a stale frame doesn't run away; the next
  // wire frame will refresh.
  const clamped = Math.min(elapsed, tickMs)
  return Math.max(0, stored - clamped)
}

export function Clock({ clock, turn, ended }: ClockProps) {
  if (!clock) {
    return (
      <span className="hxc-clock hxc-clock--empty" aria-label="clock loading">
        …
      </span>
    )
  }
  // The roomEnds fades on a `roomEnd` frame; the `clock` frame keeps
  // arriving but its values are the freeze (server-side). The component
  // just renders the last value verbatim.
  const whiteMs = ended ? clock.whiteMs : liveRemaining(clock.whiteMs, clock.lastTickAt, clock.tickMs)
  const blackMs = ended ? clock.blackMs : liveRemaining(clock.blackMs, clock.lastTickAt, clock.tickMs)

  return (
    <span className="hxc-clock" aria-live="off" aria-label="move clocks">
      <Seat
        ms={whiteMs}
        seatColor={'white'}
        active={!ended && turn === 'white'}
        ariaOrder={'first'}
      />
      <Seat
        ms={blackMs}
        seatColor={'black'}
        active={!ended && turn === 'black'}
        ariaOrder={'second'}
      />
    </span>
  )
}

function Seat({
  ms,
  seatColor,
  active,
  ariaOrder,
}: {
  ms: number
  seatColor: PieceColor
  active: boolean
  ariaOrder: 'first' | 'second'
}) {
  const low = ms < LOW_TIME_MS
  const cls = [
    'hxc-clock__seat',
    `hxc-clock__seat--${seatColor}`,
    active ? 'hxc-clock__seat--active' : '',
    low ? 'hxc-clock__seat--low' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const label = seatColor === 'white' ? 'White' : 'Black'
  return (
    <span
      className={cls}
      aria-label={`${ariaOrder === 'first' ? 'First' : 'Second'} player ${label}: ${formatClock(ms)}${active ? ' to move' : ''}`}
    >
      <span className="hxc-clock__label">{label}</span>
      <span className="hxc-clock__time">{formatClock(ms)}</span>
    </span>
  )
}

export default Clock