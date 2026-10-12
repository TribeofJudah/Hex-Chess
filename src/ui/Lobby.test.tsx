import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Lobby } from './Lobby'

afterEach(() => {
  window.location.hash = ''
})

describe('Lobby', () => {
  it('creates a room and navigates to its play route', () => {
    render(<Lobby configured />)
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }))
    expect(window.location.hash).toMatch(/^#\/play\/[A-Z0-9]{4}$/)
  })

  it('joins a room by code, uppercasing it', () => {
    render(<Lobby configured />)
    const input = screen.getByTestId('lobby-join-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ab34' } })
    expect(input.value).toBe('AB34')
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(window.location.hash).toBe('#/play/AB34')
  })

  it('submits the join form with Enter', () => {
    render(<Lobby configured />)
    const input = screen.getByTestId('lobby-join-input')
    fireEvent.change(input, { target: { value: 'XY29' } })
    fireEvent.submit(input.closest('form')!)
    expect(window.location.hash).toBe('#/play/XY29')
  })

  it('shows an inline error for a short code and does not navigate', () => {
    window.location.hash = '#/online'
    render(<Lobby configured />)
    const input = screen.getByTestId('lobby-join-input')
    fireEvent.change(input, { target: { value: 'ab' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(screen.getByRole('alert').textContent).toMatch(/4–8 character/)
    expect(window.location.hash).toBe('#/online')
  })

  it('says online play is unconfigured and disables the actions', () => {
    render(<Lobby configured={false} />)
    expect(screen.getByTestId('lobby-unconfigured')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Create room' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})
