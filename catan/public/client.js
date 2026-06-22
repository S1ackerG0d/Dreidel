'use strict';

const $ = (id) => document.getElementById(id);
const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
const ICON = { wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛏️' };
const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const SVGNS = 'http://www.w3.org/2000/svg';

let playerId = localStorage.getItem('catan_player_id');
let state = null;
let evtSource = null;

// Local UI state
let mode = null;            // 'road' | 'settlement' | 'city' | null
let showTrade = false;
let showPlenty = false;
let showMonopoly = false;
let showSend = false;
let sendSel = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
let discardSel = null;      // { wood, brick, ... }
let showForced = false;     // 2-player "forced trade" panel
let forcedSel = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };

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

async function act(type, extra) {
  const r = await action(type, extra);
  if (r.error) { $('play-error').textContent = r.error; }
  else { $('play-error').textContent = ''; }
  return r;
}

function connectEvents() {
  if (!playerId) return;
  if (evtSource) evtSource.close();
  evtSource = new EventSource('/api/events?playerId=' + encodeURIComponent(playerId));
  evtSource.onmessage = (e) => { state = JSON.parse(e.data); setConnection(true); render(); };
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
  localStorage.setItem('catan_player_id', playerId);
  connectEvents();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const myTurn = () => state && state.currentPlayerId === playerId;
const me = () => state && state.players.find((p) => p.id === playerId);

// A board piece's colour — owned by a real player or a neutral blocker.
function ownerColor(id) {
  const p = state.players.find((x) => x.id === id);
  if (p) return p.color;
  const n = (state.neutrals || []).find((x) => x.id === id);
  return n ? n.color : '#888';
}

function playerTags(p) {
  const tags = [];
  if (p.id === state.hostId) tags.push('<span class="tag host">host</span>');
  if (p.id === playerId) tags.push('<span class="tag you">you</span>');
  if (p.hasLongestRoad) tags.push('<span class="tag road">road</span>');
  if (p.hasLargestArmy) tags.push('<span class="tag army">army</span>');
  if (!p.connected) tags.push('<span class="tag offline">off</span>');
  return tags.join(' ');
}

// ---------------------------------------------------------------------------
// Top-level render
// ---------------------------------------------------------------------------
function render() {
  const known = state && state.players.some((p) => p.id === playerId);
  if (playerId && state && !known) {
    localStorage.removeItem('catan_player_id');
    playerId = null;
    if (evtSource) evtSource.close();
  }
  const showJoin = !playerId || !known;
  const inGame = state && (state.phase === 'setup' || state.phase === 'play') && !showJoin;
  const over = state && state.phase === 'gameover' && !showJoin;

  $('join-screen').classList.toggle('hidden', !showJoin);
  $('lobby-screen').classList.toggle('hidden', !(state && state.phase === 'lobby' && !showJoin));
  $('play-screen').classList.toggle('hidden', !inGame);
  $('over-screen').classList.toggle('hidden', !over);

  if (!state || showJoin) return;
  if (state.phase === 'lobby') renderLobby();
  else if (inGame) renderGame();
  else renderOver();
}

function renderLobby() {
  const isHost = playerId === state.hostId;
  $('host-lobby').classList.toggle('hidden', !isHost);
  $('wait-host').classList.toggle('hidden', isHost);
  if (isHost) $('start-btn').disabled = state.players.length < 2;

  // The official 2-player variant is only offered at an exactly-2-player table.
  const twoPlayers = state.players.length === 2;
  const on = !!state.useTwoPlayerVariant;
  $('variant-toggle').classList.toggle('hidden', !twoPlayers);
  $('variant-check').checked = on;
  $('lobby-mode').textContent = twoPlayers && on
    ? 'Mode: official 2-player variant (neutral players + trade tokens).'
    : 'Mode: standard rules.';

  $('lobby-players').innerHTML = state.players.map((p) =>
    `<li><span class="left"><span class="swatch" style="background:${p.color}"></span>
      <span class="pname">${escapeHtml(p.name)}</span> ${playerTags(p)}</span></li>`).join('');
}

// ---------------------------------------------------------------------------
// Board rendering
// ---------------------------------------------------------------------------
function clickable() {
  // Returns the sets of board elements the player may click right now.
  const out = { vertices: [], edges: [], hexes: [], act: null };
  if (!myTurn() || !state.legal) return out;
  if (state.phase === 'setup') {
    if (state.setup.expect === 'settlement') { out.vertices = state.legal.settlements; out.act = 'buildSettlement'; }
    else { out.edges = state.legal.roads; out.act = 'buildRoad'; }
    return out;
  }
  if (state.turnPhase === 'moveRobber') { out.hexes = state.legal.robberHexes; out.act = 'moveRobber'; return out; }
  if (state.turnPhase === 'main') {
    if (mode === 'road') { out.edges = state.legal.roads; out.act = 'buildRoad'; }
    else if (mode === 'settlement') { out.vertices = state.legal.settlements; out.act = 'buildSettlement'; }
    else if (mode === 'city') { out.vertices = state.legal.cities; out.act = 'buildCity'; }
  }
  return out;
}

function renderBoard() {
  const b = state.board;
  const svg = $('board');
  svg.setAttribute('viewBox', `${b.viewBox.x} ${b.viewBox.y} ${b.viewBox.w} ${b.viewBox.h}`);
  const vById = Object.fromEntries(b.vertices.map((v) => [v.id, v]));
  const click = clickable();
  const clickV = new Set(click.vertices);
  const clickE = new Set(click.edges);
  const clickH = new Set(click.hexes);

  let s = '';

  // Hex tiles + number tokens.
  for (const h of b.hexes) {
    const v = h.corners.map((id) => vById[id]);
    const pts = v.map((p) => `${p.x},${p.y}`).join(' ');
    s += `<polygon points="${pts}" class="hex-${h.resource} hex-stroke" />`;
    if (h.number != null) {
      const red = h.number === 6 || h.number === 8;
      s += `<circle cx="${h.cx}" cy="${h.cy}" r="16" class="num-token${red ? ' red' : ''}" />`;
      s += `<text x="${h.cx}" y="${h.cy - 3}" class="num-text${red ? ' red' : ''}" font-size="15">${h.number}</text>`;
      const pips = PIPS[h.number] || 0;
      const pw = 4;
      for (let i = 0; i < pips; i++) {
        const px = h.cx - ((pips - 1) * pw) / 2 + i * pw;
        s += `<circle cx="${px}" cy="${h.cy + 9}" r="1.4" class="pip" />`;
      }
    }
  }

  // Ports: dashed links + marker.
  for (const port of b.ports) {
    for (const vid of port.vertices) {
      const v = vById[vid];
      s += `<line x1="${port.mx}" y1="${port.my}" x2="${v.x}" y2="${v.y}" class="port-link" />`;
    }
    const label = port.type === 'any' ? '3:1' : ICON[port.type];
    s += `<circle cx="${port.mx}" cy="${port.my}" r="13" class="port-marker" />`;
    s += `<text x="${port.mx}" y="${port.my}" class="port-text">${label}</text>`;
  }

  // Existing roads (and faint grid for empty edges).
  for (const e of b.edges) {
    if (e.owner) {
      const color = ownerColor(e.owner);
      s += `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" class="edge-road" stroke="${color}" />`;
    } else {
      s += `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" class="edge-base" />`;
    }
  }

  // Buildings.
  for (const v of b.vertices) {
    if (!v.building) continue;
    const color = ownerColor(v.owner);
    if (v.building === 'city') {
      s += `<rect x="${v.x - 8}" y="${v.y - 8}" width="16" height="16" rx="3" fill="${color}" class="city" />`;
    } else {
      s += `<circle cx="${v.x}" cy="${v.y}" r="7" fill="${color}" class="settlement" />`;
    }
  }

  // Clickable overlays for legal placements.
  for (const eid of clickE) {
    const e = b.edges.find((x) => x.id === eid);
    s += `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" class="edge-legal" data-act="buildRoad" data-id="${eid}" />`;
  }
  for (const vid of clickV) {
    const v = vById[vid];
    s += `<circle cx="${v.x}" cy="${v.y}" r="9" class="vtx-legal" data-act="${click.act}" data-id="${vid}" />`;
  }
  for (const hid of clickH) {
    const h = b.hexes.find((x) => x.id === hid);
    s += `<circle cx="${h.cx}" cy="${h.cy}" r="34" fill="transparent" class="hex-robber-target" data-act="moveRobber" data-id="${hid}" />`;
  }

  // Robber piece.
  const rob = b.hexes.find((h) => h.id === b.robber);
  if (rob) s += `<circle cx="${rob.cx + 18}" cy="${rob.cy - 14}" r="9" class="robber" />`;

  svg.innerHTML = s;
}

function onBoardClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.getAttribute('data-act');
  const id = el.getAttribute('data-id');
  if (act === 'buildRoad') act_('buildRoad', { edgeId: id });
  else if (act === 'buildSettlement') act_('buildSettlement', { vertexId: id });
  else if (act === 'buildCity') act_('buildCity', { vertexId: id });
  else if (act === 'moveRobber') act_('moveRobber', { hexId: id });
}

