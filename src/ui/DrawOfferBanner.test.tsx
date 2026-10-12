import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DrawOfferBanner } from './DrawOfferBanner'

describe('DrawOfferBanner (t49)', () => {
  it('renders nothing without an open offer', () => {
    render(<DrawOfferBanner offer={null} />)
    expect(screen.queryByTestId('draw-offer-banner')).toBeNull()
  })

  it('shows the offered view with two answering buttons', () => {
    const onAccept = vi.fn()
    const onDecline = vi.fn()
    render(
      <DrawOfferBanner
        offer={{ state: 'offered', by: 'black' }}
        onAccept={onAccept}
        onDecline={onDecline}
      />,
    )
    expect(
      screen.getByTestId('draw-offer-text').textContent,
    ).toMatch(/Draw offer from Black — accept or decline/)
    fireEvent.click(screen.getByTestId('draw-accept'))
    fireEvent.click(screen.getByTestId('draw-decline'))
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onDecline).toHaveBeenCalledTimes(1)
  })

  it('waits without buttons for the offerer (awaiting or own open offer)', () => {
    render(<DrawOfferBanner offer={{ state: 'awaiting', by: 'white' }} />)
    expect(screen.queryByTestId('draw-accept')).toBeNull()
    expect(screen.queryByTestId('draw-decline')).toBeNull()
    expect(
      screen.getByTestId('draw-offer-text').textContent,
    ).toMatch(/You offered a draw/)
  })

  it('hides the buttons when the viewer may not answer', () => {
    render(<DrawOfferBanner offer={{ state: 'offered', by: 'white' }} canAnswer={false} />)
    expect(screen.queryByTestId('draw-accept')).toBeNull()
    expect(screen.queryByTestId('draw-decline')).toBeNull()
    expect(
      screen.getByTestId('draw-offer-text').textContent,
    ).toMatch(/You offered a draw/)
  })
})