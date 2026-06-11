'use strict';

// ---------------------------------------------------------------------------
// Procedural canvas rendering of tiles and meeples — no image assets.
// All tile art is drawn in the tile's base orientation inside a size×size
// square; rotation is a canvas transform.
// ---------------------------------------------------------------------------

const COLORS = {
  grass: '#74a14e',
  grassDark: '#5d8a3e',
  city: '#cda05c',
  cityWall: '#7c5a2b',
  cityRoof: '#a8632f',
  road: '#efe6c5',
  roadEdge: '#8d7c55',
  cloisterWall: '#d9cba8',
  cloisterRoof: '#a4402c',
  pennant: '#2f5fa8',
  tileBorder: 'rgba(40,30,10,0.35)',
};

function edgeMid(e) {
  return [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]][e];
}
function cornerBetween(e1, e2) {
  // Shared corner of two adjacent edges.
  const corners = { '0,1': [1, 0], '1,2': [1, 1], '2,3': [0, 1], '0,3': [0, 0] };
  return corners[[Math.min(e1, e2), Math.max(e1, e2)].join(',')];
}

// Rotate a unit-square point r quarter-turns clockwise.
function rotPoint(p, r) {
  let [x, y] = p;
  for (let i = 0; i < r; i++) [x, y] = [1 - y, x];
  return [x, y];
}

// --- tiles -----------------------------------------------------------------

function drawTile(ctx, type, rot, px, py, s) {
  ctx.save();
  ctx.translate(px + s / 2, py + s / 2);
  ctx.rotate((rot * Math.PI) / 2);
  ctx.translate(-s / 2, -s / 2);
  drawTileBase(ctx, type, s);
  ctx.restore();
  ctx.strokeStyle = COLORS.tileBorder;
  ctx.lineWidth = Math.max(1, s * 0.015);
  ctx.strokeRect(px, py, s, s);
}

