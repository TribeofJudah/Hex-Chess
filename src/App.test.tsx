import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the title and scaffold status', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: /hex chess/i })).toBeTruthy()
    expect(screen.getByTestId('scaffold-status')).toBeTruthy()
    expect(screen.getByText(/scaffold ready/i)).toBeTruthy()
  })
})
