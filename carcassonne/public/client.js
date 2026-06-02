'use strict';

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

let playerId = localStorage.getItem('carc_player_id');
let state = null;
let evtSource = null;

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
  localStorage.setItem('carc_player_id', playerId);
  connectEvents();
}

// ---------------------------------------------------------------------------
// Tile geometry — must mirror the server's rotation rules
// ---------------------------------------------------------------------------
function rotatedEdges(edges, rot) {
  return [0, 1, 2, 3].map((i) => edges[(i - rot + 4) % 4]);
}

function rotatedFeatures(features, rot) {
  return features.map((f) => ({
    type: f.type,
    sides: f.sides ? f.sides.map((s) => (s + rot) % 4) : undefined,
  }));
}

const SIDE_MID = [
  [50, 0],   // N
  [100, 50], // E
  [50, 100], // S
  [0, 50],   // W
];

function featurePos(feat) {
  if (feat.type === 'cloister' || !feat.sides || feat.sides.length === 0) {
    return [50, 50];
  }
  let cx = 0, cy = 0;
  for (const s of feat.sides) {
    cx += SIDE_MID[s][0];
    cy += SIDE_MID[s][1];
  }
  cx /= feat.sides.length;
  cy /= feat.sides.length;
  if (feat.sides.length === 1) {
    cx = (cx + 50) / 2;
    cy = (cy + 50) / 2;
  }
  return [cx, cy];
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------
function el(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function rect(x, y, w, h, cls) {
  return el('rect', { x, y, width: w, height: h, class: cls });
}

function line(x1, y1, x2, y2, cls) {
  return el('line', { x1, y1, x2, y2, class: cls });
}

const CITY_WEDGE = {
  0: 'M 0 0 L 100 0 L 72 32 L 28 32 Z',
  1: 'M 100 0 L 100 100 L 68 72 L 68 28 Z',
  2: 'M 100 100 L 0 100 L 28 68 L 72 68 Z',
  3: 'M 0 100 L 0 0 L 32 28 L 32 72 Z',
};

function drawCity(parent, feat) {
  // The four-side case fills the whole tile (a city dominates the entire square).
  if (feat.sides.length === 4) {
    parent.appendChild(rect(2, 2, 96, 96, 'tile-city'));
    return;
  }
  // For adjacent sides we also draw a small corner block so the city looks
  // connected to itself rather than two unrelated triangles.
  const sset = new Set(feat.sides);
  for (const s of feat.sides) {
    const p = el('path', { d: CITY_WEDGE[s], class: 'tile-city' });
    parent.appendChild(p);
  }
  const adjacencies = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const corners = {
    '0,1': 'M 50 0 L 100 0 L 100 50 L 68 28 Z',
    '1,2': 'M 100 50 L 100 100 L 50 100 L 72 68 Z',
    '2,3': 'M 50 100 L 0 100 L 0 50 L 32 72 Z',
    '3,0': 'M 0 50 L 0 0 L 50 0 L 28 32 Z',
  };
  for (const [a, b] of adjacencies) {
    if (sset.has(a) && sset.has(b)) {
      parent.appendChild(el('path', { d: corners[a + ',' + b], class: 'tile-city' }));
    }
  }
}

function drawRoad(parent, sides) {
  // Two coats — a darker outline under the road surface.
  for (const s of sides) {
    const [x, y] = SIDE_MID[s];
    parent.appendChild(line(x, y, 50, 50, 'tile-road-edge'));
  }
  for (const s of sides) {
    const [x, y] = SIDE_MID[s];
    parent.appendChild(line(x, y, 50, 50, 'tile-road'));
  }
  // Junction dot for crossroads / T-junctions / single-edge dead-ends.
  if (sides.length !== 2 || Math.abs(sides[0] - sides[1]) !== 2) {
    parent.appendChild(el('circle', {
      cx: 50, cy: 50, r: 4.5,
      fill: '#5a4634', stroke: '#3a2a1a', 'stroke-width': 1,
    }));
  }
}

function drawCloister(parent) {
  parent.appendChild(rect(35, 38, 30, 28, 'tile-cloister'));
  parent.appendChild(el('path', {
    d: 'M 32 40 L 50 28 L 68 40 Z',
    class: 'tile-cloister-roof',
  }));
  parent.appendChild(el('path', {
    d: 'M 48 48 L 52 48 L 52 54 L 56 54 L 56 58 L 52 58 L 52 64 L 48 64 L 48 58 L 44 58 L 44 54 L 48 54 Z',
    fill: '#5a3a1c',
  }));
}

function meepleShape(cx, cy, color, scale = 1) {
  const g = el('g', { transform: `translate(${cx} ${cy}) scale(${scale})` });
  g.appendChild(el('path', {
    class: 'meeple-shape',
    fill: color,
    d: 'M -5 8 L -5 1 L -9 -2 L -4 -4 L -4 -8 A 4 4 0 1 1 4 -8 L 4 -4 L 9 -2 L 5 1 L 5 8 Z',
  }));
  return g;
}

// ---------------------------------------------------------------------------
// Tile rendering
// ---------------------------------------------------------------------------
function renderTile(parent, tile, opts = {}) {
  const g = el('g', {
    transform: `translate(${tile.x * 100} ${tile.y * 100})`,
  });
  const isLast = opts.isLast;
  g.appendChild(rect(0, 0, 100, 100, 'tile-bg' + (isLast ? ' last-placed' : '')));

  const features = rotatedFeatures(tile.features, tile.rot);

  // Cities first so roads run on top.
  for (const f of features) if (f.type === 'city') drawCity(g, f);

  // Roads.
  for (const f of features) if (f.type === 'road') drawRoad(g, f.sides);

  // Cloister.
  for (const f of features) if (f.type === 'cloister') drawCloister(g);

  // Meeples placed on this tile.
  for (const m of (tile.meeples || [])) {
    const p = state.players.find((pl) => pl.id === m.playerId);
    if (!p) continue;
    const feat = features[m.localIdx];
    const [cx, cy] = featurePos(feat);
    g.appendChild(meepleShape(cx, cy, p.color, 1));
  }

  parent.appendChild(g);
}

// Tile preview (for the player whose turn it is) — drawn into preview-svg.
function renderPreview() {
  const svg = $('preview-svg');
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!state.currentTile) return;
  const t = TEMPLATES[state.currentTile.templateId];
  if (!t) return;
  const previewTile = {
    x: 0, y: 0, rot: state.currentTile.rot,
    edges: t.edges, features: t.features, meeples: [],
  };
  renderTile(svg, previewTile, { isLast: false });
}

// Templates table — kept in sync with tiles.js on the server. The preview only
// needs `edges` and `features` for each id; the rest is server-managed.
const TEMPLATES = {
  start: { edges: ['C', 'R', 'F', 'R'], features: [{ type: 'city', sides: [0] }, { type: 'road', sides: [1, 3] }] },
  'road-straight': { edges: ['F', 'R', 'F', 'R'], features: [{ type: 'road', sides: [1, 3] }] },
  'road-curve': { edges: ['F', 'R', 'R', 'F'], features: [{ type: 'road', sides: [1, 2] }] },
  'road-t': { edges: ['F', 'R', 'R', 'R'], features: [{ type: 'road', sides: [1] }, { type: 'road', sides: [2] }, { type: 'road', sides: [3] }] },
  'road-cross': { edges: ['R', 'R', 'R', 'R'], features: [{ type: 'road', sides: [0] }, { type: 'road', sides: [1] }, { type: 'road', sides: [2] }, { type: 'road', sides: [3] }] },
  cloister: { edges: ['F', 'F', 'F', 'F'], features: [{ type: 'cloister' }] },
  'cloister-road': { edges: ['F', 'F', 'R', 'F'], features: [{ type: 'cloister' }, { type: 'road', sides: [2] }] },
  'city-edge': { edges: ['C', 'F', 'F', 'F'], features: [{ type: 'city', sides: [0] }] },
  'city-edge-road-straight': { edges: ['C', 'R', 'F', 'R'], features: [{ type: 'city', sides: [0] }, { type: 'road', sides: [1, 3] }] },
  'city-edge-road-t': { edges: ['C', 'R', 'R', 'R'], features: [{ type: 'city', sides: [0] }, { type: 'road', sides: [1] }, { type: 'road', sides: [2] }, { type: 'road', sides: [3] }] },
  'city-edge-road-curveR': { edges: ['C', 'R', 'R', 'F'], features: [{ type: 'city', sides: [0] }, { type: 'road', sides: [1, 2] }] },
  'city-edge-road-curveL': { edges: ['C', 'F', 'R', 'R'], features: [{ type: 'city', sides: [0] }, { type: 'road', sides: [2, 3] }] },
  'city-adjacent': { edges: ['C', 'C', 'F', 'F'], features: [{ type: 'city', sides: [0, 1] }] },
  'city-opposite': { edges: ['C', 'F', 'C', 'F'], features: [{ type: 'city', sides: [0] }, { type: 'city', sides: [2] }] },
  'city-three': { edges: ['C', 'C', 'F', 'C'], features: [{ type: 'city', sides: [0, 1, 3] }] },
  'city-full': { edges: ['C', 'C', 'C', 'C'], features: [{ type: 'city', sides: [0, 1, 2, 3] }] },
  'city-edge-road-end': { edges: ['C', 'F', 'R', 'F'], features: [{ type: 'city', sides: [0] }, { type: 'road', sides: [2] }] },
};

// ---------------------------------------------------------------------------
// Board rendering
// ---------------------------------------------------------------------------
function renderBoard(svg) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!state.tiles || state.tiles.length === 0) return;

  // Compute bounding box (in tile coords) with 1-cell margin so legal hints fit.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of state.tiles) {
    if (t.x < minX) minX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.x > maxX) maxX = t.x;
    if (t.y > maxY) maxY = t.y;
  }
  // Expand by the legal placements so highlights are visible.
  if (state.legalPlacements) {
    for (const lp of state.legalPlacements) {
      if (lp.x < minX) minX = lp.x;
      if (lp.y < minY) minY = lp.y;
      if (lp.x > maxX) maxX = lp.x;
      if (lp.y > maxY) maxY = lp.y;
    }
  }
  minX -= 1; minY -= 1; maxX += 1; maxY += 1;
  const vbX = minX * 100;
  const vbY = minY * 100;
  const vbW = (maxX - minX + 1) * 100;
  const vbH = (maxY - minY + 1) * 100;
  svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);

  const myTurn = state.currentPlayerId === playerId;
  const lastKey = state.lastPlacedKey;

  // Tiles.
  for (const t of state.tiles) {
    const isLast = lastKey === `${t.x},${t.y}` && state.subPhase === 'meeple';
    renderTile(svg, t, { isLast });
  }

  // Legal placement hints — only on this player's "place" turn.
  if (myTurn && state.subPhase === 'place' && state.currentTile && state.legalPlacements) {
    const rot = state.currentTile.rot;
    for (const lp of state.legalPlacements) {
      const valid = lp.rotations.includes(rot);
      if (!valid) continue;
      const cell = rect(lp.x * 100 + 4, lp.y * 100 + 4, 92, 92, 'legal-cell');
      cell.addEventListener('click', () =>
        action('placeTile', { x: lp.x, y: lp.y, rot }).then(showErrorIfAny),
      );
      svg.appendChild(cell);
    }
  }

  // Meeple-placement spots on the last placed tile.
  if (myTurn && state.subPhase === 'meeple' && state.meepleSpots && state.lastPlacedKey) {
    const last = state.tiles.find((t) => `${t.x},${t.y}` === state.lastPlacedKey);
    if (last) {
      const features = rotatedFeatures(last.features, last.rot);
      for (const idx of state.meepleSpots) {
        const [cx, cy] = featurePos(features[idx]);
        const c = el('circle', {
          cx: last.x * 100 + cx,
          cy: last.y * 100 + cy,
          r: 9,
          class: 'meeple-spot',
        });
        c.addEventListener('click', () =>
          action('placeMeeple', { localIdx: idx }).then(showErrorIfAny),
        );
        svg.appendChild(c);
      }
    }
  }
}

