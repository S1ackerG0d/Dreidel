'use strict';

// Visual smoke test (not run in CI): serves ./public, renders a gallery of
// all 24 tile types, then plays a few scripted turns and screenshots the UI.
//   node test/screenshot.js

const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require(require('child_process')
  .execSync('npm root -g').toString().trim() + '/playwright');

(async () => {
  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '3699' },
  });
  await new Promise((r) => setTimeout(r, 600));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE:', m.text()); });

  await page.goto('http://localhost:3699/');

  // 1. Gallery of every tile type at every rotation 0.
  await page.evaluate(() => {
    const c = document.getElementById('board');
    c.style.position = 'fixed'; c.style.inset = '0'; c.style.zIndex = '99';
    document.getElementById('setup').classList.add('hidden');
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
      // mark every meeple spot
      TILE_TYPES[t].features.forEach((f) => {
        drawMeeple(x, px + f.spot[0] * 140, py + f.spot[1] * 140, 24,
          f.type === 'farm' ? '#3ba05a' : '#d23b3b', f.type === 'farm');
      });
    });
    x.fillStyle = '#fff'; x.font = '14px sans-serif';
    x.fillText('Gallery: red meeple = city/road/cloister spot, green lying meeple = farm spot', 30, 700);
  });
  await page.screenshot({ path: path.join(__dirname, 'shot-gallery.png') });

  // 2. Scripted game: a few placements, a meeple, a completed city.
  await page.reload();
  await page.click('#setup-start');
  await page.evaluate(() => {
    // deterministic moves through the real engine + renderer
    game.drawn = { type: 'E', rot: 3 };
    game.placeTile(1, 0);
    game.placeMeeple(0);           // Player 1 claims the city (completes: +4)
    game.endTurn();
    game.drawn = { type: 'U', rot: 0 };
    game.placeTile(0, 1);
    game.placeMeeple(1);           // Player 2 farms east of the road
    game.endTurn();
    game.drawn = { type: 'V', rot: 0 };
    game.placeTile(0, -1);
    game.placeMeeple(0);           // Player 1 takes the road
    game.endTurn();
    game.drawn = { type: 'B', rot: 0 };
    game.placeTile(1, 1);
    game.placeMeeple(0);           // Player 2's cloister
    game.endTurn();
    game.drawn = { type: 'W', rot: 0 };
    updateSidebar(); render();     // mid-turn: legal cells highlighted
  });
  await page.screenshot({ path: path.join(__dirname, 'shot-game.png') });

  // 3. Meeple placement markers.
  await page.evaluate(() => {
    game.drawn = { type: 'N', rot: 1 };
    game.placeTile(1, -1);
    updateSidebar(); render();
  });
  await page.screenshot({ path: path.join(__dirname, 'shot-meeple.png') });

  const scores = await page.evaluate(() => game.players.map((p) => p.name + '=' + p.score).join(', '));
  console.log('Scores after scripted turns:', scores);

  await browser.close();
  server.kill();
  console.log('Screenshots written to test/shot-*.png');
})().catch((e) => { console.error(e); process.exit(1); });
