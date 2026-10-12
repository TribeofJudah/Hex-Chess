import type { PieceKind } from './hexMath'
import './theme.css'

/**
 * Kind-chooser banner for a parked human promotion (t45).
 *
 * Rendered by `HexBoard` while `useGame` holds a `pendingPromotion`. The
 * board keeps the pawn and its targets highlighted; the only affordance
 * here is the kind choice — Esc cancel handling lives in `useGame`.
 */
export interface PromotionBannerProps {
  /** Origin cell of the pawn awaiting promotion. */
  from: string
  /** Destination cell on the promotion zone. */
  to: string
  /** Piece kinds the engine offers (queen, rook, bishop, knight). */
  options: PieceKind[]
  /** Complete the parked move with the chosen kind. */
  onChoose: (kind: PieceKind) => void
}

const KIND_LABEL: Record<PieceKind, string> = {
  king: 'King',
  queen: 'Queen',
  rook: 'Rook',
  bishop: 'Bishop',
  knight: 'Knight',
  pawn: 'Pawn',
}

export function PromotionBanner({
  from,
  to,
  options,
  onChoose,
}: PromotionBannerProps) {
  return (
    <div
      className="hxc-promo"
      role="group"
      aria-label={`Promotion ${from} to ${to}: choose a piece`}
      data-testid="promotion-banner"
    >
      <p className="hxc-promo__text">Choose promotion:</p>
      {options.map((kind) => (
        <button
          key={kind}
          type="button"
          className="hxc-button"
          data-testid={`promo-${kind}`}
          aria-label={`Promote to ${KIND_LABEL[kind]}`}
          onClick={() => onChoose(kind)}
        >
          {KIND_LABEL[kind]}
        </button>
      ))}
      <span className="hxc-promo__hint" aria-hidden="true">
        Esc to cancel
      </span>
    </div>
  )
}

export default PromotionBanner
