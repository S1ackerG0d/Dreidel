'use strict';

// ---------------------------------------------------------------------------
// Hot-seat UI: setup overlay, board canvas with pan/zoom, sidebar with
// players / current tile / log, meeple placement markers, game-over screen.
// ---------------------------------------------------------------------------

const PLAYER_COLORS = [
  { name: 'Red', value: '#d23b3b' },
  { name: 'Blue', value: '#3b6fd2' },
  { name: 'Yellow', value: '#e0b62a' },
  { name: 'Green', value: '#3ba05a' },
  { name: 'Black', value: '#3a3a3a' },
];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

let game = null;
let view = { panX: 0, panY: 0, scale: 96 }; // screen = world*scale + pan
let hoverCell = null;
let drag = null;

// ---- setup overlay ----------------------------------------------------------

function buildSetup() {
  const overlay = document.getElementById('setup');
  overlay.classList.remove('hidden');
  document.getElementById('gameover').classList.add('hidden');
  const namesDiv = document.getElementById('setup-names');
  const countSel = document.getElementById('setup-count');

  function renderNameInputs() {
    const n = +countSel.value;
    namesDiv.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const row = document.createElement('div');
      row.className = 'name-row';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = PLAYER_COLORS[i].value;
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 16;
      input.value = `Player ${i + 1}`;
      input.id = `setup-name-${i}`;
      row.append(dot, input);
      namesDiv.appendChild(row);
    }
  }
  countSel.onchange = renderNameInputs;
  renderNameInputs();

  document.getElementById('setup-start').onclick = () => {
    const n = +countSel.value;
    const players = [];
    for (let i = 0; i < n; i++) {
      const name = document.getElementById(`setup-name-${i}`).value.trim() || `Player ${i + 1}`;
      players.push({ name, color: PLAYER_COLORS[i].value });
    }
    overlay.classList.add('hidden');
    startGame(players);
  };
}

function startGame(players) {
  game = new Game(players);
  centerView();
  updateSidebar();
  render();
}

function centerView() {
  resizeCanvas();
  view.scale = Math.min(120, Math.max(64, Math.min(canvas.width, canvas.height) / 8));
  view.panX = canvas.clientWidth / 2 - 0.5 * view.scale;
  view.panY = canvas.clientHeight / 2 - 0.5 * view.scale;
}

// ---- coordinate helpers -------------------------------------------------------

function worldToScreen(wx, wy) {
  return [wx * view.scale + view.panX, wy * view.scale + view.panY];
}
function screenToWorld(sx, sy) {
  return [(sx - view.panX) / view.scale, (sy - view.panY) / view.scale];
}

