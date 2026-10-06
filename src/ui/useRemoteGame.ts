import { useCallback, useEffect, useRef, useState } from 'react'
import { glinskiRules } from '../rules/adapter'
import type { PieceColor, PieceKind } from './hexMath'
import {
  decode,
  encode,
  PROTOCOL_VERSION,
  type ClockWire,
  type ClientMsg,
  type Seat,
  type WireMove,
} from './protocol'
import {
  useGame,
  type DrawOfferKind,
  type GameRules,
  type UseGameResult,
} from './useGame'

/**
 * Remote-play session hook (T-remote-play, t39).
 *
 * Wraps `useGame` (rules + board state) with a WebSocket session against a
 * room Durable Object. Local moves are streamed out; inbound moves are applied
 * through `applyMove`. Handles the protocol handshake, revision gaps, version
 * mismatch and reconnection per claudedocs/ROOM_PROTO.md.
 *
 * The transport is injectable (`connect`/`urlFor`) so it can be tested without
 * a live server.
 */

export type RemoteStatus =
  | 'connecting'
  | 'waiting'
  | 'playing'
  | 'reconnecting'
  | 'version-mismatch'
  | 'error'
  | 'closed'

/** Minimal WebSocket surface the hook needs (real `WebSocket` satisfies it). */
export interface SocketLike {
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
}
export type ConnectFn = (url: string) => SocketLike

export interface UseRemoteGameOptions {
  /** Socket factory (default: `new WebSocket(url)`). */
  connect?: ConnectFn
  /** Room URL builder (default: same-origin `/room/<CODE>`). */
  urlFor?: (roomCode: string) => string
  /** First reconnect backoff step, ms (doubles up to `reconnectMaxMs`). */
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  /** Stable id used to reclaim a seat on reconnect (default: random). */
  clientId?: string
  rules?: GameRules
}

export interface UseRemoteGameResult extends UseGameResult {
  roomCode: string
  seat: Seat
  status: RemoteStatus
  peerConnected: boolean
  /** Server protocol version, present when `status === 'version-mismatch'`. */
  serverProtocol?: number
  error?: string
  /** Server-authoritative clock (t56). Mirrors `welcome.clock` and the
      per-tick `clock` frames. Absent on a v1 server or before the welcome
      frame. Updated only by wire frames — never by the local rules engine,
      so the field is the same regardless of whose turn it is locally. */
  clock?: ClockWire
  /** Play a move and stream it (thin alias over `applyMove`). */
  sendMove: (from: string, to: string, promotion?: PieceKind) => void
  /** Offer/accept/decline a draw over the wire (t49): the offerDraw /
      acceptDraw / declineDraw frames. The room derives the acting seat from
      the connection; only the offer frame carries an advisory `by`. */
  sendDraw: (kind: DrawOfferKind) => void
  leave: () => void
}

const RECONNECT_BASE_MS = 250
const RECONNECT_MAX_MS = 10_000