function showErrorIfAny(r) {
  if (r && r.error) alert(r.error);
}

// ---------------------------------------------------------------------------
// Top-level render
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function playerTags(p) {
  const tags = [];
  if (p.id === state.hostId) tags.push('<span class="tag host">host</span>');
  if (p.id === playerId) tags.push('<span class="tag you">you</span>');
  if (p.id === state.currentPlayerId && state.phase === 'play') {
    tags.push('<span class="tag turn">turn</span>');
  }
  if (!p.connected) tags.push('<span class="tag offline">offline</span>');
  return tags.join(' ');
}

function render() {
  const known = state && state.players.some((p) => p.id === playerId);
  if (playerId && state && !known) {
    localStorage.removeItem('carc_player_id');
    playerId = null;
    if (evtSource) { evtSource.close(); evtSource = null; }
  }

  const showJoin = !playerId || !known;
  const playing = state && state.phase === 'play' && !showJoin;
  const over = state && state.phase === 'gameover' && !showJoin;

  $('join-screen').classList.toggle('hidden', !showJoin);
  $('lobby-screen').classList.toggle('hidden', !(state && state.phase === 'lobby' && !showJoin));
  $('play-screen').classList.toggle('hidden', !playing);
  $('over-screen').classList.toggle('hidden', !over);

  if (!state || showJoin) return;
  if (state.phase === 'lobby') renderLobby();
  else if (playing) renderPlay();
  else renderOver();
}

