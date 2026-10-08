import { useRef, type ChangeEvent } from 'react'
import { flushSync } from 'react-dom'
import { withViewTransition } from './motion'

/** `system` follows prefers-color-scheme; the others pin `data-theme`. */
export type Theme = 'system' | 'light' | 'dark'

export interface ControlBarProps {
  /**
   * @deprecated The CRT overlay was removed in R15 (t64); this prop is
   * ignored. RemoteRoom.tsx still passes it — delete both together.
   */
  scanlines?: boolean
  /** @deprecated See `scanlines`. */
  onToggleScanlines?: () => void
  /** Current colour theme. Omitted (with `onThemeChange`) hides the switch. */
  theme?: Theme
  /** Picks a colour theme; the choice is persisted by the caller. */
  onThemeChange?: (theme: Theme) => void
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
  /** Import a `.pgn` file's text (t61). Omitted to hide the button. */
  onLoadPgn?: (text: string) => void
  /** Create a remote room and navigate to it (T-remote-play, t39). */
  onCreateRoom?: () => void
}

const DEPTHS = [1, 2, 3, 4, 5] as const

const THEMES: Theme[] = ['system', 'light', 'dark']

export function ControlBar({
  theme = 'system',
  onThemeChange,
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
  onLoadPgn,
  onCreateRoom,
}: ControlBarProps) {
  const pgnInput = useRef<HTMLInputElement>(null)

  const readPgn = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    void file.text().then((text) => onLoadPgn?.(text))
    // Clear so re-picking the same file fires `change` again.
    event.target.value = ''
  }
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
      {/* Both the input and its button go when import is unwired: a
          permanently disabled control reads as a broken one (t64 defect 7). */}
      {onLoadPgn ? (
        <>
          <input
            ref={pgnInput}
            type="file"
            accept=".pgn,text/plain"
            hidden
            data-testid="pgn-file-input"
            onChange={readPgn}
          />
          <button
            type="button"
            className="hxc-button"
            onClick={() => pgnInput.current?.click()}
          >
            Load PGN
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="hxc-button"
        onClick={onCreateRoom}
        disabled={!onCreateRoom}
      >
        Play online
      </button>
      {onThemeChange ? (
        <div className="hxc-themeswitch">
          <span className="hxc-themeswitch__label" id="theme-switch-label">
            Theme
          </span>
          <div
            className="hxc-themeswitch__group"
            role="radiogroup"
            aria-labelledby="theme-switch-label"
          >
            {THEMES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={theme === option}
                className="hxc-button hxc-switch"
                onClick={() =>
                  // Cross-fade the recolour (t66). flushSync because the
                  // transition snapshots the "after" frame as soon as this
                  // returns, while the theme itself lands in App's effect.
                  withViewTransition(() => flushSync(() => onThemeChange(option)))
                }
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default ControlBar