function drawTileBase(ctx, type, s) {
  const def = TILE_TYPES[type];
  // Grass with a hint of texture.
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = COLORS.grassDark;
  for (let i = 0; i < 5; i++) {
    const gx = ((i * 53 + type.charCodeAt(0) * 17) % 83) / 100;
    const gy = ((i * 37 + type.charCodeAt(0) * 29) % 89) / 100;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.ellipse(gx * s, gy * s, s * 0.06, s * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const roads = def.features.filter((f) => f.type === 'road');
  const cities = def.features.filter((f) => f.type === 'city');
  const hasCloister = def.features.some((f) => f.type === 'cloister');
  const threeCity = cities.some((c) => c.edges.length === 3);

  // Roads first so city walls overlap road ends (e.g. gates on S/T tiles).
  drawRoads(ctx, roads, s, { hasCloister, threeCity });
  for (const c of cities) drawCity(ctx, c, s);
  if (roads.length >= 3) drawPlaza(ctx, s);
  if (hasCloister) drawCloister(ctx, s);
}

function drawRoads(ctx, roads, s, opts) {
  if (!roads.length) return;
  const paths = [];
  for (const f of roads) {
    const p = new Path2D();
    if (f.edges.length === 2) {
      const [a, b] = f.edges;
      const [ax, ay] = edgeMid(a);
      const [bx, by] = edgeMid(b);
      p.moveTo(ax * s, ay * s);
      if ((b - a + 4) % 4 === 2) {
        p.lineTo(bx * s, by * s); // straight through
      } else {
        // Curve that leaves both edges perpendicular (so the squared line
        // ends sit flush with the tile border) and hugs the shared corner.
        const d = 0.16;
        const c1x = ax + (0.5 - ax) * 2 * d, c1y = ay + (0.5 - ay) * 2 * d;
        const c2x = bx + (0.5 - bx) * 2 * d, c2y = by + (0.5 - by) * 2 * d;
        p.bezierCurveTo(c1x * s, c1y * s, c2x * s, c2y * s, bx * s, by * s);
      }
    } else {
      // Dead end: stops at the cloister, city gate, or the central junction.
      const [ax, ay] = edgeMid(f.edges[0]);
      const t = opts.hasCloister ? 0.76 : opts.threeCity ? 0.52 : 1.0;
      const ex = ax + (0.5 - ax) * t;
      const ey = ay + (0.5 - ay) * t;
      p.moveTo(ax * s, ay * s);
      p.lineTo(ex * s, ey * s);
    }
    paths.push(p);
  }
  ctx.lineCap = 'butt';
  ctx.strokeStyle = COLORS.roadEdge;
  ctx.lineWidth = s * 0.17;
  for (const p of paths) ctx.stroke(p);
  ctx.strokeStyle = COLORS.road;
  ctx.lineWidth = s * 0.12;
  for (const p of paths) ctx.stroke(p);
}

// Find the rotation that maps `canonical` edge set onto the feature's edges.
function rotationFor(edges, canonical) {
  for (let r = 0; r < 4; r++) {
    const rotated = canonical.map((e) => (e + r) % 4).sort().join(',');
    if (rotated === [...edges].sort().join(',')) return r;
  }
  return 0;
}

function drawCity(ctx, f, s) {
  const e = f.edges;
  ctx.save();
  ctx.fillStyle = COLORS.city;
  ctx.strokeStyle = COLORS.cityWall;
  ctx.lineWidth = s * 0.03;

  const inOrientation = (canonical, draw) => {
    const r = rotationFor(e, canonical);
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate((r * Math.PI) / 2);
    ctx.translate(-s / 2, -s / 2);
    draw();
    ctx.restore();
  };

  if (e.length === 4) {
    ctx.fillRect(0, 0, s, s);
    drawCityHouses(ctx, s, [0.3, 0.3], [0.7, 0.65], [0.5, 0.78], [0.72, 0.3]);
  } else if (e.length === 3) {
    // Canonical: open side S — boundary bows up from (0,1) to (1,1).
    inOrientation([0, 1, 3], () => {
      ctx.beginPath();
      ctx.moveTo(0, s); ctx.lineTo(0, 0); ctx.lineTo(s, 0); ctx.lineTo(s, s);
      ctx.quadraticCurveTo(0.5 * s, 0.55 * s, 0, s);
      ctx.fill(); ctx.stroke();
      drawCityHouses(ctx, s, [0.3, 0.32], [0.7, 0.32], [0.5, 0.58]);
    });
  } else if (e.length === 2 && (e[1] - e[0] + 4) % 4 === 2) {
    // Tube, canonical E–W.
    inOrientation([1, 3], () => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(0.5 * s, 0.35 * s, s, 0);
      ctx.lineTo(s, s);
      ctx.quadraticCurveTo(0.5 * s, 0.65 * s, 0, s);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      drawCityHouses(ctx, s, [0.3, 0.5], [0.7, 0.5]);
    });
  } else if (e.length === 2) {
    // Corner, canonical N+W.
    inOrientation([0, 3], () => {
      ctx.beginPath();
      ctx.moveTo(0, s); ctx.lineTo(0, 0); ctx.lineTo(s, 0);
      ctx.quadraticCurveTo(0.35 * s, 0.35 * s, 0, s);
      ctx.fill(); ctx.stroke();
      drawCityHouses(ctx, s, [0.24, 0.24], [0.5, 0.18], [0.18, 0.5]);
    });
  } else {
    // Cap, canonical N.
    inOrientation([0], () => {
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(s, 0);
      ctx.quadraticCurveTo(0.5 * s, 0.55 * s, 0, 0);
      ctx.fill(); ctx.stroke();
      drawCityHouses(ctx, s, [0.35, 0.14], [0.65, 0.14]);
    });
  }

  if (f.pennant) {
    const [px, py] = f.spot;
    drawPennant(ctx, (px + 0.14) * s, (py - 0.13) * s, s);
  }
  ctx.restore();
}

function drawCityHouses(ctx, s, ...spots) {
  ctx.save();
  for (const [hx, hy] of spots) {
    const w = s * 0.13, h = s * 0.1;
    const x = hx * s - w / 2, y = hy * s - h / 2;
    ctx.fillStyle = '#b08446';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = COLORS.cityRoof;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.12, y);
    ctx.lineTo(x + w / 2, y - h * 0.7);
    ctx.lineTo(x + w * 1.12, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawPennant(ctx, x, y, s) {
  const w = s * 0.1, h = s * 0.13;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - h / 2);
  ctx.lineTo(x + w / 2, y - h / 2);
  ctx.lineTo(x + w / 2, y + h * 0.15);
  ctx.lineTo(x, y + h / 2);
  ctx.lineTo(x - w / 2, y + h * 0.15);
  ctx.closePath();
  ctx.fillStyle = COLORS.pennant;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.012;
  ctx.stroke();
  ctx.restore();
}

function drawPlaza(ctx, s) {
  ctx.fillStyle = COLORS.road;
  ctx.strokeStyle = COLORS.roadEdge;
  ctx.lineWidth = s * 0.02;
  const w = s * 0.18;
  ctx.fillRect(s / 2 - w / 2, s / 2 - w / 2, w, w);
  ctx.strokeRect(s / 2 - w / 2, s / 2 - w / 2, w, w);
}

function drawCloister(ctx, s) {
  ctx.save();
  // walls
  ctx.fillStyle = COLORS.cloisterWall;
  ctx.strokeStyle = '#8a7a5a';
  ctx.lineWidth = s * 0.02;
  ctx.fillRect(s * 0.36, s * 0.42, s * 0.28, s * 0.22);
  ctx.strokeRect(s * 0.36, s * 0.42, s * 0.28, s * 0.22);
  // roof
  ctx.fillStyle = COLORS.cloisterRoof;
  ctx.beginPath();
  ctx.moveTo(s * 0.32, s * 0.42);
  ctx.lineTo(s * 0.5, s * 0.28);
  ctx.lineTo(s * 0.68, s * 0.42);
  ctx.closePath();
  ctx.fill();
  // cross
  ctx.strokeStyle = '#5a4a30';
  ctx.lineWidth = s * 0.025;
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.28); ctx.lineTo(s * 0.5, s * 0.18);
  ctx.moveTo(s * 0.465, s * 0.215); ctx.lineTo(s * 0.535, s * 0.215);
  ctx.stroke();
  // door
  ctx.fillStyle = '#6a5a3a';
  ctx.fillRect(s * 0.47, s * 0.54, s * 0.06, s * 0.1);
  ctx.restore();
}

// --- meeples -----------------------------------------------------------------

function meeplePath(ctx) {
  // Unit meeple centered on (0,0), roughly 1 tall.
  ctx.beginPath();
  ctx.arc(0, -0.3, 0.17, Math.PI * 0.85, Math.PI * 0.15);
  ctx.quadraticCurveTo(0.16, -0.16, 0.34, -0.1);   // right arm out
  ctx.quadraticCurveTo(0.46, -0.05, 0.42, 0.05);
  ctx.quadraticCurveTo(0.38, 0.13, 0.22, 0.08);    // right arm in
  ctx.quadraticCurveTo(0.3, 0.32, 0.34, 0.46);     // right leg
  ctx.quadraticCurveTo(0.2, 0.52, 0.08, 0.46);
  ctx.quadraticCurveTo(0.04, 0.28, 0, 0.22);       // crotch
  ctx.quadraticCurveTo(-0.04, 0.28, -0.08, 0.46);  // left leg
  ctx.quadraticCurveTo(-0.2, 0.52, -0.34, 0.46);
  ctx.quadraticCurveTo(-0.3, 0.32, -0.22, 0.08);
  ctx.quadraticCurveTo(-0.38, 0.13, -0.42, 0.05);  // left arm
  ctx.quadraticCurveTo(-0.46, -0.05, -0.34, -0.1);
  ctx.quadraticCurveTo(-0.16, -0.16, -0.12, -0.24);
  ctx.closePath();
}

function drawMeeple(ctx, px, py, size, color, lying) {
  ctx.save();
  ctx.translate(px, py);
  if (lying) ctx.rotate(Math.PI / 2); // farmers lie down in the fields
  ctx.scale(size, size);
  meeplePath(ctx);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();
  ctx.restore();
}

if (typeof module !== 'undefined') {
  module.exports = { drawTile, drawMeeple, rotPoint, COLORS };
}
