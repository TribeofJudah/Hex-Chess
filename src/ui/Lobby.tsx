import { useState, type FormEvent } from 'react'
import { navigate, newRoomCode } from './router'
import { onlinePlayConfigured } from './roomConfig'
import './theme.css'

/**
 * Online-play lobby (t67), route `#/online`. Create a room (random code) or
 * join one by code. A production build without a configured room origin can't
 * reach a server, so it says so rather than dialing github.io and failing.
 */
export interface LobbyProps {
  /** Whether online play is configured (tests inject; default: roomConfig). */
  configured?: boolean
}

/** Same acceptance as the router's play route: 4–8 alphanumerics. */
const CODE_RE = /^[A-Z0-9]{4,8}$/

export function Lobby({ configured = onlinePlayConfigured() }: LobbyProps) {
  const [code, setCode] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)

  const createRoom = () =>
    navigate({ name: 'play', roomCode: newRoomCode() })

  const joinRoom = (event: FormEvent) => {
    event.preventDefault()
    const value = code.trim().toUpperCase()
    if (!CODE_RE.test(value)) {
      setJoinError('Enter a 4–8 character room code, e.g. AB34.')
      return
    }
    setJoinError(null)
    navigate({ name: 'play', roomCode: value })
  }

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">XCHESS</h1>
        <p className="app__subtitle">Play online</p>
      </header>

      {configured ? null : (
        <p
          className="hxc-lobby__notice"
          role="status"
          data-testid="lobby-unconfigured"
        >
          Online play isn&apos;t configured in this build. Set
          <code> VITE_ROOM_ORIGIN </code> to the room server and rebuild.
        </p>
      )}

      <section className="hxc-lobby" aria-label="Online play">
        <div className="hxc-lobby__row">
          <button
            type="button"
            className="hxc-button"
            onClick={createRoom}
            disabled={!configured}
          >
            Create room
          </button>
        </div>

        <form className="hxc-lobby__row" onSubmit={joinRoom} noValidate>
          <label className="hxc-lobby__label" htmlFor="lobby-join-code">
            Join a room
          </label>
          <input
            id="lobby-join-code"
            className="hxc-input"
            data-testid="lobby-join-input"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase())
              setJoinError(null)
            }}
            placeholder="AB34"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={8}
            disabled={!configured}
            aria-invalid={joinError !== null}
            aria-describedby={joinError ? 'lobby-join-error' : undefined}
          />
          <button type="submit" className="hxc-button" disabled={!configured}>
            Join
          </button>
          {joinError ? (
            <p
              id="lobby-join-error"
              className="hxc-position__error"
              role="alert"
            >
              {joinError}
            </p>
          ) : null}
        </form>

        <div className="hxc-lobby__row">
          <button
            type="button"
            className="hxc-button"
            onClick={() => navigate({ name: 'game' })}
          >
            Back to board
          </button>
        </div>
      </section>
    </main>
  )
}

export default Lobby
