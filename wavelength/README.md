# 🎯 Wavelength — LAN

A self-hosted version of the party game **Wavelength** — just the wheel, no
hint-card deck. Each round one player is the **psychic**: only they can see
where the hidden target sits on the wheel. They make up their own spectrum
(e.g. *Cold ↔ Hot*), say a clue out loud that sits exactly on the target, and
everyone else turns a dial on their own screen to guess where the clue lands.

**Zero dependencies** — just Node.js 18+.

## Run it

```bash
node wavelength/server.js          # from the repo root
```

It prints addresses to share, e.g.:

```
  🎯  Wavelength server running!

  On this computer:   http://localhost:3900
  On your LAN:         http://192.168.1.42:3900
```

Share the **LAN address** with players on the same Wi-Fi. Change the port with
`PORT=8080 node wavelength/server.js`.

## How to play

1. Players join the lobby (2–12, best with 4+). The first to join is the
   **host**, who picks how many times everyone gets to be the psychic
   (default 2) and starts the game.
2. Each round one player is the **psychic** — the role rotates every round.
   Only the psychic's screen shows the hidden target and its scoring band.
3. There are no hint cards, so the psychic **invents a spectrum** — anything
   with two opposite ends ("Underrated ↔ Overrated", "Bad pizza topping ↔
   Great pizza topping"). They can type the two ends so they appear on
   everyone's wheel, or just announce them out loud.
4. The psychic says a clue that sits exactly where the target is (target near
   the *Hot* end of *Cold ↔ Hot*? Clue: "lava"), then opens guessing.
5. Every other player drags the red needle on their own wheel (or uses the
   slider) to where they think the clue sits, and locks in. Guesses stay
   secret until everyone has locked.
6. **Reveal!** The target band appears on every screen with all the guesses:

   | Your needle lands in… | Points |
   |-----------------------|--------|
   | Centre wedge          | **4**  |
   | Next wedge either side| **3**  |
   | Outer wedge either side| **2** |
   | Off the band          | 0      |

   The psychic scores as many points as their **best** guesser — vague clues
   hurt everyone, including you.
7. After all rounds (cycles × players), the **highest score wins**.

## How it works

- Pure Node.js built-ins: an `http` server, Server-Sent Events for live state
  push, and a small JSON action endpoint. No `npm install` needed.
- **The target is per-player state:** before the reveal it is only ever sent
  to the psychic's browser — guessers' clients never receive it. Guesses are
  likewise hidden from other players until the reveal.
- The wheel is an SVG semicircle (0–180°); the scoring band is five 9°
  wedges (2-3-4-3-2) around the target, which is always drawn fully on the
  wheel. The round reveals automatically once every connected guesser locks
  in, and the psychic or host can force an early reveal.
