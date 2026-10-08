import type { ReactNode } from 'react'
import type { RemoteStatus } from './useRemoteGame'
import './theme.css'

export interface StatusBarProps {
  /**
   * Headline: whose move it is, the check warning or the game result. This is
   * the page's single live region, so it must be the one thing worth
   * announcing (t80 §4.4).
   */
  text: string
  /** Secondary line: online seat + presence. Plain text, not announced. */
  detail?: ReactNode
  /** Connection tone (online). Given → a status dot is drawn. */
  tone?: RemoteStatus
  /** Clock, retry and leave controls (online); laid out right of the text. */
  children?: ReactNode
}

/**
 * One bar for the whole page: turn, check and result for both routes, plus
 * the clock/connection furniture online. Exactly one `role="status"` lives
 * here — the move list's old turn line and the room's own bar are gone.
 */
export function StatusBar({ text, detail, tone, children }: StatusBarProps) {
  return (
    <div className="hxc-statusbar" data-testid="status-bar">
      {tone ? (
        <span
          className={`hxc-room__dot hxc-room__dot--${tone}`}
          aria-hidden="true"
        />
      ) : null}
      <p className="hxc-status" role="status">
        {text}
      </p>
      {detail ? <p className="hxc-statusbar__detail">{detail}</p> : null}
      {children ? <div className="hxc-statusbar__tools">{children}</div> : null}
    </div>
  )
}

export default StatusBar
