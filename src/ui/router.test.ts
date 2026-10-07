import { describe, expect, it } from 'vitest'
import { newRoomCode, parseRoute, routeToHash } from './router'

describe('parseRoute', () => {
  it('routes an empty hash (and junk) to the hotseat game', () => {
    expect(parseRoute('')).toEqual({ name: 'game' })
    expect(parseRoute('#/')).toEqual({ name: 'game' })
    expect(parseRoute('#/nonsense')).toEqual({ name: 'game' })
  })

  it('parses /play codes case-insensitively and uppercases them', () => {
    expect(parseRoute('#/play/ab34')).toEqual({
      name: 'play',
      roomCode: 'AB34',
    })
    expect(parseRoute('#/play/AB34')).toEqual({
      name: 'play',
      roomCode: 'AB34',
    })
    expect(parseRoute('#/play/ab34/')).toEqual({
      name: 'play',
      roomCode: 'AB34',
    })
  })

  it('rejects codes outside the 4–8 char alphabet length', () => {
    expect(parseRoute('#/play/ab3')).toEqual({ name: 'game' })
    expect(parseRoute('#/play/abcdefghi')).toEqual({ name: 'game' })
    expect(parseRoute('#/play/ab-4')).toEqual({ name: 'game' })
  })
})

describe('routeToHash', () => {
  it('round-trips each route through parseRoute', () => {
    for (const route of [
      { name: 'game' } as const,
      { name: 'play', roomCode: 'XY29' } as const,
    ]) {
      expect(parseRoute(routeToHash(route))).toEqual(route)
    }
  })
})

describe('newRoomCode', () => {
  it('emits 4 chars from the ambiguity-free alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = newRoomCode()
      expect(code).toHaveLength(4)
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/)
    }
  })
})