function defaultUrl(roomCode: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/room/${roomCode}`
}

function defaultConnect(url: string): SocketLike {
  return new WebSocket(url) as unknown as SocketLike
}

let clientSeq = 0
function randomClientId(): string {
  clientSeq += 1
  return `c${clientSeq}-${Math.random().toString(36).slice(2, 10)}`
}

/** Statuses in which we may stream a local move to the server. */
const SENDABLE: readonly RemoteStatus[] = ['waiting', 'playing']

/** Narrow a wire seat to the two playable colors; spectators cannot act. */
const colorOf = (seat: Seat): PieceColor | null =>
  seat === 'spectator' ? null : seat

export function useRemoteGame(
  roomCode: string,
  options: UseRemoteGameOptions = {},
): UseRemoteGameResult {
  const {
    connect = defaultConnect,
    urlFor = defaultUrl,
    reconnectBaseMs = RECONNECT_BASE_MS,
    reconnectMaxMs = RECONNECT_MAX_MS,
    rules = glinskiRules,
  } = options

  const game = useGame(rules)
  const [status, setStatus] = useState<RemoteStatus>('connecting')
  const [seat, setSeat] = useState<Seat>('spectator')
  const [peerConnected, setPeerConnected] = useState(false)
  const [serverProtocol, setServerProtocol] = useState<number | undefined>()
  const [error, setError] = useState<string | undefined>()
  // Server-authoritative clock (t56). Initialised from `welcome.clock` and
  // replaced by every `clock` frame; absent until the first frame lands.
  const [clock, setClock] = useState<ClockWire | undefined>()

  // Latest game, read from socket callbacks — assigned in an effect, not render.
  const gameRef = useRef(game)
  useEffect(() => {
    gameRef.current = game
  })
  const revisionRef = useRef(0)
  const lastSentRef = useRef(0)
  const socketRef = useRef<SocketLike | null>(null)
  const closedByUsRef = useRef(false)
  const mismatchRef = useRef(false)
  const attemptRef = useRef(0)
  // Stable per-session id so a reconnect reclaims the same seat.
  const [clientId] = useState(() => options.clientId ?? randomClientId())

  const send = useCallback((msg: ClientMsg) => {
    socketRef.current?.send(encode(msg))
  }, [])

  /** Rebuild the board from an authoritative move list (welcome / resync). */
  const rebuild = useCallback((moves: WireMove[]) => {
    const g = gameRef.current
    g.newGame()
    for (const m of moves) g.applyMove(m.from, m.to, m.promotion)
    lastSentRef.current = moves.length
  }, [])

  /** Open, accept or decline a draw over the wire (t49). Silently inert when
      no room can take it (not sendable, or a spectator offering). */
  const sendDraw = useCallback(
    (kind: DrawOfferKind) => {
      if (!SENDABLE.includes(status)) return
      if (kind === 'offer') {
        const by = colorOf(seat)
        if (!by) return
        send({
          v: PROTOCOL_VERSION,
          type: 'offerDraw',
          code: roomCode,
          by,
        })
        return
      }
      send({
        v: PROTOCOL_VERSION,
        type: kind === 'accept' ? 'acceptDraw' : 'declineDraw',
        code: roomCode,
      })
    },
    [send, roomCode, seat, status],
  )

  useEffect(() => {
    closedByUsRef.current = false
    mismatchRef.current = false
    attemptRef.current = 0
    revisionRef.current = 0
    lastSentRef.current = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const handle = (raw: string) => {
      const msg = decode(raw)
      if (!msg) return
      switch (msg.type) {
        case 'welcome': {
          if (msg.protocol !== PROTOCOL_VERSION) {
            // Defensive: a server that skipped the error frame.
            mismatchRef.current = true
            setServerProtocol(msg.protocol)
            setStatus('version-mismatch')
            socketRef.current?.close()
            return
          }
          attemptRef.current = 0
          revisionRef.current = msg.revision
          setSeat(msg.seat)
          rebuild(msg.moves)
          // t56: welcome may carry the clock snapshot (present when the room
          // already had one created; absent on a v1 server). Mirror it.
          if (msg.clock) setClock(msg.clock)
          setStatus('waiting')
          break
        }
        case 'state': {
          revisionRef.current = msg.revision
          rebuild(msg.moves)
          break
        }
        case 'move': {
          const have = gameRef.current.moves.length
          if (msg.ply <= have) {
            // Our own echo (or already applied): just advance the revision.
            revisionRef.current = msg.revision
          } else if (msg.ply === have + 1) {
            gameRef.current.applyMove(msg.from, msg.to, msg.promotion)
            lastSentRef.current = msg.ply
            revisionRef.current = msg.revision
          } else {
            // Gap: we missed something — ask for the authoritative state.
            send({ v: PROTOCOL_VERSION, type: 'resync', revision: have })
          }
          break
        }
        case 'peer': {
          const both = msg.seats.white && msg.seats.black
          setPeerConnected(both)
          setStatus((s) =>
            s === 'version-mismatch' || s === 'error'
              ? s
              : both
                ? 'playing'
                : 'waiting',
          )
          break
        }
        case 'error': {
          if (msg.code === 'version_mismatch') {
            mismatchRef.current = true
            if (msg.expectedProtocol !== undefined)
              setServerProtocol(msg.expectedProtocol)
            setStatus('version-mismatch')
            socketRef.current?.close()
            return
          }
          // A draw-frame NACK (t48: not_your_turn / no_open_offer /
          // game_over) is a soft refusal — the follow-up state push resyncs
          // the board, so don't tear the room down over it.
          if (msg.code === 'invalid_draw') break
          setError(msg.message)
          setStatus('error')
          break
        }
        case 'drawOffer': {
          // Mirror the per-seat view verbatim (t48): 'awaiting' on the
          // offerer's connection, 'offered' on the answerer's; 'idle' clears.
          const by = colorOf(msg.by)
          if (by) {
            gameRef.current.recvDrawOffer(
              msg.state === 'idle' ? null : { state: msg.state, by },
            )
          }
          break
        }
        case 'roomEnd': {
          // Terminal draw-agreement frame (t48); also fires for a clock
          // timeout in t56. `winner` is the side that WON (the OPPOSITE of
          // the seat that ran out); we pass it through so the local reducer
          // can mark the right `gameOver` shape.
          gameRef.current.recvRoomEnd(msg.reason, msg.winner)
          break
        }
        case 'clock': {
          // t56: server-authoritative clock update. Replaces the local
          // snapshot wholesale — the server is the only source of truth,
          // we don't derive it from `turn`. The room clock can still be
          // advancing while the game is over (the roomEnd frame is the
          // terminal, not this one), so we don't tie it to `status`.
          setClock(msg.clock)
          break
        }
        case 'pong':
          break
      }
    }

    const open = () => {
      const sock = connect(urlFor(roomCode))
      socketRef.current = sock
      sock.onopen = () => {
        setStatus('waiting')
        send({
          v: PROTOCOL_VERSION,
          type: 'join',
          room: roomCode,
          clientId,
          protocol: PROTOCOL_VERSION,
        })
      }
      sock.onmessage = (ev) => {
        if (typeof ev.data === 'string') handle(ev.data)
      }
      sock.onclose = () => {
        if (closedByUsRef.current || mismatchRef.current) {
          setStatus((s) => (s === 'version-mismatch' ? s : 'closed'))
          return
        }
        // Unexpected drop: back off and retry, reclaiming the seat.
        setStatus('reconnecting')
        const step = Math.min(
          reconnectMaxMs,
          reconnectBaseMs * 2 ** attemptRef.current,
        )
        const delay = step / 2 + Math.random() * (step / 2)
        attemptRef.current += 1
        reconnectTimer = setTimeout(open, delay)
      }
      sock.onerror = () => {
        // onclose follows; nothing extra here.
      }
    }

    open()

    return () => {
      closedByUsRef.current = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [
    roomCode,
    clientId,
    connect,
    urlFor,
    reconnectBaseMs,
    reconnectMaxMs,
    send,
    rebuild,
  ])

  // Stream locally-produced moves out. Inbound moves bump `lastSentRef` to
  // their ply (in `handle`), so only genuine local moves reach this check. A
  // move made while not yet sendable stays pending and is sent when the socket
  // becomes ready (unless a resync rebuilds past it).
  useEffect(() => {
    const len = game.moves.length
    if (len <= lastSentRef.current) return
    if (!SENDABLE.includes(status)) return
    const move = game.moves[len - 1]
    if (!move || !move.from || !move.to) return
    lastSentRef.current = len
    send({
      v: PROTOCOL_VERSION,
      type: 'move',
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
      revision: revisionRef.current,
    })
  }, [game.moves, status, send])

  // Terminal say of the wire (t55): the mirrored agreement gameOver is the
  // draw_agreement producer; t54's clock adds 'time' on top of it. The
  // reducer carries the reason on `game.roomEndReason` (set by `recvRoomEnd`
  // in useGame), so it's exposed verbatim via `...game` in the return below.

  const leave = useCallback(() => {
    closedByUsRef.current = true
    socketRef.current?.close()
    socketRef.current = null
    setStatus('closed')
  }, [])

  return {
    ...game,
    roomCode,
    seat,
    status,
    peerConnected,
    ...(serverProtocol !== undefined ? { serverProtocol } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(clock !== undefined ? { clock } : {}),
    sendMove: game.applyMove,
    sendDraw,
    // The wire half of chooseOffer (t49): nothing is dispatched locally
    // because the state updates arrive as the server's per-seat frames.
    chooseOffer: sendDraw,
    leave,
  }
}

export default useRemoteGame
