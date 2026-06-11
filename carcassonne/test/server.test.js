'use strict';

// End-to-end test of the LAN server's action layer (no HTTP): lobby flow,
// permission checks, and a complete random game driven purely through
// handleAction, the same entry point the browser client uses.

const { handleAction, getRoom, resetRoom } = require('../server.js');

let failures = 0;
function check(cond, msg) {
  if (cond) { console.log('ok - ' + msg); }
  else { failures++; console.error('FAIL - ' + msg); }
}

// ---- lobby & permissions ----------------------------------------------------

resetRoom();
check(handleAction({ type: 'start', playerId: 'nobody' }).status === 400,
  'unknown player is rejected');

const anna = handleAction({ type: 'join', name: 'Anna' }).json;
const ben = handleAction({ type: 'join', name: 'Ben' }).json;
check(!!anna.playerId && !!ben.playerId, 'two players can join');
check(anna.state.hostId === anna.playerId, 'first player is host');
check(handleAction({ type: 'join', name: '' }).status === 400, 'empty name rejected');
check(handleAction({ type: 'start', playerId: ben.playerId }).status === 403,
  'only the host can start');

const started = handleAction({ type: 'start', playerId: anna.playerId });
check(started.status === 200 && started.json.state.phase === 'playing', 'host starts the game');
check(handleAction({ type: 'join', name: 'Late' }).status === 400,
  'no joining a running game');
check(started.json.state.board.length === 1, 'board starts with the start tile');
check(started.json.state.deckLeft === 70 && !!started.json.state.drawn,
  '70 tiles in the bag, one in hand, one on the board');

// ---- turn enforcement ---------------------------------------------------------

function currentId() {
  const room = getRoom();
  return room.players[room.game.current].id;
}
function otherId() {
  const room = getRoom();
  return room.players.find((p) => p.id !== currentId()).id;
}

{
  const r = handleAction({ type: 'place', playerId: otherId(), x: 1, y: 0 });
  check(r.status === 400 && r.json.error === 'Not your turn.',
    'placing out of turn is rejected');
}
{
  const r = handleAction({ type: 'place', playerId: currentId(), x: 40, y: 40 });
  check(r.status === 400, 'placing on a detached cell is rejected');
}

// ---- play a full random game through the API ----------------------------------

let guard = 0;
let sawUndo = false;
let sawRotate = false;
while (getRoom().phase === 'playing') {
  if (++guard > 800) { check(false, 'game did not terminate'); break; }
  const pid = currentId();
  let st = handleAction({ type: 'rotate', playerId: pid }).json.state;
  sawRotate = true;
  // Hunt for a rotation with legal cells (every drawn tile has one somewhere).
  let tries = 0;
  while ((!st.legalCells || !st.legalCells.length) && tries++ < 4) {
    st = handleAction({ type: 'rotate', playerId: pid }).json.state;
  }
  if (!st.legalCells || !st.legalCells.length) { check(false, 'no legal cells offered'); break; }
  const [x, y] = st.legalCells[Math.floor(Math.random() * st.legalCells.length)];
  st = handleAction({ type: 'place', playerId: pid, x, y }).json.state;
  if (st.placed) {
    // Exercise undo once, then re-place.
    if (!sawUndo) {
      st = handleAction({ type: 'undo', playerId: pid }).json.state;
      check(!st.placed && !st.board.some((t) => t.x === x && t.y === y),
        'undo removes the placed tile');
      st = handleAction({ type: 'place', playerId: pid, x, y }).json.state;
      sawUndo = true;
    }
    const opts = st.meepleOptions || [];
    if (opts.length && Math.random() < 0.5) {
      handleAction({ type: 'meeple', playerId: pid, fi: opts[Math.floor(Math.random() * opts.length)] });
    } else {
      handleAction({ type: 'skip', playerId: pid });
    }
  }
}

check(sawRotate && sawUndo, 'rotate and undo were exercised');
check(getRoom().phase === 'gameover', 'game reaches gameover');
{
  const g = getRoom().game;
  check(g.board.size + g.discards.length === 72, 'all 72 tiles accounted for');
  const st = handleAction({ type: 'rotate', playerId: anna.playerId });
  check(st.status === 400, 'no actions after game over');
  const standings = g.standings();
  check(standings.length === 2 && standings[0].score >= standings[1].score,
    'standings are sorted');
}

// ---- back to lobby --------------------------------------------------------------

{
  const r = handleAction({ type: 'newGame', playerId: ben.playerId });
  check(r.status === 403, 'only host returns to lobby');
  const ok = handleAction({ type: 'newGame', playerId: anna.playerId });
  check(ok.status === 200 && getRoom().phase === 'lobby' && getRoom().players.length === 2,
    'host returns everyone to the lobby, seats kept');
}

if (failures) {
  console.error(`${failures} test failure(s)`);
  process.exit(1);
}
console.log('All server tests passed.');
