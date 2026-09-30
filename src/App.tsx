import { useMemo } from 'react'
import { HexBoard, type BoardPieces } from './ui/HexBoard'
import { STARTING_POSITION, type PieceType, type Color } from './board/pieces'
import { axialToNotation } from './board/notation'
import type { PieceKind, PieceColor } from './ui/hexMath'

const TYPE_TO_KIND: Record<PieceType, PieceKind> = {
  K: 'king',
  Q: 'queen',
  R: 'rook',
  B: 'bishop',
  N: 'knight',
  P: 'pawn',
}

const COLOR_MAP: Record<Color, PieceColor> = {
  w: 'white',
  b: 'black',
}

export default function App() {
  const initialPieces: BoardPieces = useMemo(() => {
    const map: BoardPieces = {}
    for (const [key, piece] of STARTING_POSITION) {
      const [q, r] = key.split(',').map(Number)
      const notation = axialToNotation({ q, r })
      if (notation) {
        map[notation] = {
          kind: TYPE_TO_KIND[piece.type],
          color: COLOR_MAP[piece.color],
        }
      }
    }
    return map
  }, [])

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">HEX CHESS</h1>
        <p className="app__subtitle">Gliński&apos;s variant — hotseat</p>
      </header>

      <section className="app__board-container" data-testid="board-section">
        <HexBoard pieces={initialPieces} size={24} legend={true} scanlines={true} />
      </section>

      <footer className="app__footer">
        <p>Vite + React + TypeScript · 91 Cells · Gliński Hexagonal Chess</p>
      </footer>
    </main>
  )
}

