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
    // B4: `seat` defaults to 'spectator', but until the welcome frame we
    // have not been assigned anything — don't claim a seat yet.
    expect(screen.getByTestId('seat-status').textContent).toBe('Connecting…')

    act(() => current().open())
    act(() => current().recv(welcomeMsg({ seat: 'black' })))
    expect(screen.getByTestId('seat-status').textContent).toBe(
      'You are Black · waiting for opponent',
    )
  })

  it('shows Spectating only once the server assigns that seat (B4)', () => {
    const { connect, current } = makeSocketFactory()
    render(<RemoteRoom roomCode="ABCD" connect={connect} />)
    act(() => current().open())
    act(() => current().recv(welcomeMsg({ seat: 'spectator' })))
    expect(screen.getByTestId('seat-status').textContent).toBe(
      'You are Spectating · waiting for opponent',
    )
  })

  it('shows You are White once the welcome assigns White (B4)', () => {
    const { connect, current } = makeSocketFactory()
    render(<RemoteRoom roomCode="ABCD" connect={connect} />)
    act(() => current().open())
    act(() => current().recv(welcomeMsg({ seat: 'white' })))
    expect(screen.getByTestId('seat-status').textContent).toBe(
      'You are White · waiting for opponent',
    )
  })

  it('walks the status bar from connecting to waiting to playing', () => {
    const { connect, current } = makeSocketFactory()
    const { container } = render(
      <RemoteRoom roomCode="ABCD" connect={connect} />,
    )
    const bar = () => container.querySelector('.hxc-statusbar')!.textContent
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
    const bar = container.querySelector('.hxc-statusbar')!.textContent
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

  it('hides every hotseat-only control on the online route (B3)', () => {
    const { connect, current } = makeSocketFactory()
    render(<RemoteRoom roomCode="ABCD" connect={connect} />)
    act(() => current().open())
    act(() => current().recv(welcomeMsg({ seat: 'white' })))
    for (const name of ['New game', 'Undo', 'Play online', 'Load PGN']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.queryByRole('combobox', { name: 'AI depth' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull()
  })

  it('offers Resign only to a seated player whose opponent is connected (B3)', () => {
    const { connect, current } = makeSocketFactory()
    render(<RemoteRoom roomCode="ABCD" connect={connect} />)
    act(() => current().open())
    act(() => current().recv(welcomeMsg({ seat: 'white' })))
    // Seated, but the peer is not here yet: nothing to resign from.
    expect(screen.queryByRole('button', { name: 'Resign' })).toBeNull()
    act(() =>
      current().recv({
        v: 1,
        type: 'peer',
        connected: true,
        seats: { white: true, black: true },
      }),
    )
    expect(screen.getByRole('button', { name: 'Resign' })).toBeTruthy()
  })

  it('renders no game-action group for a spectator (B3)', () => {
    const { connect, current } = makeSocketFactory()
    render(<RemoteRoom roomCode="ABCD" connect={connect} />)
    act(() => current().open())
    act(() => current().recv(welcomeMsg({ seat: 'spectator' })))
    expect(screen.queryByRole('group', { name: 'Game actions' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resign' })).toBeNull()
  })

  it('keeps one status live region, shared with the board footer (t80 §4.4)', () => {
    const { connect, current } = makeSocketFactory()
    render(<RemoteRoom roomCode="ABCD" connect={connect} />)
    act(() => current().open())
    act(() => current().recv(welcomeMsg({ seat: 'white' })))
    expect(screen.getAllByRole('status')).toHaveLength(1)
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

    const bar = container.querySelector('.hxc-statusbar')!.textContent ?? ''
    expect(bar).toContain('Reconnecting… attempt 1')
    const retry = screen.getByTestId('retry-now')
    fireEvent.click(retry)
    expect(sockets).toHaveLength(2)
    expect(screen.queryByTestId('retry-now')).toBeNull()
  })
})
