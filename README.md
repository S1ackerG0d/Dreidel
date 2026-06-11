# 🕎 LAN Party Games

Self-hosted multiplayer party games for your own Linux PC. Everyone on the same
network joins from their phone or laptop browser — no app installs, no internet
required, **zero dependencies**. Eight games live here:

- **🕎 Dreidel** — `node server.js` (port 3000) — the full dreidel game below.
- **🃏 Card Table** — `node cards/server.js` (port 3100) — a shared 52-card deck
  with dealing, drawing, a face-up table pile, and private hands. See
  [`cards/README.md`](cards/README.md).
- **Spyfall** — `node spyfall/server.js` (port 3200) — the hidden-role game where
  everyone shares a location except one secret spy. Secret role cards, a synced
  timer, accusation voting, and scoring. See [`spyfall/README.md`](spyfall/README.md).
- **Bananagrams** — `node bananagrams/server.js` (port 3300) — the tile-rush word
  game; each player builds a private crossword, with Peel/Dump/Bananas and a
  connected-grid referee. See [`bananagrams/README.md`](bananagrams/README.md).
- **Rock Paper Scissors** — `node rps/server.js` (port 3400) — simultaneous secret
  throws for 2–12 players with round-robin scoring, first to a target score wins.
  See [`rps/README.md`](rps/README.md).
- **🎲 Settlers** — `node catan/server.js` (port 3500) — Settlers of Catan (core
  base game) for 2–4 players: a clickable hex board, dice and resources, roads /
  settlements / cities, the robber, development cards, harbours, and longest
  road / largest army. First to 10 points wins. See
  [`catan/README.md`](catan/README.md).
- **📈 That Escalated Quickly** — `node teq/server.js` (port 3600) — cooperative
  party game for 3–10 players. Each player holds a secret number 1–10 and answers
  a question hinting at it; the Organizer must sort everyone lowest to highest.
  Earn 3 Good Cards together before collecting 3 Bad Cards. See
  [`teq/README.md`](teq/README.md).
- **🏰 Carcassonne** — `node carcassonne/server.js` (port 3700) — the tile-laying
  game for 2–5 players with the full original 72-tile set. Draw a tile, rotate
  it so the edges line up, place a meeple to claim a road / city / cloister —
  or lay a farmer in a field for end-game scoring — as the map grows. Everyone
  watches the board live from their own browser. See
  [`carcassonne/README.md`](carcassonne/README.md).

---

# 🕎 Dreidel — LAN Party Edition

A multiplayer [dreidel](https://en.wikipedia.org/wiki/Dreidel) game you host on
your own Linux PC. Everyone on the same network joins from their phone or laptop
browser — no app installs, no internet required, **zero dependencies**.

## Requirements

- Node.js 18 or newer (`node --version` to check)
- All players on the same LAN / Wi-Fi as the host

## Run it

```bash
node server.js
```

(or `npm start`)

The server prints the addresses to share, for example:

```
  🕎  Dreidel game server running!

  On this computer:   http://localhost:3000
  On your LAN:         http://192.168.1.42:3000
```

Tell everyone on your network to open the **LAN address** in their browser.
The host opens it too, enters a name, and gets a **Start game** button.

### Change the port

```bash
PORT=8080 node server.js
```

### Firewall note

If players can't connect, your firewall may be blocking the port. On most
distros:

```bash
sudo ufw allow 3000/tcp        # Ubuntu/Debian (ufw)
sudo firewall-cmd --add-port=3000/tcp   # Fedora/RHEL (firewalld)
```

## How to play

The dreidel has four Hebrew letters. On your turn you spin, and:

| Letter | Name  | Action               |
|--------|-------|----------------------|
| נ      | Nun   | Nothing happens      |
| ג      | Gimel | Take the whole pot   |
| ה      | Hey   | Take half the pot    |
| ש      | Shin  | Put one in the pot   |

- Everyone starts with the same amount of gelt (coins) — the host sets this in
  the lobby (default 10).
- Each round everyone antes one coin into the pot; whenever the pot empties,
  everyone antes again.
- Run out of gelt and you're out. **Last player with gelt wins.**

## Notes

- Up to 8 players. The first to join is the host.
- The game runs as a single shared room — perfect for one table / party.
- An accidental refresh during a game keeps your seat (you'll reconnect
  automatically).