async function act_(type, extra) {
  if (type !== 'buildRoad' || state.freeRoads <= 0) mode = null; // keep road mode while free roads remain
  await act(type, extra);
}

// ---------------------------------------------------------------------------
// Game screen
// ---------------------------------------------------------------------------
function statusLine() {
  const cur = state.players.find((p) => p.id === state.currentPlayerId);
  const who = cur ? (cur.id === playerId ? 'You' : cur.name) : '';
  if (state.phase === 'setup') {
    const what = state.setup.expect === 'settlement' ? 'a settlement' : 'a road';
    return `Setup round ${state.setup.round} — ${who} to place ${what}.`;
  }
  if (state.turnPhase === 'roll') return `${who} to roll the dice.`;
  if (state.turnPhase === 'discard') {
    return `Discarding cards (7 rolled) — waiting on: ${(state.waitingDiscards || []).join(', ')}.`;
  }
  if (state.turnPhase === 'moveRobber') return `${who} — move the robber.`;
  if (state.turnPhase === 'steal') return `${who} — choose someone to rob.`;
  let dice = '';
  if (state.dice) {
    dice = ` · rolled ${state.dice[0]}+${state.dice[1]}=${state.dice[0] + state.dice[1]}`;
    if (state.dice2) dice += ` and ${state.dice2[0]}+${state.dice2[1]}=${state.dice2[0] + state.dice2[1]}`;
  }
  return `${who}'s turn${dice}.`;
}

