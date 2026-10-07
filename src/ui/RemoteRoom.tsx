import { useState } from 'react'
import { Clock } from './Clock'
import { ControlBar } from './ControlBar'
import { DrawOfferBanner } from './DrawOfferBanner'
import { GameOverBanner } from './GameOverBanner'
import { HexBoard } from './HexBoard'
import { MoveList } from './MoveList'
import { downloadPgn, toPgn } from './pgn'
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
  const [scanlines, setScanlines] = useState(true)
  // Offer affordances (t49): only the local seat's own turn, with a peer
  // able to answer, no offer already open and a live game — the room double-
  // enforces the same rules on the wire.
  const canOfferDraw =
    canPlay &&
    game.peerConnected &&
    (game.seat === 'white' || game.seat === 'black') &&
    game.turn === game.seat &&
    !game.drawOffer &&
    !game.gameOver
  // Only the opponent of the offerer sees the answer buttons (t48 per-seat
  // view); spectators watch without a vote.
  const mayAnswerDraw =
    game.seat !== 'spectator' &&
    game.drawOffer !== null &&
    game.drawOffer.by !== game.seat

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
        <Clock
          clock={game.clock}
          turn={game.turn}
          ended={game.gameOver !== null}
        />
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

      <ControlBar
        scanlines={scanlines}
        onToggleScanlines={() => setScanlines((on) => !on)}
        onOfferDraw={canOfferDraw ? () => game.chooseOffer('offer') : undefined}
        // t55 remote export: the room's terminal say threads into the PGN
        // (a mirrored draw agreement exports 1/2-1/2 + annotation).
        onExportPgn={() =>
          downloadPgn(
            toPgn(game.moves, game.gameOver, game.roomEndReason ?? undefined),
            `hex-chess-${roomCode}.pgn`,
          )
        }
      />

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
          <DrawOfferBanner
            offer={game.drawOffer && !game.gameOver ? game.drawOffer : null}
            canAnswer={mayAnswerDraw}
            onAccept={() => game.chooseOffer('accept')}
            onDecline={() => game.chooseOffer('decline')}
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
