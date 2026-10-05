import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HexBoard } from './HexBoard'

describe('HexBoard', () => {
  it('mounts the 91-cell board with per-cell a11y ids', () => {
    const { container } = render(<HexBoard />)
    expect(container.querySelectorAll('polygon')).toHaveLength(91)
    expect(screen.getByTestId('cell-f11')).toBeTruthy()
    expect(screen.getByTestId('cell-a1')).toBeTruthy()
    expect(screen.getByTestId('cell-l6')).toBeTruthy()
  })

  it('places pieces by notation and labels them', () => {
    render(
      <HexBoard
        pieces={{ f1: { kind: 'king', color: 'white' } }}
        legend={false}
      />,
    )
    expect(screen.getByLabelText('white king on f1')).toBeTruthy()
    expect(screen.queryByLabelText('piece-legend')).toBeNull()
  })

  it('shows the 12-glyph legend by default and toggles scanlines', () => {
    const { rerender, container } = render(<HexBoard />)
    expect(screen.getByTestId('piece-legend')).toBeTruthy()
    expect(
      screen.getAllByRole('img', {
        name: /^(white|black) (king|queen|rook|bishop|knight|pawn)$/,
      }),
    ).toHaveLength(12)
    rerender(<HexBoard pieces={{ f1: { kind: 'king', color: 'white' } }} />)
    expect(container.querySelector('[data-testid="piece-legend"]')).toBeTruthy()
    const wrapper = screen
      .getByRole('img', { name: /91 cells, 1 pieces placed/ })
      .closest('.hxc-wrapper')
    expect(wrapper?.className).toContain('hxc-wrapper--scanlines')
  })
})

describe('HexBoard interactivity', () => {
  it('reports cell clicks by notation', () => {
    const onCellClick = vi.fn()
    render(<HexBoard onCellClick={onCellClick} legend={false} />)
    fireEvent.click(screen.getByTestId('cell-e2'))
    expect(onCellClick).toHaveBeenCalledWith('e2')
  })

  it('activates cells with keyboard as well', () => {
    const onCellClick = vi.fn()
    render(<HexBoard onCellClick={onCellClick} legend={false} />)
    const cell = screen.getByTestId('cell-f1')
    fireEvent.keyDown(cell, { key: 'Enter' })
    fireEvent.keyDown(screen.getByTestId('cell-k5'), { key: ' ' })
    expect(onCellClick).toHaveBeenCalledWith('f1')
    expect(onCellClick).toHaveBeenCalledWith('k5')
  })

  it('is not interactive without onCellClick', () => {
    const { container } = render(<HexBoard legend={false} />)
    const interactive = container.querySelectorAll('polygon[tabindex]')
    expect(interactive).toHaveLength(0)
  })

  it('moves the roving focus with arrow keys and activates with Enter (T17)', () => {
    const onCellClick = vi.fn()
    render(<HexBoard onCellClick={onCellClick} legend={false} />)
    expect(screen.getByTestId('cell-f6').getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(screen.getByTestId('cell-f6'), { key: 'ArrowRight' })
    expect(screen.getByTestId('cell-g6').getAttribute('tabindex')).toBe('0')
    expect(screen.getByTestId('cell-f6').getAttribute('tabindex')).toBe('-1')
    fireEvent.keyDown(screen.getByTestId('cell-g6'), { key: 'ArrowUp' })
    expect(screen.getByTestId('cell-g7').getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(screen.getByTestId('cell-g7'), { key: 'Enter' })
    expect(onCellClick).toHaveBeenCalledWith('g7')
  })

  it('highlights selection, targets, last move, and check', () => {
    render(
      <HexBoard
        legend={false}
        onCellClick={() => {}}
        selectedCell="e2"
        validTargets={['e4', 'd4']}
        lastMove={['g10', 'g9']}
        inCheckCell="k7"
      />,
    )
    expect(screen.getByTestId('cell-e2').getAttribute('class')).toContain(
      'hxc-cell--selected',
    )
    expect(screen.getByTestId('target-e4')).toBeTruthy()
    expect(screen.getByTestId('target-d4')).toBeTruthy()
    expect(screen.getByTestId('cell-g10').getAttribute('class')).toContain(
      'hxc-cell--last',
    )
    expect(screen.getByTestId('cell-g9').getAttribute('class')).toContain(
      'hxc-cell--last',
    )
    expect(screen.getByTestId('cell-k7').getAttribute('class')).toContain(
      'hxc-cell--check',
    )
  })
})
