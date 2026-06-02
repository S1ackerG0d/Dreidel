'use strict';

const $ = (id) => document.getElementById(id);

let playerId = localStorage.getItem('bananagrams_player_id');
let state = null;
let evtSource = null;

// Selection: either a rack tile (place it) or a board tile (move it).
let selected = null; // { type:'rack', tileId } | { type:'board', r, c, tileId }

// Visible window into the (much larger) playing grid. The board grows outward
// by panning/expanding this window rather than rendering the whole grid.
let view = null; // { top, left, rows, cols }
const DEFAULT_VIEW_SIZE = 15;

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

function flashError(msg) {
  $('status-line').textContent = msg;
  $('status-line').style.color = 'var(--danger)';
}
function setStatus(msg) {
  $('status-line').textContent = msg;
  $('status-line').style.color = '';
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
  localStorage.setItem('bananagrams_player_id', playerId);
  connectEvents();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function playerTags(p) {
  const tags = [];
  if (p.id === state.hostId) tags.push('<span class="tag host">host</span>');
  if (p.id === playerId) tags.push('<span class="tag you">you</span>');
  if (p.out) tags.push('<span class="tag out">out</span>');
  if (!p.connected) tags.push('<span class="tag offline">offline</span>');
  return tags.join('');
}

function render() {
  const known = state && state.players.some((p) => p.id === playerId);
  if (playerId && state && !known) {
    localStorage.removeItem('bananagrams_player_id');
    playerId = null;
    if (evtSource) evtSource.close();
  }

  if (!state || state.phase !== 'playing') view = null;

  const showJoin = !playerId || !known;
  const inGame = state && (state.phase === 'playing') && !showJoin;
  const inVerify = state && (state.phase === 'verify' || state.phase === 'gameover') && !showJoin;

  $('join-screen').classList.toggle('hidden', !showJoin);
  $('lobby-screen').classList.toggle('hidden', !(state && state.phase === 'lobby' && !showJoin));
  $('game-screen').classList.toggle('hidden', !inGame);
  $('verify-screen').classList.toggle('hidden', !inVerify);

  if (!state || showJoin) return;
  if (state.phase === 'lobby') renderLobby();
  else if (state.phase === 'playing') renderGame();
  else renderVerify();
}

function renderLobby() {
  const isHost = playerId === state.hostId;
  $('start-btn').classList.toggle('hidden', !isHost);
  $('wait-host').classList.toggle('hidden', isHost);
  $('lobby-players').innerHTML = state.players
    .map((p) => `<li><span><span class="pname">${escapeHtml(p.name)}</span>${playerTags(p)}</span></li>`)
    .join('');
}

function renderGame() {
  $('bunch-count').textContent = state.bunchCount;
  $('rack-count').textContent = state.yourRack.length;
  $('peel-btn').disabled = state.yourRack.length > 0;

  renderBoard();
  renderRack();

  $('players').innerHTML = state.players.map((p) =>
    `<li class="${p.out ? 'out' : ''}">
      <span><span class="pname">${escapeHtml(p.name)}</span>${playerTags(p)}</span>
      <span class="count">${p.tileCount} tiles</span>
    </li>`).join('');

  $('log').innerHTML = state.log.slice().reverse()
    .map((l) => `<li>${escapeHtml(l.message)}</li>`).join('');
}

function defaultView(n) {
  const size = Math.min(DEFAULT_VIEW_SIZE, n);
  const start = Math.floor((n - size) / 2);
  return { top: start, left: start, rows: size, cols: size };
}

// Keep the visible window covering every placed tile plus a one-cell margin,
// so the word chain always has an empty edge cell to extend into. This only
// ever grows the window — manual shrinking is handled in applyGridChange.
function fitView(board, n) {
  if (!view) view = defaultView(n);
  const keys = Object.keys(board);
  if (!keys.length) return;
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const k of keys) {
    const [r, c] = k.split(',').map(Number);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    minC = Math.min(minC, c); maxC = Math.max(maxC, c);
  }
  const top = Math.max(0, Math.min(view.top, minR - 1));
  const left = Math.max(0, Math.min(view.left, minC - 1));
  const bottom = Math.min(n - 1, Math.max(view.top + view.rows - 1, maxR + 1));
  const right = Math.min(n - 1, Math.max(view.left + view.cols - 1, maxC + 1));
  view = { top, left, rows: bottom - top + 1, cols: right - left + 1 };
}

