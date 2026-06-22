'use strict';

const $ = (id) => document.getElementById(id);

let playerId = localStorage.getItem('battleship_player_id');
let state = null;
let evtSource = null;

// Placement UI: which ship is selected and current orientation.
let selectedShip = 'Carrier';
let horizontal = true;

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------
async function action(type, extra = {}) {
  const res = await fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, playerId, ...extra }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { error: json.error || 'Something went wrong.' };
  return json;
}

function connectEvents() {
  if (!playerId) return;
  if (evtSource) evtSource.close();
  evtSource = new EventSource('/api/events?playerId=' + encodeURIComponent(playerId));
  evtSource.onmessage = (e) => {
    state = JSON.parse(e.data);
    setConnection(true);
    render();
  };
  evtSource.onerror = () => setConnection(false);
}

function setConnection(online) {
  const el = $('connection');
  el.textContent = online ? 'Connected' : 'Reconnecting…';
  el.className = 'status ' + (online ? 'online' : 'offline');
}

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------
async function doJoin() {
  const name = $('name-input').value.trim();
  if (!name) { $('join-error').textContent = 'Please enter a name.'; return; }
  $('join-btn').disabled = true;
  const result = await action('join', { name });
  $('join-btn').disabled = false;
  if (result.error) { $('join-error').textContent = result.error; return; }
  playerId = result.playerId;
  localStorage.setItem('battleship_player_id', playerId);
  connectEvents();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const SHIP_SIZES = { Carrier: 5, Battleship: 4, Cruiser: 3, Submarine: 3, Destroyer: 2 };
const SHIP_ORDER = ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer'];

function colLetter(c) { return String.fromCharCode(65 + c); }

// Build a SIZE x SIZE board of <div class="cell"> with optional headers.
function buildBoard(container, grid, { onClick, ghost } = {}) {
  const n = state.size;
  container.style.setProperty('--n', n);
  container.innerHTML = '';

  // top-left corner + column headers
  container.appendChild(headerCell(''));
  for (let c = 0; c < n; c++) container.appendChild(headerCell(colLetter(c)));

  for (let r = 0; r < n; r++) {
    container.appendChild(headerCell(String(r + 1)));
    for (let c = 0; c < n; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell ' + (grid ? grid[r][c] : 'water');
      cell.dataset.r = r;
      cell.dataset.c = c;
      if (ghost) {
        cell.addEventListener('mouseenter', () => paintGhost(container, r, c));
        cell.addEventListener('mouseleave', () => clearGhost(container));
      }
      if (onClick) cell.addEventListener('click', () => onClick(r, c));
      container.appendChild(cell);
    }
  }
}

function headerCell(text) {
  const h = document.createElement('div');
  h.className = 'cell header';
  h.textContent = text;
  return h;
}

function cellAt(container, r, c) {
  return container.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
}

// ---------------------------------------------------------------------------
// Placement ghost preview
// ---------------------------------------------------------------------------
function ghostCells(r, c) {
  const size = SHIP_SIZES[selectedShip];
  const cells = [];
  for (let i = 0; i < size; i++) {
    const rr = horizontal ? r : r + i;
    const cc = horizontal ? c + i : c;
    cells.push({ r: rr, c: cc });
  }
  return cells;
}

function paintGhost(container, r, c) {
  if (!selectedShip) return;
  const n = state.size;
  const cells = ghostCells(r, c);
  const fits = cells.every((p) => p.r >= 0 && p.r < n && p.c >= 0 && p.c < n);
  for (const p of cells) {
    const el = cellAt(container, p.r, p.c);
    if (el) el.classList.add(fits ? 'ghost' : 'ghost-bad');
  }
}
function clearGhost(container) {
  container.querySelectorAll('.ghost, .ghost-bad').forEach((el) =>
    el.classList.remove('ghost', 'ghost-bad'));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  const known = state && state.players.some((p) => p.id === playerId);
  if (playerId && state && !known) {
    localStorage.removeItem('battleship_player_id');
    playerId = null;
    if (evtSource) evtSource.close();
  }

  const showJoin = !playerId || !known;
  const phase = state && state.phase;

  $('join-screen').classList.toggle('hidden', !showJoin);
  $('lobby-screen').classList.toggle('hidden', !(phase === 'lobby' && !showJoin));
  $('place-screen').classList.toggle('hidden', !(phase === 'placing' && !showJoin));
  $('play-screen').classList.toggle('hidden', !(phase === 'playing' && !showJoin));
  $('over-screen').classList.toggle('hidden', !(phase === 'gameover' && !showJoin));

  if (!state || showJoin) return;
  if (phase === 'lobby') renderLobby();
  else if (phase === 'placing') renderPlacing();
  else if (phase === 'playing') renderPlay();
  else if (phase === 'gameover') renderOver();
}

function playerTags(p) {
  const tags = [];
  if (p.id === state.hostId) tags.push('<span class="tag host">host</span>');
  if (p.id === playerId) tags.push('<span class="tag you">you</span>');
  if (p.ready) tags.push('<span class="tag ready">ready</span>');
  if (!p.connected) tags.push('<span class="tag offline">offline</span>');
  return tags.join(' ');
}

function renderLog(elId) {
  $(elId).innerHTML = state.log.slice().reverse()
    .map((l) => `<li>${escapeHtml(l.message)}</li>`).join('');
}

function renderLobby() {
  const isHost = playerId === state.hostId;
  $('lobby-players').innerHTML = state.players
    .map((p) => `<li><span class="left"><span class="pname">${escapeHtml(p.name)}</span> ${playerTags(p)}</span></li>`)
    .join('');
  $('host-lobby').classList.toggle('hidden', !isHost);
  $('wait-host').classList.toggle('hidden', isHost);
  if (isHost) $('start-btn').disabled = state.players.length < 2;
}

function renderPlacing() {
  const you = state.you;
  const ready = you.ready;

  // Ship palette
  $('ship-palette').innerHTML = SHIP_ORDER.map((name) => {
    const placed = you.placedShips.includes(name);
    const sel = name === selectedShip;
    return `<button class="ship-chip${sel ? ' selected' : ''}${placed ? ' placed' : ''}" data-ship="${name}" ${ready ? 'disabled' : ''}>
      <span class="ship-name">${name}</span>
      <span class="ship-pips">${'▪'.repeat(SHIP_SIZES[name])}</span>
      ${placed ? '<span class="check">✓</span>' : ''}
    </button>`;
  }).join('');
  $('ship-palette').querySelectorAll('.ship-chip').forEach((b) =>
    b.addEventListener('click', () => { selectedShip = b.dataset.ship; render(); }));

  $('orient').textContent = horizontal ? 'horizontal' : 'vertical';
  ['rotate-btn', 'auto-btn', 'clear-btn'].forEach((id) => { $(id).disabled = ready; });

  buildBoard($('place-board'), you.board, {
    ghost: !ready,
    onClick: ready ? null : (r, c) => {
      action('placeShip', { shipName: selectedShip, r, c, horizontal }).then((res) => {
        if (res.error) flash('place-hint', res.error);
      });
    },
  });

  const allPlaced = you.placedShips.length === SHIP_ORDER.length;
  $('place-hint').textContent = ready
    ? 'Fleet locked in. Waiting for your opponent…'
    : 'Select a ship, rotate if needed, then click a cell to drop it. Click again to reposition.';
  $('ready-btn').classList.toggle('hidden', ready);
  $('ready-btn').disabled = !allPlaced;
  $('unready-btn').classList.toggle('hidden', !ready);

  const opp = state.opponent;
  $('ready-state').textContent = opp
    ? (opp.ready ? `${opp.name} is ready.` : `Waiting on ${opp.name} to place their fleet…`)
    : 'Waiting for an opponent…';

  renderLog('place-log');
}

function renderPlay() {
  const you = state.you;
  const opp = state.opponent;
  const myTurn = state.turnId === playerId;

  $('turn-label').textContent = myTurn ? 'Your turn — fire!' : `${opp ? opp.name : 'Opponent'} is taking aim…`;
  $('turn-hint').textContent = myTurn
    ? 'Click an unexplored cell in enemy waters.'
    : 'Hold tight — incoming fire may land on your fleet.';

  $('enemy-title').textContent = opp ? `${opp.name}'s waters` : 'Enemy waters';

  buildBoard($('enemy-board'), opp ? opp.board : null, {
    onClick: myTurn ? (r, c) => {
      const cellState = opp.board[r][c];
      if (cellState !== 'unknown') return;
      action('fire', { r, c }).then((res) => {
        if (res.error) flash('turn-hint', res.error);
      });
    } : null,
  });
  $('enemy-board').classList.toggle('targetable', myTurn);

  buildBoard($('own-board'), you.board, {});

  $('enemy-fleet').innerHTML = fleetStatusHtml(opp ? opp.fleet : [], true);
  $('own-fleet').innerHTML = fleetStatusHtml(you.fleet, false);

  renderLog('play-log');
}

function fleetStatusHtml(fleet, enemy) {
  return fleet.map((s) => {
    const cls = s.sunk ? 'sunk' : '';
    let detail;
    if (s.sunk) detail = 'SUNK';
    else if (enemy) detail = `${'▪'.repeat(s.size)}`;
    else detail = `${s.hits}/${s.size} hit`;
    return `<li class="${cls}"><span>${escapeHtml(s.name)}</span><span class="fleet-detail">${detail}</span></li>`;
  }).join('');
}

function renderOver() {
  const isHost = playerId === state.hostId;
  const won = state.winnerId === playerId;
  $('winner-text').textContent = won ? '🏆 Victory! The enemy fleet is sunk.' : '💀 Defeat — your fleet was destroyed.';
  $('winner-text').className = won ? 'win' : 'lose';
  $('rematch-btn').classList.toggle('hidden', !isHost);
  $('tolobby-btn').classList.toggle('hidden', !isHost);

  buildBoard($('over-enemy-board'), state.opponent ? state.opponent.board : null, {});
  buildBoard($('over-own-board'), state.you.board, {});
  renderLog('over-log');
}

// Briefly show a transient message in a hint element.
let flashTimer = null;
function flash(elId, msg) {
  const el = $(elId);
  const prev = el.textContent;
  el.textContent = msg;
  el.classList.add('flash-error');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.classList.remove('flash-error'); render(); }, 1800);
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
$('join-btn').addEventListener('click', doJoin);
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

$('start-btn').addEventListener('click', () => action('start'));
$('rotate-btn').addEventListener('click', () => { horizontal = !horizontal; render(); });
$('auto-btn').addEventListener('click', () => action('autoPlace'));
$('clear-btn').addEventListener('click', () => action('clearBoard'));
$('ready-btn').addEventListener('click', () => action('ready'));
$('unready-btn').addEventListener('click', () => action('unready'));
$('rematch-btn').addEventListener('click', () => action('rematch'));
$('tolobby-btn').addEventListener('click', () => action('toLobby'));

// Press R to rotate during placement.
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && state && state.phase === 'placing' && state.you && !state.you.ready) {
    horizontal = !horizontal;
    render();
  }
});

// Boot
if (playerId) connectEvents();
render();
