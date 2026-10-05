import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MoveList } from './MoveList'
import type { GameMove } from './useGame'

const PAIRED: GameMove[] = [
  { san: 'f5 f7', color: 'white', from: 'f5', to: 'f7' },
  { san: 'g7 g5', color: 'black', from: 'g7', to: 'g5' },
  { san: 'Bf3 b1', color: 'white', from: 'f3', to: 'b1' },
]

describe('MoveList', () => {
  it('pairs half-moves under one move number', () => {
    render(<MoveList moves={PAIRED} turn="black" />)
    const list = screen.getByTestId('move-list')
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('1.')
    expect(rows[0].textContent).toContain('f5 f7')
    expect(rows[0].textContent).toContain('g7 g5')
    expect(rows[1].textContent).toContain('2.')
    expect(rows[1].textContent).toContain('Bf3 b1')
    expect(rows[1].textContent).toContain('…') // black reply pending
  })

  it('shows an empty state before the first move', () => {
    render(<MoveList moves={[]} turn="white" />)
    expect(screen.getByText('no moves yet')).toBeTruthy()
  })

  it('shows the current turn indicator', () => {
    const { rerender } = render(<MoveList moves={PAIRED} turn="black" />)
    expect(screen.getByRole('status').textContent).toBe('Black to move')
    rerender(<MoveList moves={PAIRED} turn="white" />)
    expect(screen.getByRole('status').textContent).toBe('White to move')
  })

  it('jumps to a half-move when clicked and marks the viewed ply (T14)', () => {
    const onJump = vi.fn()
    render(<MoveList moves={PAIRED} turn="white" viewPly={2} onJump={onJump} />)
    fireEvent.click(screen.getByRole('button', { name: 'g7 g5' }))
    expect(onJump).toHaveBeenCalledWith(2)
    expect(
      screen
        .getByRole('button', { name: 'g7 g5' })
        .getAttribute('aria-current'),
    ).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'f5 f7' }))
    expect(onJump).toHaveBeenLastCalledWith(1)
  })
})
