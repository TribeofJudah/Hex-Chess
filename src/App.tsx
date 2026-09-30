import { useMemo, useState } from 'react'
import { HexBoard, type BoardPieces } from './ui/HexBoard'
import { ControlBar } from './ui/ControlBar'
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
  const pieces: BoardPieces = useMemo(() => {
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

  const [scanlines, setScanlines] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">HEX CHESS</h1>
        <p className="app__subtitle">Gliński&apos;s variant — hotseat</p>
      </header>

      <ControlBar
        scanlines={scanlines}
        onToggleScanlines={() => setScanlines((on) => !on)}
        onNewGame={() => setSelected(null)}
      />

      <section
        className="app__board-container"
        data-testid="board-section"
        aria-label="Chess board"
      >
        {/* T8 wires this to real game state; White opens, so it holds. */}
        <p className="hxc-status" role="status">
          White to move
        </p>
        <HexBoard
          pieces={pieces}
          size={24}
          legend={true}
          scanlines={scanlines}
          onCellClick={(notation) =>
            setSelected((current) => (current === notation ? null : notation))
          }
          selectedCell={selected ?? undefined}
        />
      </section>

      <footer className="app__footer">
        <p>Vite + React + TypeScript · 91 Cells · Gliński Hexagonal Chess</p>
      </footer>
    </main>
  )
}