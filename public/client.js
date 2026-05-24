'use strict';

const $ = (id) => document.getElementById(id);

let playerId = localStorage.getItem('dreidel_player_id');
let state = null;
let evtSource = null;
let spinAnimTimer = null;

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
  if (!res.ok) {
    return { error: json.error || 'Something went wrong.' };
  }
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
  if (online) {
    el.textContent = 'Connected';
    el.className = 'status online';
  } else {
    el.textContent = 'Reconnecting…';
    el.className = 'status offline';
  }
}

// ---------------------------------------------------------------------------
// Join flow
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
  localStorage.setItem('dreidel_player_id', playerId);
  state = result.state;
  connectEvents();
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const LETTER_HEBREW = { nun: 'נ', gimel: 'ג', hey: 'ה', shin: 'ש' };

function render() {
  const known = state && state.players.some((p) => p.id === playerId);

  // If our stored id is no longer recognized (server restarted / we were
  // removed), drop back to the join screen.
  if (playerId && state && !known && state.phase === 'lobby') {
    localStorage.removeItem('dreidel_player_id');
    playerId = null;
    if (evtSource) evtSource.close();
  }

  const showJoin = !playerId || !known;
  $('join-screen').classList.toggle('hidden', !showJoin);
  $('lobby-screen').classList.toggle('hidden', !(state && state.phase === 'lobby' && !showJoin));
  $('game-screen').classList.toggle('hidden', !(state && state.phase !== 'lobby' && !showJoin));

  if (!state || showJoin) return;

  if (state.phase === 'lobby') renderLobby();
  else renderGame();
}

function tag(text, cls) {
  return `<span class="tag ${cls}">${text}</span>`;
}

function playerLine(p, opts = {}) {
  const tags = [];
  if (p.id === state.hostId) tags.push(tag('host', 'host'));
  if (p.id === playerId) tags.push(tag('you', 'you'));
  if (!p.connected) tags.push(tag('offline', 'offline'));
  const cls = [opts.current ? 'current' : '', p.out ? 'out' : ''].join(' ').trim();
  return `<li class="${cls}">
    <span><span class="pname">${escapeHtml(p.name)}</span>${tags.join('')}</span>
    <span class="gelt">${p.tokens}</span>
  </li>`;
}

function renderLobby() {
  const isHost = playerId === state.hostId;
  $('lobby-host-controls').classList.toggle('hidden', !isHost);
  $('lobby-wait').classList.toggle('hidden', isHost);

  if (isHost) {
    $('tokens-input').value = state.startingTokens;
    $('start-btn').disabled = state.players.length < 2;
  }

  $('lobby-players').innerHTML = state.players.map((p) => playerLine(p)).join('');
}

function renderGame() {
  $('pot-value').textContent = state.pot;

  $('game-players').innerHTML = state.players
    .map((p) => playerLine(p, { current: p.id === state.currentPlayerId }))
    .join('');

  const me = state.players.find((p) => p.id === playerId);
  const myTurn = state.phase === 'playing' && state.currentPlayerId === playerId;
  const spinBtn = $('spin-btn');
  spinBtn.classList.toggle('hidden', !myTurn);
  spinBtn.disabled = !myTurn;

  // Turn / status text
  const turnInfo = $('turn-info');
  if (state.phase === 'playing') {
    const current = state.players.find((p) => p.id === state.currentPlayerId);
    if (myTurn) turnInfo.textContent = "It's your turn!";
    else turnInfo.textContent = current ? `Waiting for ${current.name} to spin…` : '';
  } else {
    turnInfo.textContent = '';
  }

  // Last spin display
  if (state.lastSpin) {
    $('dreidel-letter').textContent = state.lastSpin.hebrew;
    $('spin-result').textContent = state.lastSpin.detail;
  } else {
    $('dreidel-letter').textContent = '🪀';
    $('spin-result').textContent = '';
  }

  // Game over
  const over = state.phase === 'gameover';
  $('gameover').classList.toggle('hidden', !over);
  if (over) {
    const winner = state.players.find((p) => p.id === state.winnerId);
    $('winner-text').textContent = winner
      ? `🎉 ${winner.name} wins with ${winner.tokens} gelt!`
      : 'Game over!';
    $('newgame-btn').classList.toggle('hidden', playerId !== state.hostId);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function doSpin() {
  const btn = $('spin-btn');
  btn.disabled = true;

  const dreidel = $('dreidel');
  dreidel.classList.add('spinning');
  $('spin-result').textContent = '';

  // Cycle letters while "spinning" for a little flourish.
  const keys = Object.values(LETTER_HEBREW);
  let i = 0;
  spinAnimTimer = setInterval(() => {
    $('dreidel-letter').textContent = keys[i++ % keys.length];
  }, 90);

  const result = await action('spin');

  // Let the animation play briefly before revealing the outcome.
  setTimeout(() => {
    clearInterval(spinAnimTimer);
    dreidel.classList.remove('spinning');
    if (result.error) {
      $('spin-result').textContent = result.error;
    }
    render(); // re-render with authoritative state (also via SSE)
  }, 800);
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
$('join-btn').addEventListener('click', doJoin);
$('name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doJoin();
});

$('start-btn').addEventListener('click', () => action('start'));
$('spin-btn').addEventListener('click', doSpin);
$('newgame-btn').addEventListener('click', () => action('newGame'));
$('tokens-input').addEventListener('change', (e) => {
  action('setStartingTokens', { value: Number(e.target.value) });
});

window.addEventListener('beforeunload', () => {
  // Best-effort leave only while in the lobby, so an accidental refresh
  // mid-game keeps your seat (reconnect happens via the stored playerId).
  if (playerId && state && state.phase === 'lobby' && navigator.sendBeacon) {
    navigator.sendBeacon(
      '/api/action',
      new Blob([JSON.stringify({ type: 'leave', playerId })], { type: 'application/json' })
    );
  }
});

// Boot
if (playerId) {
  connectEvents();
}
render();
