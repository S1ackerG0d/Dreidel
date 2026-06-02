# 🏰 Carcassonne — LAN Party Edition

A simplified, dependency-free Carcassonne tile game you host on your own
machine. Everyone on the same LAN joins from a browser — no app installs,
no internet, **zero dependencies**.

## Run it

```bash
node carcassonne/server.js
```

Default port: `3700` (override with `PORT=…`). Visit
`http://localhost:3700` on the host machine, or share a LAN address with
players on the same network.

## Players

2 – 5 players. Each starts with 7 meeples.

## How a turn works

1. The server draws a tile from the deck and shows it to the current
   player. They can rotate it (left / right buttons) before placing.
2. The board highlights every empty square where the tile fits at its
   current rotation. **All edges that touch a neighbour must match**
   (city ↔ city, road ↔ road, field ↔ field). Tap a highlighted square
   to lay the tile.
3. After placing, the player may optionally put one of their meeples on
   a road, city, or cloister on the tile they just placed — but only if
   that feature (including any tiles it's now connected to) doesn't
   already hold someone else's meeple. Tap a glowing spot, or skip.
4. Any feature that completes as a result of the placement is scored
   immediately and all meeples on it return to their owners.

If the drawn tile can't legally be placed anywhere on the board, it's
discarded and the player draws again. The game ends when the deck is
exhausted; incomplete features holding meeples still score (at the
reduced "partial" rate).

## Scoring

| Feature  | Complete                        | Incomplete (end of game)        |
|----------|----------------------------------|---------------------------------|
| Road     | 1 point per tile                 | 1 point per tile                |
| City     | 2 points per tile                | 1 point per tile                |
| Cloister | 9 (the tile + 8 neighbours)      | 1 + 1 per surrounding tile      |

Majority rule: when a feature scores, the player with the most meeples
on it gets all the points. If multiple players tie for the most, each
of them scores the full amount.

## Tile set

This implementation uses a 59-tile subset of the base game:

- 1 starting tile (city north, road east-west)
- Roads: 8 straight, 9 curves, 4 T-junctions, 1 crossroads
- Cloisters: 4 plain, 2 with a road
- Cities of every shape: edges, opposites, adjacents, three-sided, full,
  plus city-and-road combinations

Pennants and farms are not modelled — this is a deliberately tightened
version of the base game so a session finishes in 20–30 minutes.

## State persistence

State lives in memory only — there's nothing to install or migrate, but
restarting the server resets the table.