function actionHint() {
  if (!myTurn()) return '';
  if (state.phase === 'setup') {
    return state.setup.expect === 'settlement'
      ? 'Tap a highlighted corner to place your settlement.'
      : 'Tap a highlighted edge to place your road.';
  }
  if (state.turnPhase === 'moveRobber') return 'Tap a hex to move the robber there.';
  if (state.turnPhase === 'steal') return 'Choose a player to steal one random card from.';
  if (state.turnPhase === 'main') {
    if (state.freeRoads > 0) return `Road Building — place ${state.freeRoads} free road(s).`;
    if (mode === 'road') return 'Tap a highlighted edge to build a road. (Tap "Cancel" to stop.)';
    if (mode === 'settlement') return 'Tap a highlighted corner to build a settlement.';
    if (mode === 'city') return 'Tap one of your settlements to upgrade it to a city.';
  }
  return '';
}

function renderGame() {
  // Reset stale build mode if it no longer applies.
  if (!myTurn() || state.turnPhase !== 'main') { if (state.freeRoads <= 0) mode = null; }
  if (state.freeRoads > 0 && myTurn()) mode = 'road';

  $('board-status').textContent = statusLine();
  $('action-hint').textContent = actionHint();
  renderBoard();
  renderScoreboard();
  renderHand();
  $('log').innerHTML = state.log.slice().reverse().map((l) => `<li>${escapeHtml(l.message)}</li>`).join('');
}

