# 🃏 Card Table — LAN

A self-hosted, shared **52-card deck** for your network. Players join from any
browser; the dealer shuffles and deals, players draw, play cards onto a face-up
table pile, or pick cards back up. Your hand is private — everyone else sees
only how many cards you hold. It's a flexible foundation for almost any card
game (poker, rummy, Go Fish, etc.) — the server enforces card integrity, you
bring the rules.

**Zero dependencies** — just Node.js 18+.

## Run it

```bash
node cards/server.js          # from the repo root
```

The server prints addresses to share, e.g.:

```
  🃏  Card table server running!

  On this computer:   http://localhost:3100
  On your LAN:         http://192.168.1.42:3100
```

Share the **LAN address** with players on the same Wi-Fi. Change the port with
`PORT=8080 node cards/server.js`.

## What you can do

| Who    | Action                | Effect                                            |
|--------|-----------------------|---------------------------------------------------|
| Dealer | New deck & shuffle    | Builds a fresh 52-card deck and shuffles it       |
| Dealer | Shuffle deck          | Reshuffles the current draw pile                  |
| Dealer | Deal N to each        | Deals N cards round-robin to every player         |
| Dealer | Collect all & reshuffle | Returns every card to the deck and reshuffles   |
| Anyone | Draw from deck        | Takes the top deck card into your hand            |
| Anyone | Play a card           | Click a card in your hand to put it on the table  |
| Anyone | Take from table       | Picks the top table card into your hand           |

- The first player to join is the **dealer**. Up to 10 players.
- The deck always totals 52 cards across the draw pile, hands, and table.
- Single shared table — perfect for one game at a time.

## How it works

- Pure Node.js built-ins: an `http` server, Server-Sent Events for live state
  push, and a small JSON action endpoint. No `npm install` needed.
- Cards are dealt and shuffled server-side with a CSPRNG (`crypto.randomInt`),
  so shuffles are genuinely unbiased and clients can't peek at the deck order.
- State is sent **per player**, so your hand's cards are never transmitted to
  anyone else's browser.
