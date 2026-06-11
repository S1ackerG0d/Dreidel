'use strict';

// Visual smoke test (not run in CI): starts the LAN server, joins two
// browsers, plays scripted turns through the real client API, and
// screenshots the tile gallery, the active player's view, and the
// spectator's view.
//   node test/screenshot.js

const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require(require('child_process')
  .execSync('npm root -g').toString().trim() + '/playwright');

const URL = 'http://localhost:3699/';

(async () => {
  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '3699', CARC_TEST: '1' },
  });
  await new Promise((r) => setTimeout(r, 600));

  const browser = await chromium.launch();
  const watch = (page, who) => {
    page.on('pageerror', (e) => { console.error(`PAGE ERROR (${who}):`, e.message); process.exitCode = 1; });
    page.on('console', (m) => { if (m.type() === 'error') console.error(`CONSOLE (${who}):`, m.text()); });
  };

  // Separate contexts = separate localStorage = separate players.
  const annaCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const benCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const anna = await annaCtx.newPage();
  const ben = await benCtx.newPage();
  watch(anna, 'Anna');
  watch(ben, 'Ben');

  // 1. Gallery of every tile type (renderer only, no game needed).
  await anna.goto(URL);
  await anna.evaluate(() => {
    const c = document.getElementById('board');
    c.style.position = 'fixed'; c.style.inset = '0'; c.style.zIndex = '99';
    document.getElementById('join').classList.add('hidden');
    const x = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    c.width = 1400 * dpr; c.height = 900 * dpr;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = '#222a22'; x.fillRect(0, 0, 1400, 900);
    const types = Object.keys(TILE_TYPES);
    types.forEach((t, i) => {
      const px = 30 + (i % 8) * 170, py = 40 + Math.floor(i / 8) * 200;
      drawTile(x, t, 0, px, py, 140);
      x.fillStyle = '#fff'; x.font = '16px sans-serif';
      x.fillText(`${t} ×${TILE_TYPES[t].count}`, px, py + 162);
      TILE_TYPES[t].features.forEach((f) => {
        drawMeeple(x, px + f.spot[0] * 140, py + f.spot[1] * 140, 24,
          f.type === 'farm' ? '#3ba05a' : '#d23b3b', f.type === 'farm');
      });
    });
    x.fillStyle = '#fff'; x.font = '14px sans-serif';
    x.fillText('Gallery: red meeple = city/road/cloister spot, green lying meeple = farm spot', 30, 700);
  });
  await anna.screenshot({ path: path.join(__dirname, 'shot-gallery.png') });

  // 2. Join both players, start, and play scripted turns via the client API.
  await anna.reload();
  await anna.fill('#name-input', 'Anna');
  await anna.click('#join-btn');
  await ben.goto(URL);
  await ben.fill('#name-input', 'Ben');
  await ben.click('#join-btn');
  await anna.waitForSelector('#lobby-start:not(.hidden)');
  await anna.click('#lobby-start');
  await anna.waitForFunction(() => typeof state !== 'undefined' && state && state.phase === 'playing');
  await ben.waitForFunction(() => typeof state !== 'undefined' && state && state.phase === 'playing');

  const turn = async (page, tile, rot, x, y, fi) => {
    await page.evaluate(async ({ tile, rot, x, y, fi }) => {
      await act('forceDrawn', { tile, rot });
      await act('place', { x, y });
      if (fi !== null) await act('meeple', { fi });
      else if (state.placed) await act('skip');
    }, { tile, rot, x, y, fi });
  };

  await turn(anna, 'E', 3, 1, 0, 0);   // Anna completes the start city: +4
  await turn(ben, 'U', 0, 0, 1, 1);    // Ben farms east of the road
  await turn(anna, 'V', 0, 0, -1, 0);  // Anna claims the road
  await turn(ben, 'B', 0, 1, 1, 0);    // Ben's cloister

  // Anna mid-turn: tile in hand, legal cells highlighted on her screen.
  await anna.evaluate(() => act('forceDrawn', { tile: 'N', rot: 1 }));
  await anna.waitForFunction(() => state.drawn && state.drawn.type === 'N');
  await anna.screenshot({ path: path.join(__dirname, 'shot-game.png') });

  // Meeple markers on Anna's screen; Ben sees the same board as a spectator.
  await anna.evaluate(() => act('place', { x: 1, y: -1 }));
  await anna.waitForFunction(() => !!state.placed);
  await ben.waitForFunction(() => !!state.placed);
  await anna.screenshot({ path: path.join(__dirname, 'shot-meeple.png') });
  await ben.screenshot({ path: path.join(__dirname, 'shot-spectator.png') });

  const scores = await ben.evaluate(() =>
    state.players.map((p) => `${p.name}=${p.score}`).join(', '));
  console.log('Scores after scripted turns:', scores);

  await browser.close();
  server.kill();
  console.log('Screenshots written to test/shot-*.png');
})().catch((e) => { console.error(e); process.exit(1); });
