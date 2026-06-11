# 🏰 Carcassonne — LAN edition

The classic tile-laying game, complete with the **72 tiles of the original base
game** (all 24 tile types, A–X, in their official distribution) and **farmer
scoring**. For 2–5 players on the same network: the server owns the game, and
everyone joins from their own phone or laptop browser. Zero dependencies —
plain Node.js.

## Run it

```bash
node carcassonne/server.js
```

The server prints the addresses to share, for example:

```
  🏰  Carcassonne — LAN edition server running!

  On this computer:   http://localhost:3700
  On your LAN:         http://192.168.1.42:3700
```

Everyone opens the **LAN address** in their browser, enters a name, and the
first player to join (the host) presses **Start game**. You can change the
port with `PORT=8080 node carcassonne/server.js`.

## How to play

1. **Place the tile.** On your turn a tile is drawn from the bag (71 remain
   after the start tile) — everyone sees it in the sidebar. Legal cells are
   highlighted on your screen — edges must match: road to road, city to city,
   field to field. Press **R** (or the button) to rotate. Drag to pan, scroll
   to zoom. A tile that fits nowhere is discarded and a new one drawn, per the
   official rules. While it's not your turn, you spectate the board live.
2. **Place a meeple (optional).** White markers show where you may claim a
   feature of the tile you just placed: a **road**, **city**, **cloister**, or
   **field**. A feature already claimed by any meeple is never offered. Each
   player has 7 meeples. Farmers are drawn lying down and stay on the board
   until the end of the game.
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

An accidental refresh keeps your seat — you reconnect automatically. The game
runs as a single shared room, perfect for one table.

## Files

- `server.js` — LAN game server: single shared room, lobby, SSE state
  broadcasts, and action validation. The authoritative rules run here.
- `public/tiles.js` — data for the 24 tile types: edges, features, farm
  half-edges and which cities each field touches (the heart of farmer scoring).
- `public/engine.js` — rules engine: placement legality, flood-fill over
  connected features, meeple legality, live and end-game scoring. Used by the
  server and the tests.
- `public/render.js` — procedural canvas art for tiles and meeples (no image
  assets).
- `public/client.js`, `public/index.html`, `public/style.css` — the browser
  client: renders server state and forwards input.

## Tests

```bash
node carcassonne/test/validate.js    # tile set: 72 tiles, edge/farm consistency
node carcassonne/test/sim.js         # scoring scenarios + 40 random full games
node carcassonne/test/server.test.js # lobby, permissions, full game via the action API
node carcassonne/test/screenshot.js  # optional visual check (needs Playwright)
```
