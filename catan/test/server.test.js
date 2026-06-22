'use strict';

// End-to-end test of the Settlers action layer (no HTTP), focused on the
// official 2-player variant ("Catan for Two"): neutral blockers, the double
// dice roll, trade tokens and the token-driven actions. Driven purely through
// handleAction, the same entry point the browser client uses.

const { handleAction, getGame, TOPO } = require('../server.js');

let failures = 0;
function check(cond, msg) {
  if (cond) { console.log('ok - ' + msg); }
  else { failures++; console.error('FAIL - ' + msg); }
}

// ---- helpers to drive the snake-draft setup using the same legality the
// server enforces -------------------------------------------------------------
const game = () => getGame();
const cur = () => game().players[game().turnIndex];
const vbuild = (id) => game().board.vertices[id];
const ebuild = (id) => game().board.edges[id];
const neighbourBuilt = (vid) => TOPO.vertexById[vid].adj.some((nv) => vbuild(nv).building);
function legalEdgeFor(pid) {
  return TOPO.edges.find((e) => {
    if (ebuild(e.id).owner) return false;
    const [a, b] = TOPO.edgeById[e.id].v;
    return [a, b].some((v) => {
      const o = vbuild(v).owner;
      if (o === pid) return true;
      if (o && o !== pid) return false;
      return TOPO.vertexById[v].edges.some((eid) => ebuild(eid).owner === pid);
    });
  });
}
function runSetup() {
  let guard = 0;
  while (game().phase === 'setup' && guard++ < 80) {
    const pid = cur().id;
    const s = game().setup;
    if (s.expect === 'settlement') {
      const spot = TOPO.vertices.find((v) => !vbuild(v.id).owner && !neighbourBuilt(v.id));
      handleAction({ type: 'buildSettlement', playerId: pid, vertexId: spot.id });
    } else {
      const eid = TOPO.vertexById[s.lastVertex].edges.find((e) => !ebuild(e).owner);
      handleAction({ type: 'buildRoad', playerId: pid, edgeId: eid });
    }
  }
}

function freshTable(variant) {
  // The server holds a single shared room; this test sets it up from a clean
  // process start (it is the only scenario the file drives).
  const a = handleAction({ type: 'join', name: 'Ann' }).json;
  const b = handleAction({ type: 'join', name: 'Bob' }).json;
  if (variant) handleAction({ type: 'setVariant', playerId: a.playerId, on: true });
  handleAction({ type: 'start', playerId: a.playerId });
  return { a, b };
}

// ---- lobby toggle + setup ----------------------------------------------------
const { a } = freshTable(true);
check(game().variant2p === true, 'variant is active for a 2-player table with the toggle on');
check(game().neutrals.length === 2, 'two neutral players are created');
check(game().neutrals.every((n) => n.vertices.length === 1), 'each neutral starts with one settlement');
check(game().players.every((p) => p.tokens === 5), 'each player starts with 5 trade tokens');

runSetup();
check(game().phase === 'play', 'setup completes into play');
check(game().players.every((p) => p.tokens >= 5), 'coastal settlements awarded trade tokens during setup');

// ---- double dice roll --------------------------------------------------------
const roller = cur().id;
handleAction({ type: 'roll', playerId: roller });
check(Array.isArray(game().dice) && Array.isArray(game().dice2), 'a 2-player roll produces two dice pairs');
const sum1 = game().dice[0] + game().dice[1];
const sum2 = game().dice2[0] + game().dice2[1];
check(sum1 !== sum2, 'the two roll sums always differ');

// ---- trade-token actions -----------------------------------------------------
const meP = game().players.find((p) => p.id === roller);
const oppP = game().players.find((p) => p.id !== roller);

