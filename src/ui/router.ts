import { useEffect, useState } from 'react'

/**
 * Tiny hash router (T-remote-play, t39).
 *
 * Hash routing, not History API: the app is served from GitHub Pages with a
 * relative base (`vite.config.ts` `base: './'`), where real paths like
 * `/play/ABCD` 404 on reload with no server rewrite. `#/play/ABCD` works
 * everywhere.
 */
export type Route = { name: 'game' } | { name: 'play'; roomCode: string }

const PLAY_RE = /^#\/play\/([a-z0-9]{4,8})\/?$/i

export function parseRoute(hash: string): Route {
  const code = PLAY_RE.exec(hash)?.[1]
  return code
    ? { name: 'play', roomCode: code.toUpperCase() }
    : { name: 'game' }
}

export function routeToHash(route: Route): string {
  return route.name === 'play' ? `#/play/${route.roomCode}` : '#/'
}

/** Imperatively navigate (sets the hash; fires hashchange). */
export function navigate(route: Route): void {
  window.location.hash = routeToHash(route)
}

/** Current route, re-rendering on hash changes. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

// Ambiguity-free alphabet (no I/O/0/1) so codes are safe to read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Random 4-character room code. */
export function newRoomCode(): string {
  const bytes = new Uint8Array(4)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(
    '',
  )
}
