# Hex Chess — UI / UX Report & UI Roadmap

Date: 2026-10-07 · Build: `dev` @ `f362f8d` (Rounds 14–15 merged: print-poster theme, theme
switch, PGN import, resign v4) · Method: production build (`vite preview`) driven in
Playwright at 1280×900 and 390×844, light + dark, hotseat and `#/play/<code>`, plus the
accessibility tree. Not covered: real two-player online session (no worker running
locally), touch devices, screen-reader walkthrough.

In flight while this was written: **t66 motion** (dvv1) and **t67 lobby + room origin**
(dvv2). Items they already own are marked _(t66)_ / _(t67)_.

---

## 1. Ratings

| Area               | Score        | One-line verdict                                                                                                          |
| ------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Visual identity    | **8 / 10**   | The poster/wireframe direction is distinctive and coherent; it now looks like _a product_, not a demo.                    |
| Board readability  | **6.5 / 10** | Sides read clearly in both themes; pieces still small, targets low-contrast in dark, no coordinates.                      |
| Layout & hierarchy | **4.5 / 10** | The board is the hero but sits at ~420 px under a dev-tool FEN form and a 12-control toolbar.                             |
| Interaction        | **5 / 10**   | Click-to-move works, but piece glyphs swallow clicks (only the cell rim selects). No drag, no premove.                    |
| Feedback & state   | **5.5 / 10** | Check/last-move/selection exist; game-state, clock and connection info are scattered and quiet.                           |
| Online play UX     | **3 / 10**   | Rooms work in code but are unreachable from the live site; a room opens as "spectator, reconnecting" with 7 dead buttons. |
| Mobile             | **4 / 10**   | Board starts ~555 px down; cells ≈30 px (below 44 px tap target); toolbar wraps to 4 rows.                                |
| Accessibility      | **6 / 10**   | Real buttons, radiogroup theme switch, reduced-motion respected; 91 tab stops and cells that don't announce their piece.  |
| Motion             | **2 / 10**   | Only a cell transition and clock pulse today _(t66 in progress)_.                                                         |
| **Overall UI**     | **6 / 10**   | Strong look.                                                                                                              |
| **Overall UX**     | **4.5 / 10** | Flow and layout haven't caught up with the look.                                                                          |

---

## 2. What works (keep)

- **Two-mood theme.** Light (cream, ink, terracotta, cobalt) and dark (wireframe) feel like
  one brand. The offset orange board shadow and the grid paper are the signature; protect them.
- **Theme switch** (System / Light / Dark) is a proper radiogroup, persists, and avoids a flash
  on load.
- **Piece silhouettes.** The new path-based glyphs read at small sizes; black = orange in dark,
  ink/orange in light. Sides are distinguishable at a glance in both themes.
- **Rules feedback.** Legal targets, the selection hex ring (now follows the hex), check
  highlight, and PGN import errors via an inline alert (no `alert()`).
- **Type pairing.** Space Grotesk headings with Space Mono labels fits the poster brief.

---

## 3. Bugs found in this pass

| #   | Severity | Issue                                                                                                                                                                                                                                     | Owner                          |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| B1  | **High** | Clicking a piece glyph does not select it: the piece `<svg role="img">` intercepts the pointer, so only the thin cell rim is clickable. Verified with `elementFromPoint` → piece path, no selection; clicking the polygon directly works. | sent to dvv1 as a t66 addendum |
| B2  | Medium   | Legal-target dot in dark mode is mid-grey on near-black (<3:1 non-text contrast).                                                                                                                                                         | t66 addendum                   |
| B3  | Medium   | Online room route shows the full hotseat toolbar with 7 disabled controls (New game, Undo, AI, Depth, Resign, Offer draw, Play online) before any connection.                                                                             | t67 / follow-up                |
| B4  | Medium   | Before the socket connects, the header says "You are spectator". It should say "Connecting…" until the server assigns a seat.                                                                                                             | t67                            |
| B5  | Low      | A faint square box renders over f6 on the remote route (focus/selection remnant).                                                                                                                                                         | follow-up                      |
| B6  | Low      | The piece legend row under the board has no label and wraps to two lines on mobile; it reads like captured pieces.                                                                                                                        | follow-up                      |
| B7  | Low      | Hotseat status line says "white wins — resignation" while the banner says "Black resigned".                                                                                                                                               | t67                            |

---

## 4. Polish (P1, small and high-value)

1. **Board size.** Make the board the largest thing on screen:
   `min(92vw, 72vh, 760px)` on desktop and full-bleed on mobile. Scale pieces to ~72% of
   cell height.
2. **Move the FEN loader out of the main flow.** Put it behind an "Advanced" disclosure or
   in a Tools menu with Load/Export PGN. It's a developer tool sitting above the board.
3. **Toolbar hierarchy.** Split controls into three groups:
   - Primary: New game, Undo.
   - Game actions: Resign, Offer draw. Show these only while a game is live.
   - Tools menu: AI, depth, PGN, FEN, theme.

   One primary button style (filled ink or orange). Everything else ghost.

4. **Status as a component.** One status bar above the board with turn, check, result, and
   (online) clock and connection state. Today these pieces are spread over three places.
5. **Board coordinates.** Add file letters a–l under the bottom edge and rank numbers on the
   left edge, in Space Mono, `--ink-dim`. Notation players need them.
