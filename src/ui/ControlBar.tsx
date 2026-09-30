export interface ControlBarProps {
  scanlines: boolean
  onToggleScanlines: () => void
  onNewGame?: () => void
  onUndo?: () => void
  /** UNDO stays disabled until game state history exists (T8). */
  undoEnabled?: boolean
}

export function ControlBar({
  scanlines,
  onToggleScanlines,
  onNewGame,
  onUndo,
  undoEnabled = false,
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
        aria-pressed={scanlines}
        onClick={onToggleScanlines}
      >
        Scanlines {scanlines ? 'on' : 'off'}
      </button>
    </div>
  )
}

export default ControlBar