import { describe, expect, it } from 'vitest'

import {
  axialDistance,
  axialToNotation,
  allCells,
  cellColor,
  DIAG_DIRS,
  diagRays,
  FILE_LETTERS,
  initialPlacement,
  isValidNotation,
  keyOf,
  KNIGHT_DIRS,
  mirrorCell,
  mirrorNotation,
  notationToAxial,
  ORTHO_DIRS,
  orthoRays,
  pieceAt,
  RANK_CELL_COUNTS,
  rankCells,
  ray,
  STARTING_POSITION,
  type Axial,
  type Color,
  type PieceType,
} from './board'
import { neighborsDiffer } from './colors'

const K = (q: number, r: number): Axial => ({ q, r })

describe('board shape (91 cells)', () => {
  it('has exactly 91 cells', () => {
    expect(allCells()).toHaveLength(91)
  })

  it('generates each cell exactly once', () => {
    const keys = allCells().map(keyOf)
    expect(new Set(keys).size).toBe(91)
  })

  it('every axial cell round-trips through notation', () => {
    for (const cell of allCells()) {
      const notation = axialToNotation(cell)
      expect(isValidNotation(notation)).toBe(true)
      expect(notationToAxial(notation)).toEqual(cell)
    }
  })

  it('every valid notation round-trips through axial', () => {
    let count = 0
    for (let f = 0; f < 11; f++) {
      for (let rank = 1; rank <= 11; rank++) {
        const notation = `${FILE_LETTERS[f]}${rank}`
        if (!isValidNotation(notation)) continue
        count++
        const axial = notationToAxial(notation)
        expect(axial).not.toBeNull()
        expect(axialToNotation(axial!)).toBe(notation)
      }
    }
    expect(count).toBe(91)
  })

  it('rejects out-of-board notation', () => {
    // file j never exists; corners beyond the hexagon do not exist
    expect(isValidNotation('j6')).toBe(false)
    expect(isValidNotation('a7')).toBe(false)
    expect(isValidNotation('a8')).toBe(false)
    expect(isValidNotation('l7')).toBe(false)
    expect(isValidNotation('a11')).toBe(false)
    expect(isValidNotation('f12')).toBe(false)
    expect(isValidNotation('f0')).toBe(false)
    expect(isValidNotation('e11')).toBe(false)
    expect(isValidNotation('g11')).toBe(false)
  })

  it('accepts corner landmarks of the hexagon', () => {
    for (const n of ['a1', 'l1', 'a6', 'l6', 'b7', 'k7', 'f11', 'k1', 'i8']) {
      expect(isValidNotation(n)).toBe(true)
    }
  })

  it('rank cell counts are 11×6, 9, 7, 5, 3, 1 (Wikipedia)', () => {
    expect(RANK_CELL_COUNTS).toEqual([11, 11, 11, 11, 11, 11, 9, 7, 5, 3, 1])
    const total = RANK_CELL_COUNTS.reduce((a, b) => a + b, 0)
    expect(total).toBe(91)
    for (let rank = 1; rank <= 11; rank++) {
      expect(rankCells(rank)).toHaveLength(RANK_CELL_COUNTS[rank - 1])
    }
  })

  it('rank 7 is b7–k7 (the black pawn rank)', () => {
    expect(rankCells(7)).toEqual([
      'b7',
      'c7',
      'd7',
      'e7',
      'f7',
      'g7',
      'h7',
      'i7',
      'k7',
    ])
  })

  it('files are straight lines of hexes (a–l, no j)', () => {
    expect(FILE_LETTERS).toBe('abcdefghikl')
    expect(FILE_LETTERS).not.toContain('j')
    // All cells of file f exist from 1 to 11; file l only ranks 1–6.
    expect(axialToNotation(notationToAxial('f1')!)).toBe('f1')
    expect(axialToNotation(notationToAxial('f11')!)).toBe('f11')
    expect(isValidNotation('l6')).toBe(true)
    expect(isValidNotation('l7')).toBe(false)
  })
})

describe('coordinate landmarks', () => {
  it('maps key cells to the documented axial coords', () => {
    expect(notationToAxial('f6')).toEqual(K(0, 0))
    expect(notationToAxial('a1')).toEqual(K(-5, 0))
    expect(notationToAxial('l1')).toEqual(K(5, -5))
    expect(notationToAxial('f1')).toEqual(K(0, -5))
    expect(notationToAxial('f11')).toEqual(K(0, 5))
    expect(notationToAxial('a6')).toEqual(K(-5, 5))
    expect(notationToAxial('l6')).toEqual(K(5, 0))
    expect(notationToAxial('b7')).toEqual(K(-4, 5))
    expect(notationToAxial('k7')).toEqual(K(4, 1))
    expect(notationToAxial('e10')).toEqual(K(-1, 5))
    expect(notationToAxial('g10')).toEqual(K(1, 4))
    expect(notationToAxial('f5')).toEqual(K(0, -1))
  })
})

