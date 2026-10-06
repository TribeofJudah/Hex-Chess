# Server-authoritative game clock (CLOCK)

Status: **draft v1** — server-side only (t56). The UI that renders the two
clocks is a later round; this document is the source of truth for the server
half and for the frames that round will consume.

The room times the two seats with a chess clock: the side to move burns time,
a move earns the mover an increment, and a seat whose clock reaches zero loses
the game. Frames ride the **existing** room WebSocket
(`<worker-origin>/room/<CODE>`, JSON text — `ROOM_PROTO.md` §1); there is no new
transport. `PROTOCOL_VERSION` goes **1 → 2** because `welcome` gained two
required fields and `roomEnd.reason` gained a value — see §6.

`worker/src/clock.ts` holds the whole clock: pure arithmetic, no timers, no
storage. `RoomCore` owns one `ClockState`; the Durable Object owns the 1 Hz
alarm that drives it.

---

## 1. Time control

```ts
INITIAL_MS = 5 * 60 * 1000 // 5 minutes per seat
INCREMENT_MS = 3 * 1000 // 3 s Fischer increment per accepted move
TICK_MS = 1000 // broadcast cadence
```

The clock is initialised to these defaults when the room is created (that is,
when the Durable Object first hydrates an empty storage). There is **no
per-room time-control negotiation** — the client never calls a `createRoom`
endpoint (a code is generated locally, `ROOM_PROTO.md` §4), so the server has
nowhere to take a request from and fixes the values as module constants. A
future round that wants 3+2 or 10+0 adds a `timeControl` field to `join` and
clamps it server-side.

---

## 2. Semantics

- **Start.** The clock is _initialised_ at room creation but only _runs_ from
  the moment both seats are taken — the second `join` sets `since`. A lone
  player waiting for an opponent is never charged for the wait.
- **Burning.** Only the side to move burns. Every other seat's remaining time
  is frozen.
- **Increment.** An **accepted** move adds `INCREMENT_MS` to the mover's clock
  and hands the running clock to the opponent. A rejected move changes nothing
  (it never reaches `afterMove`).
- **Flag fall.** When the side to move's remaining time reaches zero the room
  ends: `roomEnd{reason:'time', winner:<opponent>}`. Both clocks stop and the
  room is terminal — a later `move` is refused.
- **No pause.** A dropped socket does not stop the clock: disconnecting is not
  a way to save time. Seats stay reserved (`ROOM_PROTO.md` §4.3), so a
  reconnecting client resumes a clock that kept running.
- **Not running ≠ not started.** `ClockState.since === null` means "no clock is
  burning" — before the second join, and after the room ends. It is the single
  persisted indicator that the clock is live.

---

## 3. The clock is derived, not counted

`ClockState` is `{ white, black, since }`: each seat's remaining milliseconds
_as of_ `since`, plus the epoch millisecond at which the currently running seat
started burning. A seat's real remaining time is computed on read:

```ts
remainingAt(clock, seat, turn, now) =
  clock.since === null || seat !== turn
    ? clock[seat]
    : clock[seat] - (now - clock.since)
```

Nothing is written per tick. A tick only _broadcasts_ what the arithmetic
already says, which is what makes eviction cheap and exact (§4).

---

## 4. Tick driver and eviction

The Durable Object owns a single alarm, an alarm being a DO's only timer:

- `alarm()` → `core.tick(Date.now())` → re-arm at `now + TICK_MS` while a clock
  burns, then stop.
- The alarm is armed when the clock starts (a `join` that fills the second
  seat) and is **not** re-armed while one is already pending, so a chatty client
  cannot starve the 1 Hz cadence.
- The alarm survives eviction. A woken object re-hydrates its `RoomCore` from
  `{fen, moves, revision, clock, …}` and keeps counting: the elapsed wall-clock
  time is inside `now - since`, so no per-tick storage write is needed to stay
  accurate. A room woken long after a clock expired flags immediately on its
  first tick.

`RoomCore` itself holds no timer and calls no `Date.now()` directly: the time
source is a constructor parameter (`new RoomCore(code, snapshot, () => t)`), so
the clock is tested with explicit timestamps instead of fake timers.

