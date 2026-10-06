# PGN export for multiplayer terminals (t55 / t56 / R12)

The Round 1 PGN exporter (`src/ui/pgn.ts`) was hotseat-only: it knew
how to label a checkmate, resign, or fifty-move draw, but had no
channel to record the multiplayer-specific terminations that landed
in Round 8 (t48 draw agreement), Round 10 (t56 clock), and Round 12
(server-enforced checkmate / stalemate / 50-move / threefold
repetition). The exporter was extended to accept a wire-derived
`roomEndReason` and a clock-specific `timeLoser` argument; the
comment line they thread through mirrors the room's terminal say.
`PROTOCOL_VERSION` was bumped in t56 (R10) and again in R12 (server
terminals); see §5 below.

## §1. Wire summary (see `ROOM_PROTO.md` §9 + `CLOCK.md` §6)

| wire frame          | `roomEndReason` arg | `timeLoser` arg | comment line                |
|---------------------|---------------------|-----------------|-----------------------------|
| `roomEnd{reason:'draw_agreement'}` | `'draw_agreement'` | ignored  | `*[Draw by agreement]*`     |
| `roomEnd{reason:'time', winner:'white'}` | `'time'`    | `'black'` | `*[Black ran out of time]*` |
| `roomEnd{reason:'time', winner:'black'}` | `'time'`    | `'white'` | `*[White ran out of time]*` |
| `roomEnd{reason:'checkmate', winner:'white'}` (R12) | `'checkmate'` | ignored | `*[Checkmate, White wins]*` |
| `roomEnd{reason:'checkmate', winner:'black'}` (R12) | `'checkmate'` | ignored | `*[Checkmate, Black wins]*` |
| `roomEnd{reason:'stalemate', winner:'white'}` (R12) | `'stalemate'` | ignored | `*[Stalemate — Gliński 3/4 to White]*` |
| `roomEnd{reason:'stalemate', winner:'black'}` (R12) | `'stalemate'` | ignored | `*[Stalemate — Gliński 3/4 to Black]*` |
| `roomEnd{reason:'draw50'}` (R12)   | `'draw50'`    | ignored  | `*[Draw by 50-move rule]*`  |
| `roomEnd{reason:'repetition'}` (R12) | `'repetition'` | ignored | `*[Draw by threefold repetition]*` |
| hotseat resign      | n/a (omitted)       | n/a             | none                        |
| hotseat checkmate   | n/a (omitted)       | n/a             | none                        |
| hotseat repetition / fifty-move | n/a (omitted) | n/a     | none                        |

The result token is computed by `pgnResult(gameOver)` exactly as in
Rounds 1-8, EXCEPT for the multiplayer agreement path where
`roomEndReason === 'draw_agreement'` forces the header
`[Result "1/2-1/2"]` regardless of the snapshot. This is the only
override: it covers the case where the local `useGame` reducer hasn't
seen the matching `recvRoomEnd` frame yet (a resync, an out-of-window
tab, a clock-UI race).

## §2. Corroboration (t55)

The annotation comment is only emitted when the snapshot's
`gameOver.kind` agrees with the reason. This prevents:

- a stale `draw_agreement` reason on a `repetition` snapshot from
  being labelled "by agreement";
- a `time` reason on an `agreement` snapshot from being labelled
  "ran out of time" (the worker never emits that combination;
  the guard is cheap).

The single source of truth for "what kind of game end is this" is
`gameOver.kind`. `roomEndReason` is the *transport*, not the truth.

## §3. Implementation

### `src/ui/pgn.ts`

`toPgn(moves, gameOver, roomEndReason?, timeLoser?, date?)`:
- header `[Result "…"]` is set from `pgnResult(gameOver)` when
  `roomEndReason !== 'draw_agreement'`; otherwise it is forced to
  `1/2-1/2`.
- the comment line is pushed before the trailing result token iff
  `roomEndReason` plus `gameOver.kind` corroborate.
