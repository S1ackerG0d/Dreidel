# 🏰 Carcassonne

The classic tile-laying game, complete with the **72 tiles of the original base
game** (all 24 tile types, A–X, in their official distribution) and **farmer
scoring**. For 2–5 players, hot-seat style: everyone shares one screen and
passes the mouse. Zero dependencies — plain Node.js and a browser.

## Run it

```bash
node carcassonne/server.js
```

Then open the printed address (default `http://localhost:3700`). Anyone on the
LAN can open the page too, but each browser tab runs its own board — gather
round one screen for a shared game.

You can change the port with `PORT=8080 node carcassonne/server.js`.

## How to play

1. **Place the tile.** On your turn a tile is drawn from the bag (71 remain
   after the start tile). Legal cells are highlighted — edges must match:
   road to road, city to city, field to field. Press **R** (or the button) to
   rotate. Drag to pan, scroll to zoom. A tile that fits nowhere is discarded
   and a new one drawn, per the official rules.
2. **Place a meeple (optional).** White markers show where the active player
   may claim a feature of the tile just placed: a **road**, **city**,
   **cloister**, or **field**. A feature already claimed by any meeple is
   never offered. Each player has 7 meeples. Farmers are drawn lying down and
   stay on the board until the end of the game.
3. **Scoring** happens automatically:

   | Feature  | Completed during play             | At game end (incomplete) |
   |----------|-----------------------------------|--------------------------|
   | Road     | 1 / tile                          | 1 / tile                 |
   | City     | 2 / tile, +2 per pennant          | 1 / tile, +1 per pennant |
   | Cloister | 9 (tile + 8 neighbours)           | 1 + neighbouring tiles   |
   | Field    | —                                 | **3 per completed city** the field touches |

   Ties on a feature score full points for every tied player. Meeples return
   to their owners when a feature is completed; farmers never return.
4. The game ends when the bag is empty; highest total wins.

## Files

- `public/tiles.js` — data for the 24 tile types: edges, features, farm
  half-edges and which cities each field touches (the heart of farmer scoring).
- `public/engine.js` — rules engine: placement legality, flood-fill over
  connected features, meeple legality, live and end-game scoring. Runs in the
  browser and under Node (for tests).
- `public/render.js` — procedural canvas art for tiles and meeples (no image
  assets).
- `public/ui.js`, `public/index.html`, `public/style.css` — the hot-seat UI.
- `server.js` — tiny static file server.

## Tests

```bash
node carcassonne/test/validate.js   # tile set: 72 tiles, edge/farm consistency
node carcassonne/test/sim.js        # scoring scenarios + 40 random full games
node carcassonne/test/screenshot.js # optional visual check (needs Playwright)
```