function renderScoreboard() {
  $('scoreboard').innerHTML = state.players.map((p) => {
    const cur = p.id === state.currentPlayerId ? ' current' : '';
    const tokens = state.variant2p ? ` · 🎟️${p.tokens}` : '';
    const meta = `🛖${5 - p.settlementsLeft}/5 🏙️${4 - p.citiesLeft}/4 🛣️${p.longestRoad} · 🃏${p.devCount} · 🗡️${p.knightsPlayed}${tokens}`;
    return `<li class="${cur}">
      <span class="left"><span class="swatch" style="background:${p.color}"></span>
        <span class="pname">${escapeHtml(p.name)}</span> ${playerTags(p)}
        <span class="meta">🂠${p.resourceCount} ${meta}</span></span>
      <span class="vp">${p.vp}</span>
    </li>`;
  }).join('');

  // Neutral blockers (2-player variant only).
  const neutrals = state.variant2p ? (state.neutrals || []) : [];
  $('neutrals').classList.toggle('hidden', neutrals.length === 0);
  $('neutrals').innerHTML = neutrals.map((n) =>
    `<li><span class="left"><span class="swatch" style="background:${n.color}"></span>
      <span class="pname">Neutral (${escapeHtml(n.colorName)})</span>
      <span class="tag">blocker</span>
      <span class="meta">🛖${n.settlements} 🛣️${n.roads}</span></span></li>`).join('');
}

function resChip(r, n) {
  return `<div class="res-chip"><span class="ico">${ICON[r]}</span><span class="cnt">${n}</span><span class="lbl">${r}</span></div>`;
}

function renderHand() {
  const you = state.you;
  $('hand-card').classList.toggle('hidden', !you);
  if (!you) return;
  $('your-vp').textContent = `${you.vp} VP`;
  $('your-tokens').classList.toggle('hidden', !state.variant2p);
  if (state.variant2p) $('your-tokens').textContent = `🎟️ ${you.tokens}`;
  $('resources').innerHTML = RES.map((r) => resChip(r, you.resources[r])).join('');

  // Dev cards
  $('dev-cards').innerHTML = you.dev.length
    ? you.dev.map((d, i) =>
        `<div class="dev-chip${d.playable ? ' playable' : ''}" data-dev="${d.type}" data-i="${i}">${escapeHtml(d.name)}</div>`).join('')
      + `<div class="dev-chip">Deck: ${you.devDeckLeft}</div>`
    : `<div class="dev-chip">No dev cards · deck: ${you.devDeckLeft}</div>`;

  renderControls();
  renderPanels();
}

