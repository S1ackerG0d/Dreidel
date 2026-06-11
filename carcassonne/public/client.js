'use strict';

// ---------------------------------------------------------------------------
// LAN client: joins the shared room, receives authoritative state over SSE,
// and sends actions. All rules live on the server; this file only renders
// state (board canvas, sidebar, lobby/game-over overlays) and forwards input.
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

let playerId = localStorage.getItem('carcassonne_player_id');
let state = null;
let evtSource = null;
let dismissedGameOver = false;

const canvas = $('board');
const ctx = canvas.getContext('2d');
let view = { panX: 0, panY: 0, scale: 96 };
let viewCentered = false;
let hoverCell = null;
let drag = null;

// ---- networking -------------------------------------------------------------

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

async function act(type, extra) {
  const r = await action(type, extra);
  $('error').textContent = r.error || '';
  return r;
}

function connectEvents() {
  if (!playerId) return;
  if (evtSource) evtSource.close();
  evtSource = new EventSource('/api/events?playerId=' + encodeURIComponent(playerId));
  evtSource.onmessage = (e) => {
    state = JSON.parse(e.data);
    setConnection(true);
    onState();
  };
  evtSource.onerror = () => setConnection(false);
}

function setConnection(online) {
  const el = $('connection');
  el.textContent = online ? 'Connected' : 'Reconnecting…';
  el.className = 'status ' + (online ? 'online' : 'offline');
}

// ---- helpers ------------------------------------------------------------------

function me() {
  return (state && state.players.find((p) => p.id === playerId)) || null;
}
function myTurn() {
  return !!state && state.phase === 'playing' && state.currentPlayerId === playerId;
}
function isHost() {
  return !!state && state.hostId === playerId;
}
function playerName(id) {
  const p = state.players.find((q) => q.id === id);
  return p ? p.name : '?';
}
function tileAt(x, y) {
  return state.board && state.board.find((t) => t.x === x && t.y === y);
}
function inPlacePhase() {
  return state.phase === 'playing' && state.drawn && !state.placed;
}

// ---- state handling --------------------------------------------------------------

function onState() {
  if (!state) return;
  const known = !!me();
  $('join').classList.toggle('hidden', known);
  $('lobby').classList.toggle('hidden', !known || state.phase !== 'lobby');
  if (state.phase !== 'gameover') dismissedGameOver = false;
  $('gameover').classList.toggle('hidden',
    !known || state.phase !== 'gameover' || dismissedGameOver);

  if (state.phase === 'lobby') {
    viewCentered = false;
    renderLobby();
  } else {
    if (!viewCentered) { centerView(); viewCentered = true; }
    if (state.phase === 'gameover') renderGameOver();
  }
  updateSidebar();
  render();
}

function renderLobby() {
  const list = $('lobby-players');
  list.innerHTML = '';
  state.players.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'player';
    row.innerHTML =
      `<span class="dot" style="background:${p.color}"></span>` +
      `<span class="pname">${escapeHtml(p.name)}</span>` +
      `<span class="tag">${p.id === state.hostId ? 'host' : ''}` +
      `${p.id === playerId ? ' (you)' : ''}</span>` +
      `<span class="conn ${p.connected ? 'on' : 'off'}">●</span>`;
    list.appendChild(row);
  });
  $('lobby-share').textContent = location.origin;
  const startBtn = $('lobby-start');
  startBtn.classList.toggle('hidden', !isHost());
  startBtn.disabled = state.players.length < 2;
  $('lobby-wait').textContent = isHost()
    ? (state.players.length < 2 ? 'Waiting for at least one more player…' : 'Ready when you are!')
    : `Waiting for ${playerName(state.hostId)} to start the game…`;
}

function renderGameOver() {
  const list = $('final-standings');
  list.innerHTML = '';
  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  (state.standings || []).forEach((p, rank) => {
    const row = document.createElement('div');
    row.className = 'standing';
    row.innerHTML =
      `<span class="medal">${medals[rank] || ''}</span>` +
      `<span class="dot" style="background:${p.color}"></span>` +
      `<span class="pname">${escapeHtml(p.name)}${p.id === playerId ? ' (you)' : ''}</span>` +
      `<span class="pscore">${p.score}</span>`;
    list.appendChild(row);
  });
  $('btn-again').classList.toggle('hidden', !isHost());
  $('gameover-wait').textContent = isHost()
    ? '' : `${playerName(state.hostId)} can start a new game.`;
}

