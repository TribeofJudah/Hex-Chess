import { GameOverBanner } from './GameOverBanner'
import { HexBoard } from './HexBoard'
import { MoveList } from './MoveList'
import { PROTOCOL_VERSION } from './protocol'
import {
  useRemoteGame,
  type ConnectFn,
  type RemoteStatus,
} from './useRemoteGame'
import './theme.css'

export interface RemoteRoomProps {
  roomCode: string
  /** Socket factory override, for tests (default: real WebSocket). */
  connect?: ConnectFn
  onExit?: () => void
}

const STATUS_LABEL: Record<RemoteStatus, string> = {
  connecting: 'Connecting…',
  waiting: 'Waiting for opponent…',
  playing: 'Connected',
  reconnecting: 'Reconnecting…',
  'version-mismatch': 'Incompatible version',
  error: 'Error',
  closed: 'Left the room',
}

export function RemoteRoom({ roomCode, connect, onExit }: RemoteRoomProps) {
  const game = useRemoteGame(roomCode, connect ? { connect } : {})
  const canPlay = game.status === 'playing' || game.status === 'waiting'

  let status = STATUS_LABEL[game.status]
  if (game.status === 'playing') {
    status = `${game.turn === 'white' ? 'White' : 'Black'} to move`
  } else if (game.status === 'version-mismatch') {
    status = `Incompatible protocol version — server v${game.serverProtocol ?? '?'}, client v${PROTOCOL_VERSION}`
  } else if (game.status === 'error') {
    status = game.error ?? 'Connection error'
  }

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">HEX CHESS</h1>
        <p className="app__subtitle">
          Room <strong className="hxc-room__code">{roomCode}</strong> · you are{' '}
          {game.seat}
        </p>
      </header>

      <div className="hxc-room__bar" role="status" aria-live="polite">
        <span
          className={`hxc-room__dot hxc-room__dot--${game.status}`}
          aria-hidden="true"
        />
        <span>{status}</span>
        <span className="hxc-room__spacer" />
        <button
          type="button"
          className="hxc-button"
          onClick={onExit}
          disabled={!onExit}
        >
          Leave
        </button>
      </div>

      <div className="app__layout">
        <section
          className="app__board-container"
          data-testid="board-section"
          aria-label="Chess board"
        >
          <HexBoard
            pieces={game.position}
            size={24}
            legend={true}
            scanlines={true}
            onCellClick={canPlay ? game.clickCell : () => {}}
            selectedCell={game.selected ?? undefined}
            validTargets={game.validTargets}
            lastMove={game.lastMove ?? undefined}
            inCheckCell={game.inCheckCell}
            promotion={game.pendingPromotion}
            onPromotionChoose={game.choosePromotion}
          />
          {game.gameOver ? (
            <GameOverBanner
              gameOver={game.gameOver}
              onPlayAgain={game.newGame}
            />
          ) : null}
        </section>
        <MoveList
          moves={game.moves}
          turn={game.turn}
          viewPly={game.viewPly}
          onJump={game.jumpTo}
        />
      </div>
    </main>
  )
}

export default RemoteRoom