function renderControls() {
  const c = $('controls');
  const main = myTurn() && state.turnPhase === 'main';
  const roll = myTurn() && state.turnPhase === 'roll';
  const legal = state.legal || {};
  let html = '';

  if (roll) html += `<button class="primary" data-ctl="roll">🎲 Roll dice</button>`;
  if (main) {
    const buildingFree = state.freeRoads > 0;
    html += btn('road', '🛣️ Road', (legal.roads || []).length === 0);
    html += btn('settlement', '🛖 Settlement', (legal.settlements || []).length === 0);
    html += btn('city', '🏙️ City', (legal.cities || []).length === 0);
    if (mode) html += `<button class="ghost" data-ctl="cancel">Cancel</button>`;
    if (!buildingFree) {
      const canBuy = RES.every((r) => true) && affordDev() && state.you.devDeckLeft > 0;
      html += `<button data-ctl="buyDev" ${canBuy ? '' : 'disabled'}>🃏 Buy dev card</button>`;
      html += `<button class="ghost" data-ctl="trade">💱 Trade</button>`;
      if (state.variant2p) {
        const cost = state.you.tokenActionCost;
        const poor = state.you.tokens < cost;
        html += `<button class="ghost${showForced ? ' primary' : ''}" data-ctl="forcedTrade" ${poor ? 'disabled' : ''}>🤝 Forced trade (${cost}🎟️)</button>`;
        html += `<button class="ghost" data-ctl="tokenRobber" ${poor ? 'disabled' : ''}>🥷 Move robber (${cost}🎟️)</button>`;
        const hasKnight = state.you.dev.some((d) => d.type === 'knight');
        html += `<button class="ghost" data-ctl="sacrificeKnight" ${hasKnight ? '' : 'disabled'}>🗡️→🎟️ Sacrifice knight</button>`;
      }
      html += `<button class="primary" data-ctl="endTurn">End turn ⏭️</button>`;
    }
  }
  c.innerHTML = html;
}

function btn(m, label, disabled) {
  const active = mode === m ? ' primary' : ' ghost';
  return `<button class="${active.trim()}" data-ctl="mode-${m}" ${disabled && mode !== m ? 'disabled' : ''}>${label}</button>`;
}

function affordDev() {
  const r = state.you.resources;
  return r.sheep >= 1 && r.wheat >= 1 && r.ore >= 1;
}

function selectOptions(selected) {
  return RES.map((r) => `<option value="${r}"${r === selected ? ' selected' : ''}>${ICON[r]} ${r}</option>`).join('');
}

