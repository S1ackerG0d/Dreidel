'use strict';

const $ = (id) => document.getElementById(id);

let playerId = localStorage.getItem('spyfall_player_id');
let state = null;
let evtSource = null;
let timerInterval = null;
let clockSkew = 0; // serverNow - clientNow, to sync the countdown

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
    if (typeof state.serverNow === 'number') clockSkew = state.serverNow - Date.now();
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
  if (!name) {
    $('join-error').textContent = 'Please enter a name.';
    return;
  }
  $('join-btn').disabled = true;
  const result = await action('join', { name });
  $('join-btn').disabled = false;
  if (result.error) {
    $('join-error').textContent = result.error;
    return;
  }
  playerId = result.playerId;
  localStorage.setItem('spyfall_player_id', playerId);
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
  if (p.isSpy) tags.push('<span class="tag spy">spy</span>');
  if (!p.connected) tags.push('<span class="tag offline">offline</span>');
  return tags.join('');
}

function render() {
  const known = state && state.players.some((p) => p.id === playerId);
  if (playerId && state && !known) {
    localStorage.removeItem('spyfall_player_id');
    playerId = null;
    if (evtSource) evtSource.close();
  }

  const showJoin = !playerId || !known;
  $('join-screen').classList.toggle('hidden', !showJoin);
  $('lobby-screen').classList.toggle('hidden', !(state && state.phase === 'lobby' && !showJoin));
  $('play-screen').classList.toggle('hidden', !(state && state.phase === 'playing' && !showJoin));
  $('reveal-screen').classList.toggle('hidden', !(state && state.phase === 'reveal' && !showJoin));

  if (!state || showJoin) { stopTimer(); return; }

  const isHost = playerId === state.hostId;
  if (state.phase === 'lobby') renderLobby(isHost);
  else if (state.phase === 'playing') renderPlay(isHost);
  else renderReveal(isHost);
}

function renderLobby(isHost) {
  stopTimer();
  $('host-lobby').classList.toggle('hidden', !isHost);
  $('wait-host').classList.toggle('hidden', isHost);
  if (isHost) {
    $('duration-input').value = Math.round(state.durationSec / 60);
    $('start-btn').disabled = state.players.length < 3;
  }
  $('lobby-players').innerHTML = state.players
    .map((p) => `<li><span><span class="pname">${escapeHtml(p.name)}</span>${playerTags(p)}</span></li>`)
    .join('');
}

function renderPlay(isHost) {
  // Role card
  const roleEl = $('role-card');
  if (state.youAreSpy) {
    roleEl.className = 'card role-card spy';
    roleEl.innerHTML = `<div class="label">Your card</div>
      <div class="big">🕵️ You are the SPY</div>
      <p class="hint">You don't know the location. Blend in, ask clever questions, and figure out where everyone is.</p>`;
  } else if (state.yourCard) {
    roleEl.className = 'card role-card';
    roleEl.innerHTML = `<div class="label">Location</div>
      <div class="big">${escapeHtml(state.yourCard.location)}</div>
      <div class="label">Your role</div>
      <div class="role">${escapeHtml(state.yourCard.role)}</div>`;
  }

  // First player
  $('first-player').textContent = state.firstPlayerName
    ? `${state.firstPlayerName} asks the first question.`
    : '';

  // End-round button (host)
  $('end-btn').classList.toggle('hidden', !isHost);

  // Players (accusable)
  const accusing = !!state.accusation;
  $('play-players').innerHTML = state.players.map((p) => {
    const self = p.id === playerId;
    return `<li class="${self ? 'self' : ''}" data-id="${self || accusing ? '' : p.id}">
      <span><span class="pname">${escapeHtml(p.name)}</span>${playerTags(p)}</span>
    </li>`;
  }).join('');
  if (!accusing) {
    $('play-players').querySelectorAll('li[data-id]:not([data-id=""])').forEach((li) => {
      li.addEventListener('click', () => {
        const name = li.querySelector('.pname').textContent;
        if (confirm(`Accuse ${name} of being the spy? Everyone else will vote.`)) {
          action('accuse', { targetId: li.dataset.id });
        }
      });
    });
  }

  // Accusation box
  renderAccusation();

  // Spy guess box
  $('spy-guess-box').classList.toggle('hidden', !state.youAreSpy || accusing);
  if (state.youAreSpy && $('guess-select').children.length === 0) {
    $('guess-select').innerHTML = state.locations
      .map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  }

  // Locations reference
  $('locations').innerHTML = state.locations.map((l) => `<span>${escapeHtml(l)}</span>`).join('');

  // Log
  $('play-log').innerHTML = state.log.slice().reverse()
    .map((l) => `<li>${escapeHtml(l.message)}</li>`).join('');

  startTimer();
}

function renderAccusation() {
  const box = $('accusation-box');
  const a = state.accusation;
  if (!a) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = `<h3>${escapeHtml(a.accuserName)} accuses ${escapeHtml(a.accusedName)}</h3>
    <p class="votes">${a.votesIn} / ${a.votesNeeded} votes in. The vote must be unanimous to convict.</p>
    <div class="field">
      <button id="vote-yes" ${a.youCanVote ? '' : 'disabled'}>Guilty</button>
      <button id="vote-no" class="secondary" ${a.youCanVote ? '' : 'disabled'}>Innocent</button>
    </div>
    ${a.youCanVote ? '' : '<p class="hint">Waiting for other votes…</p>'}`;
  if (a.youCanVote) {
    $('vote-yes').addEventListener('click', () => action('vote', { value: true }));
    $('vote-no').addEventListener('click', () => action('vote', { value: false }));
  }
}

function renderReveal(isHost) {
  stopTimer();
  const r = state.result || {};
  const headlines = {
    spy_caught: '🎉 The group wins!',
    spy_escaped: '🕵️ The spy escaped!',
    spy_guessed: '🕵️ The spy wins!',
    spy_wrong_guess: '🎉 The group wins!',
    wrong_accusation: '🕵️ The spy wins!',
  };
  $('reveal-headline').textContent = headlines[r.outcome] || 'Round over';
  $('reveal-detail').textContent = r.message || '';

  $('host-reveal').classList.toggle('hidden', !isHost);
  $('reset-scores-btn').classList.toggle('hidden', !isHost);

  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  $('scoreboard').innerHTML = sorted.map((p) =>
    `<li><span><span class="pname">${escapeHtml(p.name)}</span>${playerTags(p)}</span>
      <span class="score">${p.score}</span></li>`).join('');
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------
function startTimer() {
  stopTimer();
  tickTimer();
  timerInterval = setInterval(tickTimer, 500);
}
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}
function tickTimer() {
  if (!state || !state.roundEndsAt) return;
  const remaining = Math.max(0, state.roundEndsAt - (Date.now() + clockSkew));
  const total = Math.ceil(remaining / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const el = $('timer');
  el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  el.classList.toggle('low', total <= 30);
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
$('join-btn').addEventListener('click', doJoin);
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

$('start-btn').addEventListener('click', () => action('start'));
$('duration-input').addEventListener('change', (e) =>
  action('setDuration', { minutes: Number(e.target.value) }));
$('end-btn').addEventListener('click', () => {
  if (confirm('End the round now? The spy will escape with 2 points.')) action('endRound');
});
$('guess-btn').addEventListener('click', () =>
  action('spyGuess', { location: $('guess-select').value }));
$('next-btn').addEventListener('click', () => action('start'));
$('lobby-btn').addEventListener('click', () => action('toLobby'));
$('reset-scores-btn').addEventListener('click', () => action('resetScores'));

// Boot
if (playerId) connectEvents();
render();