6. **Move list beside the board on desktop.** Two-column layout ≥1024 px: board left, then a
   side rail with status, clocks, moves and actions. Clicking a move should preview that
   position.
7. **Captured-pieces tray** replacing the unlabeled legend: show material per side with a
   +N material delta.
8. **Contrast pass:**
   - Check `--ink-dim` text on cream.
   - Use terracotta only for large text (3.7:1, already documented).
   - Bring every non-text UI element to ≥3:1.

## 5. Modernize (P2, product-level UX)

1. **Home screen.** Three big poster cards: _Play a friend here_ (hotseat), _Play the
   computer_, _Play online_. Each opens the right mode instead of toggles on one toolbar.
   This is where the field-guide artifact's look should carry over.
2. **Online lobby** _(t67)_:
   - Create room, share the link, join by code.
   - Show seat and presence: "Waiting for opponent", "Opponent disconnected — 30 s to
     reconnect".
   - Rematch button at game end that swaps colours.
3. **Drag to move**, alongside click-to-move. Use pointer events, show a ghost piece, snap to
   the nearest legal hex, cancel on Escape or drop outside.
4. **Premove** in online games: one queued move, shown as a dashed arrow, cancelled by
   clicking any empty cell.
5. **Arrows and highlights.** Right-click drag draws an arrow and right-click marks a cell.
   Analysis-friendly, and expected by chess players.
6. **Game review.** After a game, step through moves with ←/→ and jump to start or end.
   PGN export sits here.
7. **Onboarding for Gliński rules.** First-run overlay or a "How pieces move" sheet reusing
   the field-guide movement stars, plus a hover tip on any piece showing its rays. Most
   players have never seen hex chess.
8. **Sound (optional, off by default):** move, capture, check and low-time ticks, muted when
   the tab is hidden.
9. **Settings sheet.** One place for theme, sound, motion (system / reduced / full), and
   board orientation (auto-flip for black, or fixed).
10. **Accessibility:**
    - Use a roving tabindex so the board is one tab stop and arrow keys move between cells.
    - Cell labels should include the occupant ("f5, white pawn").
    - Announce moves via `aria-live` ("White pawn f5 to f6").
    - Add a text move input (type `f6`) as an alternative to pointing.

## 6. Motion roadmap

Principles:

- Crisp and mechanical, like print registration. No springs or bounce, and no blur.
- Animate transform and opacity only.
- Tokens: `--motion-fast 120ms`, `--motion-base 200ms`, `--motion-slow 320ms`,
  `--ease-out cubic-bezier(.2,.7,.2,1)`.
- Everything is gated on `prefers-reduced-motion` _(t66 implements the base layer)_.

| Tier         | Moment      | Motion                                                                                                             |
| ------------ | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Core _(t66)_ | Move        | FLIP slide source→destination, 200 ms ease-out; AI and remote moves animate the same way                           |
| Core _(t66)_ | Capture     | Captured piece scales to 0.85 and fades under the arriving piece, 120 ms                                           |
| Core _(t66)_ | Select      | Hex ring draws in (stroke-dashoffset); legal targets fade in staggered by distance, ≤120 ms total                  |
| Core _(t66)_ | Check       | King cell double pulse on the checking move, then holds static                                                     |
| Core _(t66)_ | Promotion   | Pawn slides, then the new piece scales in, 120 ms                                                                  |
| Core _(t66)_ | Theme       | View Transitions cross-fade; instant fallback                                                                      |
| Core _(t66)_ | Buttons     | 1–2 px press offset with the shadow collapsing (poster offset look)                                                |
| Next         | Game end    | Banner drops in with a registration-offset effect (orange layer lags the ink by 2 px, 320 ms); losing king tips 8° |
| Next         | New game    | Pieces drop into place file by file, 20 ms stagger, ≤400 ms total                                                  |
| Next         | Online      | Opponent-move arrival pulse on the destination; clock hand-off slide; "opponent connected" dot pop                 |
| Next         | Last move   | Thin orange trail line from source to destination that fades over 600 ms                                           |
| Later        | Home cards  | Wireframe grid perspective tilt on hover (CSS 3D, ≤4°), poster cards slide in on load                              |
| Later        | Review mode | Scrubbing through moves animates pieces at 0.5× duration; holding an arrow key fast-forwards with no animation     |

## 7. Suggested sequencing

| Round     | UI work                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| R16 (now) | t66 motion core + B1/B2 · t67 lobby, room origin, reconnect UX, B4, B7                                                                |
| R17       | P1 polish 1–6: board size, FEN to Tools, toolbar groups, status bar, coordinates, two-column layout · B3, B5, B6                      |
| R18       | Home screen, captured tray, rematch, game review, keyboard roving tabindex and live announcements                                     |
| R19       | Drag-to-move, premove, arrows; Gliński onboarding sheet; next-tier motion                                                             |
| R20       | Settings sheet, sound, home-card motion; contrast and a11y audit; mobile tap-target pass (44 px via board scale and hit-area padding) |

Deploying the worker (owner's Cloudflare token) and the Pages `VITE_ROOM_ORIGIN` variable
are prerequisites for any online UX to reach users. Both are owner actions; see
`CF_DEPLOY.md`.
