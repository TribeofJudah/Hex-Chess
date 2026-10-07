import { PROTOCOL_VERSION } from '../ui/protocol'
import type { ConnectFn, SocketLike } from '../ui/useRemoteGame'

/** Scriptable stand-in for a browser WebSocket, for remote-play tests. */
export class FakeSocket implements SocketLike {
  sent: unknown[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }
  close(): void {
    this.closed = true
  }

  // --- test drivers ---
  open(): void {
    this.onopen?.()
  }
  recv(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  drop(): void {
    this.onclose?.()
  }
  last<T = Record<string, unknown>>(): T {
    return this.sent[this.sent.length - 1] as T
  }
}

/** A `connect` factory that records every socket it hands out. */
export function makeSocketFactory() {
  const sockets: FakeSocket[] = []
  const connect: ConnectFn = (url) => {
    const sock = new FakeSocket(url)
    sockets.push(sock)
    return sock
  }
  return { connect, sockets, current: () => sockets[sockets.length - 1]! }
}

/** A well-formed `welcome` frame; override any field. */
export function welcomeMsg(over: Record<string, unknown> = {}) {
  return {
    v: PROTOCOL_VERSION,
    type: 'welcome',
    room: 'ABCD',
    clientId: 'c1',
    seat: 'white',
    protocol: PROTOCOL_VERSION,
    revision: 0,
    moves: [],
    ...over,
  }
}
