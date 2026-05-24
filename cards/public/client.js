'use strict';

const $ = (id) => document.getElementById(id);

let playerId = localStorage.getItem('cards_player_id');
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
  localStorage.setItem('cards_player_id', playerId);
  connectEvents();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cardHtml(card, { playable = false } = {}) {
  const cls = ['playing-card', card.color === 'red' ? 'red' : ''].join(' ');
  const data = playable ? ` data-card="${card.id}"` : '';
  return `<div class="${cls}"${data}>
    <span class="corner top">${card.rank}${card.symbol}</span>
    <span class="pip">${card.symbol}</span>
    <span class="corner bottom">${card.rank}${card.symbol}</span>
  </div>`;
}

function render() {
  const known = state && state.players.some((p) => p.id === playerId);
  if (playerId && state && !known) {
    // Our id is no longer recognised (server restarted / we were removed).
    localStorage.removeItem('cards_player_id');
    playerId = null;
    if (evtSource) evtSource.close();
  }

  const showJoin = !playerId || !known;
  $('join-screen').classList.toggle('hidden', !showJoin);
  $('table-screen').classList.toggle('hidden', showJoin);
  if (!state || showJoin) return;

  const isHost = playerId === state.hostId;
  $('dealer-controls').classList.toggle('hidden', !isHost);

  $('deck-count').textContent = state.deckCount;
  $('discard-count').textContent = state.discardCount;

  rebuildDiscard();

  // Hand
  const me = state.players.find((p) => p.id === playerId);
  const handEl = $('hand');
  if (me && me.hand && me.hand.length) {
    handEl.innerHTML = me.hand.map((c) => cardHtml(c, { playable: true })).join('');
    handEl.querySelectorAll('[data-card]').forEach((el) => {
      el.addEventListener('click', () => action('play', { cardId: el.dataset.card }));
    });
  } else {
    handEl.innerHTML = '<span class="empty-msg">No cards yet — draw or wait to be dealt.</span>';
  }

  $('draw-btn').disabled = state.deckCount === 0;
  $('take-discard-btn').disabled = state.discardCount === 0;

  // Players
  $('players').innerHTML = state.players.map((p) => {
    const tags = [];
    if (p.id === state.hostId) tags.push('<span class="tag host">dealer</span>');
    if (p.id === playerId) tags.push('<span class="tag you">you</span>');
    if (!p.connected) tags.push('<span class="tag offline">offline</span>');
    return `<li>
      <span><span class="pname">${escapeHtml(p.name)}</span>${tags.join('')}</span>
      <span class="count">${p.handCount}</span>
    </li>`;
  }).join('');

  // Log
  $('log').innerHTML = state.log.slice().reverse()
    .map((l) => `<li>${escapeHtml(l.message)}</li>`).join('');
}

function rebuildDiscard() {
  const wrap = $('discard-pile');
  if (!wrap) return;
  if (state.discardTop) {
    const c = state.discardTop;
    wrap.className = 'playing-card ' + (c.color === 'red' ? 'red' : '');
    wrap.innerHTML = `<span class="corner top">${c.rank}${c.symbol}</span>
      <span class="pip">${c.symbol}</span>
      <span class="corner bottom">${c.rank}${c.symbol}</span>`;
  } else {
    wrap.className = 'playing-card empty';
    wrap.innerHTML = '—';
  }
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
$('join-btn').addEventListener('click', doJoin);
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

$('start-btn').addEventListener('click', () => action('start'));
$('shuffle-btn').addEventListener('click', () => action('shuffle'));
$('recall-btn').addEventListener('click', () => action('recall'));
$('deal-btn').addEventListener('click', () =>
  action('deal', { count: Number($('deal-count').value) }));
$('draw-btn').addEventListener('click', () => action('draw'));
$('take-discard-btn').addEventListener('click', () => action('drawDiscard'));

// Boot
if (playerId) connectEvents();
render();