`ponytail:` a live room wakes once per second even with nobody connected, until
its clock flags (bounded by the time control). If that ever costs real money,
the tick can be sent only while `live.size > 0`, keeping the alarm as a
deadline-only backstop.

---

## 5. Message shapes

Added to `worker/src/protocol.ts` (the client copies land with the UI round).

### 5.1 `clock` (server → client)

```ts
interface ClockWire {
  white: number // ms remaining
  black: number
  turn: PieceColor // whose clock is burning
  running: boolean
}
interface ClockMsg extends ClockWire {
  v: number
  type: 'clock'
  code: string
}
```

Broadcast to every live connection (players and spectators) once per second
while the clock burns, and once more when it stops: the flag fall sends a final
`clock` with the loser at `0` and `running:false` **before** the terminal
`roomEnd`, so a client never has to infer the result.

`white`/`black` are always floored at `0` on the wire.

### 5.2 `welcome` (server → client) — changed

Gains `clock: ClockWire` and `ended: boolean`. `welcome` is already the
authoritative per-client rebuild frame (`ROOM_PROTO.md` §4); a joiner to a game
in progress must start with the right clock numbers, and a joiner to a finished
room must not be shown a live board.

### 5.3 `roomEnd` — changed

```ts
reason: 'draw_agreement' | 'time'
winner?: PieceColor // present for 'time': the opponent of the flagged seat
```

The reason union widens, so a v1 client that switches on it (or on the welcome
shape) cannot be left to guess — see §6.

---

## 6. Protocol bump (1 → 2)

`PROTOCOL_VERSION` is `2`. `ROOM_PROTO.md` §2 bumps the version _only_ for
incompatible message-shape changes, and this is one: `welcome` gained two
required fields and `roomEnd.reason` gained a value. A v1 client reading a v2
`welcome` would run a clock-less board against a clocked server, so the join
handshake rejects it with `version_mismatch` instead.

> **Both copies must bump together.** The worker copy is
> `worker/src/protocol.ts`; the client copy is `src/ui/protocol.ts`.
> The t56 fence covers `worker/**` only, so the client bump is a **required
> follow-up in the same commit** — a v1 client against this worker is rejected
> at join.

---

## 7. Persistence

`RoomSnapshot` (`worker/src/room.ts`) carries `clock?: ClockState`; the field is
optional so a pre-t56 snapshot still hydrates (default: the §1 time control,
not running). `welcome.ended` is backed by the same `ended` flag that a draw
agreement sets — the field was already persisted, it is now simply reported
back to a joiner.

The DO persists on every frame that can change room state: a `join` (the clock
may start), a `move` (the clock switches sides), or a draw frame. `resync` and
`ping` still do not write. A flag fall persists on the tick that ends the room.

---

## 8. Coverage

`worker/test/clock.test.ts`: the arithmetic (only the side to move burns, a
frozen clock floors at zero); the clock not running before both seats are
taken; 1 Hz ticks with the idle seat untouched; the increment and hand-over on
a move; the flag fall ending the room with `winner`; a move refused after the
room ended; a room revived after eviction still counting from `since`; a clock
that expired while the DO was evicted flagging on the next tick; a draw
agreement stopping the clock.

Not covered here (no workerd under Node vitest — see `worker/README.md`): the DO
adapter itself, so the alarm arming/re-arming path in `index.ts` is exercised
only by `wrangler deploy --dry-run` plus review.

---

## 9. Non-goals

- **No per-room time control.** The §1 constants are fixed; no negotiation.
- **No client UI** yet: nothing renders `clock`, and `src/ui/protocol.ts` is
  still v1 (see §6).
- **No pause / no abandonment timeout.** A room whose players both vanish keeps
  burning until someone flags; there is no "abandoned room" cleanup.
- **No `resign`.** Resignation is still absent from the protocol; only a draw
  agreement and a flag fall end the room.
- The room still does not enforce checkmate / stalemate / 50-move as terminal
  states — that gap predates t56 and is unchanged.
