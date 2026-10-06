import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Clock, formatClock } from './Clock'
import type { ClockWire } from './protocol'

afterEach(() => {
  vi.useRealTimers()
})

describe('formatClock', () => {
  it('formats whole minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(5_000)).toBe('0:05')
    expect(formatClock(65_000)).toBe('1:05')
    expect(formatClock(305_000)).toBe('5:05')
    expect(formatClock(599_000)).toBe('9:59')
  })

  it('floors at zero on negative input', () => {
    expect(formatClock(-100)).toBe('0:00')
  })

  it('rounds down to whole seconds', () => {
    expect(formatClock(5_999)).toBe('0:05')
    expect(formatClock(60_999)).toBe('1:00')
  })
})

describe('Clock component', () => {
  function mkClock(over: Partial<ClockWire> = {}): ClockWire {
    return {
      whiteMs: 300_000,
      blackMs: 300_000,
      lastTickAt: 0,
      tickMs: 1000,
      incrementMs: 3000,
      ...over,
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(0))
  })

  it('renders a placeholder when the wire has not produced a clock yet', () => {
    render(<Clock clock={undefined} turn="white" />)
    expect(screen.getByLabelText('clock loading')).toBeDefined()
  })

  it('renders both seats with their mm:ss values', () => {
    render(
      <Clock
        clock={mkClock({ whiteMs: 305_000, blackMs: 297_000 })}
        turn="white"
      />,
    )
    expect(screen.getByText('5:05')).toBeDefined()
    expect(screen.getByText('4:57')).toBeDefined()
  })

  it('marks the active side (whose turn it is) with the active modifier', () => {
    const { container } = render(
      <Clock
        clock={mkClock()}
        turn="black"
      />,
    )
    const black = container.querySelector('.hxc-clock__seat--black')!
    const white = container.querySelector('.hxc-clock__seat--white')!
    expect(black.className).toContain('hxc-clock__seat--active')
    expect(white.className).not.toContain('hxc-clock__seat--active')
  })

  it('applies the low-time class to a sub-30s side', () => {
    const { container } = render(
      <Clock
        clock={mkClock({ whiteMs: 25_000, blackMs: 120_000 })}
        turn="white"
      />,
    )
    const white = container.querySelector('.hxc-clock__seat--white')!
    const black = container.querySelector('.hxc-clock__seat--black')!
    expect(white.className).toContain('hxc-clock__seat--low')
    expect(black.className).not.toContain('hxc-clock__seat--low')
  })

  it('freezes both clocks on `ended` (no active highlight, no extrapolation)', () => {
    const { container } = render(
      <Clock
        clock={mkClock({ whiteMs: 0, blackMs: 47_000 })}
        turn="white"
        ended
      />,
    )
    const white = container.querySelector('.hxc-clock__seat--white')!
    const black = container.querySelector('.hxc-clock__seat--black')!
    // `ended` freezes the active highlight on both sides.
    expect(white.className).not.toContain('hxc-clock__seat--active')
    expect(black.className).not.toContain('hxc-clock__seat--active')
    // The floor at zero is shown; the opponent's frozen value is intact.
    expect(screen.getByText('0:00')).toBeDefined()
    expect(screen.getByText('0:47')).toBeDefined()
  })
})