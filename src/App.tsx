import { useState } from 'react'
import { HexBoard } from './ui/HexBoard'
import { ControlBar } from './ui/ControlBar'
import { MoveList } from './ui/MoveList'
import { GameOverBanner } from './ui/GameOverBanner'
import { useGame, type GameOver } from './ui/useGame'
import { glinskiRules } from './rules/adapter'

function gameOverText(gameOver: GameOver): string {
  if (gameOver.winner) {
    return gameOver.kind === 'checkmate'
      ? `Checkmate — ${gameOver.winner} wins`
      : `Stalemate — ${gameOver.winner} wins 0.75-0.25`
  }
  return gameOver.kind === 'fifty-move'
    ? 'Draw — fifty-move rule'
    : 'Draw — threefold repetition'
}

export default function App() {
  const game = useGame(glinskiRules)
  const [scanlines, setScanlines] = useState(true)

  const status = game.gameOver
    ? gameOverText(game.gameOver)
    : `${game.turn === 'white' ? 'White' : 'Black'} to move`

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">HEX CHESS</h1>
        <p className="app__subtitle">Gliński&apos;s variant — hotseat</p>
      </header>

      <ControlBar
        scanlines={scanlines}
        onToggleScanlines={() => setScanlines((on) => !on)}
        onNewGame={game.newGame}
        onUndo={game.undo}
        undoEnabled={game.canUndo}
      />

      <div className="app__layout">
        <section
          className="app__board-container"
          data-testid="board-section"
          aria-label="Chess board"
        >
          <p className="hxc-status" role="status">
            {status}
          </p>
          <HexBoard
            pieces={game.position}
            size={24}
            legend={true}
            scanlines={scanlines}
            onCellClick={game.clickCell}
            selectedCell={game.selected ?? undefined}
            validTargets={game.validTargets}
            lastMove={game.lastMove ?? undefined}
            inCheckCell={game.inCheckCell}
          />
          {game.gameOver ? (
            <GameOverBanner
              gameOver={game.gameOver}
              onPlayAgain={game.newGame}
            />
          ) : null}
        </section>
        <MoveList moves={game.moves} turn={game.turn} />
      </div>

      <footer className="app__footer">
        <p>Vite + React + TypeScript · 91 Cells · Gliński Hexagonal Chess</p>
      </footer>
    </main>
  )
}