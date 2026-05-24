'use strict';

const $ = (id) => document.getElementById(id);
const EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };

let playerId = localStorage.getItem('rps_player_id');
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
  localStorage.setItem('rps_player_id', playerId);
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
  if (!p.connected) tags.push('<span class="tag offline">offline</span>');
  return tags.join(' ');
}

function render() {
  const known = state && state.players.some((p) => p.id === playerId);
  if (playerId && state && !known) {
    localStorage.removeItem('rps_player_id');
    playerId = null;
    if (evtSource) evtSource.close();
  }

  const showJoin = !playerId || !known;
  const playing = state && (state.phase === 'picking' || state.phase === 'reveal') && !showJoin;
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
  if (isHost) {
    $('target-input').value = state.targetScore;
    $('start-btn').disabled = state.players.length < 2;
  }
  $('lobby-players').innerHTML = state.players
    .map((p) => `<li><span class="left"><span class="pname">${escapeHtml(p.name)}</span> ${playerTags(p)}</span></li>`)
    .join('');
}

function renderPlay() {
  const isHost = playerId === state.hostId;
  const picking = state.phase === 'picking';

  $('round-label').textContent = `Round ${state.round} · first to ${state.targetScore}`;

  // Throw buttons
  const buttons = document.querySelectorAll('.throw');
  buttons.forEach((b) => {
    const chosen = state.yourChoice === b.dataset.choice;
    b.classList.toggle('chosen', !!chosen);
    b.disabled = !picking || !!state.yourChoice;
  });

  if (picking) {
    $('phase-hint').textContent = state.yourChoice
      ? 'Locked in! Waiting for everyone else…'
      : 'Make your throw — it stays secret until everyone has locked in.';
  } else {
    $('phase-hint').textContent = 'Throws revealed! Points go to whoever beats an opponent.';
  }

  $('next-btn').classList.toggle('hidden', !(isHost && state.phase === 'reveal'));

  // Scoreboard
  $('scoreboard').innerHTML = [...state.players]
    .sort((a, b) => b.score - a.score)
    .map((p) => {
      let mid = '';
      if (picking) {
        mid = p.locked
          ? '<span class="tag locked">locked</span>'
          : '<span class="tag waiting">thinking…</span>';
      } else if (p.choice) {
        mid = `<span class="throw-emoji">${EMOJI[p.choice]}</span>` +
              (p.gained ? `<span class="gain">+${p.gained}</span>` : '');
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
  const w = state.players.find((p) => p.id === state.winnerId);
  $('winner-text').textContent = w ? `🏆 ${w.name} wins with ${w.score} points!` : 'Match over!';
  $('again-btn').classList.toggle('hidden', !isHost);

  $('final-scoreboard').innerHTML = [...state.players]
    .sort((a, b) => b.score - a.score)
    .map((p) => `<li>
      <span class="left"><span class="pname">${escapeHtml(p.name)}</span> ${playerTags(p)}
        ${p.choice ? `<span class="throw-emoji">${EMOJI[p.choice]}</span>` : ''}</span>
      <span class="score">${p.score}</span>
    </li>`).join('');
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
$('join-btn').addEventListener('click', doJoin);
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

$('start-btn').addEventListener('click', () => action('start'));
$('target-input').addEventListener('change', (e) =>
  action('setTarget', { value: Number(e.target.value) }));
$('next-btn').addEventListener('click', () => action('nextRound'));
$('again-btn').addEventListener('click', () => action('toLobby'));

document.querySelectorAll('.throw').forEach((b) => {
  b.addEventListener('click', () => action('pick', { choice: b.dataset.choice }));
});

// Boot
if (playerId) connectEvents();
render();
