import { act, render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeSocketFactory, welcomeMsg } from '../test/fakeSocket'
import { PROTOCOL_VERSION } from './protocol'
import { RemoteRoom } from './RemoteRoom'

describe('RemoteRoom', () => {
  it('shows the room code and the seat from the welcome frame', () => {
    const { connect, current } = makeSocketFactory()
    render(<RemoteRoom roomCode="ABCD" connect={connect} />)

    expect(screen.getByText('ABCD')).toBeTruthy()
    expect(screen.getByText(/you are spectator/)).toBeTruthy()

    act(() => current().open())
    act(() => current().recv(welcomeMsg({ seat: 'black' })))
    expect(screen.getByText(/you are black/)).toBeTruthy()
  })

  it('walks the status bar from connecting to waiting to playing', () => {
    const { connect, current } = makeSocketFactory()
    const { container } = render(
      <RemoteRoom roomCode="ABCD" connect={connect} />,
    )
    const bar = () => container.querySelector('.hxc-room__bar')!.textContent
    expect(bar()).toContain('Connecting…')

    act(() => current().open())
    act(() => current().recv(welcomeMsg()))
    expect(bar()).toContain('Waiting for opponent…')

    act(() =>
      current().recv({
        v: 1,
        type: 'peer',
        connected: true,
        seats: { white: true, black: true },
      }),
    )
    // Playing shows whose move it is, not a generic label.
    expect(bar()).toContain('White to move')
  })

  it('explains a protocol version mismatch with both versions', () => {
    const { connect, current } = makeSocketFactory()
    const { container } = render(
      <RemoteRoom roomCode="ABCD" connect={connect} />,
    )
    act(() => current().open())
    act(() =>
      current().recv({
        v: 1,
        type: 'error',
        code: 'version_mismatch',
        message: 'update required',
        expectedProtocol: 2,
      }),
    )
    const bar = container.querySelector('.hxc-room__bar')!.textContent
    expect(bar).toContain('Incompatible protocol version')
    expect(bar).toContain('server v2')
    expect(bar).toContain(`client v${PROTOCOL_VERSION}`)
  })

  it('leaves the room through onExit', () => {
    const onExit = vi.fn()
    const { connect } = makeSocketFactory()
    render(<RemoteRoom roomCode="ABCD" connect={connect} onExit={onExit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
