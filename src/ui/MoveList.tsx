import type { PieceColor } from './hexMath'
import type { GameMove } from './useGame'
import './theme.css'

export interface MoveListProps {
  /** Half-moves in play order: index 0 = White's first, odd = Black's. */
  moves: GameMove[]
  turn: PieceColor
  /** Half-move index currently shown on the board (T14); highlights it. */
  viewPly?: number
  /** Called with the 1-based half-move index to jump the board to (T14). */
  onJump?: (ply: number) => void
}

export function MoveList({ moves, turn, viewPly, onJump }: MoveListProps) {
  const pairs = []
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({
      number: Math.floor(i / 2) + 1,
      white: moves[i],
      black: moves[i + 1],
    })
  }
  return (
    <section className="hxc-movelist" aria-label="Move history">
      <div className="hxc-movelist__head hxc-grid" aria-hidden="true">
        <span>#</span>
        <span>White</span>
        <span>Black</span>
      </div>
      <ol className="hxc-movelist__body" data-testid="move-list">
        {pairs.length === 0 ? (
          <li className="hxc-movelist__empty">no moves yet</li>
        ) : (
          pairs.map(({ number, white, black }, pairIndex) => {
            const whitePly = pairIndex * 2 + 1
            return (
              <li key={number} className="hxc-grid">
                <span className="hxc-movelist__num">{number}.</span>
                <MoveCell
                  san={white.san}
                  ply={whitePly}
                  viewPly={viewPly}
                  onJump={onJump}
                />
                {black ? (
                  <MoveCell
                    san={black.san}
                    ply={whitePly + 1}
                    viewPly={viewPly}
                    onJump={onJump}
                  />
                ) : (
                  <span>…</span>
                )}
              </li>
            )
          })
        )}
      </ol>
      <p className="hxc-movelist__turn" role="status">
        {turn === 'white' ? 'White' : 'Black'} to move
      </p>
    </section>
  )
}

function MoveCell({
  san,
  ply,
  viewPly,
  onJump,
}: {
  san: string
  ply: number
  viewPly?: number
  onJump?: (ply: number) => void
}) {
  return (
    <button
      type="button"
      className="hxc-movelist__move"
      aria-current={viewPly === ply ? 'true' : undefined}
      onClick={onJump ? () => onJump(ply) : undefined}
      disabled={!onJump}
    >
      {san}
    </button>
  )
}

export default MoveList
