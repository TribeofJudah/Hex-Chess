import type { GameOver } from './useGame'
import './theme.css'

export interface GameOverBannerProps {
  gameOver: GameOver
  onPlayAgain: () => void
}

function bannerText(gameOver: GameOver): string {
  switch (gameOver.kind) {
    case 'checkmate':
      return `Checkmate — ${gameOver.winner} wins`
    case 'stalemate':
      return `Stalemate — ${gameOver.winner} wins 0.75-0.25`
    case 'fifty-move':
      return 'Draw — fifty-move rule'
    case 'repetition':
      return 'Draw — threefold repetition'
  }
}

export function GameOverBanner({ gameOver, onPlayAgain }: GameOverBannerProps) {
  return (
    <div className="hxc-banner" role="alert">
      <p className="hxc-banner__text" data-testid="banner-text">
        {bannerText(gameOver)}
      </p>
      <button type="button" className="hxc-button" onClick={onPlayAgain}>
        Play again
      </button>
    </div>
  )
}

export default GameOverBanner