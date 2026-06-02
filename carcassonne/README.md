# 🏰 Carcassonne — LAN Party Edition

A dependency-free Carcassonne tile game you host on your own machine.
Everyone on the same LAN joins from a browser — no app installs, no
internet, **zero dependencies**.

## Run it

```bash
node carcassonne/server.js
```

Default port: `3700` (override with `PORT=…`). Visit
`http://localhost:3700` on the host, or share a LAN address with players
on the same network.

## Players

2 – 5 players. Each starts with 7 meeples.

## Turn flow

1. The server draws a tile from the deck and shows it to the current
   player. Rotate it with the left / right buttons.
2. The board highlights every empty square where the tile fits at its
   current rotation. **All edges that touch a neighbour must match** —
   city ↔ city, road ↔ road, field ↔ field. Tap a highlighted square to
   lay the tile.
3. After placing, the player may optionally put a meeple on a road,
   city, cloister, or field on the tile they just placed — but only if
   the feature (including any tiles it's now connected to) doesn't
   already hold someone else's meeple. Field claims (farmers) lie down;
   they stay on the field until the game ends. Tap a glowing spot or
   skip.
4. Roads, cities, and cloisters that complete because of the placement
   score immediately and release their meeples. Fields stay claimed.

If the drawn tile can't legally be placed anywhere, it's discarded and
the player draws again. The game ends when the deck is exhausted;
remaining incomplete features holding meeples score one last time.

## Scoring

| Feature  | While playing (complete)     | At end of game (incomplete) |
|----------|------------------------------|-----------------------------|
| Road     | 1 point per tile             | 1 point per tile            |
| City     | 2 × tiles + 2 × pennants     | 1 × tiles + 1 × pennants    |
| Cloister | 9 (tile + 8 neighbours)      | 1 + 1 per surrounding tile  |
| Field    | — (never scores mid-game)    | 3 points × distinct **completed** cities the field touches |

Majority rule: when a feature scores, the player with the most meeples
on it gets all the points. If two or more players tie for the most,
each tied player scores the full amount.

## Tile set & farms

This implementation aims at the canonical Hans im Glück base game:
**72 tiles** (1 starter + 71 in the deck) across 22 unique templates,
with the standard ratios for cloisters, full cities, single-edge
cities, opposite/adjacent connected & separate cities, three-sided
cities, every city + road combination, straight roads (8), curve roads
(9), T-junctions (4), and the crossroads (1). About 6 city tiles carry
pennants.

Per-template counts are a best-effort reconstruction — the sandbox this
was developed in blocked Wikipedia/Wikicarpedia/BGG, so exact counts may
not match Hans im Glück to the last copy. The total is 72 and the mix
plays correctly.

**Farms** are fully modelled. Each tile's field is decomposed into the
grid corner positions it occupies; fields merge across tile borders
through both shared corners; a field's farmer scores 3 points per
distinct completed city the field touches at end of game. T-junctions,
crossroads, and city-and-road tiles split the field exactly as on a
physical tile.

**Junctions** at T- and cross-roads use a special "junction" centre
that prevents the meeting road stubs from merging into a single road —
each branch is its own road feature, as in the rules.

## Tile representation

Each template is a 3×3 grid (`C`=city, `R`=road, `F`=field, `J`=road
junction) plus optional cloister and pennant flags. Connected
components over orthogonal grid neighbours yield the road, city, and
field features automatically — see `tiles.js`.

## State persistence

State lives in memory only — restarting the server resets the table.
