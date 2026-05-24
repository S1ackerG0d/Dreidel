'use strict';

// ---------------------------------------------------------------------------
// Catan board geometry.
//
// The topology (hexes, vertices, edges and how they connect) is fixed and
// computed once. We generate it by laying out 19 pointy-top hexes in a radius-2
// hexagonal map, computing each hex's six corner pixel positions, and then
// de-duplicating corners that coincide into shared vertices, and corner pairs
// into shared edges. From that we derive all adjacency the game rules need.
//
// A fresh resource/number/port assignment is rolled per game on top of this.
// ---------------------------------------------------------------------------

const SIZE = 60; // hex circumradius in px (also the edge length)
const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

const round1 = (n) => Math.round(n * 10) / 10;
const pixKey = (x, y) => Math.round(x) + ',' + Math.round(y);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildTopology() {
  // 19 axial hex coordinates within distance 2 of the centre.
  const axials = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      const s = -q - r;
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= 2) axials.push({ q, r });
    }
  }
  // Top-to-bottom, left-to-right ordering for stable, readable ids.
  axials.sort((a, b) => a.r - b.r || a.q - b.q);

  const vertices = [];
  const vByKey = new Map();
  const edges = [];
  const eByKey = new Map();
  const hexes = [];

  function getVertex(x, y) {
    const k = pixKey(x, y);
    let v = vByKey.get(k);
    if (!v) {
      v = { id: 'v' + vertices.length, x: round1(x), y: round1(y), hexes: [], edges: [], adj: [] };
      vByKey.set(k, v);
      vertices.push(v);
    }
    return v;
  }

  function getEdge(va, vb) {
    const k = [va.id, vb.id].sort().join('|');
    let e = eByKey.get(k);
    if (!e) {
      e = {
        id: 'e' + edges.length,
        v: [va.id, vb.id],
        x1: va.x, y1: va.y, x2: vb.x, y2: vb.y,
        mx: round1((va.x + vb.x) / 2), my: round1((va.y + vb.y) / 2),
        hexes: [],
      };
      eByKey.set(k, e);
      edges.push(e);
      va.edges.push(e.id);
      vb.edges.push(e.id);
      va.adj.push(vb.id);
      vb.adj.push(va.id);
    }
    return e;
  }

  axials.forEach((ax, i) => {
    const cx = SIZE * Math.sqrt(3) * (ax.q + ax.r / 2);
    const cy = SIZE * 1.5 * ax.r;
    const corners = [];
    for (let c = 0; c < 6; c++) {
      const ang = (Math.PI / 180) * (60 * c - 30);
      corners.push(getVertex(cx + SIZE * Math.cos(ang), cy + SIZE * Math.sin(ang)));
    }
    const hex = {
      id: 'h' + i, q: ax.q, r: ax.r,
      cx: round1(cx), cy: round1(cy),
      corners: corners.map((v) => v.id), edges: [],
    };
    for (let c = 0; c < 6; c++) {
      const va = corners[c];
      const vb = corners[(c + 1) % 6];
      const e = getEdge(va, vb);
      hex.edges.push(e.id);
      if (!e.hexes.includes(hex.id)) e.hexes.push(hex.id);
      if (!va.hexes.includes(hex.id)) va.hexes.push(hex.id);
    }
    hexes.push(hex);
  });

  // Edges adjacent (sharing a vertex) to each edge — handy for road reasoning.
  for (const e of edges) {
    const set = new Set();
    for (const vid of e.v) {
      for (const eid of vertices.find((v) => v.id === vid).edges) {
        if (eid !== e.id) set.add(eid);
      }
    }
    e.adj = [...set];
  }

  // Drawing viewBox.
  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);
  const pad = SIZE * 1.6;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const viewBox = {
    x: round1(minX),
    y: round1(minY),
    w: round1(Math.max(...xs) - minX + pad),
    h: round1(Math.max(...ys) - minY + pad),
  };

  const vertexById = Object.fromEntries(vertices.map((v) => [v.id, v]));
  const edgeById = Object.fromEntries(edges.map((e) => [e.id, e]));
  const hexById = Object.fromEntries(hexes.map((h) => [h.id, h]));

  return { hexes, vertices, edges, vertexById, edgeById, hexById, viewBox, size: SIZE };
}

// Coastal edges touch exactly one hex; ports sit on a selection of them,
// spread evenly around the rim so two ports never share a vertex.
function placePorts(topology) {
  const coastal = topology.edges.filter((e) => e.hexes.length === 1);
  coastal.sort((a, b) => Math.atan2(a.my, a.mx) - Math.atan2(b.my, b.mx));
  const types = shuffle(['any', 'any', 'any', 'any', 'wood', 'brick', 'sheep', 'wheat', 'ore']);
  const ports = [];
  const usedV = new Set();
  for (let k = 0; k < 9; k++) {
    const start = Math.round((k * coastal.length) / 9);
    for (let t = 0; t < coastal.length; t++) {
      const e = coastal[(start + t) % coastal.length];
      if (!usedV.has(e.v[0]) && !usedV.has(e.v[1])) {
        ports.push({ edge: e.id, vertices: e.v.slice(), type: types[ports.length], mx: e.mx, my: e.my });
        usedV.add(e.v[0]);
        usedV.add(e.v[1]);
        break;
      }
    }
  }
  return ports;
}

// A fresh game's resource layout: 19 terrain tiles, 18 number tokens, robber on
// the desert, and a spread of harbours.
function randomizeBoard(topology) {
  const resPool = shuffle([
    'wood', 'wood', 'wood', 'wood',
    'sheep', 'sheep', 'sheep', 'sheep',
    'wheat', 'wheat', 'wheat', 'wheat',
    'brick', 'brick', 'brick',
    'ore', 'ore', 'ore',
    'desert',
  ]);
  const numbers = shuffle([5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11]);

  const hexes = {};
  let robber = null;
  let ni = 0;
  for (const hex of topology.hexes) {
    const resource = resPool[topology.hexes.indexOf(hex)];
    const h = { id: hex.id, resource, number: null, robber: false };
    if (resource === 'desert') {
      h.robber = true;
      robber = hex.id;
    } else {
      h.number = numbers[ni++];
    }
    hexes[hex.id] = h;
  }

  const ports = placePorts(topology);

  // Per-vertex / per-edge ownership starts empty.
  const vertices = {};
  for (const v of topology.vertices) vertices[v.id] = { building: null, owner: null };
  const edges = {};
  for (const e of topology.edges) edges[e.id] = { owner: null };

  // Tag vertices that grant a port.
  for (const p of ports) {
    for (const vid of p.vertices) vertices[vid].port = p.type;
  }

  return { hexes, vertices, edges, ports, robber };
}

module.exports = { buildTopology, randomizeBoard, RESOURCES, SIZE };
