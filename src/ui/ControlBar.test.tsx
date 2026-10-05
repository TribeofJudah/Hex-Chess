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
    render(
      <ControlBar scanlines onToggleScanlines={() => {}} onUndo={onUndo} />,
    )
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
    expect(disabled).toHaveLength(6) // New game, Undo, AI, Resign, Draw, Export PGN
  })

  it('fires the resign and draw handlers (T16)', () => {
    const onResign = vi.fn()
    const onOfferDraw = vi.fn()
    render(
      <ControlBar
        scanlines
        onToggleScanlines={() => {}}
        onResign={onResign}
        onOfferDraw={onOfferDraw}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resign' }))
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    expect(onResign).toHaveBeenCalledTimes(1)
    expect(onOfferDraw).toHaveBeenCalledTimes(1)
  })

  it('changes the AI depth from the selector (T15)', () => {
    const onAiDepthChange = vi.fn()
    render(
      <ControlBar
        scanlines
        onToggleScanlines={() => {}}
        aiDepth={3}
        onAiDepthChange={onAiDepthChange}
      />,
    )
    const select = screen.getByRole('combobox', { name: 'AI depth' })
    expect((select as HTMLSelectElement).value).toBe('3')
    fireEvent.change(select, { target: { value: '5' } })
    expect(onAiDepthChange).toHaveBeenCalledWith(5)
  })

  it('toggles the AI and exports PGN', () => {
    const onToggleAi = vi.fn()
    const onExportPgn = vi.fn()
    render(
      <ControlBar
        scanlines
        onToggleScanlines={() => {}}
        aiEnabled
        onToggleAi={onToggleAi}
        onExportPgn={onExportPgn}
      />,
    )
    const ai = screen.getByRole('button', { name: 'AI on' })
    expect(ai.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(ai)
    fireEvent.click(screen.getByRole('button', { name: 'Export PGN' }))
    expect(onToggleAi).toHaveBeenCalledTimes(1)
    expect(onExportPgn).toHaveBeenCalledTimes(1)
  })
})
