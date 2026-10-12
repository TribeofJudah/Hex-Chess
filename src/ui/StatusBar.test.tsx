import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBar } from './StatusBar'

describe('StatusBar', () => {
  it('announces the turn through the page’s single live region', () => {
    render(<StatusBar text="White to move" />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('White to move')
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1)
  })

  it('keeps the headline text exact when a detail line is present', () => {
    render(
      <StatusBar
        text="White to move"
        tone="playing"
        detail={<span data-testid="seat-status">You are White</span>}
      />,
    )
    // The detail is a sibling, not part of the announced text.
    expect(screen.getByRole('status').textContent).toBe('White to move')
    expect(screen.getByTestId('seat-status').textContent).toBe('You are White')
  })

  it('draws the connection dot only when a tone is given', () => {
    const { container, rerender } = render(<StatusBar text="White to move" />)
    expect(container.querySelector('.hxc-room__dot')).toBeNull()
    rerender(<StatusBar text="White to move" tone="reconnecting" />)
    expect(
      container.querySelector('.hxc-room__dot--reconnecting'),
    ).toBeTruthy()
  })

  it('renders the online furniture beside the text', () => {
    render(
      <StatusBar text="White to move" tone="playing">
        <button type="button">Leave</button>
      </StatusBar>,
    )
    expect(screen.getByRole('button', { name: 'Leave' })).toBeTruthy()
  })
})