// ---- sidebar -----------------------------------------------------------------------

function updateSidebar() {
  const playersDiv = $('players');
  playersDiv.innerHTML = '';
  state.players.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'player' +
      (p.id === state.currentPlayerId && state.phase === 'playing' ? ' active' : '') +
      (p.connected ? '' : ' offline');
    row.innerHTML =
      `<span class="dot" style="background:${p.color}"></span>` +
      `<span class="pname">${escapeHtml(p.name)}${p.id === playerId ? ' (you)' : ''}</span>` +
      `<span class="pmeeples" title="${p.meeples} meeples left">` +
      `${'▲'.repeat(p.meeples) || '–'}</span>` +
      `<span class="pscore">${p.score}</span>`;
    playersDiv.appendChild(row);
  });

  const prev = $('tile-preview');
  const pctx = prev.getContext('2d');
  pctx.clearRect(0, 0, prev.width, prev.height);
  if (state.drawn) drawTile(pctx, state.drawn.type, state.drawn.rot, 5, 5, prev.width - 10);
  $('tiles-left').textContent =
    state.phase === 'lobby' ? '' :
    state.over ? 'No tiles left' : `${state.deckLeft} tiles in the bag`;

  $('btn-rotate').disabled = !(myTurn() && inPlacePhase());
  $('btn-skip').classList.toggle('hidden', !(myTurn() && state.placed));
  $('btn-undo').classList.toggle('hidden', !(myTurn() && state.placed));
  $('btn-new').classList.toggle('hidden', !isHost() || state.phase === 'lobby');

  const hint = $('hint');
  if (state.phase === 'lobby') {
    hint.textContent = '';
  } else if (state.over) {
    hint.textContent = 'Game over — final scores are in.';
  } else if (myTurn() && state.placed) {
    hint.textContent = 'Click a white marker to place a meeple (farmers lie down), or skip.';
  } else if (myTurn()) {
    hint.textContent = 'Your turn: place the tile on a highlighted cell. R rotates, drag pans, scroll zooms.';
  } else if (state.currentPlayerId) {
    hint.textContent = `Waiting for ${playerName(state.currentPlayerId)}…`;
  } else {
    hint.textContent = '';
  }

  const logDiv = $('log');
  logDiv.innerHTML = '';
  for (const msg of state.log || []) {
    const div = document.createElement('div');
    div.textContent = msg;
    logDiv.appendChild(div);
  }
  logDiv.scrollTop = logDiv.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- board rendering ------------------------------------------------------------------

function centerView() {
  resizeCanvas();
  view.scale = Math.min(120, Math.max(64, Math.min(canvas.clientWidth, canvas.clientHeight) / 8));
  view.panX = canvas.clientWidth / 2 - 0.5 * view.scale;
  view.panY = canvas.clientHeight / 2 - 0.5 * view.scale;
}

function worldToScreen(wx, wy) {
  return [wx * view.scale + view.panX, wy * view.scale + view.panY];
}
function screenToWorld(sx, sy) {
  return [(sx - view.panX) / view.scale, (sy - view.panY) / view.scale];
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function render() {
  resizeCanvas();
  ctx.fillStyle = '#222a22';
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  if (!state || !state.board) return;
  const s = view.scale;

  for (const tile of state.board) {
    const [px, py] = worldToScreen(tile.x, tile.y);
    drawTile(ctx, tile.type, tile.rot, px, py, s);
  }

  // Legal cells — only the active player gets the interactive highlights.
  if (myTurn() && inPlacePhase() && state.legalCells) {
    for (const [x, y] of state.legalCells) {
      const [px, py] = worldToScreen(x, y);
      const isHover = hoverCell && hoverCell[0] === x && hoverCell[1] === y;
      if (isHover) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        drawTile(ctx, state.drawn.type, state.drawn.rot, px, py, s);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(px + s * 0.04, py + s * 0.04, s * 0.92, s * 0.92);
      }
      ctx.strokeStyle = isHover ? '#ffe066' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(px + 2, py + 2, s - 4, s - 4);
      ctx.setLineDash([]);
    }
  }

  if (state.placed) {
    const [px, py] = worldToScreen(state.placed.x, state.placed.y);
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = 3;
    ctx.strokeRect(px + 1.5, py + 1.5, s - 3, s - 3);
  }

  for (const tile of state.board) {
    for (const fiStr of Object.keys(tile.meeples)) {
      const fi = +fiStr;
      const def = TILE_TYPES[tile.type].features[fi];
      const [rx, ry] = rotPoint(def.spot, tile.rot);
      const [mx, my] = worldToScreen(tile.x + rx, tile.y + ry);
      const color = state.players[tile.meeples[fi]].color;
      drawMeeple(ctx, mx, my, s * 0.3, color, def.type === 'farm');
    }
  }

  if (myTurn() && state.placed && state.meepleOptions) {
    const color = me().color;
    for (const { fi, x, y, farm } of meepleMarkers()) {
      const [mx, my] = worldToScreen(x, y);
      ctx.beginPath();
      ctx.arc(mx, my, s * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      drawMeeple(ctx, mx, my, s * 0.22, color, farm);
    }
  }
}

function meepleMarkers() {
  const tile = tileAt(state.placed.x, state.placed.y);
  if (!tile) return [];
  return state.meepleOptions.map((fi) => {
    const def = TILE_TYPES[tile.type].features[fi];
    const [rx, ry] = rotPoint(def.spot, tile.rot);
    return { fi, x: tile.x + rx, y: tile.y + ry, farm: def.type === 'farm' };
  });
}

// ---- input --------------------------------------------------------------------------

canvas.addEventListener('mousedown', (e) => {
  drag = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY, moved: false };
});

