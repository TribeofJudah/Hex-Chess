import type { PieceColor } from './hexMath'
import type { DrawOfferView } from './useGame'
import './theme.css'

/**
 * Draw-offer banner (t49) — the client half of the t48 wire contract
 * (claudedocs/DRAW_PROTO.md).
 *
 * - `awaiting` (the offerer's per-seat view): the offer waits for a reply and
 *   v1 has no revoke, so there is nothing to click.
 * - `offered` (the answerer's view): Accept / Decline call back into
 *   `chooseOffer`, which routes to the local rules path or the wire frames.
 * A `roomEnd{reason:'draw_agreement'}` clears the offer; the existing
 * `GameOverBanner` then shows "Draw — by agreement".
 */
export interface DrawOfferBannerProps {
  /** Mirrored offer view; null renders nothing. */
  offer: DrawOfferView | null
  /** Answer affordances only for a seat that may answer (t48: the opponent
      of `by`). Pass false for the offerer's own open offer (incl. vs AI). */
  canAnswer?: boolean
  onAccept?: () => void
  onDecline?: () => void
}

const SEAT_LABEL: Record<PieceColor, string> = {
  white: 'White',
  black: 'Black',
}

export function DrawOfferBanner({
  offer,
  canAnswer = true,
  onAccept,
  onDecline,
}: DrawOfferBannerProps) {
  if (!offer) return null
  const waiting = offer.state === 'awaiting' || !canAnswer
  const text = waiting
    ? 'You offered a draw — waiting for a reply…'
    : `Draw offer from ${SEAT_LABEL[offer.by]} — accept or decline?`
  return (
    <div
      className="hxc-draw"
      role="group"
      aria-label="Draw offer"
      data-testid="draw-offer-banner"
    >
      <p className="hxc-draw__text" data-testid="draw-offer-text">
        {text}
      </p>
      {!waiting ? (
        <>
          <button
            type="button"
            className="hxc-button"
            data-testid="draw-accept"
            onClick={onAccept}
          >
            Accept
          </button>
          <button
            type="button"
            className="hxc-button"
            data-testid="draw-decline"
            onClick={onDecline}
          >
            Decline
          </button>
        </>
      ) : null}
    </div>
  )
}

export default DrawOfferBanner