// ---- rendering ----------------------------------------------------------------

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
  if (!game) return;
  const s = view.scale;

  // Placed tiles.
  for (const tile of game.board.values()) {
    const [px, py] = worldToScreen(tile.x, tile.y);
    drawTile(ctx, tile.type, tile.rot, px, py, s);
  }

  // Legal cells for the tile in hand.
  if (game.drawn && !game.placed && !game.over) {
    const cells = game.legalCells(game.drawn.type, game.drawn.rot);
    for (const [x, y] of cells) {
      const [px, py] = worldToScreen(x, y);
      const isHover = hoverCell && hoverCell[0] === x && hoverCell[1] === y;
      if (isHover) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        drawTile(ctx, game.drawn.type, game.drawn.rot, px, py, s);
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

  // Highlight the tile placed this turn.
  if (game.placed) {
    const [px, py] = worldToScreen(game.placed.x, game.placed.y);
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = 3;
    ctx.strokeRect(px + 1.5, py + 1.5, s - 3, s - 3);
  }

  // Meeples on the board.
  for (const tile of game.board.values()) {
    for (const fiStr of Object.keys(tile.meeples)) {
      const fi = +fiStr;
      const def = TILE_TYPES[tile.type].features[fi];
      const [rx, ry] = rotPoint(def.spot, tile.rot);
      const [mx, my] = worldToScreen(tile.x + rx, tile.y + ry);
      const color = game.players[tile.meeples[fi]].color;
      drawMeeple(ctx, mx, my, s * 0.3, color, def.type === 'farm');
    }
  }

  // Meeple placement markers.
  if (game.placed && !game.over) {
    const color = game.players[game.current].color;
    for (const { fi, x, y } of meepleMarkers()) {
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
      const def = TILE_TYPES[game.tileAt(game.placed.x, game.placed.y).type].features[fi];
      drawMeeple(ctx, mx, my, s * 0.22, color, def.type === 'farm');
    }
  }
}

function meepleMarkers() {
  const tile = game.tileAt(game.placed.x, game.placed.y);
  return game.meepleOptions().map((fi) => {
    const def = TILE_TYPES[tile.type].features[fi];
    const [rx, ry] = rotPoint(def.spot, tile.rot);
    return { fi, x: tile.x + rx, y: tile.y + ry };
  });
}

// ---- sidebar -------------------------------------------------------------------

function updateSidebar() {
  if (!game) return;
  const playersDiv = document.getElementById('players');
  playersDiv.innerHTML = '';
  game.players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'player' + (i === game.current && !game.over ? ' active' : '');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;
    const name = document.createElement('span');
    name.className = 'pname';
    name.textContent = p.name;
    const meeples = document.createElement('span');
    meeples.className = 'pmeeples';
    meeples.textContent = '▲'.repeat(p.meeples) || '–';
    meeples.title = `${p.meeples} meeples left`;
    const score = document.createElement('span');
    score.className = 'pscore';
    score.textContent = p.score;
    row.append(dot, name, meeples, score);
    playersDiv.appendChild(row);
  });

  // Tile preview.
  const prev = document.getElementById('tile-preview');
  const pctx = prev.getContext('2d');
  pctx.clearRect(0, 0, prev.width, prev.height);
  if (game.drawn && !game.over) {
    drawTile(pctx, game.drawn.type, game.drawn.rot, 5, 5, prev.width - 10);
  }
  document.getElementById('tiles-left').textContent =
    game.over ? 'No tiles left' : `${game.deck.length} tiles in the bag`;

  // Phase-dependent controls and hint.
  const placing = game.drawn && !game.placed && !game.over;
  document.getElementById('btn-rotate').disabled = !placing;
  document.getElementById('btn-skip').classList.toggle('hidden', !game.placed);
  document.getElementById('btn-undo').classList.toggle('hidden', !game.placed);
  const hint = document.getElementById('hint');
  if (game.over) {
    hint.textContent = 'Game over — final scores are in.';
  } else if (game.placed) {
    const n = game.meepleOptions().length;
    hint.textContent = n
      ? `${game.players[game.current].name}: click a white marker to place a meeple (farmers lie down), or skip.`
      : `${game.players[game.current].name}: no meeple can be placed here.`;
  } else {
    hint.textContent =
      `${game.players[game.current].name}: place the tile on a highlighted cell. R rotates, drag pans, scroll zooms.`;
  }

  // Log.
  const logDiv = document.getElementById('log');
  logDiv.innerHTML = '';
  for (const msg of game.log.slice(-40)) {
    const div = document.createElement('div');
    div.textContent = msg;
    logDiv.appendChild(div);
  }
  logDiv.scrollTop = logDiv.scrollHeight;
}

function afterAction() {
  updateSidebar();
  render();
  if (game.over) showGameOver();
}

function showGameOver() {
  const overlay = document.getElementById('gameover');
  overlay.classList.remove('hidden');
  const list = document.getElementById('final-standings');
  list.innerHTML = '';
  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}', '', ''];
  game.standings().forEach((p, rank) => {
    const row = document.createElement('div');
    row.className = 'standing';
    row.innerHTML =
      `<span class="medal">${medals[rank] || ''}</span>` +
      `<span class="dot" style="background:${p.color}"></span>` +
      `<span class="pname">${escapeHtml(p.name)}</span>` +
      `<span class="pscore">${p.score}</span>`;
    list.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- input ---------------------------------------------------------------------

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
  if (!game || !game.drawn || game.placed || game.over) return;
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
  if (wasDrag || !game || game.over) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) return;
  const [wx, wy] = screenToWorld(sx, sy);

  if (game.placed) {
    // Meeple phase: did we hit a marker?
    for (const m of meepleMarkers()) {
      const [mx, my] = worldToScreen(m.x, m.y);
      if (Math.hypot(mx - sx, my - sy) <= view.scale * 0.18) {
        game.placeMeeple(m.fi);
        game.endTurn();
        afterAction();
        return;
      }
    }
    return;
  }

  if (game.drawn) {
    const x = Math.floor(wx), y = Math.floor(wy);
    if (game.placeTile(x, y)) {
      if (game.meepleOptions().length === 0) {
        game.endTurn(); // nothing to decide
      }
      afterAction();
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
  if (!game || game.over) return;
  if (e.key === 'r' || e.key === 'R') {
    game.rotateDrawn();
    updateSidebar();
    render();
  }
});

document.getElementById('btn-rotate').onclick = () => {
  if (!game) return;
  game.rotateDrawn();
  updateSidebar();
  render();
};

document.getElementById('btn-skip').onclick = () => {
  if (!game || !game.placed) return;
  game.endTurn();
  afterAction();
};

document.getElementById('btn-undo').onclick = () => {
  if (!game || !game.placed) return;
  game.undoPlace();
  afterAction();
};

document.getElementById('btn-new').onclick = buildSetup;
document.getElementById('btn-again').onclick = buildSetup;

window.addEventListener('resize', render);

buildSetup();
