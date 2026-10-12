import { useRef, type ChangeEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { withViewTransition } from './motion'

/** `system` follows prefers-color-scheme; the others pin `data-theme`. */
export type Theme = 'system' | 'light' | 'dark'

export interface ControlBarProps {
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
  /** Side to move resigns (T16). Omitted to hide the whole Game-actions
      group (game over; or the remote seat cannot act). */
  onResign?: (() => void) | undefined
  /** Offer a draw to the opponent (T16; t49 adds the negotiated flow).
      Callers omit it to hide the button (game over, offer open, not the
      local turn, room not connected). */
  onOfferDraw?: (() => void) | undefined
  onExportPgn?: () => void
  /** Import a `.pgn` file's text (t61). Omitted to hide the button. */
  onLoadPgn?: (text: string) => void
  /** Create a remote room and navigate to it (T-remote-play, t39). */
  onCreateRoom?: () => void
  /** Extra content for the Tools disclosure (t80): the FEN loader. */
  tools?: ReactNode
}

const DEPTHS = [1, 2, 3, 4, 5] as const

const THEMES: Theme[] = ['system', 'light', 'dark']

/**
 * Three groups, in the order a game is played (t80 §4.3):
 *
 * - **Primary** — New game (the one filled button), Undo.
 * - **Game actions** — Resign, Offer draw, only while a game is live. The
 *   caller signals "live" by wiring the handlers; an unwired group is not
 *   rendered at all rather than rendered dead (B3).
 * - **Tools** — a closed `<details>`: AI, depth, PGN, FEN, theme. Developer
 *   and setup affordances, off the main flow (t80 §4.2).
 */
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
  tools,
}: ControlBarProps) {
  const pgnInput = useRef<HTMLInputElement>(null)

  const readPgn = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    void file.text().then((text) => onLoadPgn?.(text))
    // Clear so re-picking the same file fires `change` again.
    event.target.value = ''
  }

  const hasPrimary = Boolean(onNewGame || onUndo)
  const hasGameActions = Boolean(onResign || onOfferDraw)
  const hasTools = Boolean(
    onToggleAi ||
      onAiDepthChange ||
      onThemeChange ||
      onExportPgn ||
      onLoadPgn ||
      onCreateRoom ||
      tools,
  )

  return (
    <div className="hxc-controls" role="toolbar" aria-label="Board controls">
      {hasPrimary ? (
        <div className="hxc-controls__group" role="group" aria-label="Primary">
          {onNewGame ? (
            <button
              type="button"
              className="hxc-button hxc-button--primary"
              onClick={onNewGame}
            >
              New game
            </button>
          ) : null}
          {onUndo ? (
            <button
              type="button"
              className="hxc-button"
              onClick={onUndo}
              disabled={!undoEnabled}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}

      {hasGameActions ? (
        <div
          className="hxc-controls__group"
          role="group"
          aria-label="Game actions"
        >
          {onResign ? (
            <button type="button" className="hxc-button" onClick={onResign}>
              Resign
            </button>
          ) : null}
          {onOfferDraw ? (
            <button type="button" className="hxc-button" onClick={onOfferDraw}>
              Offer draw
            </button>
          ) : null}
        </div>
      ) : null}

      {hasTools ? (
        <details className="hxc-tools" data-testid="tools">
          <summary className="hxc-tools__summary">Tools</summary>
          <div
            className="hxc-controls__group hxc-tools__body"
            role="group"
            aria-label="Game tools"
          >
            {onToggleAi ? (
              <button
                type="button"
                className="hxc-button hxc-switch"
                aria-pressed={aiEnabled}
                onClick={onToggleAi}
              >
                AI {aiEnabled ? 'on' : 'off'}
              </button>
            ) : null}
            {onAiDepthChange ? (
              <label className="hxc-depth">
                <span className="hxc-depth__label">Depth</span>
                <select
                  className="hxc-select"
                  aria-label="AI depth"
                  value={aiDepth}
                  onChange={(event) =>
                    onAiDepthChange(Number(event.target.value))
                  }
                >
                  {DEPTHS.map((depth) => (
                    <option key={depth} value={depth}>
                      {depth}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
                        // transition snapshots the "after" frame as soon as
                        // this returns, while the theme itself lands in App's
                        // effect.
                        withViewTransition(() =>
                          flushSync(() => onThemeChange(option)),
                        )
                      }
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {onExportPgn ? (
              <button type="button" className="hxc-button" onClick={onExportPgn}>
                Export PGN
              </button>
            ) : null}
            {/* Both the input and its button go when import is unwired: a
                permanently disabled control reads as a broken one (t64
                defect 7). */}
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
            {onCreateRoom ? (
              <button
                type="button"
                className="hxc-button"
                onClick={onCreateRoom}
              >
                Play online
              </button>
            ) : null}
            {tools}
          </div>
        </details>
      ) : null}
    </div>
  )
}

export default ControlBar
