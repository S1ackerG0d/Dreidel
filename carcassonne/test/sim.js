'use strict';

// Engine tests: deterministic scoring scenarios plus a fuzz of full random
// games checking invariants (meeple conservation, tile counts, completion).
//
// The browser scripts are plain <script> files, so we load them into a
// shared vm context the same way a page would.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = vm.createContext({ console });
for (const file of ['tiles.js', 'engine.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
  vm.runInContext(src, context, { filename: file });
}

function run(code) {
  return vm.runInContext(code, context);
}

let failures = 0;
function check(cond, msg) {
  if (cond) { console.log('ok - ' + msg); }
  else { failures++; console.error('FAIL - ' + msg); }
}

// ---------------------------------------------------------------------------
// Scenario 1: complete a two-tile city, then score its farm at game end.
// ---------------------------------------------------------------------------
{
  run(`
    g = new Game([{name:'Anna',color:'red'},{name:'Ben',color:'blue'}], makeRng(1));
    // Anna closes the start tile's city with an E-cap facing west and claims it.
    g.drawn = { type: 'E', rot: 3 };
    if (!g.placeTile(1, 0)) throw new Error('city tile placement refused');
    if (!g.placeMeeple(0)) throw new Error('city meeple refused');
    g.endTurn();
  `);
  check(run('g.players[0].score') === 4, 'completed 2-tile city scores 4');
  check(run('g.players[0].meeples') === 7, 'city meeple returned on completion');

  run(`
    // Ben farms the field east of the start tile's road, touching that city.
    g.drawn = { type: 'U', rot: 0 };
    if (!g.placeTile(0, 1)) throw new Error('road tile placement refused');
    if (!g.placeMeeple(1)) throw new Error('farmer placement refused');
    g.endTurn();
    g.finishGame();
  `);
  check(run('g.players[1].score') === 3, 'farm next to 1 completed city scores 3');
  check(run('g.players[1].meeples') === 6, 'farmer stays on the board');
}

// ---------------------------------------------------------------------------
// Scenario 2: a road closed at both ends by junctions scores 1 per tile.
// ---------------------------------------------------------------------------
{
  run(`
    g = new Game([{name:'Anna',color:'red'},{name:'Ben',color:'blue'}], makeRng(2));
    g.drawn = { type: 'W', rot: 0 };
    if (!g.placeTile(0, -1)) throw new Error('junction placement refused');
    if (!g.placeMeeple(1)) throw new Error('road meeple refused'); // south leg
    g.endTurn();
  `);
  check(run('g.players[0].score') === 0, 'open road not scored yet');
  run(`
    g.drawn = { type: 'W', rot: 2 };
    if (!g.placeTile(0, 1)) throw new Error('second junction refused');
    claimed = g.meepleOptions();
  `);
  // The connecting road already carries Anna's meeple, so the matching leg
  // of the new junction must not be offered to Ben.
  const tileFi = run(`
    (() => {
      const t = g.tileAt(0, 1);
      return g.featureAtEdge(t, 'road', 0); // leg pointing north, into the road
    })()
  `);
  check(!run('claimed').includes(tileFi), 'occupied road is not a meeple option');
  run('g.endTurn();');
  check(run('g.players[0].score') === 3, 'completed 3-tile road scores 3');
  check(run('g.players[0].meeples') === 7, 'road meeple returned');
}

// ---------------------------------------------------------------------------
// Scenario 3: a cloister surrounded by 8 tiles scores 9.
// ---------------------------------------------------------------------------
{
  run(`
    g = new Game([{name:'Anna',color:'red'}], makeRng(3));
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        if (dx || dy) g.setTile(50 + dx, 50 + dy, 'B', 0);
    g.setTile(50, 50, 'B', 0);
    g.tileAt(50, 50).meeples[0] = 0;
    g.players[0].meeples--;
    g.placed = { x: 50, y: 50 };
    g.resolveCompletions();
    g.placed = null;
  `);
  check(run('g.players[0].score') === 9, 'surrounded cloister scores 9');
  check(run('g.players[0].meeples') === 7, 'cloister meeple returned');
}

// ---------------------------------------------------------------------------
// Fuzz: play full random games and check global invariants.
// ---------------------------------------------------------------------------
const games = 40;
let allOk = true;
const stats = { scores: [], boardSizes: [] };
for (let seed = 1; seed <= games; seed++) {
  const result = run(`
    (() => {
      const rng = makeRng(${seed});
      const nPlayers = 2 + Math.floor(rng() * 4);
      const players = [];
      for (let i = 0; i < nPlayers; i++) players.push({ name: 'P' + i, color: '#000' });
      const g = new Game(players, rng);
      let guard = 0;
      while (!g.over && g.drawn) {
        if (++guard > 500) throw new Error('game did not terminate');
        const moves = [];
        for (let r = 0; r < 4; r++) {
          for (const [x, y] of g.legalCells(g.drawn.type, r)) moves.push([r, x, y]);
        }
        if (!moves.length) throw new Error('drawn tile has no legal move');
        const [r, x, y] = moves[Math.floor(rng() * moves.length)];
        g.drawn.rot = r;
        if (!g.placeTile(x, y)) throw new Error('legal placement refused');
        const opts = g.meepleOptions();
        if (opts.length && rng() < 0.6) {
          if (!g.placeMeeple(opts[Math.floor(rng() * opts.length)])) {
            throw new Error('legal meeple refused');
          }
        }
        g.endTurn();
      }
      if (!g.over) throw new Error('game ended without finishing');
      // Meeple conservation: in supply + on board = 7 per player.
      let onBoard = 0;
      for (const t of g.board.values()) onBoard += Object.keys(t.meeples).length;
      const supply = g.players.reduce((a, p) => a + p.meeples, 0);
      if (onBoard + supply !== nPlayers * MEEPLES_PER_PLAYER) {
        throw new Error('meeples not conserved: ' + (onBoard + supply));
      }
      if (g.board.size + g.discards.length !== 72) {
        throw new Error('tiles lost: board ' + g.board.size + ' + discards ' + g.discards.length);
      }
      if (g.players.some((p) => p.score < 0 || !Number.isFinite(p.score))) {
        throw new Error('bad score');
      }
      return {
        board: g.board.size,
        discards: g.discards.length,
        topScore: Math.max(...g.players.map((p) => p.score)),
      };
    })()
  `);
  stats.scores.push(result.topScore);
  stats.boardSizes.push(result.board);
}
check(allOk, `${games} random games completed with invariants intact`);
const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
console.log(`   avg board size ${avg(stats.boardSizes)} tiles, avg winning score ${avg(stats.scores)}`);

if (failures) {
  console.error(`${failures} test failure(s)`);
  process.exit(1);
}
console.log('All engine tests passed.');
