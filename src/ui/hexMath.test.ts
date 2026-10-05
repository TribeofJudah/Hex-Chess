import { describe, expect, it } from 'vitest'
import {
  FILES,
  allCells,
  boardBounds,
  cellCenter,
  cellCorners,
  cellPoints,
  cellToFileRank,
  fileHeight,
  fileRankToCell,
  isValidQr,
  viewBox,
} from './hexMath'

describe('board extent', () => {
  it('has exactly 91 cells', () => {
    expect(allCells()).toHaveLength(91)
  })

  it('rejects coordinates outside the hexagon', () => {
    expect(isValidQr(0, 0)).toBe(true)
    expect(isValidQr(-5, 0)).toBe(true) // file a edge
    expect(isValidQr(0, -5)).toBe(true) // bottom vertex
    expect(isValidQr(-5, -5)).toBe(false) // sums to |s| = 10
    expect(isValidQr(-6, 0)).toBe(false)
  })

  it('gives files heights 6,7,8,9,10,11,10,9,8,7,6', () => {
    expect([...FILES].map(fileHeight)).toEqual([
      6, 7, 8, 9, 10, 11, 10, 9, 8, 7, 6,
    ])
  })
})

// Gliński's ranks bend 60° at file f: 6 full ranks of 11, then 9,7,5,3,1.
const EXPECTED_RANK_POPULATIONS = [11, 11, 11, 11, 11, 11, 9, 7, 5, 3, 1]

describe('notch-bent ranks', () => {
  it('has rank populations 11x6, 9, 7, 5, 3, 1', () => {
    const populations = new Array(11).fill(0)
    for (const cell of allCells()) {
      populations[cellToFileRank(cell).rank - 1] += 1
    }
    expect(populations).toEqual(EXPECTED_RANK_POPULATIONS)
  })

  it('labels each file 1..height bottom-up (f11 is the lone top cell)', () => {
    expect({ ...fileRankToCell('f', 11) }).toEqual({ q: 0, r: 5, s: -5 })
    expect(cellToFileRank({ q: 0, r: 5, s: -5 })).toEqual({
      file: 'f',
      rank: 11,
    })
  })

  it('bottom corners are a1 and l6', () => {
    expect(cellToFileRank({ q: -5, r: 0, s: 5 })).toEqual({
      file: 'a',
      rank: 1,
    })
    const l6 = fileRankToCell('l', 6)
    expect({ q: l6.q, r: l6.r }).toEqual({ q: 5, r: 0 })
  })

  it('round-trips notation for every cell', () => {
    for (const cell of allCells()) {
      const { file, rank } = cellToFileRank(cell)
      const back = fileRankToCell(file, rank)
      expect({ q: back.q, r: back.r }).toEqual({ q: cell.q, r: cell.r })
    }
  })
})

describe('projection', () => {
  const size = 20

  it('steps files horizontally by 1.5·size', () => {
    const a = cellCenter({ q: 0, r: 0, s: 0 }, size)
    const b = cellCenter({ q: 1, r: 0, s: -1 }, size)
    expect(b.x - a.x).toBeCloseTo(1.5 * size)
  })

  it('keeps vertical file neighbors √3·size apart', () => {
    const a = cellCenter({ q: 2, r: -3, s: 1 }, size)
    const b = cellCenter({ q: 2, r: -2, s: 0 }, size)
    expect(b.y - a.y).toBeCloseTo(Math.sqrt(3) * size)
  })

  it('emits 6 hex corners per cell as joined attribute points', () => {
    const corners = cellCorners(size)
    expect(corners).toHaveLength(6)
    expect(cellPoints(0, 0, corners)).toBe(
      '20,0 10,17.321 -10,17.321 -20,0 -10,-17.321 10,-17.321',
    )
  })

  it('fits all cell centers inside the board bounds', () => {
    const { origin, width, height } = boardBounds(size)
    for (const cell of allCells()) {
      const { x, y } = cellCenter(cell, size)
      expect(x).toBeGreaterThanOrEqual(origin.x)
      expect(x).toBeLessThanOrEqual(origin.x + width)
      expect(-y).toBeGreaterThanOrEqual(origin.y)
      expect(-y).toBeLessThanOrEqual(origin.y + height)
    }
    expect(viewBox(size)).toMatch(/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/)
  })
})
