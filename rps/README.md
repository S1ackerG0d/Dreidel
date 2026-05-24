# ✊✋✌️ Rock Paper Scissors — LAN

A self-hosted Rock Paper Scissors for your network — and it scales past two
players. Everyone joins from a browser, throws simultaneously each round, and
the throws stay secret until all are locked in.

**Zero dependencies** — just Node.js 18+.

## Run it

```bash
node rps/server.js          # from the repo root
```

It prints addresses to share, e.g.:

```
  ✊✋✌️  Rock Paper Scissors server running!

  On this computer:   http://localhost:3400
  On your LAN:         http://192.168.1.42:3400
```

Share the **LAN address** with players on the same Wi-Fi. Change the port with
`PORT=8080 node rps/server.js`.

## How to play

1. Players join the lobby (2–12). The first to join is the **host**.
2. The host picks the target score (default 5) and starts the match.
3. Each round, everyone secretly throws **Rock**, **Paper**, or **Scissors**.
   Your throw is hidden — others only see that you've locked in.
4. Once everyone has locked in, all throws are revealed and scored:
   **you earn one point for every opponent your throw beats** that round.
5. The host clicks **Next round** to continue. **First to the target score
   wins** — if there's a tie at the top, play continues until it's broken.

### Scoring examples

- **2 players:** this is exactly normal RPS — beat your opponent, +1; tie or
  lose, +0.
- **More players:** throw Rock against three opponents who played
  Scissors, Scissors, Paper → you beat two of them, so **+2** this round.

## How it works

- Pure Node.js built-ins: an `http` server, Server-Sent Events for live state
  push, and a small JSON action endpoint. No `npm install` needed.
- **State is sent per player:** during the picking phase your choice is never
  transmitted to anyone else — opponents only see a "locked in" flag. All
  throws are included only once the round is revealed.
- A round reveals automatically as soon as every connected player has locked in.