function renderLobby() {
  const isHost = playerId === state.hostId;
  $('host-lobby').classList.toggle('hidden', !isHost);
  $('wait-host').classList.toggle('hidden', isHost);
  if (isHost) $('start-btn').disabled = state.players.length < 2;
  $('lobby-players').innerHTML = state.players
    .map((p) => `<li>
        <span class="left">
          <span class="swatch" style="background:${p.color}"></span>
          <span class="pname">${escapeHtml(p.name)}</span>
          ${playerTags(p)}
        </span>
      </li>`)
    .join('');
}

function renderPlay() {
  const myTurn = state.currentPlayerId === playerId;
  const cur = state.players.find((p) => p.id === state.currentPlayerId);
  $('turn-label').textContent = cur ? `${cur.name}'s turn` : '';
  $('turn-label').style.color = cur ? cur.color : '';

  if (state.subPhase === 'place') {
    $('phase-hint').textContent = myTurn
      ? 'Pick a glowing square to lay your tile. Rotate it until the edges line up.'
      : `Waiting for ${cur ? cur.name : 'the next player'} to place a tile…`;
  } else if (state.subPhase === 'meeple') {
    $('phase-hint').textContent = myTurn
      ? 'Optional: claim a feature on the tile you just placed by tapping a glowing spot.'
      : `Waiting for ${cur ? cur.name : 'the next player'} to choose a meeple…`;
  } else {
    $('phase-hint').textContent = '';
  }
  $('deck-info').textContent = `Tiles left: ${state.deckLeft}` + (state.discards ? ` · ${state.discards} discarded` : '');

  // Preview tile (only when it is the current player's turn AND they're placing).
  const showPreview = myTurn && state.subPhase === 'place' && state.currentTile;
  $('tile-preview').classList.toggle('hidden', !showPreview);
  if (showPreview) renderPreview();

  // Meeple-prompt card with skip button.
  $('meeple-prompt').classList.toggle('hidden', !(myTurn && state.subPhase === 'meeple'));

  // Board.
  renderBoard($('board'));

  // Scores.
  $('scoreboard').innerHTML = state.players
    .map((p) => {
      const isCur = p.id === state.currentPlayerId;
      return `<li class="${isCur ? 'current' : ''}">
        <span class="left">
          <span class="swatch" style="background:${p.color}"></span>
          <span class="pname">${escapeHtml(p.name)}</span>
          ${playerTags(p)}
          <span class="meeple-count">meeples: ${p.meeples}</span>
        </span>
        <span class="score">${p.score}</span>
      </li>`;
    }).join('');

  // Log.
  $('log').innerHTML = state.log.slice().reverse()
    .map((l) => `<li>${escapeHtml(l.message)}</li>`).join('');
}

