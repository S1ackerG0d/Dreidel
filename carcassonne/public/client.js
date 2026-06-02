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
// Tile geometry — mirrors the server's tiles.js
// ---------------------------------------------------------------------------
const NW = 0, N_MID = 1, NE = 2, W_MID = 3, CENTRE = 4, E_MID = 5, SW = 6, S_MID = 7, SE = 8;
const SIDE_MID = [N_MID, E_MID, S_MID, W_MID];
const ADJ = [
  [N_MID, W_MID], [NW, NE, CENTRE], [N_MID, E_MID],
  [NW, CENTRE, SW], [N_MID, W_MID, E_MID, S_MID], [NE, CENTRE, SE],
  [W_MID, S_MID], [CENTRE, SW, SE], [E_MID, S_MID],
];

function rotateTerrain(terrain, rot) {
  let cur = terrain;
  const r = ((rot % 4) + 4) % 4;
  for (let n = 0; n < r; n++) {
    const out = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      out[i * 3 + j] = cur[(2 - j) * 3 + i];
    }
    cur = out.join('');
  }
  return cur;
}

function deriveFeatures(terrain) {
  const owner = new Array(9).fill(-1);
  const features = [];
  for (let start = 0; start < 9; start++) {
    if (owner[start] !== -1) continue;
    const t = terrain[start];
    const stack = [start];
    const cells = [];
    while (stack.length) {
      const cur = stack.pop();
      if (owner[cur] !== -1) continue;
      owner[cur] = features.length;
      cells.push(cur);
      if (t === 'J') continue;
      for (const n of ADJ[cur]) {
        if (owner[n] === -1 && terrain[n] === t) stack.push(n);
      }
    }
    const type = t === 'C' ? 'city' : (t === 'R' || t === 'J') ? 'road' : 'field';
    const sides = [];
    for (let s = 0; s < 4; s++) if (cells.includes(SIDE_MID[s])) sides.push(s);
    features.push({ type, cells, sides, isJunction: t === 'J' });
  }
  return { features, owner };
}

// Pixel coordinates for grid cells (each cell = 33.333 × 33.333 of a 100×100 tile).
function cellRect(cell) {
  const col = cell % 3;
  const row = Math.floor(cell / 3);
  return { x: col * (100 / 3), y: row * (100 / 3), w: 100 / 3, h: 100 / 3 };
}