// Manually add/remove a row or column on one edge. Adding pans/grows the window
// (up to the grid bound); removing shrinks it, but fitView immediately re-grows
// it if the removal would have hidden a tile or its one-cell margin.
function applyGridChange(action, side) {
  const n = state.gridSize;
  fitView(state.yourBoard, n);
  const before = `${view.top},${view.left},${view.rows},${view.cols}`;
  if (action === 'add') {
    if (side === 'top' && view.top > 0) { view.top--; view.rows++; }
    else if (side === 'bottom' && view.top + view.rows < n) { view.rows++; }
    else if (side === 'left' && view.left > 0) { view.left--; view.cols++; }
    else if (side === 'right' && view.left + view.cols < n) { view.cols++; }
  } else {
    if (side === 'top' && view.rows > 1) { view.top++; view.rows--; }
    else if (side === 'bottom' && view.rows > 1) { view.rows--; }
    else if (side === 'left' && view.cols > 1) { view.left++; view.cols--; }
    else if (side === 'right' && view.cols > 1) { view.cols--; }
  }
  fitView(state.yourBoard, n);
  renderBoard();
  if (`${view.top},${view.left},${view.rows},${view.cols}` === before) {
    setStatus(action === 'add'
      ? 'Grid is already at its maximum size.'
      : 'Can’t shrink past your word chain.');
  } else {
    setStatus('');
  }
}

function updateGridControls(n) {
  const set = (side, dis) => {
    const b = document.querySelector(`[data-grid="add"][data-side="${side}"]`);
    if (b) b.disabled = dis;
  };
  set('top', view.top <= 0);
  set('bottom', view.top + view.rows >= n);
  set('left', view.left <= 0);
  set('right', view.left + view.cols >= n);
}

function renderBoard() {
  const n = state.gridSize;
  fitView(state.yourBoard, n);
  const { top, left, rows, cols } = view;
  const board = $('board');
  board.style.gridTemplateColumns = `repeat(${cols}, 30px)`;
  let html = '';
  for (let r = top; r < top + rows; r++) {
    for (let c = left; c < left + cols; c++) {
      const tile = state.yourBoard[`${r},${c}`];
      if (tile) {
        const sel = selected && selected.type === 'board' && selected.r === r && selected.c === c;
        html += `<div class="cell filled${sel ? ' selected' : ''}" data-r="${r}" data-c="${c}" data-tile="${tile.id}">${tile.letter}</div>`;
      } else {
        html += `<div class="cell target-ok" data-r="${r}" data-c="${c}"></div>`;
      }
    }
  }
  board.innerHTML = html;
  board.querySelectorAll('.cell').forEach((cell) => {
    cell.addEventListener('click', () => onCellClick(cell));
  });
  updateGridControls(n);
}

function renderRack() {
  const rack = $('rack');
  if (!state.yourRack.length) {
    rack.innerHTML = '<span class="empty-msg">Rack empty — Peel when your grid is complete!</span>';
    return;
  }
  rack.innerHTML = state.yourRack.map((t) => {
    const sel = selected && selected.type === 'rack' && selected.tileId === t.id;
    return `<div class="tile ${sel ? 'selected' : ''}" data-tile="${t.id}">${t.letter}</div>`;
  }).join('');
  rack.querySelectorAll('.tile').forEach((el) => {
    el.addEventListener('click', () => {
      selected = (selected && selected.type === 'rack' && selected.tileId === el.dataset.tile)
        ? null
        : { type: 'rack', tileId: el.dataset.tile };
      renderRack();
      renderBoard();
      setStatus(selected ? 'Tile selected — click a board cell to place it.' : '');
    });
  });
}

async function onCellClick(cell) {
  const r = Number(cell.dataset.r);
  const c = Number(cell.dataset.c);
  const occupied = cell.classList.contains('filled');

  if (occupied) {
    // If the same board tile is already selected, that second click recalls it.
    if (selected && selected.type === 'board' && selected.r === r && selected.c === c) {
      selected = null;
      const res = await action('recall', { r, c });
      if (res.error) flashError(res.error);
      else setStatus('');
      renderBoard();
      renderRack();
      return;
    }
    // Otherwise, select this placed tile so the next empty-cell click moves it.
    selected = { type: 'board', r, c, tileId: cell.dataset.tile };
    renderBoard();
    renderRack();
    setStatus('Tile selected — click an empty cell to move it, or click the tile again to send it back to your rack.');
    return;
  }

  // Empty cell.
  if (!selected) { setStatus('Select a tile from your rack — or a placed tile to move it.'); return; }

  let res;
  if (selected.type === 'rack') {
    res = await action('place', { tileId: selected.tileId, r, c });
  } else {
    res = await action('move', { fromR: selected.r, fromC: selected.c, toR: r, toC: c });
  }
  selected = null;
  if (res.error) flashError(res.error);
  else setStatus('');
}

