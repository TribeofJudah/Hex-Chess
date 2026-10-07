import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

/** Feed text through the ControlBar's hidden PGN file input. */
function loadPgn(text: string) {
  const input = screen.getByTestId('pgn-file-input') as HTMLInputElement
  const file = new File([text], 'game.pgn', { type: 'application/x-chess-pgn' })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('App', () => {
  it('renders the title and board', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: /hex chess/i })).toBeTruthy()
    expect(screen.getByTestId('board-section')).toBeTruthy()
    expect(
      screen.getByRole('img', { name: /hexagonal chess board/i }),
    ).toBeTruthy()
  })

  it('loads a PGN from the toolbar into the board and move list (t61)', async () => {
    render(<App />)
    loadPgn('[Result "*"]\n\n1. f5 f6 e7 e5\n*')
    await waitFor(() =>
      expect(screen.getByTestId('move-list').textContent).toContain('f5 f6'),
    )
    expect(screen.getByTestId('move-list').textContent).toContain('e7 e5')
    // Two plies replayed: back to White, no error. (MoveList repeats the
    // turn text, so scope to the board's status line.)
    const board = within(screen.getByTestId('board-section'))
    expect(board.getByText('White to move')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows an illegal PGN move inline, without alert()', async () => {
    render(<App />)
    loadPgn('1. f5 f6 f7 f6\n*')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('PGN move 2')
    expect(alert.textContent).toContain('f7 f6')
    // The failed import left the game untouched.
    expect(screen.getByTestId('move-list').textContent).toContain('no moves yet')
  })
})
