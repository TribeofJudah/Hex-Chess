export default function App() {
  return (
    <main className="app">
      <header className="app__header">
        <svg
          className="app__hex"
          viewBox="0 0 100 100"
          role="img"
          aria-label="Hexagon logo"
        >
          <polygon
            points="50,4 91,27 91,73 50,96 9,73 9,27"
            fill="var(--color-hex)"
            stroke="var(--color-border)"
            strokeWidth="4"
          />
        </svg>
        <h1 className="app__title">HEX CHESS</h1>
        <p className="app__subtitle">Gliński&apos;s variant — hotseat</p>
      </header>

      <section className="app__panel" data-testid="scaffold-status">
        <p className="app__status">SCAFFOLD READY</p>
        <p className="app__hint">
          Board model lands in T3 · move generation in T4 · board UI in T6
        </p>
      </section>

      <footer className="app__footer">
        <p>Vite + React + TypeScript · Vitest · no backend</p>
      </footer>
    </main>
  )
}