window.addEventListener('mousemove', (e) => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      view.panX = drag.panX + dx;
      view.panY = drag.panY + dy;
      render();
    }
    return;
  }
  if (!state || !myTurn() || !inPlacePhase()) return;
  const rect = canvas.getBoundingClientRect();
  const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const cell = [Math.floor(wx), Math.floor(wy)];
  if (!hoverCell || hoverCell[0] !== cell[0] || hoverCell[1] !== cell[1]) {
    hoverCell = cell;
    render();
  }
});

window.addEventListener('mouseup', (e) => {
  if (!drag) return;
  const wasDrag = drag.moved;
  drag = null;
  if (wasDrag || !state || !myTurn()) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) return;
  const [wx, wy] = screenToWorld(sx, sy);

  if (state.placed) {
    for (const m of meepleMarkers()) {
      const [mx, my] = worldToScreen(m.x, m.y);
      if (Math.hypot(mx - sx, my - sy) <= view.scale * 0.18) {
        act('meeple', { fi: m.fi });
        return;
      }
    }
    return;
  }

  if (inPlacePhase()) {
    const x = Math.floor(wx), y = Math.floor(wy);
    if ((state.legalCells || []).some(([cx, cy]) => cx === x && cy === y)) {
      act('place', { x, y });
    }
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const [wx, wy] = screenToWorld(sx, sy);
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  view.scale = Math.min(220, Math.max(28, view.scale * factor));
  view.panX = sx - wx * view.scale;
  view.panY = sy - wy * view.scale;
  render();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if ((e.key === 'r' || e.key === 'R') && myTurn() && inPlacePhase()) act('rotate');
});

// ---- buttons --------------------------------------------------------------------------

$('btn-rotate').onclick = () => act('rotate');
$('btn-skip').onclick = () => act('skip');
$('btn-undo').onclick = () => act('undo');
$('btn-new').onclick = () => act('newGame');
$('btn-again').onclick = () => act('newGame');
$('lobby-start').onclick = async () => {
  const r = await action('start');
  if (r.error) $('lobby-wait').textContent = r.error;
};
$('btn-view-board').onclick = () => {
  dismissedGameOver = true;
  $('gameover').classList.add('hidden');
};

async function doJoin() {
  const name = $('name-input').value.trim();
  if (!name) { $('join-error').textContent = 'Please enter a name.'; return; }
  $('join-btn').disabled = true;
  const result = await action('join', { name });
  $('join-btn').disabled = false;
  if (result.error) { $('join-error').textContent = result.error; return; }
  playerId = result.playerId;
  localStorage.setItem('carcassonne_player_id', playerId);
  connectEvents();
}

$('join-btn').onclick = doJoin;
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

window.addEventListener('resize', render);

// ---- boot -----------------------------------------------------------------------------

if (playerId) {
  connectEvents(); // reconnect; the join overlay shows if the server forgot us
} else {
  $('join').classList.remove('hidden');
}
