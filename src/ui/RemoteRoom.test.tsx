import { act, render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeSocketFactory, welcomeMsg } from '../test/fakeSocket'
import { PROTOCOL_VERSION } from './protocol'
import { RemoteRoom } from './RemoteRoom'

afterEach(() => {
  vi.restoreAllMocks()
  delete (navigator as unknown as { clipboard?: unknown }).clipboard
})

describe('RemoteRoom', () => {
  it('shows the room code and the seat from the welcome frame', () => {
    const { connect, current } = makeSocketFactory()
    render(<RemoteRoom roomCode="ABCD" connect={connect} />)

    expect(screen.getByText('ABCD')).toBeTruthy()
    expect(screen.getByTestId('seat-status').textContent).toBe(
      'You are Spectating · waiting for opponent',
    )

    act(() => current().open())
    act(() => current().recv(welcomeMsg({ seat: 'black' })))
    expect(screen.getByTestId('seat-status').textContent).toBe(
      'You are Black · waiting for opponent',
    )
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

  // t65: the Resign button opens an inline confirm (never window.confirm);
  // confirming streams the `resign` frame, cancelling sends nothing.
  it('confirms a resignation through the banner before sending resign', () => {
    const { connect, current } = makeSocketFactory()
    render(<RemoteRoom roomCode="ABCD" connect={connect} />)
    act(() => current().open())
    act(() => current().recv(welcomeMsg({ seat: 'white' })))
    act(() =>
      current().recv({
        v: 1,
        type: 'peer',
        connected: true,
        seats: { white: true, black: true },
      }),
    )

    // The ControlBar button only opens the confirm banner.
    fireEvent.click(screen.getByRole('button', { name: 'Resign' }))
    expect(screen.getByTestId('resign-confirm')).toBeTruthy()
    expect(current().sent).not.toContainEqual({
      v: PROTOCOL_VERSION,
      type: 'resign',
    })

    // Cancelling hides the banner and sends nothing.
    fireEvent.click(screen.getByTestId('resign-confirm-cancel'))
    expect(screen.queryByTestId('resign-confirm')).toBeNull()

    // Confirming streams the frame and closes the banner.
    fireEvent.click(screen.getByRole('button', { name: 'Resign' }))
    fireEvent.click(screen.getByTestId('resign-confirm-yes'))
    expect(current().last()).toEqual({
      v: PROTOCOL_VERSION,
      type: 'resign',
    })
    expect(screen.queryByTestId('resign-confirm')).toBeNull()
  })

  it('keeps the Resign button disabled for a spectator', () => {
    const { connect, current } = makeSocketFactory()
    render(<RemoteRoom roomCode="ABCD" connect={connect} />)
    act(() => current().open())
    act(() => current().recv(welcomeMsg({ seat: 'spectator' })))
    expect(
      (screen.getByRole('button', { name: 'Resign' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  // t67: share the room and read opponent presence.
  it('copies a share link and announces it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const { connect } = makeSocketFactory()
    render(<RemoteRoom roomCode="abcd" connect={connect} />)
    expect(screen.getByTestId('room-code').textContent).toBe('abcd')
    fireEvent.click(screen.getByTestId('copy-link'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('#/play/ABCD'))
    await waitFor(() =>
      expect(screen.getByTestId('copy-status').textContent).toBe('Link copied'),
    )
  })

  it('falls back to selectable text when the clipboard is unavailable', () => {
    // jsdom has no navigator.clipboard by default.
    delete (navigator as unknown as { clipboard?: unknown }).clipboard
    const { connect } = makeSocketFactory()
    render(<RemoteRoom roomCode="ABCD" connect={connect} />)
    fireEvent.click(screen.getByTestId('copy-link'))
    expect(screen.getByTestId('copy-status').textContent).toMatch(
      /select the code/,
    )
  })

  it('reports opponent presence as connected then disconnected', () => {
    const { connect, current } = makeSocketFactory()
    render(<RemoteRoom roomCode="ABCD" connect={connect} />)
    act(() => current().open())
    act(() => current().recv(welcomeMsg()))
    act(() =>
      current().recv({
        v: 1,
        type: 'peer',
        connected: true,
        seats: { white: true, black: true },
      }),
    )
    expect(screen.getByTestId('seat-status').textContent).toContain(
      'opponent connected',
    )
    act(() =>
      current().recv({
        v: 1,
        type: 'peer',
        connected: false,
        seats: { white: true, black: false },
      }),
    )
    expect(screen.getByTestId('seat-status').textContent).toContain(
      'opponent disconnected',
    )
  })

  it('shows reconnect progress and retries on demand', () => {
    const { connect, sockets, current } = makeSocketFactory()
    const { container } = render(
      <RemoteRoom roomCode="ABCD" connect={connect} />,
    )
    act(() => current().open())
    act(() => current().recv(welcomeMsg()))
    act(() => current().drop())

    const bar = container.querySelector('.hxc-room__bar')!.textContent ?? ''
    expect(bar).toContain('Reconnecting… attempt 1')
    const retry = screen.getByTestId('retry-now')
    fireEvent.click(retry)
    expect(sockets).toHaveLength(2)
    expect(screen.queryByTestId('retry-now')).toBeNull()
  })
})
