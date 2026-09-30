import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HexBoard } from './HexBoard'
import { PieceLegend } from './pieces/Piece'

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