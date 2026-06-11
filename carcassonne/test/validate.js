'use strict';

// Structural validation of the tile set: 72 tiles total, and on every tile
// each edge/half-edge is consistently covered by exactly the right features.

const { TILE_TYPES, START_TILE } = require('../public/tiles.js');

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('FAIL: ' + msg); }
}

const total = Object.values(TILE_TYPES).reduce((a, t) => a + t.count, 0);
check(total === 72, `expected 72 tiles, got ${total}`);
check(TILE_TYPES[START_TILE], `start tile ${START_TILE} missing`);
check(Object.keys(TILE_TYPES).length === 24, 'expected 24 tile types');

for (const [name, def] of Object.entries(TILE_TYPES)) {
  check(def.edges.length === 4, `${name}: needs 4 edges`);
  check(def.edges.every((e) => 'CRF'.includes(e)), `${name}: bad edge letter`);
  check(def.count >= 1, `${name}: bad count`);

  const farms = def.features.filter((f) => f.type === 'farm');
  const halfOwner = new Map();
  for (const f of farms) {
    for (const h of f.halves) {
      check(h >= 0 && h < 8, `${name}: bad half-edge ${h}`);
      check(!halfOwner.has(h), `${name}: half-edge ${h} in two farms`);
      halfOwner.set(h, f);
    }
    check(Array.isArray(f.cities), `${name}: farm missing cities list`);
    for (const ci of f.cities) {
      check(def.features[ci] && def.features[ci].type === 'city',
        `${name}: farm cities ref ${ci} is not a city feature`);
    }
  }

  for (let e = 0; e < 4; e++) {
    const letter = def.edges[e];
    const halves = [e * 2, e * 2 + 1];
    const cityFeats = def.features.filter((f) => f.type === 'city' && f.edges.includes(e));
    const roadFeats = def.features.filter((f) => f.type === 'road' && f.edges.includes(e));
    if (letter === 'C') {
      check(cityFeats.length === 1, `${name}: city edge ${e} must be in exactly 1 city feature`);
      check(roadFeats.length === 0, `${name}: city edge ${e} also in a road`);
      for (const h of halves) check(!halfOwner.has(h), `${name}: city edge ${e} half ${h} in a farm`);
    } else {
      check(cityFeats.length === 0, `${name}: non-city edge ${e} in a city feature`);
      check(roadFeats.length === (letter === 'R' ? 1 : 0),
        `${name}: edge ${e} (${letter}) road feature count wrong`);
      for (const h of halves) check(halfOwner.has(h), `${name}: edge ${e} half ${h} not in any farm`);
    }
  }

  for (const f of def.features) {
    check(Array.isArray(f.spot) && f.spot.length === 2 &&
      f.spot.every((v) => v >= 0 && v <= 1),
      `${name}: feature ${f.type} needs a spot in [0,1]^2`);
  }
}

if (failures) {
  console.error(`${failures} validation failure(s)`);
  process.exit(1);
}
console.log('Tile set OK: 24 types, 72 tiles, all edges and farm half-edges consistent.');
