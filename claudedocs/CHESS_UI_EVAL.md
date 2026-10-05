# Chess-UI library evaluation (t38 — research only)

Date: 2026-10-05 · Author: spp2 (pane 49) · Scope: research only, no code changed.

## Question

HexChess ships a bespoke React + SVG board for Gliński's hexagonal chess
(91 cells, axial coords), with a custom retro/pixel theme and its own rules
engine, position editor, PGN export and AI. Should we replace any of it with an
off-the-shelf chess-UI library?

## Verdict

**Keep the bespoke React + SVG board. Do not adopt a chess-UI library for the
board.**

No mainstream chess-UI library renders hexagonal geometry — they are all built
for the 8×8 square board. The single library that _is_ hexagonal
(`@hexchess/hexchess-board`) is a canvas Web Component that bundles its own
engine and its own theming, so adopting it would mean discarding our pixel
theme and duplicating/removing the engine and serialization we already built.

Two narrow, low-cost options remain open and are listed at the end (a test
oracle, and a fallback if we ever drop the custom theme). Neither is needed now.

## Candidates

| Library                                           | Rendering                  | Geometry          | Engine                               | Theme/pieces               | Verdict                                                  |
| ------------------------------------------------- | -------------------------- | ----------------- | ------------------------------------ | -------------------------- | -------------------------------------------------------- |
| `@hexchess/hexchess-board` v2.0.0 (BSD-3)         | Canvas web component (Lit) | **Hex (Gliński)** | Built-in                             | CSS vars + `<slot>` pieces | Only credible drop-in; conflicts with our theme + engine |
| chessground (lichess)                             | DOM/SVG                    | 8×8 only          | none ("variant-friendly" but square) | CSS                        | Not hex; would need a full custom renderer               |
| react-chessboard (Clariity)                       | DOM + dnd-kit              | 8×8 only          | none                                 | CSS/pieces props           | Not hex ("custom dimensions" = 8×8 size only)            |
| chessboard.js / chessboardjsx                     | DOM/jQuery                 | 8×8 only          | none                                 | CSS                        | Not hex; jQuery-era                                      |
| `@mdwebb/react-chess`                             | chessground + chess.js     | 8×8 only          | chess.js                             | themes                     | Not hex                                                  |
| `@bedard/hexchess` (scottbedard/hexchess.ts, MIT) | none (**logic only**)      | Hex (Gliński)     | Full move/check/mate                 | n/a                        | Not UI; useful as a **test oracle**                      |

### `@hexchess/hexchess-board` — the one real candidate, and why it still loses

- Pros: the only production-grade hex board; canvas render is fast (~120 FPS
  drag claims); ships an engine; pieces overridable via `piece-<color>-<name>`
  slots; colours via `--hexchess-*` CSS custom properties; framework-agnostic.
- Cons for us:
  - **Canvas, not SVG.** Our pixel-art pieces and scanline/retro theme are SVG
    and CSS; a canvas board means re-supplying every piece as `<img>` art and
    giving up the current theming approach.
  - **Second engine.** It detects moves/check/mate itself, duplicating
    `src/rules` — we'd have to run both or delete ours.
  - **Not React-native.** It's a custom element; React use is a ref +
    `createElement`, no JSX ergonomics.
  - **Thin community / young.** ~1 star, 127 commits, open issues; a `lit`
    runtime dependency despite the "dependency-free" tagline.
  - FEN load/export is only loosely documented.

Net: it solves a problem we already solved, and undoes the parts of our
implementation that are actually differentiated (the retro theme + our
serialization).

## If we ever change course

1. **Test oracle (cheap, recommended eventually).** Add `@bedard/hexchess`
   (MIT, the engine behind hexchess.club, and the source of the FEN convention
   our `src/board/fen.ts` already follows) as a **devDependency** and
   cross-check our rules engine / FEN against it in tests. Additive, no
   runtime cost, no UI change.
2. **Full swap (only if we drop the custom theme).** Adopt
   `@hexchess/hexchess-board`, retire our SVG board + engine, and accept its
   canvas look. Not justified while the pixel theme is a product goal.

## Sources

- [@hexchess/hexchess-board (npm)](https://www.npmjs.com/package/@hexchess/hexchess-board) · [repo](https://github.com/hexagonchess/hexchess-board) · [docs](https://hexagonchess.github.io/hexchess-board/api/)
- [scottbedard/hexchess](https://github.com/scottbedard/hexchess) · [hexchess.club docs](https://docs.hexchess.club/) · [hexchess.ts](https://github.com/scottbedard/hexchess.ts)
- [react-chessboard](https://github.com/Clariity/react-chessboard) · [chessground](https://github.com/react-chess/chessground) · [@mdwebb/react-chess](https://github.com/matt-d-webb/react-chess)