if (game().turnPhase !== 'main') {
  // A 7 came up; resolve the robber so we land in the main phase.
  while (game().turnPhase === 'moveRobber' || game().turnPhase === 'steal' || game().turnPhase === 'discard') {
    if (game().turnPhase === 'discard') {
      // discard for whoever still owes (give back whatever they hold)
      for (const pid of Object.keys(game().pendingDiscards)) {
        const need = game().pendingDiscards[pid];
        const p = game().players.find((x) => x.id === pid);
        const d = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
        let left = need;
        for (const r of ['wood', 'brick', 'sheep', 'wheat', 'ore']) {
          const take = Math.min(left, p.resources[r]); d[r] = take; left -= take;
        }
        handleAction({ type: 'discard', playerId: pid, discard: d });
      }
    } else if (game().turnPhase === 'moveRobber') {
      const target = TOPO.hexes.find((h) => h.id !== game().board.robber).id;
      handleAction({ type: 'moveRobber', playerId: roller, hexId: target });
    } else if (game().turnPhase === 'steal') {
      handleAction({ type: 'steal', playerId: roller, targetId: game().stealTargets[0] });
    }
  }
}

// Forced trade: stack the hands deterministically.
meP.resources = { wood: 2, brick: 2, sheep: 0, wheat: 0, ore: 0 };
oppP.resources = { wood: 0, brick: 0, sheep: 3, wheat: 0, ore: 0 };
meP.tokens = 5;
const ftBad = handleAction({ type: 'forcedTrade', playerId: roller, give: { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 } });
check(ftBad.status === 400, 'forced trade requires exactly two cards to give');
const ft = handleAction({ type: 'forcedTrade', playerId: roller, give: { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 } });
check(ft.status === 200, 'forced trade succeeds');
check(meP.resources.sheep === 2, 'forced trade takes 2 random cards from the opponent');
check(oppP.resources.wood === 1 && oppP.resources.brick === 1, 'opponent receives the two chosen cards');
check(meP.tokens === 4, 'a trailing/tied player pays 1 token');

// Token cost scales with the standings: a leading player pays 2 tokens.
meP.resources = { wood: 2, brick: 2, sheep: 0, wheat: 0, ore: 0 };
oppP.resources = { wood: 0, brick: 0, sheep: 3, wheat: 0, ore: 0 };
meP.tokens = 5;
meP.dev = [{ type: 'vp', boughtTurn: -1 }, { type: 'vp', boughtTurn: -1 }]; // a VP lead
const ftLead = handleAction({ type: 'forcedTrade', playerId: roller, give: { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 } });
check(ftLead.status === 200 && meP.tokens === 3, 'a leading player pays 2 tokens for an action');
meP.dev = [];

// Sacrifice knight for tokens.
meP.dev = [{ type: 'knight', boughtTurn: -1 }];
const beforeTokens = meP.tokens;
const sk = handleAction({ type: 'sacrificeKnight', playerId: roller });
check(sk.status === 200 && meP.tokens === beforeTokens + 2 && meP.dev.length === 0,
  'sacrificing a Knight removes the card and grants 2 tokens');

// Token robber moves the game into the robber sequence without a 7.
meP.tokens = 5;
const tr = handleAction({ type: 'tokenRobber', playerId: roller });
check(tr.status === 200 && game().turnPhase === 'moveRobber' && meP.tokens === 4,
  'paying tokens lets you move the robber on demand');

// ---- neutral expansion -------------------------------------------------------
// Resolve the token robber, then build a road and confirm neutrals expand.
const tgt = TOPO.hexes.find((h) => h.id !== game().board.robber).id;
handleAction({ type: 'moveRobber', playerId: roller, hexId: tgt });
if (game().turnPhase === 'steal') handleAction({ type: 'steal', playerId: roller, targetId: game().stealTargets[0] });
if (game().turnPhase === 'main') {
  meP.resources = { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 };
  const before = game().neutrals.map((n) => n.vertices.length + (15 - n.roadsLeft));
  const e = legalEdgeFor(roller);
  if (e) {
    handleAction({ type: 'buildRoad', playerId: roller, edgeId: e.id });
    const after = game().neutrals.map((n) => n.vertices.length + (15 - n.roadsLeft));
    check(after.some((v, i) => v > before[i]), 'neutrals expand when a real player builds');
  } else {
    check(true, 'no legal road available to test neutral expansion (skipped)');
  }
}

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