function renderPanels() {
  // Trade
  const tradeOpen = showTrade && myTurn() && state.turnPhase === 'main';
  $('trade-panel').classList.toggle('hidden', !tradeOpen);
  if (tradeOpen) {
    if (!$('trade-give').options.length) { $('trade-give').innerHTML = selectOptions('wood'); $('trade-receive').innerHTML = selectOptions('brick'); }
    $('trade-rates').textContent = 'Your rates — ' + RES.map((r) => `${r} ${state.you.tradeRates[r]}:1`).join(' · ');
  }

  // Discard
  const needDiscard = (state.discardNeeded || 0) > 0;
  $('discard-panel').classList.toggle('hidden', !needDiscard);
  if (needDiscard) {
    if (!discardSel) discardSel = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    $('discard-count').textContent = state.discardNeeded;
    const chosen = RES.reduce((n, r) => n + discardSel[r], 0);
    $('discard-controls').innerHTML = RES.map((r) =>
      `<div class="res-chip discard-chip"><span class="ico">${ICON[r]}</span>
        <button data-dish="-" data-r="${r}">−</button>
        <span class="cnt">${discardSel[r]}/${state.you.resources[r]}</span>
        <button data-dish="+" data-r="${r}">+</button></div>`).join('');
    $('discard-btn').disabled = chosen !== state.discardNeeded;
    $('discard-btn').textContent = `Discard ${chosen}/${state.discardNeeded}`;
  } else {
    discardSel = null;
  }

  // Year of Plenty
  const plentyOpen = showPlenty && myTurn();
  $('plenty-panel').classList.toggle('hidden', !plentyOpen);
  if (plentyOpen && !$('plenty-1').options.length) { $('plenty-1').innerHTML = selectOptions('wood'); $('plenty-2').innerHTML = selectOptions('brick'); }

  // Monopoly
  const monoOpen = showMonopoly && myTurn();
  $('monopoly-panel').classList.toggle('hidden', !monoOpen);
  if (monoOpen && !$('monopoly-res').options.length) $('monopoly-res').innerHTML = selectOptions('wood');

  // Send resources to another player — available any time during play.
  const inPlay = state.phase === 'play';
  $('send-toggle').classList.toggle('hidden', !inPlay);
  const sendOpen = showSend && inPlay;
  $('send-panel').classList.toggle('hidden', !sendOpen);
  if (sendOpen) {
    const others = state.players.filter((p) => p.id !== playerId);
    const prev = $('send-to').value;
    $('send-to').innerHTML = others.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    if (others.some((p) => p.id === prev)) $('send-to').value = prev;
    let total = 0;
    $('send-controls').innerHTML = RES.map((r) => {
      if (sendSel[r] > state.you.resources[r]) sendSel[r] = state.you.resources[r];
      total += sendSel[r];
      return `<div class="res-chip discard-chip"><span class="ico">${ICON[r]}</span>
        <button data-sendd="-" data-r="${r}">−</button>
        <span class="cnt">${sendSel[r]}/${state.you.resources[r]}</span>
        <button data-sendd="+" data-r="${r}">+</button></div>`;
    }).join('');
    $('send-btn').disabled = total === 0 || others.length === 0;
    $('send-btn').textContent = total > 0 ? `Send ${total} card${total === 1 ? '' : 's'}` : 'Send';
  }

  // Forced trade (2-player variant).
  const forcedOpen = showForced && myTurn() && state.turnPhase === 'main' && state.variant2p;
  $('forced-panel').classList.toggle('hidden', !forcedOpen);
  if (forcedOpen) {
    $('forced-cost').textContent = `${state.you.tokenActionCost}🎟️`;
    let total = 0;
    $('forced-controls').innerHTML = RES.map((r) => {
      if (forcedSel[r] > state.you.resources[r]) forcedSel[r] = state.you.resources[r];
      total += forcedSel[r];
      return `<div class="res-chip discard-chip"><span class="ico">${ICON[r]}</span>
        <button data-forcedd="-" data-r="${r}">−</button>
        <span class="cnt">${forcedSel[r]}/${state.you.resources[r]}</span>
        <button data-forcedd="+" data-r="${r}">+</button></div>`;
    }).join('');
    $('forced-btn').disabled = total !== 2;
    $('forced-btn').textContent = `Give ${total}/2 & take 2 random`;
  } else {
    forcedSel = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  }

  // Steal targets shown in the status area as buttons.
  if (state.turnPhase === 'steal' && myTurn() && state.stealTargets) {
    const btns = state.stealTargets.map((t) =>
      `<button data-steal="${t.id}" style="background:${t.color};color:#111">${escapeHtml(t.name)}</button>`).join(' ');
    $('action-hint').innerHTML = 'Steal from: ' + btns;
  }
}

function renderOver() {
  const w = state.players.find((p) => p.id === state.winnerId);
  $('winner-text').textContent = w ? `🏆 ${w.name} wins with ${w.vp} points!` : 'Game over!';
  $('again-btn').classList.toggle('hidden', playerId !== state.hostId);
  $('final-scoreboard').innerHTML = [...state.players].sort((a, b) => b.vp - a.vp).map((p) =>
    `<li><span class="left"><span class="swatch" style="background:${p.color}"></span>
      <span class="pname">${escapeHtml(p.name)}</span> ${playerTags(p)}</span>
      <span class="vp">${p.vp}</span></li>`).join('');
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------
$('join-btn').addEventListener('click', doJoin);
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
$('start-btn').addEventListener('click', () => action('start'));
$('again-btn').addEventListener('click', () => action('newGame'));
$('board').addEventListener('click', onBoardClick);

$('controls').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ctl]');
  if (!b) return;
  const ctl = b.getAttribute('data-ctl');
  if (ctl === 'roll') act('roll');
  else if (ctl === 'endTurn') { mode = null; showTrade = false; showForced = false; act('endTurn'); }
  else if (ctl === 'buyDev') act('buyDev');
  else if (ctl === 'trade') { showTrade = !showTrade; renderPanels(); }
  else if (ctl === 'forcedTrade') { showForced = !showForced; renderPanels(); }
  else if (ctl === 'tokenRobber') act('tokenRobber');
  else if (ctl === 'sacrificeKnight') act('sacrificeKnight');
  else if (ctl === 'cancel') { mode = null; renderGame(); }
  else if (ctl.startsWith('mode-')) {
    const m = ctl.slice(5);
    mode = mode === m ? null : m;
    renderGame();
  }
});

