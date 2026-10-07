import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ControlBar } from './ControlBar'

describe('ControlBar', () => {
  it('fires handlers from the pixel buttons', () => {
    const onNewGame = vi.fn()
    const onUndo = vi.fn()
    render(<ControlBar onNewGame={onNewGame} onUndo={onUndo} undoEnabled />)
    fireEvent.click(screen.getByRole('button', { name: 'New game' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onNewGame).toHaveBeenCalledTimes(1)
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('keeps UNDO disabled until history exists (T8)', () => {
    const onUndo = vi.fn()
    render(<ControlBar onUndo={onUndo} />)
    const undo = screen.getByRole('button', { name: 'Undo' })
    expect(undo).toHaveProperty('disabled', true)
    fireEvent.click(undo)
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('reflects the theme choice and reports changes (t64)', () => {
    const onThemeChange = vi.fn()
    const { rerender } = render(
      <ControlBar theme="dark" onThemeChange={onThemeChange} />,
    )
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy()
    const checked = (name: RegExp) =>
      screen.getByRole('radio', { name }).getAttribute('aria-checked')
    expect(checked(/^dark$/i)).toBe('true')
    expect(checked(/^light$/i)).toBe('false')
    fireEvent.click(screen.getByRole('radio', { name: /^light$/i }))
    expect(onThemeChange).toHaveBeenCalledWith('light')
    rerender(<ControlBar theme="system" onThemeChange={onThemeChange} />)
    expect(checked(/^system$/i)).toBe('true')
  })

  it('hides the theme switch when no handler is wired', () => {
    render(<ControlBar />)
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull()
  })

  it('disables actions that have no handler', () => {
    render(<ControlBar />)
    const disabled = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('disabled'))
    expect(disabled).toHaveLength(7) // New game, Undo, AI, Resign, Offer draw, Export PGN, Play online
  })

  it('fires the resign and draw handlers (T16)', () => {
    const onResign = vi.fn()
    const onOfferDraw = vi.fn()
    render(<ControlBar onResign={onResign} onOfferDraw={onOfferDraw} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resign' }))
    fireEvent.click(screen.getByRole('button', { name: 'Offer draw' }))
    expect(onResign).toHaveBeenCalledTimes(1)
    expect(onOfferDraw).toHaveBeenCalledTimes(1)
  })

  it('changes the AI depth from the selector (T15)', () => {
    const onAiDepthChange = vi.fn()
    render(<ControlBar aiDepth={3} onAiDepthChange={onAiDepthChange} />)
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

  it('reads a chosen .pgn file into onLoadPgn (t61)', async () => {
    const onLoadPgn = vi.fn()
    render(<ControlBar onLoadPgn={onLoadPgn} />)
    const input = screen.getByTestId('pgn-file-input') as HTMLInputElement
    expect(input.accept).toBe('.pgn,text/plain')
    const file = new File(['1. f5 f6 e7 e5'], 'game.pgn', {
      type: 'application/x-chess-pgn',
    })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() =>
      expect(onLoadPgn).toHaveBeenCalledWith('1. f5 f6 e7 e5'),
    )
    // The input is cleared so the same file can be re-selected.
    expect(input.value).toBe('')
  })

  it('omits the PGN import entirely when unwired (t64)', () => {
    render(<ControlBar />)
    expect(screen.queryByRole('button', { name: 'Load PGN' })).toBeNull()
    expect(screen.queryByTestId('pgn-file-input')).toBeNull()
  })
})