function renderVerify() {
  const isHost = playerId === state.hostId;
  const r = state.reveal;
  const claimant = state.players.find((p) => p.id === state.bananaClaimId) ||
                   state.players.find((p) => p.id === state.winnerId);

  const single = $('reveal-board');
  const all = $('reveal-all');

  if (state.phase === 'verify') {
    $('verify-title').textContent = `🍌 ${claimant ? claimant.name : 'A player'} called BANANAS!`;
    $('verify-detail').textContent = 'Check the grid below — every word should be valid and connected. The host confirms the win or calls it rotten.';
    $('host-verify').classList.toggle('hidden', !isHost);
    $('host-gameover').classList.add('hidden');
    single.classList.remove('hidden');
    all.classList.add('hidden');
    renderRevealBoard(single, r ? r.board : {});
    return;
  }

  // Game over: show every player's final board.
  const w = state.players.find((p) => p.id === state.winnerId);
  $('verify-title').textContent = w ? `🎉 ${w.name} wins!` : 'Game over';
  $('verify-detail').textContent = 'Final grids from every player:';
  $('host-verify').classList.add('hidden');
  $('host-gameover').classList.toggle('hidden', !isHost);
  single.classList.add('hidden');
  all.classList.remove('hidden');
  renderAllBoards(state.allBoards || []);
}

function renderAllBoards(boards) {
  const el = $('reveal-all');
  if (!boards.length) { el.innerHTML = '<p class="hint">No boards to show.</p>'; return; }
  el.innerHTML = boards.map((b, i) => {
    const tags = [];
    if (b.isWinner) tags.push('<span class="tag winner">winner</span>');
    if (b.out) tags.push('<span class="tag out">out</span>');
    if (b.playerId === playerId) tags.push('<span class="tag you">you</span>');
    return `
      <div class="reveal-entry">
        <h3 class="reveal-name"><span>${escapeHtml(b.name)}</span>${tags.join('')}</h3>
        <div id="reveal-entry-${i}" class="board reveal"></div>
      </div>
    `;
  }).join('');
  boards.forEach((b, i) => renderRevealBoard($(`reveal-entry-${i}`), b.board));
}

function renderRevealBoard(el, board) {
  const keys = Object.keys(board);
  if (!keys.length) { el.innerHTML = '<span class="hint">No tiles.</span>'; return; }
  // Crop to the used bounding box so the reveal isn't a huge empty grid.
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const k of keys) {
    const [r, c] = k.split(',').map(Number);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    minC = Math.min(minC, c); maxC = Math.max(maxC, c);
  }
  const cols = maxC - minC + 1;
  el.style.gridTemplateColumns = `repeat(${cols}, 30px)`;
  let html = '';
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const t = board[`${r},${c}`];
      html += t
        ? `<div class="cell filled">${t.letter}</div>`
        : `<div class="cell"></div>`;
    }
  }
  el.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
$('join-btn').addEventListener('click', doJoin);
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

$('start-btn').addEventListener('click', () => action('start'));

$('peel-btn').addEventListener('click', async () => {
  const res = await action('peel');
  if (res.error) flashError(res.error);
});
$('dump-btn').addEventListener('click', async () => {
  if (!selected || selected.type !== 'rack') {
    setStatus('Select a tile in your rack to dump.');
    return;
  }
  const res = await action('dump', { tileId: selected.tileId });
  selected = null;
  if (res.error) flashError(res.error);
});
$('recall-all-btn').addEventListener('click', async () => {
  // Pick up every placed tile back to the rack.
  for (const key of Object.keys(state.yourBoard)) {
    const [r, c] = key.split(',').map(Number);
    await action('recall', { r, c });
  }
  selected = null;
});

document.querySelectorAll('[data-grid]').forEach((btn) => {
  btn.addEventListener('click', () => applyGridChange(btn.dataset.grid, btn.dataset.side));
});

$('confirm-btn').addEventListener('click', () => action('confirmWin'));
$('rotten-btn').addEventListener('click', () => action('rotten'));
$('lobby-btn').addEventListener('click', () => action('toLobby'));

// Boot
if (playerId) connectEvents();
render();