describe('mirror symmetry', () => {
  it('mirrors camps through the horizontal center line', () => {
    expect(mirrorNotation('f1')).toBe('f11')
    expect(mirrorNotation('e1')).toBe('e10')
    expect(mirrorNotation('b1')).toBe('b7')
    expect(mirrorNotation('k1')).toBe('k7')
    expect(mirrorNotation('f2')).toBe('f10')
    expect(mirrorNotation('f5')).toBe('f7')
    expect(mirrorNotation('f6')).toBe('f6')
  })

  it('mirror is an involution on all 91 cells', () => {
    for (const cell of allCells()) {
      const m = mirrorCell(cell)
      expect(mirrorCell(m)).toEqual(cell)
    }
  })
})

describe('cell colours', () => {
  it('center cell f6 is mid-tone (Wikipedia)', () => {
    expect(cellColor(K(0, 0))).toBe('mid')
    expect(cellColor(notationToAxial('f6')!)).toBe('mid')
  })

  it('orthogonal neighbours never share a colour (board-wide)', () => {
    for (const cell of allCells()) {
      expect(neighborsDiffer(cell)).toBe(true)
    }
  })

  it('exactly three colours exist across the board', () => {
    const seen = new Set(allCells().map((c) => cellColor(c)))
    expect(seen.size).toBe(3)
  })

  it('starting bishops cover all three colours', () => {
    const colors = new Set(
      ['f1', 'f2', 'f3'].map((n) => cellColor(notationToAxial(n)!)),
    )
    expect(colors.size).toBe(3)
  })

  it('colour is consistent between axial and notation lookups', () => {
    for (const n of ['f6', 'f1', 'e1', 'g10', 'b7', 'l6']) {
      const axial = notationToAxial(n)!
      expect(cellColor(axial)).toBe(
        cellColor(notationToAxial(axialToNotation(axial))!),
      )
    }
  })
})

describe('rays and neighbors', () => {
  it('ortho ray from f6 south hits f5 f4 f3 f2 f1', () => {
    const cells = ray(K(0, 0), ORTHO_DIRS[4]).map(axialToNotation)
    expect(cells).toEqual(['f5', 'f4', 'f3', 'f2', 'f1'])
  })

  it('f6 has all six orthogonal neighbours on board', () => {
    const ns = orthoRays(K(0, 0)).map((r) => axialToNotation(r[0]))
    expect(ns).toEqual(['g6', 'f7', 'e6', 'e5', 'f5', 'g5'])
  })

  it('a corner cell has exactly 3 orthogonal neighbours', () => {
    const a1 = notationToAxial('a1')!
    // NE: the long a1–l6 diagonal (10 steps) · N: the a-file (5)
    // SE: the white back rank a1–f1 (5) · the rest leave the board
    expect(orthoRays(a1).map((r) => r.length)).toEqual([10, 5, 0, 0, 0, 5])
  })

  it('diagonal rays from f6 toward the vertices', () => {
    const cells = diagRays(K(0, 0)).map((r) => r.map(axialToNotation))
    expect(cells[0]).toEqual(['h5', 'k4'])
    expect(cells[2]).toEqual(['e7', 'd8'])
  })

  it('hex distance is cube-distance', () => {
    expect(axialDistance(K(0, 0), K(3, -2))).toBe(3)
    expect(axialDistance(notationToAxial('a1')!, notationToAxial('f6')!)).toBe(
      5,
    )
  })

  it('knight offsets are 12 and none collide with ortho/diag first steps', () => {
    expect(KNIGHT_DIRS).toHaveLength(12)
    const firstSteps = [...ORTHO_DIRS, ...DIAG_DIRS].map((d) => `${d.q},${d.r}`)
    for (const k of KNIGHT_DIRS) {
      expect(firstSteps).not.toContain(`${k.q},${k.r}`)
    }
  })
})

