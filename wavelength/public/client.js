'use strict';

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

// Wheel geometry — must match the <svg> skeleton in index.html.
const CX = 210, CY = 215, R = 195;
const WEDGE = 9; // degrees per scoring wedge, matching the server

const PLAYER_COLORS = [
  '#ff6b6b', '#54d18c', '#2e9bff', '#f5c542', '#c77dff', '#ff9f43',
  '#4dd4c7', '#f368e0', '#a3cb38', '#8395a7', '#e84393', '#00cec9',
];

let playerId = localStorage.getItem('wavelength_player_id');
let state = null;
let evtSource = null;
let myDial = 90; // local needle position while guessing
let dragging = false;

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
  localStorage.setItem('wavelength_player_id', playerId);
  connectEvents();
}

// ---------------------------------------------------------------------------
// Wheel drawing helpers
// ---------------------------------------------------------------------------
function pt(angleDeg, radius = R) {
  const a = (angleDeg * Math.PI) / 180;
  return [CX - radius * Math.cos(a), CY - radius * Math.sin(a)];
}

function wedgePath(a1, a2) {
  const [x1, y1] = pt(a1);
  const [x2, y2] = pt(a2);
  return `M ${CX} ${CY} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function drawTicks() {
  const g = $('ticks');
  g.innerHTML = '';
  for (let a = 0; a <= 180; a += 15) {
    const [x1, y1] = pt(a, R - 8);
    const [x2, y2] = pt(a, R - 2);
    g.appendChild(svgEl('line', { x1, y1, x2, y2, class: 'tick' }));
  }
}

// Draw (or clear) the 2-3-4-3-2 scoring band around the target.
function drawBands(target) {
  const g = $('bands');
  g.innerHTML = '';
  if (target == null) return;
  const wedges = [
    { from: target - 2.5 * WEDGE, points: 2 },
    { from: target - 1.5 * WEDGE, points: 3 },
    { from: target - 0.5 * WEDGE, points: 4 },
    { from: target + 0.5 * WEDGE, points: 3 },
    { from: target + 1.5 * WEDGE, points: 2 },
  ];
  for (const w of wedges) {
    g.appendChild(svgEl('path', {
      d: wedgePath(w.from, w.from + WEDGE),
      class: 'band band-' + w.points,
    }));
    const [tx, ty] = pt(w.from + WEDGE / 2, R * 0.85);
    const label = svgEl('text', { x: tx, y: ty, class: 'band-label', 'text-anchor': 'middle' });
    label.textContent = w.points;
    g.appendChild(label);
  }
}

function setMyNeedle(angle, visible) {
  const n = $('my-needle');
  n.classList.toggle('hidden', !visible);
  if (!visible) return;
  const [x2, y2] = pt(angle, R * 0.96);
  n.setAttribute('x2', x2);
  n.setAttribute('y2', y2);
}

function drawResultNeedles(guesses) {
  const g = $('result-needles');
  g.innerHTML = '';
  if (!guesses) return;
  guesses.forEach((r) => {
    if (r.guess == null) return;
    const [x2, y2] = pt(r.guess, R * 0.96);
    g.appendChild(svgEl('line', {
      x1: CX, y1: CY, x2, y2,
      class: 'result-needle', stroke: colorFor(r.id),
    }));
  });
}

function colorFor(id) {
  const idx = state ? state.players.findIndex((p) => p.id === id) : -1;
  return PLAYER_COLORS[(idx + PLAYER_COLORS.length) % PLAYER_COLORS.length];
}

// ---------------------------------------------------------------------------
// Dial interaction (drag on the wheel + slider fallback)
// ---------------------------------------------------------------------------
function canDial() {
  return state && state.phase === 'guessing' &&
    playerId !== state.psychicId && state.yourGuess == null;
}

function angleFromEvent(e) {
  const svg = $('wheel');
  const rect = svg.getBoundingClientRect();
  const scale = 420 / rect.width;
  const x = (e.clientX - rect.left) * scale;
  const y = (e.clientY - rect.top) * scale;
  const a = (Math.atan2(CY - y, CX - x) * 180) / Math.PI;
  return Math.max(0, Math.min(180, a));
}

function setDial(angle) {
  myDial = Math.round(angle * 2) / 2;
  $('dial-slider').value = myDial;
  setMyNeedle(myDial, true);
}

const wheelSvg = document.getElementById('wheel');
wheelSvg.addEventListener('pointerdown', (e) => {
  if (!canDial()) return;
  dragging = true;
  wheelSvg.setPointerCapture(e.pointerId);
  setDial(angleFromEvent(e));
});
wheelSvg.addEventListener('pointermove', (e) => {
  if (dragging && canDial()) setDial(angleFromEvent(e));
});
wheelSvg.addEventListener('pointerup', () => { dragging = false; });
wheelSvg.addEventListener('pointercancel', () => { dragging = false; });

$('dial-slider').addEventListener('input', (e) => {
  if (canDial()) setDial(Number(e.target.value));
});

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
  if (state.psychicId && p.id === state.psychicId) tags.push('<span class="tag psychic">psychic</span>');
  if (!p.connected) tags.push('<span class="tag offline">offline</span>');
  return tags.join(' ');
}

function render() {
  const known = state && state.players.some((p) => p.id === playerId);
  if (playerId && state && !known) {
    localStorage.removeItem('wavelength_player_id');
    playerId = null;
    if (evtSource) evtSource.close();
  }

  const showJoin = !playerId || !known;
  const inRound = state && ['clue', 'guessing', 'reveal'].includes(state.phase) && !showJoin;
  const over = state && state.phase === 'gameover' && !showJoin;

  $('join-screen').classList.toggle('hidden', !showJoin);
  $('lobby-screen').classList.toggle('hidden', !(state && state.phase === 'lobby' && !showJoin));
  $('play-screen').classList.toggle('hidden', !inRound);
  $('over-screen').classList.toggle('hidden', !over);

  if (!state || showJoin) return;
  if (state.phase === 'lobby') renderLobby();
  else if (inRound) renderPlay();
  else renderOver();
}

function renderLobby() {
  const isHost = playerId === state.hostId;
  $('host-lobby').classList.toggle('hidden', !isHost);
  $('wait-host').classList.toggle('hidden', isHost);
  if (isHost) {
    if (document.activeElement !== $('cycles-input')) $('cycles-input').value = state.cycles;
    $('start-btn').disabled = state.players.length < 2;
  }
  $('lobby-players').innerHTML = state.players
    .map((p) => `<li><span class="left"><span class="pname">${escapeHtml(p.name)}</span> ${playerTags(p)}</span></li>`)
    .join('');
}

function renderPlay() {
  const isPsychic = playerId === state.psychicId;
  const isHost = playerId === state.hostId;
  const psy = state.players.find((p) => p.id === state.psychicId);
  const phase = state.phase;

  $('round-label').textContent =
    `Round ${state.round}/${state.totalRounds} · Psychic: ${psy ? psy.name : '—'}`;

  // Phase hint
  let hint = '';
  if (phase === 'clue') {
    hint = isPsychic
      ? 'Study the target, then give a clue that sits exactly there on your spectrum.'
      : 'The psychic is thinking of a clue — listen up!';
  } else if (phase === 'guessing') {
    hint = isPsychic
      ? 'No more hints! Watch them squirm.'
      : state.yourGuess != null
        ? 'Locked in! Waiting for the other guessers…'
        : 'Where on the spectrum is the clue? Set your dial and lock in.';
  } else {
    hint = 'The target is revealed — points for everyone in the band.';
  }
  $('phase-hint').textContent = hint;

  // Spectrum labels
  const sp = state.spectrum || {};
  $('left-label').textContent = sp.left ? '◀ ' + sp.left : '';
  $('right-label').textContent = sp.right ? sp.right + ' ▶' : '';

  // Wheel: bands are visible to the psychic pre-reveal, to everyone after.
  drawBands(state.target);
  drawResultNeedles(phase === 'reveal' && state.lastResult ? state.lastResult.guesses : null);

  // My needle: guessers see their own dial during guessing.
  if (phase === 'guessing' && !isPsychic) {
    if (state.yourGuess != null) myDial = state.yourGuess;
    setMyNeedle(myDial, true);
  } else {
    setMyNeedle(myDial, false);
  }

  // Controls
  $('psychic-clue').classList.toggle('hidden', !(phase === 'clue' && isPsychic));
  $('wait-clue').classList.toggle('hidden', !(phase === 'clue' && !isPsychic));
  $('guess-controls').classList.toggle('hidden', !(phase === 'guessing' && !isPsychic));
  $('psychic-wait').classList.toggle('hidden', !(phase === 'guessing' && isPsychic));
  $('reveal-panel').classList.toggle('hidden', phase !== 'reveal');

  if (phase === 'guessing' && !isPsychic) {
    const locked = state.yourGuess != null;
    $('lock-btn').disabled = locked;
    $('lock-btn').textContent = locked ? 'Locked in!' : 'Lock in guess';
    $('dial-slider').disabled = locked;
    if (locked) $('dial-slider').value = myDial;
  }

  if (phase === 'reveal' && state.lastResult) {
    const r = state.lastResult;
    const rows = r.guesses.map((g) => {
      const off = g.guess == null ? null : Math.abs(g.guess - r.target);
      return `<li>
        <span class="left">
          <span class="chip" style="background:${colorFor(g.id)}"></span>
          <span class="pname">${escapeHtml(g.name)}</span>
          <span class="hint">${off == null ? 'no guess' : off.toFixed(1) + '° off'}</span>
        </span>
        <span class="score">+${g.points}</span>
      </li>`;
    });
    rows.push(`<li>
      <span class="left"><span class="chip psychic-chip">🔮</span>
        <span class="pname">${escapeHtml(r.psychicName)}</span>
        <span class="hint">psychic bonus</span></span>
      <span class="score">+${r.psychicPoints}</span>
    </li>`);
    $('result-list').innerHTML = rows.join('');
    $('next-btn').classList.toggle('hidden', !(isHost || isPsychic));
    $('next-btn').textContent =
      state.round >= state.totalRounds ? 'Final scores' : 'Next round';
  }

  // Scoreboard
  $('scoreboard').innerHTML = [...state.players]
    .sort((a, b) => b.score - a.score)
    .map((p) => {
      let mid = '';
      if (phase === 'guessing' && p.id !== state.psychicId) {
        mid = p.locked
          ? '<span class="tag locked">locked</span>'
          : '<span class="tag waiting">dialing…</span>';
      }
      return `<li>
        <span class="left"><span class="pname">${escapeHtml(p.name)}</span> ${playerTags(p)} ${mid}</span>
        <span class="score">${p.score}</span>
      </li>`;
    }).join('');

  $('log').innerHTML = state.log.slice().reverse()
    .map((l) => `<li>${escapeHtml(l.message)}</li>`).join('');
}

function renderOver() {
  const isHost = playerId === state.hostId;
  const winners = state.players.filter((p) => state.winnerIds.includes(p.id));
  const names = winners.map((p) => p.name).join(' & ');
  $('winner-text').textContent = winners.length
    ? `🏆 ${names} win${winners.length === 1 ? 's' : ''} with ${winners[0].score} points!`
    : 'Game over!';
  $('again-btn').classList.toggle('hidden', !isHost);

  $('final-scoreboard').innerHTML = [...state.players]
    .sort((a, b) => b.score - a.score)
    .map((p) => `<li>
      <span class="left"><span class="pname">${escapeHtml(p.name)}</span> ${playerTags(p)}</span>
      <span class="score">${p.score}</span>
    </li>`).join('');
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
$('join-btn').addEventListener('click', doJoin);
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

$('start-btn').addEventListener('click', () => action('start'));
$('cycles-input').addEventListener('change', (e) =>
  action('setCycles', { value: Number(e.target.value) }));

function sendSpectrum() {
  action('setSpectrum', {
    left: $('left-input').value,
    right: $('right-input').value,
  });
}
$('left-input').addEventListener('change', sendSpectrum);
$('right-input').addEventListener('change', sendSpectrum);

$('clue-btn').addEventListener('click', () => { sendSpectrum(); action('clueGiven'); });
$('lock-btn').addEventListener('click', () => action('lockGuess', { value: myDial }));
$('reveal-btn').addEventListener('click', () => action('forceReveal'));
$('next-btn').addEventListener('click', () => {
  $('left-input').value = '';
  $('right-input').value = '';
  myDial = 90;
  $('dial-slider').value = 90;
  action('nextRound');
});
$('again-btn').addEventListener('click', () => action('toLobby'));

// Boot
drawTicks();
if (playerId) connectEvents();
render();
