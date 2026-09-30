import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the title and board', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: /hex chess/i })).toBeTruthy()
    expect(screen.getByTestId('board-section')).toBeTruthy()
    expect(screen.getByRole('img', { name: /hexagonal chess board/i })).toBeTruthy()
  })
})
