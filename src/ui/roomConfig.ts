/**
 * Room-server origin config (t67).
 *
 * The client dials `<origin>/room/<CODE>`. On the GitHub Pages deploy the
 * page's own host is `github.io`, where no room server lives, so a production
 * build must be told the worker origin via `VITE_ROOM_ORIGIN` (e.g.
 * `https://hex-chess-rooms.<account>.workers.dev`). Local dev leaves it unset
 * and reaches the room server through the Vite `/room` proxy (same host).
 */

/** Warn at most once — a bad value is the same bad value on every call. */
let warned = false

/**
 * The validated `VITE_ROOM_ORIGIN`, or null when unset or malformed. Only a
 * bare http(s) origin is accepted — no path, query or fragment. A malformed
 * value is treated as unset and warned about once.
 */
function roomOriginUrl(): URL | null {
  const raw = import.meta.env.VITE_ROOM_ORIGIN?.trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    warnBadOrigin(raw)
    return null
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    warnBadOrigin(raw)
    return null
  }
  return url
}

function warnBadOrigin(raw: string): void {
  if (warned) return
  warned = true
  console.warn(
    `[hex-chess] ignoring VITE_ROOM_ORIGIN "${raw}": expected a bare http(s) ` +
      `origin (scheme + host, no path).`,
  )
}

/** Whether a valid `VITE_ROOM_ORIGIN` is configured. */
export function hasRoomOrigin(): boolean {
  return roomOriginUrl() !== null
}

/**
 * Whether online play can actually connect from this build. Dev builds work
 * through the Vite proxy on the same host; a production build needs an
 * explicit room origin or the client would dial its own page host.
 */
export function onlinePlayConfigured(): boolean {
  return !import.meta.env.PROD || hasRoomOrigin()
}

/** WebSocket URL for a room: `<origin>/room/<CODE>`, or same-host in dev. */
export function roomSocketUrl(roomCode: string): string {
  const code = roomCode.toUpperCase()
  const origin = roomOriginUrl()
  if (origin) {
    const scheme = origin.protocol === 'https:' ? 'wss' : 'ws'
    return `${scheme}://${origin.host}/room/${code}`
  }
  // Same-host fallback: local dev (Vite proxy) or a self-hosted deploy.
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}/room/${code}`
}

/**
 * Shareable page URL for a room — the app's own page with the play hash, not
 * the room-server origin (invitees open the app, which then dials the server).
 */
export function roomShareUrl(roomCode: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#/play/${roomCode.toUpperCase()}`
}
