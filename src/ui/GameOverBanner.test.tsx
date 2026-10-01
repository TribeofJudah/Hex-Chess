import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GameOverBanner } from './GameOverBanner'
import type { GameOver } from './useGame'

describe('GameOverBanner', () => {
  const cases: Array<[GameOver, RegExp]> = [
    [{ kind: 'checkmate', winner: 'white' }, /Checkmate — white wins/i],
    [{ kind: 'checkmate', winner: 'black' }, /Checkmate — black wins/i],
    [
      { kind: 'stalemate', winner: 'white' },
      /Stalemate — white wins 0\.75-0\.25/i,
    ],
    [{ kind: 'fifty-move' }, /fifty-move rule/i],
    [{ kind: 'repetition' }, /threefold repetition/i],
  ]

  it.each(cases)('announces %s', (gameOver, text) => {
    render(<GameOverBanner gameOver={gameOver} onPlayAgain={() => {}} />)
    expect(screen.getByRole('alert').textContent).toMatch(text)
  })

  it('plays again on demand', () => {
    const onPlayAgain = vi.fn()
    render(
      <GameOverBanner
        gameOver={{ kind: 'repetition' }}
        onPlayAgain={onPlayAgain}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
    expect(onPlayAgain).toHaveBeenCalledTimes(1)
  })
})
