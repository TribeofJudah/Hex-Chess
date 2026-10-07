import { useEffect, useRef, useState } from 'react'
import { Clock } from './Clock'
import { ControlBar } from './ControlBar'
import { DrawOfferBanner } from './DrawOfferBanner'
import { GameOverBanner } from './GameOverBanner'
import { HexBoard } from './HexBoard'
import { MoveList } from './MoveList'
import { downloadPgn, toPgn } from './pgn'
import { PROTOCOL_VERSION, type Seat } from './protocol'
import { roomShareUrl } from './roomConfig'
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
  offline: 'Offline',
  'version-mismatch': 'Incompatible version',
  error: 'Error',
  closed: 'Left the room',
}

/** How the local seat reads to the player (t67). */
const SEAT_LABEL: Record<Seat, string> = {
  white: 'White',
  black: 'Black',
  spectator: 'Spectating',
}

export function RemoteRoom({ roomCode, connect, onExit }: RemoteRoomProps) {
  const game = useRemoteGame(roomCode, connect ? { connect } : {})
  const canPlay = game.status === 'playing' || game.status === 'waiting'
  const [scanlines, setScanlines] = useState(true)
  // Resign confirmation (t65): the button opens an inline banner (the existing
  // draw-banner pattern) rather than a window.confirm; confirming streams the
  // `resign` frame. Only a seated player in a live game may resign (the room
  // double-enforces this).
  const [confirmResign, setConfirmResign] = useState(false)
  const canResign =
    canPlay &&
    (game.seat === 'white' || game.seat === 'black') &&
    !game.gameOver
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

  // Share + presence (t67).
  const [copyStatus, setCopyStatus] = useState('')
  const codeRef = useRef<HTMLElement>(null)
  const selectCode = () => {
    const el = codeRef.current
    const selection = window.getSelection()
    if (!el || !selection) return
    const range = document.createRange()
    range.selectNodeContents(el)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  const copyLink = () => {
    const announce = (text: string) => setCopyStatus(text)
    if (typeof navigator.clipboard?.writeText === 'function') {
      navigator.clipboard.writeText(roomShareUrl(roomCode)).then(
        () => announce('Link copied'),
        () => {
          selectCode()
          announce('Copy failed — select the code')
        },
      )
      return
    }
    // No clipboard API: fall back to selectable text.
    selectCode()
    announce('Copy failed — select the code')
  }

  // Reconnect countdown (t67): re-render each second while a retry is pending.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (game.nextRetryAt === undefined) return
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [game.nextRetryAt])
  const retryInSec =
    game.nextRetryAt === undefined
      ? 0
      : Math.max(0, Math.ceil((game.nextRetryAt - nowTick) / 1000))

  const presence = game.peerConnected
    ? 'opponent connected'
    : game.hasPeerEver
      ? 'opponent disconnected'
      : 'waiting for opponent'

  let status = STATUS_LABEL[game.status]
  if (game.status === 'playing') {
    status = `${game.turn === 'white' ? 'White' : 'Black'} to move`
  } else if (game.status === 'version-mismatch') {
    status = `Incompatible protocol version — server v${game.serverProtocol ?? '?'}, client v${PROTOCOL_VERSION}`
  } else if (game.status === 'error') {
    status = game.error ?? 'Connection error'
  } else if (game.status === 'reconnecting') {
    status =
      `Reconnecting… attempt ${game.reconnectAttempt}` +
      (retryInSec > 0 ? ` — next try in ${retryInSec}s` : '')
  }

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">HEX CHESS</h1>
        <div className="hxc-lobby__share" data-testid="room-share">
          <code
            className="hxc-room__code"
            data-testid="room-code"
            ref={codeRef}
          >
            {roomCode}
          </code>
          <button
            type="button"
            className="hxc-button"
            data-testid="copy-link"
            onClick={copyLink}
          >
            Copy link
          </button>
          <span role="status" aria-live="polite" data-testid="copy-status">
            {copyStatus}
          </span>
        </div>
        <p className="app__subtitle" data-testid="seat-status">
          You are {SEAT_LABEL[game.seat]} · {presence}
        </p>
      </header>

      <div className="hxc-room__bar" role="status" aria-live="polite">
        <span
          className={`hxc-room__dot hxc-room__dot--${game.status}`}
          aria-hidden="true"
        />
        <span>{status}</span>
        {game.status === 'reconnecting' || game.status === 'offline' ? (
          <button
            type="button"
            className="hxc-button"
            data-testid="retry-now"
            onClick={game.retryNow}
          >
            Retry now
          </button>
        ) : null}
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
        // ControlBar's `onResign` is a plain optional prop (no `| undefined`),
        // so spread it in only when enabled (exactOptionalPropertyTypes).
        {...(canResign ? { onResign: () => setConfirmResign(true) } : {})}
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
          {confirmResign && !game.gameOver ? (
            <div
              className="hxc-draw"
              role="group"
              aria-label="Confirm resignation"
              data-testid="resign-confirm"
            >
              <p className="hxc-draw__text" data-testid="resign-confirm-text">
                Resign this game?
              </p>
              <button
                type="button"
                className="hxc-button"
                data-testid="resign-confirm-yes"
                onClick={() => {
                  setConfirmResign(false)
                  game.sendResign()
                }}
              >
                Resign
              </button>
              <button
                type="button"
                className="hxc-button"
                data-testid="resign-confirm-cancel"
                onClick={() => setConfirmResign(false)}
              >
                Cancel
              </button>
            </div>
          ) : null}
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
