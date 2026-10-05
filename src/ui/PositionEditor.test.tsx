import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PositionEditor } from './PositionEditor'

describe('PositionEditor', () => {
  it('loads the typed FEN and clears any previous error (T13)', () => {
    const onLoad = vi
      .fn()
      .mockReturnValueOnce({ ok: false, error: 'bad rank' })
      .mockReturnValueOnce({ ok: true })
    render(<PositionEditor onLoad={onLoad} />)

    const input = screen.getByLabelText('Load position (FEN)')
    const load = screen.getByRole('button', { name: 'Load' })
    expect(load).toHaveProperty('disabled', true)

    fireEvent.change(input, { target: { value: 'bad' } })
    fireEvent.click(load)
    expect(onLoad).toHaveBeenCalledWith('bad')
    expect(screen.getByRole('alert').textContent).toBe('bad rank')

    fireEvent.change(input, { target: { value: 'good' } })
    fireEvent.click(load)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
