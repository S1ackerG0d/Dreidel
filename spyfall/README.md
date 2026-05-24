# 🕵️ Spyfall — LAN

A self-hosted version of the hidden-role party game [Spyfall](https://en.wikipedia.org/wiki/Spyfall_(party_game)).
Everyone joins from a browser on your network — each player secretly receives the
**same location plus a unique role**, except one random player who is the **Spy**
and doesn't know the location.

Non-spies ask each other questions to expose the spy without naming the location
outright; the spy bluffs along and tries to deduce where everyone is.

**Zero dependencies** — just Node.js 18+.

## Run it

```bash
node spyfall/server.js          # from the repo root
```

It prints addresses to share, e.g.:

```
  🕵️  Spyfall server running!

  On this computer:   http://localhost:3200
  On your LAN:         http://192.168.1.42:3200
```

Share the **LAN address** with players on the same Wi-Fi. Change the port with
`PORT=8080 node spyfall/server.js`.

Best played with everyone in the same room or on a voice call — the app handles
the secret roles, the shared location list, the timer, and the voting; the
questioning happens out loud.

## How a round goes

1. Players join the lobby (3–8 players). The first to join is the **host**.
2. The host picks a round length (default 8 minutes) and starts.
3. Everyone privately sees their card — a location + role, or **"You are the
   Spy."** The full list of possible locations is shown to all (the spy uses it
   to guess).
4. A random player is named to ask the first question. Players question each
   other out loud.
5. A round ends when one of these happens:
   - **Accusation:** tap a player to accuse them. Everyone else votes; the vote
     must be **unanimous** to convict. A non-unanimous vote just continues play.
   - **Spy guesses:** the spy may reveal and guess the location at any time.
   - **Time runs out**, or the host ends the round early.

## Scoring

| Outcome                                    | Points                                   |
|--------------------------------------------|------------------------------------------|
| Spy is correctly convicted                 | Accuser **+2**, every other non-spy **+1** |
| Group convicts the wrong (innocent) player | Spy **+4**                               |
| Spy reveals and guesses the location right | Spy **+4**                               |
| Spy reveals and guesses wrong              | Every non-spy **+1**                     |
| Time runs out / host ends the round        | Spy **+2**                               |

Scores carry across rounds. The host can start the next round, return to the
lobby, or reset scores from the reveal screen.

## How it works

- Pure Node.js built-ins: an `http` server, Server-Sent Events for live state
  push (including a server-synced countdown), and a small JSON action endpoint.
  No `npm install` needed.
- Roles, the location, and the spy are chosen server-side with a CSPRNG.
- **State is sent per player**: the location is never included in the spy's data
  stream — only the public list of candidate locations is — so the spy genuinely
  cannot peek.
- Locations and their roles live in [`locations.js`](locations.js); add your own
  by editing that file.
