# 📈 That Escalated Quickly — LAN Party Edition

A cooperative party game where players secretly hold number cards 1–10 and must
answer a question in a way that hints at their number — without ever saying it.
Host it on your own PC, everyone joins from their phone or laptop browser.
No app installs, no internet required, **zero dependencies**.

## Run it

```bash
node teq/server.js
```

```
  📈  That Escalated Quickly server running!

  On this computer:   http://localhost:3600
  On your LAN:         http://192.168.1.42:3600
```

## How to play

### Setup
- 3–10 players. The first to join is the host.
- Each round, one player is the **Organizer** (role rotates clockwise).

### Each round

1. **Deal** — Everyone receives a secret number card (1–10). You can see your
   own number but not anyone else's.

2. **Answer** — The Organizer reads a question aloud. Players answer one at a
   time (starting with the Organizer, going clockwise). Your answer must
   **hint at your number** on the scale without giving it away directly.
   - 1 = least extreme / weakest / worst
   - 10 = most extreme / strongest / best

   You may **not** say your number, say words like "the best," "the worst,"
   "halfway," or "middle," or change your answer after saying it.

3. **Organize** — After everyone has answered, the Organizer tries to reveal
   the number cards **from lowest to highest**. They click each player (in
   the order they believe is correct); the card flips immediately when clicked.

4. **Score the round:**
   - All cards revealed in correct order → **Good Card** ✓
   - A card is revealed out of order → **Mistake**

### Allowed mistakes

| Players | Mistakes allowed |
|---------|-----------------|
| 3       | 1               |
| 4–5     | 0               |
| 6–10    | 1               |

When a mistake is allowed: all currently revealed cards are discarded, and the
Organizer continues ordering the remaining players from scratch. If mistakes
exceed the limit, the round ends as a **Bad Card** ✗.

### Winning and losing

The whole group wins or loses together:

- **3 Good Cards** → everyone wins 🎉
- **3 Bad Cards** → everyone loses 💀

## Tips

- Middle numbers (4–6) are the hardest to hint at — don't be too obvious.
- Think about how the Organizer interprets the scale, not just what sounds
  clever.
- Listen carefully to earlier answers; they give you context for calibrating
  your own.

## Notes

- If a player leaves mid-game, the game resets to the lobby.
- Change the port: `PORT=8080 node teq/server.js`
