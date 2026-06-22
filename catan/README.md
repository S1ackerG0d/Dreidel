# 🎲 Settlers — LAN Party Edition

A self-hosted **Settlers of Catan** (core base game) you run on your own PC.
Everyone on the same network joins from a phone or laptop browser, taps a hex
board to build, and races to **10 victory points**.

**Zero dependencies** — just Node.js 18+.

## Run it

```bash
node catan/server.js          # from the repo root
```

It prints addresses to share, e.g.:

```
  🎲  Settlers — LAN edition server running!

  On this computer:   http://localhost:3500
  On your LAN:         http://192.168.1.42:3500
```

Share the **LAN address** with players on the same Wi-Fi. Change the port with
`PORT=8080 node catan/server.js`.

## How to play

1. Players join the lobby (**2–4**). The first to join is the **host** and
   starts the game.
2. **Setup** runs as a snake draft: in order, then reverse order, each player
   taps the board to place **2 settlements** and **2 roads**. Your second
   settlement pays out one resource from each terrain it touches.
3. On your turn:
   - **Roll the dice.** Every hex showing the rolled number pays its owners —
     1 card per adjacent settlement, 2 per city. The hex under the robber pays
     nothing.
   - **Roll a 7** and the robber moves: anyone holding more than 7 cards
     discards half, then the roller moves the robber to a new hex and steals a
     random card from a player there.
   - **Build, buy and trade** with the buttons:

     | Build | Cost |
     |-------|------|
     | Road | 🌲 🧱 |
     | Settlement | 🌲 🧱 🐑 🌾 |
     | City (upgrades a settlement) | 🌾🌾 ⛏️⛏️⛏️ |
     | Development card | 🐑 🌾 ⛏️ |

   - **Trade with the bank** at 4:1, or 3:1 / 2:1 if you've built on the
     matching **harbour**.
   - **End your turn.**

   **Sending resources to other players:** tap **🎁 Send resources** any time
   during the game to hand cards to another player. There's no in-app offer
   screen — agree the deal out loud on voice chat, then each side sends their
   half. Every transfer is written to the public log so the whole table can see
   who gave what.

### Scoring & special cards

- **Settlement** = 1 point, **City** = 2 points.
- **Longest Road** (+2): first player with 5+ connected road segments; an
  opponent's settlement built on a junction can cut your road.
- **Largest Army** (+2): first player to play 3 Knights; stolen by whoever plays
  more.
- **Development cards:** Knight (move the robber), Road Building (2 free roads),
  Year of Plenty (take 2 cards from the bank), Monopoly (take all of one
  resource from everyone), and hidden Victory Point cards. A card can't be
  played the same turn you buy it, and only one card may be played per turn.
- **First to 10 victory points on their own turn wins.** Hidden VP cards count
  and are revealed at the win.

### Official 2-player variant ("Catan for Two")

With **exactly two** players in the lobby, the host can tick **"Official
2-player variant"** before starting. It adapts the table the way the official
*Traders & Barbarians* "Catan for Two" rules do, so two players get a full game
instead of a half-empty board:

- **Neutral players.** The two unused colours become imaginary blockers. Each
  starts with one settlement and gains one more piece — a road, or a settlement
  when its road network can reach a free corner — every time *you* build a road
  or settlement. They never produce, trade or score, but their pieces block
  building and can cut a longest road, keeping the map tight.
- **Double dice.** On your turn you roll **twice**, and the two totals are
  forced to differ — so each turn pays out on two different numbers.
- **Trade tokens.** Each player starts with **5**. Build a settlement on the
  **coast** for **+1**, or on a corner touching **both the desert and the
  coast** for **+3** (during setup too). You can also **sacrifice a Knight**
  card for **+2**.
- **Token actions.** Spend tokens on your turn for **🤝 Forced trade** (take two
  random cards from your opponent and give two of your choice back) or **🥷 Move
  robber** (move the robber and steal without rolling a 7). An action costs **1
  token while you trail or are tied**, **2 tokens while you lead**.

The Knight-sacrifice reward and the exact corners/edges neutral pieces grow into
are our own sensible reading of the variant — neutral expansion is chosen
automatically rather than placed by hand.

## How it works

- Pure Node.js built-ins: an `http` server, Server-Sent Events for live state
  push, and a small JSON action endpoint. No `npm install` needed.
- The board's hexes, 54 vertices and 72 edges are derived once from a radius-2
  hex layout by de-duplicating shared corners; each game then rolls a fresh
  terrain, number-token and harbour arrangement on top.
- **State is sent per player:** your resource and development cards stay
  private — everyone else only sees your card *counts*. The board, scores and
  the set of legal moves for the active player are shared so the client can
  highlight where you may build.
