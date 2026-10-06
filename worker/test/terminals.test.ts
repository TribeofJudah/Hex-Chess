import { describe, expect, it } from 'vitest'
import { parsePosition, serializePosition } from '../src/board/fen'
import { notationToAxial } from '../src/board/notation'
import { keyOf, type Piece } from '../src/board/pieces'
import {
  applyMove,
  initialGame,
  legalMoves,
  status,
  type GameState,
} from '../src/rules/rules'
import {
  PROTOCOL_VERSION,
  type ClientMsg,
  type RoomEndMsg,
  type ServerMsg,
  type WireMove,
} from '../src/protocol'
import { RoomCore, type Conn, type RoomSnapshot } from '../src/room'

function fakeConn(clientId: string) {
  const sent: ServerMsg[] = []
  const conn: Conn = {
    clientId,
    protocol: PROTOCOL_VERSION,
    send: (m) => sent.push(m),
  }
  return {
    conn,
    sent,
    last: () => sent[sent.length - 1]!,
    find: (type: ServerMsg['type']) => sent.find((m) => m.type === type),
    /** Type-narrowed `find` for roomEnd — callers can read `winner`. */
    findEnd: () => sent.find((m): m is RoomEndMsg => m.type === 'roomEnd'),
  }
}

const join = (conn: Conn): ClientMsg => ({
  v: PROTOCOL_VERSION,
  type: 'join',
  room: 'ABCD',
  clientId: conn.clientId,
  protocol: conn.protocol,
})

const move = (from: string, to: string, revision: number): ClientMsg => ({
  v: PROTOCOL_VERSION,
  type: 'move',
  from,
  to,
  revision,
})

/** An arbitrary epoch; tests drive `now` by hand. */
const T0 = 1_700_000_000_000

/** Build a sparse custom position (mirrors `customPos` in src/rules/rules.test.ts). */
function customPos(
  pieces: Array<[string, Piece]>,
  turn: 'w' | 'b' = 'w',
  extra?: Partial<GameState>,
): GameState {
  const board = new Map<string, Piece>()
  for (const [n, p] of pieces) board.set(keyOf(notationToAxial(n)!), p)
  return {
    board,
    turn,
    epTarget: null,
    halfmove: 0,
    fullmove: 1,
    history: [],
    ...extra,
  }
}

/** Run a sequence of coordinate moves through the engine, asserting legality. */
function play(state: GameState, ...coords: string[]): GameState {
  let s = state
  for (const c of coords) {
    const m = /([a-il][1-9][0-9]?)[-x]?([a-il][1-9][0-9]?)/i.exec(c)
    if (!m) throw new Error(`bad coordinate: ${c}`)
    const from = notationToAxial(m[1]!)!
    const to = notationToAxial(m[2]!)!
    const legal = legalMoves(s).find(
      (move) =>
        keyOf(move.from) === keyOf(from) && keyOf(move.to) === keyOf(to),
    )
    expect(legal, `expected ${c} to be legal`).toBeDefined()
    s = applyMove(s, legal!)
  }
  return s
}

/** Build a room whose FEN is `fen`, both seats taken, and the clock armed. */
function seededRoom(fen: string) {
  let now = T0
  const core = new RoomCore(
    'ABCD',
    { fen, moves: [], revision: 0, ended: false },
    () => now,
  )
  const w = fakeConn('w')
  const b = fakeConn('b')
  core.receive(w.conn, join(w.conn))
  core.receive(b.conn, join(b.conn))
  return {
    core,
    w,
    b,
    at: (t: number) => {
      now = t
    },
  }
}

/** Like `seededRoom` but the room hydrates from a full snapshot — for tests
 *  that need the room's position-key history to span the seed boundary
 *  (the repetition test). */
function seededRoomFromSnap(snap: RoomSnapshot) {
  let now = T0
  const core = new RoomCore('ABCD', snap, () => now)
  const w = fakeConn('w')
  const b = fakeConn('b')
  core.receive(w.conn, join(w.conn))
  core.receive(b.conn, join(b.conn))
  return {
    core,
    w,
    b,
    at: (t: number) => {
      now = t
    },
  }
}

/**
 * Mirror of the engine's private `positionKey()` (worker/src/rules/rules.ts) and
 * the room's same-named helper. Used by the repetition test to seed the
 * snapshot's `history` array — the test cannot read either of the two real
 * implementations, so it re-implements the deterministic algorithm locally
 * (kept bit-equal by hand).
 */
