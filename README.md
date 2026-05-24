# 🕎 LAN Party Games

Self-hosted multiplayer party games for your own Linux PC. Everyone on the same
network joins from their phone or laptop browser — no app installs, no internet
required, **zero dependencies**. Two games live here:

- **🕎 Dreidel** — `node server.js` (port 3000) — the full dreidel game below.
- **🃏 Card Table** — `node cards/server.js` (port 3100) — a shared 52-card deck
  with dealing, drawing, a face-up table pile, and private hands. See
  [`cards/README.md`](cards/README.md).

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
