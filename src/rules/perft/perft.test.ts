import { describe, expect, it } from 'vitest'
import { initialGame } from '../rules'
import { perft } from './perft'

describe('perft', () => {
  it('depth 0 is 1', () => {
    expect(perft(initialGame(), 0)).toBe(1)
  })

  it('depth 1 is 51 (initial white legal moves)', () => {
    expect(perft(initialGame(), 1)).toBe(51)
  })

  it('depth 2 counts all 2-ply variations', () => {
    const p2 = perft(initialGame(), 2)
    // 51 white moves generate 2589 legal black replies across all branches
    expect(p2).toBe(2589)
  })
})
