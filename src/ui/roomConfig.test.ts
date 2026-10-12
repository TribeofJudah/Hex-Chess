import { afterEach, describe, expect, it, vi } from 'vitest'

/** Fresh module (the warn-once flag is module state) with env stubbed. */
async function loadConfig(env: Record<string, string> = {}) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  return import('./roomConfig')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('roomSocketUrl', () => {
  it('derives wss://<host>/room/<CODE> from an https origin', async () => {
    const { roomSocketUrl } = await loadConfig({
      VITE_ROOM_ORIGIN: 'https://hex-chess-rooms.acct.workers.dev',
    })
    expect(roomSocketUrl('ab34')).toBe(
      'wss://hex-chess-rooms.acct.workers.dev/room/AB34',
    )
  })

  it('derives ws:// for an http origin', async () => {
    const { roomSocketUrl } = await loadConfig({
      VITE_ROOM_ORIGIN: 'http://127.0.0.1:8787',
    })
    expect(roomSocketUrl('ABCD')).toBe('ws://127.0.0.1:8787/room/ABCD')
  })

  it('falls back to the page host when the origin is unset', async () => {
    const { roomSocketUrl } = await loadConfig()
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    expect(roomSocketUrl('ABCD')).toBe(
      `${scheme}://${window.location.host}/room/ABCD`,
    )
  })
})

describe('room origin validation', () => {
  const bad = [
    'ftp://nope.example', // unsupported scheme
    'https://x.workers.dev/room', // has a path
    'https://x.workers.dev/?a=1', // has a query
    'not a url',
  ]

  it.each(bad)('treats %s as unset and warns once', async (raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { roomSocketUrl, hasRoomOrigin } = await loadConfig({
      VITE_ROOM_ORIGIN: raw,
    })
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    // Two calls, one warning.
    expect(roomSocketUrl('ABCD')).toBe(
      `${scheme}://${window.location.host}/room/ABCD`,
    )
    expect(roomSocketUrl('ABCD')).toBe(
      `${scheme}://${window.location.host}/room/ABCD`,
    )
    expect(hasRoomOrigin()).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('accepts a valid origin and a trailing slash', async () => {
    const { hasRoomOrigin } = await loadConfig({
      VITE_ROOM_ORIGIN: 'https://rooms.example.workers.dev/',
    })
    expect(hasRoomOrigin()).toBe(true)
  })
})

describe('onlinePlayConfigured', () => {
  it('is true in dev (same-host proxy) with no origin', async () => {
    const { onlinePlayConfigured } = await loadConfig()
    expect(onlinePlayConfigured()).toBe(true)
  })

  it('is false in a production build with no origin', async () => {
    const { onlinePlayConfigured } = await loadConfig({ PROD: 'true' })
    expect(onlinePlayConfigured()).toBe(false)
  })

  it('is true in a production build with a valid origin', async () => {
    const { onlinePlayConfigured } = await loadConfig({
      PROD: 'true',
      VITE_ROOM_ORIGIN: 'https://rooms.example.workers.dev',
    })
    expect(onlinePlayConfigured()).toBe(true)
  })
})

describe('roomShareUrl', () => {
  it('is the page URL with the play hash, uppercasing the code', async () => {
    const { roomShareUrl } = await loadConfig()
    const { origin, pathname } = window.location
    expect(roomShareUrl('ab34')).toBe(`${origin}${pathname}#/play/AB34`)
  })
})