describe('initial position (Gliński array)', () => {
  it('has exactly 36 pieces (18 per side)', () => {
    expect(STARTING_POSITION.size).toBe(36)
    const whites = [...STARTING_POSITION.values()].filter(
      (p) => p.color === 'w',
    )
    const blacks = [...STARTING_POSITION.values()].filter(
      (p) => p.color === 'b',
    )
    expect(whites).toHaveLength(18)
    expect(blacks).toHaveLength(18)
  })

  it('piece multiset per side is 1K 1Q 3B 2N 2R 9P', () => {
    const tally = (color: Color) => {
      const t = new Map<PieceType, number>()
      for (const p of STARTING_POSITION.values()) {
        if (p.color === color) t.set(p.type, (t.get(p.type) ?? 0) + 1)
      }
      return t
    }
    for (const color of ['w', 'b'] as const) {
      expect(tally(color)).toEqual(
        new Map<PieceType, number>([
          ['K', 1],
          ['Q', 1],
          ['B', 3],
          ['N', 2],
          ['R', 2],
          ['P', 9],
        ]),
      )
    }
  })

  it('places White pieces on the verified starting cells', () => {
    expect(pieceAt('g1')?.type).toBe('K')
    expect(pieceAt('e1')?.type).toBe('Q')
    expect(pieceAt('f1')?.type).toBe('B')
    expect(pieceAt('f2')?.type).toBe('B')
    expect(pieceAt('f3')?.type).toBe('B')
    expect(pieceAt('d1')?.type).toBe('N')
    expect(pieceAt('h1')?.type).toBe('N')
    expect(pieceAt('c1')?.type).toBe('R')
    expect(pieceAt('i1')?.type).toBe('R')
  })

  it('white pawns start on b1 c2 d3 e4 f5 g4 h3 i2 k1', () => {
    const pawnCells = initialPlacement()
      .filter((p) => p.piece.color === 'w' && p.piece.type === 'P')
      .map((p) => axialToNotation(p.cell))
    expect([...pawnCells].sort()).toEqual(
      ['b1', 'c2', 'd3', 'e4', 'f5', 'g4', 'h3', 'i2', 'k1'].sort(),
    )
  })

  it('rank 7 is filled with black pawns (Wikipedia)', () => {
    for (const n of rankCells(7)) {
      const p = pieceAt(n)
      expect(p).toBeDefined()
      expect(p!.type).toBe('P')
      expect(p!.color).toBe('b')
    }
  })

  it('black mirrors white (queens on e, kings on g)', () => {
    expect(pieceAt('g10')?.type).toBe('K')
    expect(pieceAt('e10')?.type).toBe('Q')
    expect(pieceAt('f11')?.type).toBe('B')
    expect(pieceAt('f10')?.type).toBe('B')
    expect(pieceAt('f9')?.type).toBe('B')
    expect(pieceAt('d9')?.type).toBe('N')
    expect(pieceAt('h9')?.type).toBe('N')
    expect(pieceAt('c8')?.type).toBe('R')
    expect(pieceAt('i8')?.type).toBe('R')
    const blackPawnCells = initialPlacement()
      .filter((p) => p.piece.color === 'b' && p.piece.type === 'P')
      .map((p) => axialToNotation(p.cell))
    expect([...blackPawnCells].sort()).toEqual(
      ['b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7', 'i7', 'k7'].sort(),
    )
  })

  it("Fool's mate source cells are occupied by the right pieces", () => {
    // 1.Qe1c3 Qe10c6 2.b1b2 b7b6 3.Bf3b1 e7e6? 4.Qc3xBf9#
    expect(pieceAt('e1')).toMatchObject({ type: 'Q', color: 'w' })
    expect(pieceAt('e10')).toMatchObject({ type: 'Q', color: 'b' })
    expect(pieceAt('b1')).toMatchObject({ type: 'P', color: 'w' })
    expect(pieceAt('b7')).toMatchObject({ type: 'P', color: 'b' })
    expect(pieceAt('f3')).toMatchObject({ type: 'B', color: 'w' })
    expect(pieceAt('f9')).toMatchObject({ type: 'B', color: 'b' })
  })

  it('position is exactly mirror-symmetric (cell by cell)', () => {
    for (const [key, piece] of STARTING_POSITION) {
      const [q, r] = key.split(',').map(Number)
      const m = keyOf(mirrorCell(K(q, r)))
      const counterpart = STARTING_POSITION.get(m)
      expect(counterpart).toBeDefined()
      expect(counterpart!.type).toBe(piece.type)
      expect(counterpart!.color).toBe(piece.color === 'w' ? 'b' : 'w')
    }
  })

  it('all 36 pieces sit on distinct on-board cells', () => {
    expect(STARTING_POSITION.size).toBe(36)
    for (const key of STARTING_POSITION.keys()) {
      const [q, r] = key.split(',').map(Number)
      expect(Math.abs(q)).toBeLessThanOrEqual(5)
      expect(Math.abs(r)).toBeLessThanOrEqual(5)
      expect(Math.abs(q + r)).toBeLessThanOrEqual(5)
    }
  })
})
