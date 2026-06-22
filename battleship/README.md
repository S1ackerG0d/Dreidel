# 🚢 Battleship — LAN Party Edition

A two-player [Battleship](https://en.wikipedia.org/wiki/Battleship_(game)) duel
you host on your own PC. Both admirals join from their phone or laptop browser
on the same network — no app installs, no internet required, **zero
dependencies**.

Each player secretly places a fleet on a hidden 10×10 grid, then you take turns
calling shots at each other's waters. The server never reveals a ship to the
other player until it has been sunk, so the fog of war is real.

## Requirements

- Node.js 18 or newer (`node --version` to check)
- Both players on the same LAN / Wi-Fi as the host

## Run it

```bash
node battleship/server.js
```

The server prints the addresses to share, for example:

```
  🚢  Battleship server running!

  On this computer:   http://localhost:3800
  On your LAN:         http://192.168.1.42:3800
```

Both players open the **LAN address**, enter a name, and the duel begins.

### Change the port

```bash
PORT=8080 node battleship/server.js
```

## How to play

1. **Join** — the first two players take the helm; the first to join is the host.
2. **Place your fleet** — you each get five ships:

   | Ship       | Length |
   |------------|--------|
   | Carrier    | 5      |
   | Battleship | 4      |
   | Cruiser    | 3      |
   | Submarine  | 3      |
   | Destroyer  | 2      |

   Pick a ship, press **Rotate** (or the `R` key) to switch between horizontal
   and vertical, then click a cell to drop it. Click again to reposition. Use
   **Auto-place** to scatter the whole fleet at random, or **Clear** to start
   over. Hit **Ready** once all five are down.

3. **Fire** — when both fleets are ready, the host fires first. On your turn,
   click an unexplored cell in the enemy's waters:
   - **•** a miss (open water)
   - **✸** a hit
   - a ship's outline is revealed only when every one of its cells is hit —
     *"You sank my Battleship!"*

   One shot per turn, then control passes to your opponent.

4. **Win** by sinking the entire enemy fleet. The host can start a **Rematch**
   or return everyone to the lobby.

## Notes

- Strictly two players — Battleship is a duel.
- An accidental refresh keeps your seat and your fleet (you reconnect
  automatically).
- The whole game runs as a single shared room — perfect for one match.
