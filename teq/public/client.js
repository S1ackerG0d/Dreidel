'use strict';

const $ = (id) => document.getElementById(id);

let playerId = localStorage.getItem('teq_player_id');
let state = null;
let evtSource = null;
let countdownInterval = null;

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
// Timer
// ---------------------------------------------------------------------------
function startCountdown() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  if (!state || !state.timerEnd) return;

  function update() {
    const remaining = Math.max(0, Math.ceil((state.timerEnd - Date.now()) / 1000));
    const text = remaining > 0 ? `⏱ ${remaining}s` : '⏰';
    ['timer-writing', 'timer-voting', 'timer-results'].forEach((id) => {
      const el = $(id);
      if (el) el.textContent = text;
    });
    if (remaining <= 0) { clearInterval(countdownInterval); countdownInterval = null; }
  }
  update();
  countdownInterval = setInterval(update, 500);
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
  if (p.id === state.hostId) tags.push('<span class="tag host">host</span>');
  if (p.id === playerId) tags.push('<span class="tag you">you</span>');
  if (!p.connected) tags.push('<span class="tag offline">offline</span>');
  return tags.join(' ');
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }

  const known = state && state.players.some((p) => p.id === playerId);
  if (playerId && state && !known) {
    localStorage.removeItem('teq_player_id');
    playerId = null;
    if (evtSource) evtSource.close();
  }

  const showJoin = !playerId || !known;
  const phase = state ? state.phase : null;

  $('join-screen').classList.toggle('hidden', !showJoin);
  $('lobby-screen').classList.toggle('hidden', !(phase === 'lobby' && !showJoin));
  $('writing-screen').classList.toggle('hidden', !(phase === 'writing' && !showJoin));
  $('voting-screen').classList.toggle('hidden', !(phase === 'voting' && !showJoin));
  $('results-screen').classList.toggle('hidden', !(phase === 'results' && !showJoin));
  $('over-screen').classList.toggle('hidden', !(phase === 'gameover' && !showJoin));

  if (!state || showJoin) return;

  if (phase === 'lobby') renderLobby();
  else if (phase === 'writing') renderWriting();
  else if (phase === 'voting') renderVoting();
  else if (phase === 'results') renderResults();
  else if (phase === 'gameover') renderGameover();
}

function renderLobby() {
  const isHost = playerId === state.hostId;
  $('host-lobby').classList.toggle('hidden', !isHost);
  $('wait-host').classList.toggle('hidden', isHost);
  if (isHost) {
    $('rounds-input').value = state.totalRounds;
    $('start-btn').disabled = state.players.length < 2;
  }
  $('lobby-players').innerHTML = state.players
    .map((p) => `<li><span class="left"><span class="pname">${escapeHtml(p.name)}</span> ${playerTags(p)}</span></li>`)
    .join('');
}

function renderWriting() {
  $('writing-round').textContent = `Round ${state.round} of ${state.totalRounds}`;
  $('writing-prompt').textContent = state.currentPrompt || '';
  $('submitted-count').textContent = `${state.submittedCount} of ${state.expectedCount} submitted`;

  const submitted = state.myResponseSubmitted;
  $('response-area').classList.toggle('hidden', !!submitted);
  $('submitted-msg').classList.toggle('hidden', !submitted);

  startCountdown();
}

function renderVoting() {
  $('voting-round').textContent = `Round ${state.round} of ${state.totalRounds}`;
  $('voting-prompt').textContent = state.currentPrompt || '';
  $('voted-count').textContent = `${state.votedCount} of ${state.expectedCount} voted`;

  const container = $('responses-list');
  container.innerHTML = '';
  const hasVoted = state.myVoteIdx !== null;

  for (const r of (state.responses || [])) {
    const isMyVote = state.myVoteIdx === r.idx;
    const div = document.createElement('div');
    div.className = 'response-card' +
      (r.canVote ? ' voteable' : ' own-response') +
      (isMyVote ? ' my-vote' : '');

    const textP = document.createElement('p');
    textP.className = 'response-text';
    textP.textContent = r.text;
    div.appendChild(textP);

    if (!r.canVote) {
      const lbl = document.createElement('p');
      lbl.className = 'own-label';
      lbl.textContent = '← Your response';
      div.appendChild(lbl);
    } else {
      const btn = document.createElement('button');
      btn.className = 'vote-btn' + (isMyVote ? ' voted' : '');
      btn.textContent = isMyVote ? '✓ Voted!' : 'Vote for this';
      btn.disabled = hasVoted;
      btn.addEventListener('click', () => action('vote', { idx: r.idx }));
      div.appendChild(btn);
    }

    container.appendChild(div);
  }

  startCountdown();
}

function renderResults() {
  const isHost = playerId === state.hostId;
  $('results-round').textContent = `Round ${state.round} of ${state.totalRounds}`;
  $('next-round-btn').classList.toggle('hidden', !isHost);

  const results = state.roundResults || [];
  const maxVotes = Math.max(...results.map((r) => r.votes), 0);

  $('results-list').innerHTML = [...results]
    .sort((a, b) => b.votes - a.votes)
    .map((r) => `
      <div class="result-card${r.votes === maxVotes && maxVotes > 0 ? ' winner' : ''}">
        <p class="result-text">${escapeHtml(r.text)}</p>
        <div class="result-meta">
          <span class="result-author">${escapeHtml(r.playerName)}</span>
          <span class="result-votes">${r.votes} vote${r.votes !== 1 ? 's' : ''}${r.bonus ? ' 🏆 +2' : ''}</span>
        </div>
      </div>
    `).join('');

  $('results-scoreboard').innerHTML = [...state.players]
    .sort((a, b) => b.score - a.score)
    .map((p) => `<li>
      <span class="left"><span class="pname">${escapeHtml(p.name)}</span> ${playerTags(p)}</span>
      <span class="score">${p.score}</span>
    </li>`).join('');

  $('results-log').innerHTML = state.log.slice().reverse()
    .map((l) => `<li>${escapeHtml(l.message)}</li>`).join('');

  startCountdown();
}

function renderGameover() {
  const isHost = playerId === state.hostId;
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  $('winner-text').textContent = winner
    ? `🏆 ${winner.name} wins with ${winner.score} points!`
    : 'Game over!';
  $('play-again-btn').classList.toggle('hidden', !isHost);

  $('final-scoreboard').innerHTML = sorted
    .map((p) => `<li>
      <span class="left"><span class="pname">${escapeHtml(p.name)}</span> ${playerTags(p)}</span>
      <span class="score">${p.score}</span>
    </li>`).join('');
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
$('rounds-input').addEventListener('change', (e) =>
  action('setRounds', { value: Number(e.target.value) }));

$('submit-btn').addEventListener('click', async () => {
  const text = $('response-input').value.trim();
  if (!text) { $('submit-error').textContent = 'Please write something first.'; return; }
  $('submit-error').textContent = '';
  $('submit-btn').disabled = true;
  const result = await action('submit', { text });
  $('submit-btn').disabled = false;
  if (result.error) { $('submit-error').textContent = result.error; }
});

$('response-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('submit-btn').click(); }
});

$('next-round-btn').addEventListener('click', () => action('nextRound'));
$('play-again-btn').addEventListener('click', () => action('toLobby'));

// Boot
if (playerId) connectEvents();
render();
