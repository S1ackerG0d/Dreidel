# 🍌 Bananagrams — LAN

A self-hosted version of [Bananagrams](https://en.wikipedia.org/wiki/Bananagrams),
the tile-rush word game. Each player races to arrange their own private hand of
letter tiles into a connected crossword. Everyone joins from a browser on your
network.

**Zero dependencies** — just Node.js 18+.

## Run it

```bash
node bananagrams/server.js          # from the repo root
```

It prints addresses to share, e.g.:

```
  🍌  Bananagrams server running!

  On this computer:   http://localhost:3300
  On your LAN:         http://192.168.1.42:3300
```

Share the **LAN address** with players on the same Wi-Fi. Change the port with
`PORT=8080 node bananagrams/server.js`.

## How to play

1. Players join the lobby (1–8). The first to join is the **host**.
2. The host hits **Split!** Everyone is dealt their starting tiles:
   - 2–4 players → 21 tiles each · 5–6 → 15 · 7–8 → 11.
3. Build a crossword on your private board: click a tile in your rack, then a
   board cell to place it. Click a placed tile to pick it back up (or use
   **Recall all**). All your tiles must connect into one grid.
4. **Peel** — when your rack is empty and your grid is connected, hit
   **Peel / Bananas**. Every player draws one tile from the bunch and the race
   continues.
5. **Dump** — stuck on a tile? Select it and **Dump** to return it to the bunch
   and draw 3 in its place (needs 3+ tiles left in the bunch).
6. **Bananas!** — when the bunch is too low to peel and you've used all your
   tiles, the same button calls **Bananas**. The game pauses and your grid is
   revealed for the group to check.
7. The host **confirms the win** 🎉, or — if a word is invalid — calls it a
   **Rotten banana**: that player is out, their tiles return to the bunch, and
   everyone else plays on.

## How it works

- Pure Node.js built-ins: an `http` server, Server-Sent Events for live state
  push, and a small JSON action endpoint. No `npm install` needed.
- The 144-tile bunch uses the official letter distribution and is shuffled
  server-side with a CSPRNG.
- **State is sent per player** — your rack and board are never transmitted to
  anyone else's browser; others see only your tile count. The full grid is
  revealed only when you call Bananas.
- The server referees the **mechanics**: tile ownership, the bunch, peels,
  dumps, and that a grid is fully **connected** (one crossword, no islands)
  before a peel or Bananas is allowed.

### A note on word checking

The server does **not** contain a dictionary, so it doesn't judge whether your
words are real — just like the physical game, the group eyeballs the winner's
grid on Bananas and the host confirms or calls "rotten." This keeps the project
dependency-free. Want automatic word validation? A dictionary word-list could be
dropped in and checked on Peel/Bananas — ask and it can be added.
