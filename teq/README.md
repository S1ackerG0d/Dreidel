# 📈 That Escalated Quickly — LAN Party Edition

A multiplayer party game where mundane situations spiral completely out of control.
Host it on your own PC — everyone joins from their phone or laptop browser.
No app installs, no internet required, **zero dependencies**.

## Run it

```bash
node teq/server.js
```

The server prints addresses to share:

```
  📈  That Escalated Quickly server running!

  On this computer:   http://localhost:3600
  On your LAN:         http://192.168.1.42:3600
```

Tell everyone on your network to open the **LAN address** in their browser.

## How to play

Each round proceeds in three phases:

### 1. Write (90 seconds)
Everyone sees the same starting scenario — something small and ordinary:

> *You're at a quiet library and you accidentally knock over a single book…*

Each player secretly types how this situation spirals completely out of control.

### 2. Vote (45 seconds)
All responses are revealed **anonymously**. Players vote for their favourite —
you can't vote for your own.

### 3. Results
Votes are revealed along with who wrote each response.

**Scoring:**
- **1 point** per vote your response receives
- **+2 bonus points** if you got the most votes (sole winner of the round)

After all rounds, the player with the most points wins!

## Settings

- **Rounds:** 1–10 (default 5). Set in the lobby before the game starts.

## Notes

- 2–12 players. The first to join is the host.
- The game auto-advances between phases when everyone has submitted or voted,
  or after the timer runs out — whichever comes first.
- During results, the host can manually skip to the next round.
- Change the port: `PORT=8080 node teq/server.js`
