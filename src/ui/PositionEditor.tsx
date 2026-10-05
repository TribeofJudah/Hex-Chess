import { useState, type FormEvent } from 'react'
import './theme.css'

export interface PositionEditorProps {
  /** Parse + load a FEN-like string; returns an error message on failure (T13). */
  onLoad: (text: string) => { ok: true } | { ok: false; error: string }
}

export function PositionEditor({ onLoad }: PositionEditorProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = onLoad(text)
    setError(result.ok ? null : result.error)
  }

  return (
    <form className="hxc-position" aria-label="Load position" onSubmit={submit}>
      <label className="hxc-position__label" htmlFor="hxc-fen">
        Load position (FEN)
      </label>
      <input
        id="hxc-fen"
        className="hxc-input"
        value={text}
        spellCheck={false}
        autoComplete="off"
        placeholder="b/qbk/n1b1n/… w - 0 1"
        onChange={(event) => setText(event.target.value)}
      />
      <button
        type="submit"
        className="hxc-button"
        disabled={text.trim() === ''}
      >
        Load
      </button>
      {error ? (
        <p className="hxc-position__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}

export default PositionEditor