function mirrorPositionKey(fen: string): string {
  const pos = parsePosition(fen)
  const entries = [...pos.board.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
  let s = `${pos.turn}|${pos.epTarget ? `${pos.epTarget.q},${pos.epTarget.r}` : '-'}|`
  for (const [k, p] of entries) s += `${k}:${p.color}${p.type},`
  return s
}

describe('RoomCore engine-game-end terminals (t62)', () => {
  it('checkmate → roomEnd{reason:"checkmate", winner: deliverer}', () => {
    // Wikipedia Fool's mate: 1.Qe1c3 Qe10c6 2.b1b2 b7b6 3.Bf3b1 e7e6 4.Qc3xBf9#
    // Pre-mate FEN (the 6-move buildup) seeded into the room, then the mate.
    const before = play(
      initialGame(),
      'e1c3',
      'e10c6',
      'b1b2',
      'b7b6',
      'f3b1',
      'e7e6',
    )
    const fen = serializePosition(before)
    const { core, w, b } = seededRoom(fen)

    // The mate Qc3xf9, white's last legal move. The room is at revision 0
    // with white to move, so `w` (joined first as white) sends it.
    core.receive(w.conn, move('c3', 'f9', 0))

    // The mated side is black (the side whose turn it is after Qxf9).
    // The deliverer is white — the side whose turn it WAS.
    expect(w.find('roomEnd')).toMatchObject({
      type: 'roomEnd',
      code: 'ABCD',
      reason: 'checkmate',
      winner: 'white',
    })
    expect(b.find('roomEnd')).toMatchObject({
      reason: 'checkmate',
      winner: 'white',
    })
    expect(core.snapshot()).toMatchObject({ ended: true })
  })

  it('stalemate → roomEnd{reason:"stalemate", winner: side whose turn it is}', () => {
    // Build a position where white can capture black's last piece in one
    // move. The engine's `inCheck` returns `false` when a king is missing
    // from the board, so the post-capture state (black has nothing left)
    // is reported as `stalemate` rather than `checkmate` — see
    // `claudedocs/TERMINALS.md` §2 for the rationale.
    //
    // Pre: white queen at d8, white king at l1, black king at c8.
    // Move: Q@d8→c8 captures the black king.
    const preStalemate = customPos(
      [
        ['d8', { type: 'Q', color: 'w' }],
        ['c8', { type: 'K', color: 'b' }],
        ['l1', { type: 'K', color: 'w' }],
      ],
      'w',
    )
    expect(status(preStalemate)).toBe('playing')

    const fen = serializePosition(preStalemate)
    const room = seededRoom(fen)
    room.core.receive(room.w.conn, move('d8', 'c8', 0))

    // Implementation choice: `winner` is the side whose turn it is (black).
    // See TERMINALS.md §2 for the rationale and the open question about
    // which side conventionally is the "stalemater".
    expect(room.w.find('roomEnd')).toMatchObject({
      type: 'roomEnd',
      code: 'ABCD',
      reason: 'stalemate',
      winner: 'black',
    })
    expect(room.b.find('roomEnd')).toMatchObject({
      reason: 'stalemate',
      winner: 'black',
    })
    expect(room.core.snapshot()).toMatchObject({ ended: true })
  })

  it('draw50 → roomEnd{reason:"draw50"} with no winner', () => {
    // 100 halfmoves since the last pawn move / capture. Seed a custom FEN
    // with halfmove=100 and two kings; a legal king move doesn't reset the
    // counter, so the post-move halfmove becomes 101 — still >= 100 → draw50.
    const seed = customPos(
      [
        ['k1', { type: 'K', color: 'w' }],
        ['a1', { type: 'K', color: 'b' }],
      ],
      'w',
      { halfmove: 100 },
    )
    expect(status(seed)).toBe('draw50')
    const fen = serializePosition(seed)

    const { core, w, b } = seededRoom(fen)
    // K on k1 → k2 (legal; doesn't capture or push a pawn).
    core.receive(w.conn, move('k1', 'k2', 0))

    expect(w.find('roomEnd')).toMatchObject({
      type: 'roomEnd',
      code: 'ABCD',
      reason: 'draw50',
    })
    expect(w.findEnd()?.winner).toBeUndefined()
    expect(b.findEnd()?.winner).toBeUndefined()
    expect(core.snapshot()).toMatchObject({ ended: true })
  })

  it('repetition → roomEnd{reason:"repetition"} with no winner', () => {
    // Knight shuffle: White d1-b2-d1, Black d9-f8-d9. After two cycles
    // (8 plies), the position repeats for the third time → `repetition`.
    //
    // The room's terminal check fires after every accepted move, so we
    // drive it one ply at a time. We seed the snapshot with the move
    // list and the position-key history of one full cycle (8 plies, 2
    // occurrences of the opening) — see `RoomSnapshot.history` (t62).
    // Then play the second cycle through the room's `move()` — the 8th
    // ply in the room is the third occurrence → repetition.
    const cycle = ['d1b2', 'd9f8', 'b2d1', 'f8d9']

    // Play one full cycle through the engine, recording each post-move key.
    let s = initialGame()
    const keys: string[] = [mirrorPositionKey(serializePosition(s))]
    const wmoves: WireMove[] = []
    let r = 0
    let col: 'white' | 'black' = 'white'
    for (const c of cycle) {
      const from = c.slice(0, 2)
      const to = c.slice(2)
      const m = legalMoves(s).find((mv) => {
        return keyOf(mv.from) === keyOf(notationToAxial(from)!) &&
          keyOf(mv.to) === keyOf(notationToAxial(to)!)
      })
      expect(m, `expected ${c} to be legal`).toBeDefined()
      s = applyMove(s, m!)
      keys.push(mirrorPositionKey(serializePosition(s)))
      wmoves.push({ from, to, ply: ++r, color: col })
      col = col === 'white' ? 'black' : 'white'
    }
    const seedFen = serializePosition(s)

    // Seed the room with the cycle's post-state: 2 occurrences already.
    const snap: RoomSnapshot = {
      fen: seedFen,
      moves: wmoves,
      revision: wmoves.length,
      ended: false,
      history: keys,
    }
    const { core, w, b } = seededRoomFromSnap(snap)

    const turnAfterOne = seedFen.split(' ')[1]!
    let nextMover = turnAfterOne === 'w' ? w : b
    let revision = wmoves.length
    for (const c of cycle) {
      const from = c.slice(0, 2)
      const to = c.slice(2)
      core.receive(nextMover.conn, move(from, to, revision))
      // Alternate: w→b→w→b
      nextMover = nextMover === w ? b : w
      revision++
    }

    expect(w.find('roomEnd')).toMatchObject({
      type: 'roomEnd',
      code: 'ABCD',
      reason: 'repetition',
    })
    expect(w.findEnd()?.winner).toBeUndefined()
    expect(b.findEnd()?.winner).toBeUndefined()
    expect(core.snapshot()).toMatchObject({ ended: true })
  })

  it('refuses a move once the room is terminal', () => {
    // Same stalemate fixture as above; after the trigger move the room
    // is terminal, so a follow-up move attempt is NACKed with
    // `the room has ended` (mirrors the t56 clock pattern in
    // worker/test/clock.test.ts).
    const preStalemate = customPos(
      [
        ['d8', { type: 'Q', color: 'w' }],
        ['c8', { type: 'K', color: 'b' }],
        ['l1', { type: 'K', color: 'w' }],
      ],
      'w',
    )
    const fen = serializePosition(preStalemate)
    const { core, w } = seededRoom(fen)

    core.receive(w.conn, move('d8', 'c8', 0)) // stalemate → roomEnd
    expect(w.find('roomEnd')).toMatchObject({ reason: 'stalemate' })

    core.receive(w.conn, move('l1', 'l2', 1))
    expect(w.find('error')).toMatchObject({
      type: 'error',
      code: 'invalid_move',
      message: 'the room has ended',
    })
    expect(core.moveCount).toBe(1)
  })

  it('a snapshot with ended:true stays terminal; welcome.ended carries through', () => {
    // Persist a terminal room, then revive it. The revived room must (a) hand
    // `welcome.ended=true` to a fresh joiner, (b) NACK any move, (c) preserve
    // the position-key history. Mirrors worker/test/clock.test.ts's "flags a
    // clock that ran out while the DO was evicted".
    const seed = play(
      initialGame(),
      'e1c3',
      'e10c6',
      'b1b2',
      'b7b6',
      'f3b1',
      'e7e6',
    )
    const beforeMate = serializePosition(seed)
    const now = T0
    const live = new RoomCore(
      'ABCD',
      { fen: beforeMate, moves: [], revision: 0, ended: false },
      () => now,
    )
    const w1 = fakeConn('w1')
    const b1 = fakeConn('b1')
    live.receive(w1.conn, join(w1.conn))
    live.receive(b1.conn, join(b1.conn))
    live.receive(w1.conn, move('c3', 'f9', 0))
    expect(w1.find('roomEnd')).toMatchObject({ reason: 'checkmate' })
    const snap = live.snapshot()
    expect(snap.ended).toBe(true)
    expect(snap.history?.length ?? 0).toBeGreaterThan(0)

    const revived = new RoomCore('ABCD', snap, () => T0)
    const w2 = fakeConn('w2')
    revived.receive(w2.conn, join(w2.conn))
    expect(w2.find('welcome')).toMatchObject({ ended: true })
    revived.receive(w2.conn, move('f9', 'f8', 1))
    expect(w2.find('error')).toMatchObject({
      code: 'invalid_move',
      message: 'the room has ended',
    })
    expect(revived.snapshot().ended).toBe(true)
  })
})
