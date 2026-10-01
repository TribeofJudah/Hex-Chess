# Hex Chess (Gliński's Variant)

> A retro 8-bit implementation of **Gliński's Hexagonal Chess** built with **Vite**, **React 19**, and **TypeScript**.

🌐 **Live Demo:** [https://tribeofjudah.github.io/Hex-Chess/](https://tribeofjudah.github.io/Hex-Chess/)  
📖 **Rules Reference:** [Wikipedia: Gliński's Hexagonal Chess](https://en.wikipedia.org/wiki/Hexagonal_chess#Gli%C5%84ski's_hexagonal_chess)

---

## Features

- **Gliński Board & Notation**: 91 hexagonal cells across 11 files (`a`–`l` omitting `j`) and 11 bent ranks with standard 3-color map.
- **Accurate Rules Engine**:
  - **Rook**: 6 orthogonal directions (along cell edges).
  - **Bishop**: 6 diagonal directions (through cell vertices, strictly color-bound across 3 colors).
  - **Queen**: Combines Rook and Bishop (12 directions).
  - **Knight**: 12 hex-knight jump targets (2 orthogonal steps + 1 step 60° diagonal).
  - **King**: 12 adjacent directions (1-step in any direction), check & checkmate detection (no castling in Gliński).
  - **Pawn**: 1 forward step along file; double-step available from all 9 initial pawn starting squares; captures in 2 forward diagonal directions; en passant supported; promotion on opposite back rank.
  - **Stalemate**: Recorded as a 3/4–1/4 victory (0.75 to 0.25) per Gliński rules.
  - **Draw Rules**: 50-move rule and threefold repetition detection.
- **Retro 8-Bit Pixel Aesthetic**:
  - Handcrafted SVG pixel piece glyphs (12 distinct pieces).
  - Typography using local `@fontsource/press-start-2p`.
  - CRT scanline overlay (toggleable via Control Bar).
- **Game Flow & Controls**:
  - Local 2-player hotseat.
  - Interactive cell selection with valid target highlights, last-move indicator, and king check alert.
  - Move list with paired notation (`1. f5 f7`, `2. Bf3 b1`).
  - Snapshot-based Undo stack.
  - Game Over banner with checkmate, stalemate, and draw verdicts.

---

## Getting Started

### Prerequisites

- Node.js `>= 20.19` (recommended: Node 22+)
- npm

### Installation

```bash
git clone https://github.com/TribeofJudah/Hex-Chess.git
cd Hex-Chess
npm install
```

### Development Server

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### Running Tests

```bash
npm test
```

Runs all Vitest suites across board geometry, move generation, perft validation, UI components, and game flow.

### Linting & Typecheck

```bash
npm run lint
npm run build
```

---

## Tech Stack

- **Framework**: React 19 + TypeScript 5.9
- **Build Tool**: Vite 8
- **Styling**: CSS Custom Properties (Theme tokens) + Retro Pixel Assets
- **Testing**: Vitest 5 + Testing Library
- **Deployment**: GitHub Pages via GitHub Actions

---

## License

MIT