$('dev-cards').addEventListener('click', (e) => {
  const chip = e.target.closest('.dev-chip.playable');
  if (!chip) return;
  const type = chip.getAttribute('data-dev');
  if (type === 'plenty') { showPlenty = true; renderPanels(); }
  else if (type === 'monopoly') { showMonopoly = true; renderPanels(); }
  else if (type === 'road') { act('playDev', { cardType: 'road' }); }
  else if (type === 'knight') { act('playDev', { cardType: 'knight' }); }
});

$('trade-btn').addEventListener('click', () =>
  act('bankTrade', { give: $('trade-give').value, receive: $('trade-receive').value }));

$('plenty-btn').addEventListener('click', async () => {
  const r = await act('playDev', { cardType: 'plenty', r1: $('plenty-1').value, r2: $('plenty-2').value });
  if (!r.error) showPlenty = false;
});
$('monopoly-btn').addEventListener('click', async () => {
  const r = await act('playDev', { cardType: 'monopoly', resource: $('monopoly-res').value });
  if (!r.error) showMonopoly = false;
});

$('discard-controls').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dish]');
  if (!b) return;
  const r = b.getAttribute('data-r');
  const dir = b.getAttribute('data-dish');
  if (dir === '+' && discardSel[r] < state.you.resources[r]) discardSel[r]++;
  if (dir === '-' && discardSel[r] > 0) discardSel[r]--;
  renderPanels();
});
$('discard-btn').addEventListener('click', async () => {
  const r = await act('discard', { discard: discardSel });
  if (!r.error) discardSel = null;
});

$('action-hint').addEventListener('click', (e) => {
  const b = e.target.closest('[data-steal]');
  if (b) act('steal', { targetId: b.getAttribute('data-steal') });
});

$('variant-check').addEventListener('change', (e) => action('setVariant', { on: e.target.checked }));

$('forced-controls').addEventListener('click', (e) => {
  const b = e.target.closest('[data-forcedd]');
  if (!b) return;
  const r = b.getAttribute('data-r');
  const dir = b.getAttribute('data-forcedd');
  const total = RES.reduce((n, x) => n + forcedSel[x], 0);
  if (dir === '+' && forcedSel[r] < state.you.resources[r] && total < 2) forcedSel[r]++;
  if (dir === '-' && forcedSel[r] > 0) forcedSel[r]--;
  renderPanels();
});
$('forced-btn').addEventListener('click', async () => {
  const r = await act('forcedTrade', { give: forcedSel });
  if (!r.error) { forcedSel = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }; showForced = false; renderPanels(); }
});

$('send-toggle').addEventListener('click', () => { showSend = !showSend; renderPanels(); });
$('send-controls').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sendd]');
  if (!b) return;
  const r = b.getAttribute('data-r');
  const dir = b.getAttribute('data-sendd');
  if (dir === '+' && sendSel[r] < state.you.resources[r]) sendSel[r]++;
  if (dir === '-' && sendSel[r] > 0) sendSel[r]--;
  renderPanels();
});
$('send-btn').addEventListener('click', async () => {
  const r = await act('sendResources', { toId: $('send-to').value, gift: sendSel });
  if (!r.error) { sendSel = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }; showSend = false; renderPanels(); }
});

// Boot
if (playerId) connectEvents();
render();
