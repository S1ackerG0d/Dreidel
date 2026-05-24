'use strict';

const $ = (id) => document.getElementById(id);

let playerId = localStorage.getItem('bananagrams_player_id');
let state = null;
let evtSource = null;

// Selection: either a rack tile (place it) or a board tile (move it).
let selected = null; // { type:'rack', tileId } | { type:'board', r, c, tileId }

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

function renderBoard() {
  const n = state.gridSize;
  const board = $('board');
  board.style.gridTemplateColumns = `repeat(${n}, 30px)`;
  let html = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const tile = state.yourBoard[`${r},${c}`];
      if (tile) {
        html += `<div class="cell filled" data-r="${r}" data-c="${c}" data-tile="${tile.id}">${tile.letter}</div>`;
      } else {
        html += `<div class="cell target-ok" data-r="${r}" data-c="${c}"></div>`;
      }
    }
  }
  board.innerHTML = html;
  board.querySelectorAll('.cell').forEach((cell) => {
    cell.addEventListener('click', () => onCellClick(cell));
  });
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
      setStatus(selected ? 'Tile selected — click a board cell to place it.' : '');
    });
  });
}

async function onCellClick(cell) {
  const r = Number(cell.dataset.r);
  const c = Number(cell.dataset.c);
  const occupied = cell.classList.contains('filled');

  if (occupied) {
    // Clicking a placed tile: if we have a selection, ignore; otherwise pick it up.
    if (selected) { selected = null; renderRack(); }
    const res = await action('recall', { r, c });
    if (res.error) flashError(res.error);
    return;
  }

  // Empty cell.
  if (!selected) { setStatus('Select a tile from your rack first.'); return; }

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

  if (state.phase === 'verify') {
    $('verify-title').textContent = `🍌 ${claimant ? claimant.name : 'A player'} called BANANAS!`;
    $('verify-detail').textContent = 'Check the grid below — every word should be valid and connected. The host confirms the win or calls it rotten.';
    $('host-verify').classList.toggle('hidden', !isHost);
    $('host-gameover').classList.add('hidden');
  } else {
    const w = state.players.find((p) => p.id === state.winnerId);
    $('verify-title').textContent = `🎉 ${w ? w.name : 'Someone'} wins!`;
    $('verify-detail').textContent = 'Final grid:';
    $('host-verify').classList.add('hidden');
    $('host-gameover').classList.toggle('hidden', !isHost);
  }

  renderRevealBoard(r ? r.board : {});
}

function renderRevealBoard(board) {
  const keys = Object.keys(board);
  const el = $('reveal-board');
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

$('confirm-btn').addEventListener('click', () => action('confirmWin'));
$('rotten-btn').addEventListener('click', () => action('rotten'));
$('lobby-btn').addEventListener('click', () => action('toLobby'));

// Boot
if (playerId) connectEvents();
render();
