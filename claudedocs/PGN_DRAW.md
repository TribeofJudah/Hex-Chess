# PGN export for multiplayer terminals (t55 / t56)

The Round 1 PGN exporter (`src/ui/pgn.ts`) was hotseat-only: it knew
how to label a checkmate, resign, or fifty-move draw, but had no
channel to record the multiplayer-specific terminations that landed
in Round 8 (t48 draw agreement) and Round 10 (t56 clock). The exporter
was extended to accept a wire-derived `roomEndReason` and a
clock-specific `timeLoser` argument; the comment line they thread
through mirrors the room's terminal say.

## Wire summary (see `ROOM_PROTO.md` §9 + `CLOCK.md` §6)

| wire frame          | `roomEndReason` arg | `timeLoser` arg | comment line                |
|---------------------|---------------------|-----------------|-----------------------------|
| `roomEnd{reason:'draw_agreement'}` | `'draw_agreement'` | ignored  | `*[Draw by agreement]*`     |
| `roomEnd{reason:'time', winner:'white'}` | `'time'`    | `'black'` | `*[Black ran out of time]*` |
| `roomEnd{reason:'time', winner:'black'}` | `'time'`    | `'white'` | `*[White ran out of time]*` |
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

## Corroboration (t55)

The annotation comment is only emitted when the snapshot's
`gameOver.kind` agrees with the reason. This prevents:

- a stale `draw_agreement` reason on a `repetition` snapshot from
  being labelled "by agreement";
- a `time` reason on an `agreement` snapshot from being labelled
  "ran out of time" (the worker never emits that combination;
  the guard is cheap).

The single source of truth for "what kind of game end is this" is
`gameOver.kind`. `roomEndReason` is the *transport*, not the truth.

## Implementation

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
export type RoomEndReason = 'draw_agreement' | 'time'
```

### `src/ui/useGame.ts`

`GameState.roomEndReason: 'draw_agreement' | 'time' | null` carries
the wire reason end-to-end. Set by the `recvRoomEnd(reason, winner?)`
reducer case (t48 + t56); cleared by `newGame`, `loadPosition`,
`undo`, `resign`, `draw`, and the local-path `chooseOffer accept`.

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

## Tests (gate)

`src/ui/pgn.test.ts` adds (was 3, now 11):
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

## Protocol bump

`t56` bumped `PROTOCOL_VERSION` from 1 to 2 to carry the clock
frames. `roomEnd.reason` widened from `'draw_agreement'` to
`'draw_agreement' | 'time'`, and the new `winner?: PieceColor`
field names the side that WON when `reason === 'time'`. See
`claudedocs/CLOCK.md` §6 for the full v2 server-side spec; the
client mirror is in `src/ui/protocol.ts`.

## Open questions

- The `roomEnd{reason:'time'}` wire value names the **winner**
  (`winner?: PieceColor`); the PGN exporter inverts it to the
  **loser** (`timeLoser`) so the comment is searchable. If the
  project ever ships a "lost on time" client-side UI, it should
  do the same inversion (renderer, not transport).
- `RoomEndReason` is a small string union today; if a future round
  adds more terminals (e.g. abort, abandoned) the type widens here
  and `toPgn` gains another branch.
