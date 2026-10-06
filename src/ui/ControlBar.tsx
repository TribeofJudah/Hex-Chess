export interface ControlBarProps {
  scanlines: boolean
  onToggleScanlines: () => void
  onNewGame?: () => void
  onUndo?: () => void
  /** UNDO stays disabled until game state history exists (T8). */
  undoEnabled?: boolean
  /** White human vs Black AI when on; hotseat when off. */
  aiEnabled?: boolean
  onToggleAi?: () => void
  /** AI search depth, 1–5 (T15); defaults to 3. */
  aiDepth?: number
  onAiDepthChange?: (depth: number) => void
  /** Side to move resigns (T16). */
  onResign?: () => void
  /** Offer a draw to the opponent (T16; t49 adds the negotiated flow).
      Callers omit it to hide the button (game over, offer open, not the
      local turn, room not connected). */
  onOfferDraw?: (() => void) | undefined
  onExportPgn?: () => void
  /** Create a remote room and navigate to it (T-remote-play, t39). */
  onCreateRoom?: () => void
}

const DEPTHS = [1, 2, 3, 4, 5] as const

export function ControlBar({
  scanlines,
  onToggleScanlines,
  onNewGame,
  onUndo,
  undoEnabled = false,
  aiEnabled = false,
  onToggleAi,
  aiDepth = 3,
  onAiDepthChange,
  onResign,
  onOfferDraw,
  onExportPgn,
  onCreateRoom,
}: ControlBarProps) {
  return (
    <div className="hxc-controls" role="toolbar" aria-label="Board controls">
      {/* Title-case labels: CSS uppercases them; screen readers read words. */}
      <button
        type="button"
        className="hxc-button"
        onClick={onNewGame}
        disabled={!onNewGame}
      >
        New game
      </button>
      <button
        type="button"
        className="hxc-button"
        onClick={onUndo}
        disabled={!undoEnabled || !onUndo}
      >
        Undo
      </button>
      <button
        type="button"
        className="hxc-button hxc-switch"
        aria-pressed={aiEnabled}
        onClick={onToggleAi}
        disabled={!onToggleAi}
      >
        AI {aiEnabled ? 'on' : 'off'}
      </button>
      <label className="hxc-depth">
        <span className="hxc-depth__label">Depth</span>
        <select
          className="hxc-select"
          aria-label="AI depth"
          value={aiDepth}
          onChange={(event) => onAiDepthChange?.(Number(event.target.value))}
          disabled={!onAiDepthChange}
        >
          {DEPTHS.map((depth) => (
            <option key={depth} value={depth}>
              {depth}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="hxc-button"
        onClick={onResign}
        disabled={!onResign}
      >
        Resign
      </button>
      <button
        type="button"
        className="hxc-button"
        onClick={onOfferDraw}
        disabled={!onOfferDraw}
      >
        Offer draw
      </button>
      <button
        type="button"
        className="hxc-button"
        onClick={onExportPgn}
        disabled={!onExportPgn}
      >
        Export PGN
      </button>
      <button
        type="button"
        className="hxc-button"
        onClick={onCreateRoom}
        disabled={!onCreateRoom}
      >
        Play online
      </button>
      <button
        type="button"
        className="hxc-button hxc-switch"
        aria-pressed={scanlines}
        onClick={onToggleScanlines}
      >
        Scanlines {scanlines ? 'on' : 'off'}
      </button>
    </div>
  )
}

export default ControlBar
