import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ControlBar } from './ControlBar'

describe('ControlBar', () => {
  it('fires handlers from the pixel buttons', () => {
    const onNewGame = vi.fn()
    const onUndo = vi.fn()
    const onToggleScanlines = vi.fn()
    render(
      <ControlBar
        scanlines={false}
        onToggleScanlines={onToggleScanlines}
        onNewGame={onNewGame}
        onUndo={onUndo}
        undoEnabled
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'New game' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Scanlines off' }))
    expect(onNewGame).toHaveBeenCalledTimes(1)
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onToggleScanlines).toHaveBeenCalledTimes(1)
  })

  it('keeps UNDO disabled until history exists (T8)', () => {
    const onUndo = vi.fn()
    render(<ControlBar scanlines onToggleScanlines={() => {}} onUndo={onUndo} />)
    const undo = screen.getByRole('button', { name: 'Undo' })
    expect(undo).toHaveProperty('disabled', true)
    fireEvent.click(undo)
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('reflects scanline state via aria-pressed', () => {
    const { rerender } = render(
      <ControlBar scanlines onToggleScanlines={() => {}} />,
    )
    const button = screen.getByRole('button', { name: 'Scanlines on' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    rerender(<ControlBar scanlines={false} onToggleScanlines={() => {}} />)
    expect(screen.getByRole('button', { name: 'Scanlines off' })).toBeTruthy()
  })

  it('disables actions that have no handler', () => {
    render(<ControlBar scanlines onToggleScanlines={() => {}} />)
    const disabled = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('disabled'))
    expect(disabled).toHaveLength(2) // New game + Undo
  })
})