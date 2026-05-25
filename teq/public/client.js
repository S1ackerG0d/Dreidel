'use strict';

const $ = (id) => document.getElementById(id);

let playerId = localStorage.getItem('teq_player_id');
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
  evtSource.onmessage = (e) => { state = JSON.parse(e.data); setConnection(true); render(); };
  evtSource.onerror = () => setConnection(false);
}

function setConnection(online) {
  const el = $('connection');
  el.textContent = online ? 'Connected' : 'Reconnecting…';
  el.className = 'status ' + (online ? 'online' : 'offline');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function playerTags(p) {
  const tags = [];
  if (state.organizerId === p.id) tags.push('<span class="tag organizer">organizer</span>');
  if (state.hostId === p.id) tags.push('<span class="tag host">host</span>');
  if (p.id === playerId) tags.push('<span class="tag you">you</span>');
  if (p.connected === false) tags.push('<span class="tag offline">offline</span>');
  return tags.join(' ');
}

function numberHint(n) {
  if (n === null || n === undefined) return '';
  if (n <= 2) return 'very low — answer should be pretty bad/weak/extreme in a bad way';
  if (n <= 4) return 'low — lean toward the weaker or less impressive end';
  if (n <= 6) return 'middle — a solid, reasonable answer, not too extreme either way';
  if (n <= 8) return 'high — lean toward impressive or intense';
  return 'very high — give the most impressive, powerful, or extreme answer you can';
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  const known = state && state.players && state.players.some((p) => p.id === playerId);
  if (playerId && state && !known) {
    localStorage.removeItem('teq_player_id');
    playerId = null;
    if (evtSource) evtSource.close();
  }

  const showJoin = !playerId || !known;
  const phase = state ? state.phase : null;
  const active = phase && phase !== 'lobby' && !showJoin;

  // Score bar
  $('score-bar').classList.toggle('hidden', !active);
  if (active) {
    $('good-score').textContent = `✓ Good: ${state.goodCards} / 3`;
    $('bad-score').textContent = `✗ Bad: ${state.badCards} / 3`;
  }

  $('join-screen').classList.toggle('hidden', !showJoin);
  $('lobby-screen').classList.toggle('hidden', !(phase === 'lobby' && !showJoin));
  $('answering-screen').classList.toggle('hidden', !(phase === 'answering' && !showJoin));
  $('ordering-screen').classList.toggle('hidden', !(phase === 'ordering' && !showJoin));
  $('roundover-screen').classList.toggle('hidden', !(phase === 'roundover' && !showJoin));
  $('gameover-screen').classList.toggle('hidden', !(phase === 'gameover' && !showJoin));

  if (!state || showJoin) return;

  if (phase === 'lobby') renderLobby();
  else if (phase === 'answering') renderAnswering();
  else if (phase === 'ordering') renderOrdering();
  else if (phase === 'roundover') renderRoundover();
  else if (phase === 'gameover') renderGameover();
}

function renderLobby() {
  const isHost = playerId === state.hostId;
  $('host-lobby').classList.toggle('hidden', !isHost);
  $('wait-host').classList.toggle('hidden', isHost);
  if (isHost) $('start-btn').disabled = (state.players || []).length < 3;
  $('lobby-players').innerHTML = (state.players || [])
    .map((p) => `<li><span class="left"><span class="pname">${escapeHtml(p.name)}</span> ${playerTags(p)}</span></li>`)
    .join('');
}

function renderAnswering() {
  const players = state.players || [];
  const org = players.find((p) => p.id === state.organizerId);
  const current = players.find((p) => p.id === state.currentAnswererId);
  const isMyTurn = playerId === state.currentAnswererId;
  const myNum = state.myNumber;

  // Header
  $('answering-organizer').textContent = org
    ? `Organizer: ${org.name}`
    : 'Organizer';
  $('answering-question').textContent = state.question || '';
  $('answering-progress').textContent =
    `${state.answeredCount || 0} of ${players.length} answered · ${state.allowedMistakes} mistake(s) allowed`;

  // Number badge
  const badge = $('my-number');
  if (myNum !== null && myNum !== undefined) {
    badge.textContent = myNum;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  // Input card vs wait card
  $('answer-input-card').classList.toggle('hidden', !isMyTurn);
  $('answer-wait-card').classList.toggle('hidden', isMyTurn);

  if (isMyTurn) {
    $('answer-scale-hint').textContent = myNum !== null
      ? `Your number is ${myNum} — ${numberHint(myNum)}.`
      : '';
    $('answer-input').focus();
  } else if (current) {
    $('answer-wait-msg').textContent = `Waiting for ${current.name} to answer…`;
    $('my-number-hint').textContent = myNum !== null
      ? `Your number is ${myNum} — ${numberHint(myNum)}.`
      : '';
  }

  // Answers so far
  const answers = state.answers || [];
  $('answers-so-far').classList.toggle('hidden', answers.length === 0);
  $('answers-list').innerHTML = answers
    .map((a) => `
      <div class="answer-entry">
        <span class="answer-player">${escapeHtml(a.playerName)}</span>
        <span class="answer-text">${escapeHtml(a.answer)}</span>
      </div>`)
    .join('');
}

function renderOrdering() {
  const players = state.players || [];
  const isOrg = playerId === state.organizerId;
  const org = players.find((p) => p.id === state.organizerId);
  const orderedIds = state.orderedIds || [];
  const allRevealedIds = state.allRevealedIds || [];
  const discardedIds = allRevealedIds.filter((id) => !orderedIds.includes(id));
  const unrevealedPlayers = players.filter((p) => !allRevealedIds.includes(p.id));

  $('ordering-organizer-label').textContent = isOrg
    ? 'You are the Organizer — click players to reveal their cards, lowest first'
    : `${org?.name || 'Organizer'} is choosing the order…`;
  $('ordering-question').textContent = state.question || '';
  $('mistake-counter').textContent =
    `Mistakes: ${state.mistakes} of ${state.allowedMistakes} allowed`;

  // Current sequence
  const seqPlayers = orderedIds.map((id) => players.find((p) => p.id === id)).filter(Boolean);
  $('sequence-empty').classList.toggle('hidden', seqPlayers.length > 0);
  $('current-sequence').innerHTML = seqPlayers
    .map((p) => `
      <div class="reveal-card ok">
        <span class="num-chip">${p.number}</span>
        <span class="reveal-name">${escapeHtml(p.name)}</span>
        <span class="reveal-answer">"${escapeHtml(p.answer || '')}"</span>
      </div>`)
    .join('');

  // Discarded
  $('discarded-card').classList.toggle('hidden', discardedIds.length === 0);
  if (discardedIds.length > 0) {
    const dp = discardedIds.map((id) => players.find((p) => p.id === id)).filter(Boolean);
    $('discarded-list').innerHTML = dp
      .map((p) => `
        <div class="reveal-card discarded">
          <span class="num-chip">${p.number}</span>
          <span class="reveal-name">${escapeHtml(p.name)}</span>
          <span class="reveal-answer">"${escapeHtml(p.answer || '')}"</span>
        </div>`)
      .join('');
  }

  // Unrevealed
  $('unrevealed-heading').textContent = isOrg
    ? `Click to reveal next (${unrevealedPlayers.length} left)`
    : `Not yet revealed (${unrevealedPlayers.length} left)`;
  $('unrevealed-empty').classList.toggle('hidden', unrevealedPlayers.length > 0);

  const list = $('unrevealed-list');
  list.innerHTML = '';
  for (const p of unrevealedPlayers) {
    const div = document.createElement('div');
    div.className = 'unrevealed-card' + (isOrg ? ' clickable' : '');
    div.innerHTML = `
      <span class="reveal-name">${escapeHtml(p.name)}</span>
      <span class="reveal-answer">"${escapeHtml(p.answer || '')}"</span>`;
    if (isOrg) {
      div.addEventListener('click', () => action('revealNext', { targetId: p.id }));
    }
    list.appendChild(div);
  }
}

function renderRoundover() {
  const isHost = playerId === state.hostId;
  const isGood = state.roundResult === 'good';

  const banner = $('result-banner');
  banner.className = 'card result-banner ' + (isGood ? 'good' : 'bad');
  $('round-result-text').textContent = isGood ? '✓ Good Card!' : '✗ Bad Card';
  $('score-summary').textContent =
    `Score: ${state.goodCards} Good  ·  ${state.badCards} Bad  ·  `
    + `(${state.mistakes} mistake${state.mistakes !== 1 ? 's' : ''}, ${state.allowedMistakes} allowed)`;

  $('roundover-question').textContent = state.question || '';

  // Sort all players by number
  const sorted = [...(state.players || [])].sort((a, b) => a.number - b.number);
  $('roundover-answers').innerHTML = sorted
    .map((p) => `
      <div class="roundover-row">
        <span class="num-chip">${p.number}</span>
        <div class="roundover-details">
          <span class="roundover-name">${escapeHtml(p.name)}</span>
          <span class="roundover-answer">"${escapeHtml(p.answer || '(no answer)')}"</span>
        </div>
      </div>`)
    .join('');

  $('next-round-btn').classList.toggle('hidden', !isHost);
  $('wait-next').classList.toggle('hidden', isHost);
}

function renderGameover() {
  const isHost = playerId === state.hostId;
  const isWin = state.goodCards >= 3;

  const banner = $('gameover-banner');
  banner.className = 'card result-banner ' + (isWin ? 'good' : 'bad');
  $('gameover-text').textContent = isWin ? '🎉 You all win!' : '💀 You all lose!';
  $('gameover-score').textContent =
    `Final: ${state.goodCards} Good Card${state.goodCards !== 1 ? 's' : ''}, ${state.badCards} Bad Card${state.badCards !== 1 ? 's' : ''}`;

  $('new-game-btn').classList.toggle('hidden', !isHost);
  $('wait-newgame').classList.toggle('hidden', isHost);

  $('gameover-log').innerHTML = (state.log || []).slice().reverse()
    .map((l) => `<li>${escapeHtml(l.message)}</li>`).join('');
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
$('join-btn').addEventListener('click', async () => {
  const name = $('name-input').value.trim();
  if (!name) { $('join-error').textContent = 'Please enter a name.'; return; }
  $('join-btn').disabled = true;
  const result = await action('join', { name });
  $('join-btn').disabled = false;
  if (result.error) { $('join-error').textContent = result.error; return; }
  playerId = result.playerId;
  localStorage.setItem('teq_player_id', playerId);
  connectEvents();
});

$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-btn').click(); });

$('start-btn').addEventListener('click', () => action('start'));

$('answer-btn').addEventListener('click', async () => {
  const answer = $('answer-input').value.trim();
  if (!answer) { $('answer-error').textContent = 'Please type an answer.'; return; }
  $('answer-error').textContent = '';
  $('answer-btn').disabled = true;
  const result = await action('submitAnswer', { answer });
  $('answer-btn').disabled = false;
  if (result.error) { $('answer-error').textContent = result.error; return; }
  $('answer-input').value = '';
});

$('answer-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('answer-btn').click(); }
});

$('next-round-btn').addEventListener('click', () => action('nextRound'));
$('new-game-btn').addEventListener('click', () => action('newGame'));

if (playerId) connectEvents();
render();