function sideMidPoint(side) {
  const cell = SIDE_MID[side];
  const r = cellRect(cell);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function cellCentre(cell) {
  const r = cellRect(cell);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// Best meeple anchor for a local feature on a tile.
function featureAnchor(feature) {
  if (feature.type === 'cloister' || feature.cells === undefined) return { x: 50, y: 50 };
  if (feature.cells.length === 0) return { x: 50, y: 50 };
  let sx = 0, sy = 0;
  for (const c of feature.cells) {
    const p = cellCentre(c);
    sx += p.x; sy += p.y;
  }
  return { x: sx / feature.cells.length, y: sy / feature.cells.length };
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------
function el(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function meepleShape(cx, cy, color, kind, scale = 0.9) {
  // kind: 'meeple' = standing; 'farmer' = lying down (rotated 90°).
  const rot = kind === 'farmer' ? 90 : 0;
  const g = el('g', { transform: `translate(${cx} ${cy}) rotate(${rot}) scale(${scale})` });
  g.appendChild(el('path', {
    class: 'meeple-shape',
    fill: color,
    d: 'M -5 8 L -5 1 L -9 -2 L -4 -4 L -4 -8 A 4 4 0 1 1 4 -8 L 4 -4 L 9 -2 L 5 1 L 5 8 Z',
  }));
  return g;
}

function pennantShape(cx, cy) {
  // Small triangle flag in city.
  const g = el('g', { transform: `translate(${cx} ${cy})` });
  g.appendChild(el('rect', { x: -0.5, y: -8, width: 1, height: 16, fill: '#3a2a1a' }));
  g.appendChild(el('path', { d: 'M 0 -8 L 8 -5 L 0 -2 Z', fill: '#e84a4a', stroke: '#3a2a1a', 'stroke-width': 0.5 }));
  return g;
}

// ---------------------------------------------------------------------------
// Tile rendering (from terrain + cloister + pennant)
// ---------------------------------------------------------------------------
function renderTileInto(parent, transform, templateId, rot, opts = {}) {
  const tpl = state.templates[templateId];
  if (!tpl) return null;
  const terrain = rotateTerrain(tpl.terrain, rot);
  const derived = deriveFeatures(terrain);

  const g = el('g', { transform });
  parent.appendChild(g);

  // Field background (entire tile starts as field, cities/roads paint over).
  g.appendChild(el('rect', { x: 0, y: 0, width: 100, height: 100, class: 'tile-bg' + (opts.isLast ? ' last-placed' : '') }));

  // Cities: paint each city cell as a filled rect (same colour, adjacent cells visually merge).
  for (const f of derived.features) {
    if (f.type !== 'city') continue;
    for (const c of f.cells) {
      const r = cellRect(c);
      g.appendChild(el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'tile-city' }));
    }
  }

  // Roads: draw a stroke from each road cell's centre to each connected
  // road cell's centre (within the tile). Each road feature's segments stay
  // visually separate at junctions (J cells don't propagate).
  const drawnRoadPairs = new Set();
  for (const f of derived.features) {
    if (f.type !== 'road') continue;
    for (const c of f.cells) {
      // Connect to each adjacent cell of the same feature.
      for (const n of ADJ[c]) {
        if (derived.owner[n] !== derived.owner[c]) continue;
        const key = c < n ? `${c}-${n}` : `${n}-${c}`;
        if (drawnRoadPairs.has(key)) continue;
        drawnRoadPairs.add(key);
        const p1 = cellCentre(c);
        const p2 = cellCentre(n);
        g.appendChild(el('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'tile-road-edge' }));
      }
      // If this road cell is an edge cell, also connect it to its outer edge midpoint
      // (so 1-side roads visually reach the tile boundary).
      if (c === N_MID || c === E_MID || c === S_MID || c === W_MID) {
        const cc = cellCentre(c);
        const side = SIDE_MID.indexOf(c);
        const outer = sideMidPoint(side); // same as cc (edge cell centre is on the boundary already...)
        // Actually the edge-cell centre is at the boundary midpoint, so no extra line is needed.
      }
    }
  }
  // Now draw the lighter road surface over the dark outline.
  for (const key of drawnRoadPairs) {
    const [a, b] = key.split('-').map(Number);
    const p1 = cellCentre(a);
    const p2 = cellCentre(b);
    g.appendChild(el('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'tile-road' }));
  }

  // Junction dot at any J cell.
  if (terrain[CENTRE] === 'J') {
    const cc = cellCentre(CENTRE);
    g.appendChild(el('circle', { cx: cc.x, cy: cc.y, r: 5, fill: '#5a4634', stroke: '#3a2a1a', 'stroke-width': 1 }));
  }

  // Cloister.
  if (tpl.cloister) {
    g.appendChild(el('rect', { x: 35, y: 38, width: 30, height: 28, class: 'tile-cloister' }));
    g.appendChild(el('path', { d: 'M 32 40 L 50 28 L 68 40 Z', class: 'tile-cloister-roof' }));
    g.appendChild(el('path', {
      d: 'M 48 48 L 52 48 L 52 54 L 56 54 L 56 58 L 52 58 L 52 64 L 48 64 L 48 58 L 44 58 L 44 54 L 48 54 Z',
      fill: '#5a3a1c',
    }));
  }

  // Pennant — placed in the largest city feature's anchor.
  if (tpl.pennants > 0) {
    const cityFeats = derived.features.filter((f) => f.type === 'city');
    if (cityFeats.length) {
      cityFeats.sort((a, b) => b.cells.length - a.cells.length);
      const anchor = featureAnchor(cityFeats[0]);
      // Offset slightly so pennant doesn't overlap a meeple in the same spot.
      g.appendChild(pennantShape(anchor.x - 10, anchor.y));
    }
  }

  return { g, derived };
}

// ---------------------------------------------------------------------------
// Tile preview
// ---------------------------------------------------------------------------
function renderPreview() {
  const svg = $('preview-svg');
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!state.currentTile) return;
  renderTileInto(svg, 'translate(0 0)', state.currentTile.templateId, state.currentTile.rot);
}

// ---------------------------------------------------------------------------
// Board rendering
// ---------------------------------------------------------------------------
function renderBoard(svg) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!state.tiles || state.tiles.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of state.tiles) {
    if (t.x < minX) minX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.x > maxX) maxX = t.x;
    if (t.y > maxY) maxY = t.y;
  }
  if (state.legalPlacements) for (const lp of state.legalPlacements) {
    if (lp.x < minX) minX = lp.x;
    if (lp.y < minY) minY = lp.y;
    if (lp.x > maxX) maxX = lp.x;
    if (lp.y > maxY) maxY = lp.y;
  }
  minX -= 1; minY -= 1; maxX += 1; maxY += 1;
  svg.setAttribute('viewBox', `${minX*100} ${minY*100} ${(maxX-minX+1)*100} ${(maxY-minY+1)*100}`);

  const myTurn = state.currentPlayerId === playerId;
  const lastKey = state.lastPlacedKey;

  for (const t of state.tiles) {
    const isLast = lastKey === `${t.x},${t.y}` && state.subPhase === 'meeple';
    const rendered = renderTileInto(svg, `translate(${t.x * 100} ${t.y * 100})`, t.templateId, t.rot, { isLast });
    if (!rendered) continue;
    // Render meeples placed on this tile.
    for (const m of t.meeples) {
      const player = state.players.find((pl) => pl.id === m.playerId);
      if (!player) continue;
      const feat = rendered.derived.features[m.localIdx];
      // Cloister feature is appended after derived features on cloister tiles.
      let anchor;
      if (feat) anchor = featureAnchor(feat);
      else anchor = { x: 50, y: 50 };
      rendered.g.appendChild(meepleShape(anchor.x, anchor.y, player.color, m.kind || 'meeple', 0.9));
    }
  }

  // Legal placements (current rotation only).
  if (myTurn && state.subPhase === 'place' && state.currentTile && state.legalPlacements) {
    const rot = state.currentTile.rot;
    for (const lp of state.legalPlacements) {
      if (!lp.rotations.includes(rot)) continue;
      const cell = el('rect', { x: lp.x * 100 + 4, y: lp.y * 100 + 4, width: 92, height: 92, class: 'legal-cell' });
      cell.addEventListener('click', () =>
        action('placeTile', { x: lp.x, y: lp.y, rot }).then(showErrorIfAny));
      svg.appendChild(cell);
    }
  }

  // Meeple-placement spots on the last placed tile.
  if (myTurn && state.subPhase === 'meeple' && state.meepleSpots && state.lastPlacedKey) {
    const last = state.tiles.find((t) => `${t.x},${t.y}` === state.lastPlacedKey);
    if (last) {
      const tpl = state.templates[last.templateId];
      const terrain = rotateTerrain(tpl.terrain, last.rot);
      const derived = deriveFeatures(terrain);
      for (const idx of state.meepleSpots) {
        let anchor;
        let type;
        if (idx < derived.features.length) {
          const f = derived.features[idx];
          anchor = featureAnchor(f);
          type = f.type;
        } else {
          anchor = { x: 50, y: 50 };
          type = 'cloister';
        }
        const c = el('circle', {
          cx: last.x * 100 + anchor.x,
          cy: last.y * 100 + anchor.y,
          r: type === 'field' ? 7 : 9,
          class: 'meeple-spot ' + (type === 'field' ? 'farmer-spot' : ''),
        });
        c.addEventListener('click', () =>
          action('placeMeeple', { localIdx: idx }).then(showErrorIfAny));
        svg.appendChild(c);
      }
    }
  }
}

function showErrorIfAny(r) { if (r && r.error) alert(r.error); }

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
      </li>`).join('');
}

function renderPlay() {
  const myTurn = state.currentPlayerId === playerId;
  const cur = state.players.find((p) => p.id === state.currentPlayerId);
  $('turn-label').textContent = cur ? `${cur.name}'s turn` : '';
  $('turn-label').style.color = cur ? cur.color : '';

  if (state.subPhase === 'place') {
    $('phase-hint').textContent = myTurn
      ? 'Tap a glowing square to lay your tile. Rotate it until the edges line up.'
      : `Waiting for ${cur ? cur.name : 'the next player'} to place a tile…`;
  } else if (state.subPhase === 'meeple') {
    $('phase-hint').textContent = myTurn
      ? 'Optional: claim a road, city, cloister, or field by tapping a glowing spot. Field claims (farmers) lie down and only score at end of game.'
      : `Waiting for ${cur ? cur.name : 'the next player'} to choose a meeple…`;
  } else {
    $('phase-hint').textContent = '';
  }
  $('deck-info').textContent = `Tiles left: ${state.deckLeft}` + (state.discards ? ` · ${state.discards} discarded` : '');

  const showPreview = myTurn && state.subPhase === 'place' && state.currentTile;
  $('tile-preview').classList.toggle('hidden', !showPreview);
  if (showPreview) renderPreview();
  $('meeple-prompt').classList.toggle('hidden', !(myTurn && state.subPhase === 'meeple'));

  renderBoard($('board'));

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

if (playerId) connectEvents();
render();