function renderOver() {
  const isHost = playerId === state.hostId;
  const winners = (state.winnerIds || []).map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
  if (winners.length === 1) {
    $('winner-text').textContent = `🏆 ${winners[0].name} wins with ${winners[0].score} points!`;
  } else if (winners.length > 1) {
    $('winner-text').textContent = `🏆 Tie at ${winners[0].score} — ${winners.map((w) => w.name).join(' & ')}`;
  } else {
    $('winner-text').textContent = 'Game over!';
  }
  $('again-btn').classList.toggle('hidden', !isHost);

  $('final-scoreboard').innerHTML = [...state.players]
    .sort((a, b) => b.score - a.score)
    .map((p) => `<li>
      <span class="left">
        <span class="swatch" style="background:${p.color}"></span>
        <span class="pname">${escapeHtml(p.name)}</span>
      </span>
      <span class="score">${p.score}</span>
    </li>`).join('');

  if ($('final-board')) renderBoard($('final-board'));
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
$('join-btn').addEventListener('click', doJoin);
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
$('start-btn').addEventListener('click', () => action('start').then(showErrorIfAny));
$('again-btn').addEventListener('click', () => action('newGame').then(showErrorIfAny));
$('rotate-ccw').addEventListener('click', () => action('rotate', { dir: 'ccw' }).then(showErrorIfAny));
$('rotate-cw').addEventListener('click', () => action('rotate', { dir: 'cw' }).then(showErrorIfAny));
$('skip-meeple').addEventListener('click', () => action('skipMeeple').then(showErrorIfAny));

// Boot
if (playerId) connectEvents();
render();