- `timeLoser` is the OPPOSITE of the wire's `winner` field; the
  exporter takes the loser because chess databases and humans search
  on the text ("Black ran out of time" rather than "White won on
  time").

The new `RoomEndReason` type is exported so the multiplayer hook can
typecheck the threading:

```ts
export type RoomEndReason =
  | 'draw_agreement'
  | 'time'
  | 'checkmate'
  | 'stalemate'
  | 'draw50'
  | 'repetition'
```

### `src/ui/useGame.ts`

`GameState.roomEndReason: 'draw_agreement' | 'time' | 'checkmate' |
'stalemate' | 'draw50' | 'repetition' | null` carries the wire reason
end-to-end. Set by the `recvRoomEnd(reason, winner?)` reducer case
(t48 + t56 + R12); cleared by `newGame`, `loadPosition`, `undo`,
`resign`, `draw`, and the local-path `chooseOffer accept`.

### `src/ui/useRemoteGame.ts`

The `case 'roomEnd'` switch forwards `msg.reason, msg.winner` to
`gameRef.current.recvRoomEnd`. `roomEndReason` is exposed on
`UseRemoteGameResult` via the spread of `useGame`'s result.

### `src/ui/RemoteRoom.tsx`

The existing ControlBar already had `onExportPgn` wired; t55 turns
it on for multiplayer with the roomEnd reason threaded:

```tsx
onExportPgn={() =>
  downloadPgn(
    toPgn(game.moves, game.gameOver, game.roomEndReason),
    `hex-chess-${roomCode}.pgn`,
  )
}
```

Hotseat keeps its existing render (`onExportPgn` in `src/App.tsx`
omits `roomEndReason`, so `toPgn` produces the pre-t55 string).

## §4. Tests (gate)

`src/ui/pgn.test.ts` (was 3, now 19 across all rounds):
- draw_agreement annotation produces `[Result "1/2-1/2"]` and
  `*[Draw by agreement]*` immediately above the trailing token.
- hotseat rendering stays comment-free when no `roomEndReason`
  is provided.
- `time` + `timeLoser='white'` and `timeLoser='black'` both produce
  the right loser-named comment and the right `[Result "…"]`.
- the corroboration guard: `kind:'repetition'` with reason
  `'draw_agreement'` produces no comment, even though both
  individually would.
- the override: `kind:undefined` with reason `'draw_agreement'`
  forces `1/2-1/2` with no comment.
- the integration test: a `useRemoteGame` consumer that receives
  a `roomEnd{reason:'draw_agreement'}` frame ends with
  `roomEndReason === 'draw_agreement'`; the export rendered from
  that hook ends with `*[Draw by agreement]*\n1/2-1/2\n`.
- **R12**: `checkmate` with `winner: 'white' | 'black'` produces
  `*[Checkmate, White wins]*` / `*[Checkmate, Black wins]*` + the
  right `[Result "…"]`.
- **R12**: `stalemate` with `winner: 'white' | 'black'` produces
  `*[Stalemate — Gliński 3/4 to White]*` / `… Black]*` + the right
  `3/4-1/4` / `1/4-3/4`.
- **R12**: `draw50` produces `*[Draw by 50-move rule]*` +
  `1/2-1/2`.
- **R12**: `repetition` produces `*[Draw by threefold repetition]*` +
  `1/2-1/2`.
- **R12**: corroboration guard extends to the new reasons — every
  (reason, kind) mismatch renders the snapshot's result with no
  comment line.
- **R12** integration: a `useRemoteGame` consumer that receives
  `roomEnd{reason:'checkmate', winner:'white'}` ends with the right
  PGN (`1-0` + `*[Checkmate, White wins]*`).

`src/ui/protocol.test.ts` adds one R12 test: round-trip the four new
`roomEnd.reason` values (`checkmate` / `stalemate` / `draw50` /
`repetition`) through `encode` + `decode`.

`src/ui/useGame.test.tsx` adds an R12 table-driven test pinning the
reducer's wire→kind mapping for every `recvRoomEnd(reason, winner?)`
pair.

`src/ui/useRemoteGame.test.tsx` adds an R12 table-driven test
asserting the hook threads every new reason into the right
`gameOver` shape and the right `roomEndReason`.

## §5. Server-side terminal annotations (R12)

R12 closes the gap from `ROOM_PROTO.md` §8.3 ("Checkmate / stalemate /
50-move still not enforced server-side") by promoting the four
rule-book terminals from client-only into wire-level emissions:

| terminal            | wire `reason`     | `winner?` | `gameOver.kind`     | PGN `[Result "…"]` | PGN comment               |
|---------------------|-------------------|-----------|---------------------|--------------------|---------------------------|
| checkmate           | `'checkmate'`      | required  | `'checkmate'`       | `1-0` / `0-1`     | `*[Checkmate, W/B wins]*` |
| stalemate (3/4)    | `'stalemate'`      | required  | `'stalemate'`       | `3/4-1/4` / `1/4-3/4` | `*[Stalemate — Gliński 3/4 to W/B]*` |
| 50-move rule       | `'draw50'`         | absent    | `'fifty-move'`      | `1/2-1/2`          | `*[Draw by 50-move rule]*` |
| threefold repetition| `'repetition'`    | absent    | `'repetition'`      | `1/2-1/2`          | `*[Draw by threefold repetition]*` |

### Stalemate — "the 3/4 framing" (mirror the worker)

Gliński's rule treats stalemate as a 3/4–1/4 split: the side that
trapped the opponent's king scores 0.75, the stalemated side 0.25
(see `src/rules/rules.ts` `status()` and `src/rules/adapter.ts`
`statusAfter`, which returns `{ kind: 'stalemate', winner: opponent }`).
The worker mirrors this on the wire: `roomEnd{reason:'stalemate',
winner}` names the **trapping side**, i.e. the 3/4 side. The exporter
matches: `*[Stalemate — Gliński 3/4 to {winner}]*` and `pgnResult()`
already returns `3/4-1/4` (white winner) / `1/4-3/4` (black winner).

### Banner wording

The room's `GameOverBanner` (shared between hotseat and remote, see
`src/ui/GameOverBanner.tsx`) renders:

- `Checkmate — {winner} wins`
- `Stalemate — {winner} wins 0.75-0.25`
- `Draw — fifty-move rule`
- `Draw — threefold repetition`

No `RemoteRoom.tsx` change was needed — `GameOverBanner` already
covers all four new shapes once the reducer sets them, and the wire
mirroring in `useRemoteGame.ts`'s `case 'roomEnd'` is a straight
forward to `gameRef.current.recvRoomEnd(msg.reason, msg.winner)`.

### Corroboration

The t55 guard extends to the new reasons: each branch in `toPgn()`
cross-checks `roomEndReason` against `gameOver.kind` and emits a
comment only when they agree. A stale `checkmate` reason on a
`fifty-move` snapshot renders without a comment line — the snapshot
is the truth (`gameOver.kind`), the reason is the transport.

## §6. Protocol bump

`PROTOCOL_VERSION` is bumped in two rounds:

- **t56 (R10)** bumped `PROTOCOL_VERSION` from 1 to 2 to carry the clock
  frames. `roomEnd.reason` widened from `'draw_agreement'` to
  `'draw_agreement' | 'time'`, and the new `winner?: PieceColor` field
  names the side that WON when `reason === 'time'`. See
  `claudedocs/CLOCK.md` §6 for the full v2 server-side spec; the client
  mirror is in `src/ui/protocol.ts`.
- **R12** bumped `PROTOCOL_VERSION` from 2 to 3 because the worker
  promotes `checkmate` / `stalemate` / `draw50` / `repetition` from
  client-side-only into server-enforced terminals. `roomEnd.reason`
  widens to all six; `winner?` is meaningful for `checkmate`,
  `stalemate`, and `time` (the last unchanged from R10). v2 clients are
  rejected at join with `version_mismatch` because their
  `RoomEndMsg.reason` cannot represent the new terminals. See
  `claudedocs/ROOM_PROTO.md` for the server-side rule additions and
  `src/ui/protocol.ts` for the client mirror.

## §7. Open questions

- The `roomEnd{reason:'time'}` wire value names the **winner**
  (`winner?: PieceColor`); the PGN exporter inverts it to the
  **loser** (`timeLoser`) so the comment is searchable. If the
  project ever ships a "lost on time" client-side UI, it should
  do the same inversion (renderer, not transport).
- `RoomEndReason` is a small string union today; if a future round
  adds more terminals (e.g. abort, abandoned) the type widens here
  and `toPgn` gains another branch.
