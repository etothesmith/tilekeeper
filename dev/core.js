// ==CORE START== (pure rules for wave generation + the solver bot; no DOM, so it runs in tests too)
// Discrete model of one wave, one roll at a time. Each roll the bot may:
//   1) trigger the blue mark it set last roll (captures the cube that rolled onto it),
//   2) fire Blast when a green glyph's 3x3 holds no black cube and either 3+ cubes or nothing more is coming,
//   3) walk Kip up to 3 tiles to a safe tile and set a new blue mark within reach 2 on the empty tile
//      the most urgent required cube will roll onto next.
// It fails if a required cube gets within `margin` rows of the drop edge, a black cube would be caught, or Kip has nowhere safe.
const CORE_REQUIRED = { N: true, A: true, F: false, E: true, C: true, I: true, $: false, P: true, U: true, W: true, G: true, S: true, B: true, R: true, L: true };   // Gilded is optional
// grid cells are type letters; Linked cubes are "L" + a group number ("L1", "L2"...)
const cellType = cell => cell[0] === "L" ? "L" : cell;
// Wisp cubes are solid for 2 rolls, then phased for 1 (can't be captured, don't crush); `age` = rolls since the wave rose
const wispPhased = age => age % 3 === 2;
// A Prism's first diagonal: even columns head right, odd columns head left
const prismStart = c => (c % 2 === 0 ? 1 : -1);
// Where every cube goes on the next roll. Front rows move first; inside a row, straight movers go before Prisms.
// Plain cubes move 1 row. Frost moves 2 rows (1 if that tile is taken). Prism moves diagonally (bouncing off the side
// walls) and alternates left/right each roll, straight down if its diagonal is taken. A cube with nowhere to go stays.
// Cubes are {c, r, t, dir}; returns Map cube -> {c, r, dir, pass} (pass = the tile a Frost cube slides through).
function rollPlan(cubes, W) {
  const occ = new Set(), out = new Map();
  const order = [...cubes].sort((a, b) => b.r - a.r || (a.t === "P") - (b.t === "P"));
  for (const q of order) {
    let dir = q.dir, cands;
    if (q.t === "P") { if (q.c + dir < 0 || q.c + dir >= W) dir = -dir; cands = [[q.c + dir, q.r + 1], [q.c, q.r + 1]]; }
    else if (q.t === "I") cands = [[q.c, q.r + 2], [q.c, q.r + 1]];
    else if (q.t === "#") cands = [];                    // a cube still rising out of the floor holds its tile
    else cands = [[q.c, q.r + 1]];
    cands.push([q.c, q.r]);
    const pick = cands.find(([c, r]) => !occ.has(c + "," + r)) || [q.c, q.r];
    out.set(q, { c: pick[0], r: pick[1], dir: q.t === "P" ? -dir : dir, pass: pick[1] - q.r === 2 ? { c: q.c, r: q.r + 1 } : null });
    occ.add(pick[0] + "," + pick[1]);
  }
  return out;
}
// Conveyors (end of each roll): whatever stands on a belt tile shifts 1 column its way; blocked shifts cancel.
// Mutates the cubes' columns (and kip's, if given); returns the cubes that moved.
function conveyorStep(cubes, conv, W, kip) {
  if (!conv || !conv.length) return [];
  const at = new Map(cubes.map(q => [q.c + "," + q.r, q]));
  const belt = (c, r) => conv.find(t => t.c === c && t.r === r);
  const list = cubes.map(q => ({ q, t: belt(q.c, q.r) })).filter(x => x.t).sort((a, b) => b.t.c * b.t.dir - a.t.c * a.t.dir);
  const moved = [];
  for (const { q, t } of list) {
    const nc = q.c + t.dir;
    if (nc < 0 || nc >= W || at.has(nc + "," + q.r) || (kip && kip.c === nc && kip.r === q.r)) continue;
    at.delete(q.c + "," + q.r); q.c = nc; at.set(nc + "," + q.r, q); moved.push(q);
  }
  if (kip) { const t = belt(kip.c, kip.r); if (t) { const nc = kip.c + t.dir; if (nc >= 0 && nc < W && !at.has(nc + "," + kip.r)) kip.c = nc; } }
  return moved;
}
// Fuse dials: once a Fuse cube reaches the near half of the floor it lights at 3, then counts down 1 per roll; at 0 it turns black.
const fuseHotRow = L => Math.ceil(L / 2);
// how many tiles the bot lets Kip move per roll (a player managing ~4 swipes a roll)
const MOVES = 5;
function solveWave(grid, W, L, kipC, kipR, margin = 2, hz = {}) {
  const conv = hz.conv || [], cur = hz.cur || [];
  const cracks = new Set(), holes = new Set();
  const D = grid.length;
  let cubes = [];
  grid.forEach((row, i) => row.forEach((cell, c) => { if (cell) cubes.push({ c, r: D - 1 - i, t: cellType(cell), g: cell[0] === "L" ? cell : null, dir: prismStart(c), dial: 3, lit: false }); }));
  const req = q => CORE_REQUIRED[q.t];
  const crumble = new Set((hz.crumble || []).map(t => t.c + "," + t.r)), vents = new Set((hz.vents || []).map(t => t.c + "," + t.r));
  const at = (c, r) => cubes.find(q => q.c === c && q.r === r);
  let greens = [], mark = null, kip = { c: kipC, r: Math.max(kipR, D) }, roll = 0, first = null, last = null;
  const phased = (q, k = roll) => q.t === "W" && wispPhased(k);
  const inStage = (c, r) => c >= 0 && c < W && r >= 0 && r < L;
  const take = q => {
    if (!cubes.includes(q)) return;
    // Iron: the first capture only strips the plating
    if (q.t === "R") { q.t = "N"; if (first === null) first = roll; last = roll; return; }
    // Linked: the whole chain goes together
    if (q.t === "L" && q.g) { const grp = cubes.filter(x => x.g === q.g && x !== q); q.g = null; for (const x of grp) { x.g = null; take(x); } }
    cubes = cubes.filter(x => x !== q);
    if (q.t === "A" && !greens.some(g => g.c === q.c && g.r === q.r)) greens.push({ c: q.c, r: q.r });
    if (req(q)) { if (first === null) first = roll; last = roll; }
    // a Geode splits into Shards on its empty left/right neighbours
    if (q.t === "G") for (const dc of [-1, 1]) { const c = q.c + dc; if (inStage(c, q.r) && !at(c, q.r) && !holes.has(c + "," + q.r)) cubes.push({ c, r: q.r, t: "S", dir: prismStart(c), dial: 3, lit: false }); }
  };
  const hot = fuseHotRow(L);
  for (let step = 0; step < 400; step++) {
    // 1) trigger last roll's mark
    if (mark) {
      const q = at(mark.c, mark.r);
      if (q && q === mark.want && !phased(q)) { take(q); mark = null; }
      else if (!cubes.includes(mark.want) || roll >= mark.due) mark = null;   // its cube is gone, or it didn't come
    }
    // 2) blast
    if (greens.length) {
      const hit = new Set(); let bad = false;
      for (const g of greens) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const q = at(g.c + dc, g.r + dr); if (!q || phased(q)) continue;
        if (q.t === "F") bad = true; else hit.add(q);
      }
      const incoming = cubes.some(q => req(q) && greens.some(g => Math.abs(q.c - g.c) <= 1 && q.r < g.r - 1));
      const urgent = [...hit].some(q => q.r >= L - margin - (q.t === "I" ? 2 : 1) || (q.t === "U" && q.lit));
      // big waves: hold the blast until the squares are well filled
      const enough = W >= 7 ? Math.min(6, 3 + greens.length * 2) : 3;
      if (!bad && hit.size && (hit.size >= enough || !incoming || urgent)) {
        greens = [];
        for (const q of [...hit]) take(q);
      }
    }
    if (!cubes.some(req)) return { perfect: true, rolls: first === null ? 0 : last - first };
    // 3) predict the roll (and the belts after it), pick a target and a safe spot for Kip
    const plan = rollPlan(cubes, W);
    const ghost = cubes.map(q => ({ q, c: plan.get(q).c, r: plan.get(q).r }));
    conveyorStep(ghost, conv, W, null);
    const fin = new Map(ghost.map(g => [g.q, g]));
    const danger = new Set();
    for (const q of cubes) { const p = plan.get(q); danger.add(p.c + "," + p.r); if (p.pass) danger.add(p.pass.c + "," + p.pass.r); const f = fin.get(q); danger.add(f.c + "," + f.r); }
    const safe = (c, r) => inStage(c, r) && !at(c, r) && !danger.has(c + "," + r) && !holes.has(c + "," + r) && !crumble.has(c + "," + r) && !vents.has(c + "," + r);
    const urgency = q => fin.get(q).r + (q.t === "U" ? (q.lit ? 10 : 4) : 0) + (q.t === "B" ? 6 : 0) + (q.t === "A" && W >= 7 ? 3 : 0);
    const targets = cubes.filter(req).sort((a, b) => urgency(b) - urgency(a) || Math.abs(a.c - kip.c) - Math.abs(b.c - kip.c));
    // where each cube will be over the next few rolls (ignoring captures)
    const ahead = new Map(cubes.map(q => [q, []]));
    { let sim = cubes.map(q => ({ c: q.c, r: q.r, t: q.t, dir: q.dir, src: q }));
      for (let k = 1; k <= 3; k++) { const pl = rollPlan(sim, W); for (const g of sim) { const p = pl.get(g); g.c = p.c; g.r = p.r; g.dir = p.dir; } conveyorStep(sim, conv, W, null); for (const g of sim) ahead.get(g.src).push({ c: g.c, r: g.r }); } }
    let chosen = null;
    for (const q of (mark ? [] : targets)) {
      // Kip marks only the tile he stands on: he walks onto a tile the cube will land on 1-3 rolls from now (it must be
      // free right now), marks it, and steps off to a safe neighbour before the roll. Walking + stepping off fits in MOVES.
      // Any cubes that roll over the mark first are let through; he detonates when this cube arrives.
      let tile = null, due = 0;
      for (let k = 1; k <= 3 && !tile; k++) {
        const t = ahead.get(q)[k - 1];
        if (!inStage(t.c, t.r) || t.r >= L - margin) break;
        if (phased(q, roll + k) || greens.some(g => g.c === t.c && g.r === t.r) || at(t.c, t.r) || holes.has(t.c + "," + t.r)) continue;
        if (Math.abs(t.c - kip.c) + Math.abs(t.r - kip.r) + 1 > MOVES) continue;
        tile = t; due = roll + k;
      }
      if (!tile) continue;
      const toTile = Math.abs(tile.c - kip.c) + Math.abs(tile.r - kip.r);
      if (toTile + 1 > MOVES) continue;
      let best = null;
      for (const [dc, dr] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
        const c = tile.c + dc, r = tile.r + dr;
        if (!safe(c, r)) continue;
        const score = r * 10 - ([...conv, ...cur].some(t => t.c === c && t.r === r) ? 5 : 0);   // prefer stepping back toward the edge, off belts and currents
        if (!best || score > best.score) best = { c, r, score };
      }
      if (best) { chosen = { tile, spot: best, want: q, due }; break; }
    }
    if (chosen) { mark = { c: chosen.tile.c, r: chosen.tile.r, want: chosen.want, due: chosen.due }; kip = { c: chosen.spot.c, r: chosen.spot.r }; }
    // light an Ember in reach when, after this roll, it will blow up 2+ cubes and no black one
    if (chosen) for (const e of cubes) {
      if (e.t !== "E" || e.lit || Math.max(Math.abs(e.c - kip.c), Math.abs(e.r - kip.r)) > 2) continue;
      const p = plan.get(e), set = new Set([e]), queue = [e];
      while (queue.length) { const x = queue.shift(), px = plan.get(x); for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const y = cubes.find(q => plan.get(q).c === px.c + dc && plan.get(q).r === px.r + dr); if (y && !set.has(y)) { set.add(y); if (y.t === "E") queue.push(y); } } }
      if (set.size >= 3 && ![...set].some(q => q.t === "F") && p.r < L) { e.lit = true; break; }
    }
    if (!chosen) {
      // nothing markable in reach yet: walk toward the most urgent cube (or just out of the way)
      const goal = targets.length ? { c: fin.get(targets[0]).c, r: fin.get(targets[0]).r + 2 } : { c: kip.c, r: kip.r };
      let best = null;
      for (let r = kip.r - MOVES; r <= kip.r + MOVES; r++) for (let c = kip.c - MOVES; c <= kip.c + MOVES; c++) {
        if (!safe(c, r) || Math.abs(c - kip.c) + Math.abs(r - kip.r) > MOVES) continue;
        const score = -(Math.abs(c - goal.c) + Math.abs(r - goal.r));
        if (!best || score > best.score) best = { c, r, score };
      }
      if (!best) { if (!safe(kip.c, kip.r)) return { perfect: false, rolls: 0, why: "crushed" }; }
      else kip = { c: best.c, r: best.r };
    }
    // 4) the roll, then the belts, then the Fuse dials
    roll++;
    for (const q of cubes) {
      const p = plan.get(q);
      if (!phased(q) && ((kip.c === p.c && kip.r === p.r) || (p.pass && kip.c === p.pass.c && kip.r === p.pass.r))) return { perfect: false, rolls: 0, why: "crushed" };
      q.c = p.c; q.r = p.r; q.dir = p.dir;
    }
    // holes swallow what lands in them; a cracked tile breaks under the next cube; Basalt cracks where it lands
    for (const q of [...cubes]) {
      const key = q.c + "," + q.r;
      if (q.r >= L) continue;
      if (holes.has(key) || cracks.has(key)) { cracks.delete(key); holes.add(key); cubes = cubes.filter(x => x !== q); if (req(q)) return { perfect: false, rolls: 0, why: "hole" }; continue; }
      if (q.t === "B") cracks.add(key);
    }
    // lit Embers go off as they land, taking their neighbours (and chaining through other Embers)
    for (const e of cubes.filter(q => q.t === "E" && q.lit)) {
      if (!cubes.includes(e)) continue;
      const set = new Set([e]), queue = [e];
      while (queue.length) { const x = queue.shift(); for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const y = at(x.c + dc, x.r + dr); if (y && !set.has(y)) { set.add(y); if (y.t === "E") queue.push(y); } } }
      if ([...set].some(q => q.t === "F")) return { perfect: false, rolls: 0, why: "forbidden" };
      for (const q of set) take(q);
    }
    for (const q of cubes) if (q.r >= L - margin && req(q)) return { perfect: false, rolls: 0, why: "edge" };
    cubes = cubes.filter(q => q.r < L);                           // black and gold cubes roll off harmlessly
    const kk = { c: kip.c, r: kip.r }; conveyorStep(cubes, conv, W, kk); kip = kk;
    const ct = cur.find(t => t.c === kip.c && t.r === kip.r);
    if (ct) { const nc = kip.c + ct.dc, nr = kip.r + ct.dr; if (inStage(nc, nr) && !at(nc, nr) && !holes.has(nc + "," + nr)) kip = { c: nc, r: nr }; }
    for (const q of cubes) if (q.t === "U" && q.r >= hot) { if (!q.lit) q.lit = true; else if (--q.dial <= 0) return { perfect: false, rolls: 0, why: "fuse" }; }
  }
  return { perfect: false, rolls: 0, why: "timeout" };
}

// Floor hazards for one attempt, from the level seed: Sun Glyphs, ice (in pairs) and conveyor belts (2-3 long, one direction).
// Kept clear of the wave's rows and Kip's start tile.
function placeHazards(lv, seed, kipC, kipR, mulberry) {
  const glyphs = [], ice = [], conv = [], cur = [], crumble = [], vents = [];
  const rand = mulberry(seed ^ 0x51ed);
  const lo = lv.depth[1] + 2, hi = lv.length - 4;
  const taken = (c, r) => (c === kipC && r === kipR) || [glyphs, ice, conv, cur, crumble, vents].some(list => list.some(g => g.c === c && g.r === r));
  for (const hz of lv.hazards || []) {
    for (let n = 0, placed = 0; n < 80 && placed < hz.count; n++) {
      const c = Math.floor(rand() * lv.width), r = lo + Math.floor(rand() * (hi - lo + 1));
      if (taken(c, r)) continue;
      if (hz.type === "glyph") {
        if (glyphs.some(g => Math.abs(g.r - r) < 2 && g.c === c)) continue;
        glyphs.push({ c, r, charged: true, locked: false }); placed++;
      } else if (hz.type === "ice") {
        ice.push({ c, r }); placed++;
        const c2 = c + (c < lv.width - 1 && (rand() < 0.5 || c === 0) ? 1 : -1);
        if (placed < hz.count && !taken(c2, r)) { ice.push({ c: c2, r }); placed++; }
      } else if (hz.type === "crumble") {
        crumble.push({ c, r }); placed++;
      } else if (hz.type === "vent") {
        if (Math.abs(c - kipC) + Math.abs(r - kipR) < 3) continue;
        vents.push({ c, r }); placed++;
      } else if (hz.type === "current") {
        // single tiles that push Kip (never cubes) one tile at the end of each roll; rarely toward the drop edge
        const x = rand(), d = x < 0.32 ? [-1, 0] : x < 0.64 ? [1, 0] : x < 0.88 ? [0, -1] : [0, 1];
        if (c + d[0] < 0 || c + d[0] >= lv.width) continue;
        cur.push({ c, r, dc: d[0], dr: d[1] }); placed++;
      } else if (hz.type === "conveyor") {
        if (conv.some(g => Math.abs(g.r - r) < 2)) continue;           // one belt per row band
        const rd = rand(), mid = (lv.width - 1) / 2, dir = c < mid ? 1 : c > mid ? -1 : (rd < 0.5 ? 1 : -1), len = Math.min(hz.count - placed, 2 + (rand() < 0.4 ? 1 : 0));
        for (let k = 0; k < len; k++) { const cc = c + k * dir; if (cc < 0 || cc >= lv.width || cc + dir < 0 || cc + dir >= lv.width || taken(cc, r)) break; conv.push({ c: cc, r, dir }); placed++; }
      }
    }
  }
  return { glyphs, ice, conv, cur, crumble, vents };
}

// Fill a width x depth grid from the level's weighted pool, then apply the quotas
// (black cubes within forbiddenPct, a green on bigger waves, the level's new cube in every intro-level wave).
function generateGrid(lv, W, D, rand, coreCount) {
  const entries = Object.entries(lv.pool), total = entries.reduce((s, e) => s + e[1], 0);
  const grid = [];
  for (let d = 0; d < D; d++) {
    const row = [];
    for (let c = 0; c < W; c++) {
      let x = rand() * total, pick = entries[0][0];
      for (const [k, w] of entries) { if ((x -= w) < 0) { pick = k; break; } }
      row.push(pick);
    }
    grid.push(row);
  }
  const cells = [];
  for (let d = 0; d < D; d++) for (let c = 0; c < W; c++) cells.push([d, c]);
  const pickCell = pred => { const opts = cells.filter(([d, c]) => pred(grid[d][c])); return opts.length ? opts[Math.floor(rand() * opts.length)] : null; };
  const count = t => cells.filter(([d, c]) => grid[d][c] === t).length;
  const [fMin, fMax] = (lv.forbiddenPct || [0, 0]).map(p => Math.round(p * cells.length));
  while (count("F") > fMax) { const p = pickCell(t => t === "F"); if (!p) break; grid[p[0]][p[1]] = "N"; }
  while (count("F") < fMin) { const p = pickCell(t => t === "N"); if (!p) break; grid[p[0]][p[1]] = "F"; }
  if (lv.pool.A && count("A") === 0 && cells.length >= 12) { const p = pickCell(t => t === "N"); if (p) grid[p[0]][p[1]] = "A"; }
  if (lv.pool[lv.intro] && lv.intro !== "N" && count(lv.intro) === 0) { const p = pickCell(t => t === "N"); if (p) grid[p[0]][p[1]] = lv.intro; }
  // special cubes (anything but plain, green, black, core) capped per wave
  const special = t => !["N", "A", "F", "C"].includes(t);
  while (cells.filter(([d, c]) => special(grid[d][c])).length > (lv.specialsCap ?? 99)) { const p = pickCell(special); if (!p) break; grid[p[0]][p[1]] = "N"; }
  while (count("$") > 1) { const p = pickCell(t => t === "$"); grid[p[0]][p[1]] = "N"; }
  for (let d = 2; d < D; d++) for (let c = 0; c < W; c++) if (grid[d][c] === "U") grid[d][c] = "N";   // Fuse only in the 2 front rows
  // Basalt only in the 2 back rows (anything behind it would roll onto its cracks), at most 2 a wave
  for (let d = 0; d < D - 2; d++) for (let c = 0; c < W; c++) if (grid[d][c] === "B") grid[d][c] = "N";
  while (count("B") > 2) { const p = pickCell(t => t === "B"); grid[p[0]][p[1]] = "N"; }
  // at most one Wisp per column
  for (let c = 0; c < W; c++) { let seen = false; for (let d = 0; d < D; d++) if (grid[d][c] === "W") { if (seen) grid[d][c] = "N"; seen = true; } }
  // boss waves: the level says how many Core cubes this wave carries
  for (let k = 0; k < (coreCount || 0); k++) { const p = pickCell(t => t === "N"); if (p) grid[p[0]][p[1]] = "C"; }
  // Linked chains: runs of 2-4 side-by-side plain cubes, about linkPct of the wave
  if (lv.linkPct) {
    let want = Math.round(lv.linkPct * cells.length), id = 1;
    for (let tries = 0; tries < 40 && want >= 2; tries++) {
      const d = Math.floor(rand() * D), c0 = Math.floor(rand() * W), len = Math.min(want, 2 + Math.floor(rand() * 3));
      let run = 0; while (run < len && c0 + run < W && grid[d][c0 + run] === "N") run++;
      if (run < 2) continue;
      for (let k = 0; k < run; k++) grid[d][c0 + k] = "L" + id;
      id++; want -= run;
    }
  }
  return grid;
}

// Hand-made fallback when 40 seeds all fail: plain cubes with a green every other row for blasts.
function templateGrid(lv, W, D, coreCount) {
  const grid = [];
  // big waves get a green in every row so blasts can keep up
  const every = W * D >= 24 ? 1 : 2;
  for (let d = 0; d < D; d++) grid.push(Array.from({ length: W }, (_, c) => (lv.pool.A && d % every === every - 1 && c === (d % 2 ? Math.floor(W / 2) - 1 : Math.floor(W / 2) + 1)) ? "A" : "N"));
  for (let k = 0; k < (coreCount || 0); k++) grid[Math.min(D - 1, k)][(k * 2) % W] = "C";
  return grid;
}
// boss waves past the planned count each carry one Core, so the fight continues until the boss falls
const coresFor = (lv, i) => lv.boss ? (i < lv.boss.cores.length ? lv.boss.cores[i] : 1) : 0;

// Build wave i: authored first wave, otherwise up to 40 seeded tries the solver can clear Perfect, then the template.
function buildWave(lv, i, seed, W, L, kipC, kipR, mulberry, hz = {}) {
  const leeway = lv.id.startsWith("1-") ? 1 : 0;
  if (i === 0 && lv.firstWave) {
    const grid = lv.firstWave.map(r => r.slice());
    const s = solveWave(grid, W, L, kipC, kipR, W >= 7 ? 1 : 2, hz);
    return { grid, par: s.perfect ? s.rolls + leeway : null, source: "authored", tries: 1 };
  }
  const t = lv.waves > 1 ? Math.min(1, i / (lv.waves - 1)) : 0;
  const D = Math.round(lv.depth[0] + (lv.depth[1] - lv.depth[0]) * t);
  const cores = coresFor(lv, i);
  let firstGrid = null;
  for (let attempt = 0; attempt < (lv.tries || 60); attempt++) {
    const grid = generateGrid(lv, W, D, mulberry(seed + i * 1000 + attempt), cores);
    if (!firstGrid) firstGrid = grid;
    const s = solveWave(grid, W, L, kipC, kipR, W >= 7 ? 1 : 2, hz);
    if (s.perfect) return { grid, par: s.rolls + leeway, source: "generated", tries: attempt + 1 };
  }
  // Endless and Daily don't promise a Perfect-able wave, so keep a real mixed wave (par is estimated)
  if (lv.mode) return { grid: firstGrid, par: null, source: "generated (unsolved)", tries: lv.tries };
  const grid = templateGrid(lv, W, D, cores);
  const s = solveWave(grid, W, L, kipC, kipR, W >= 7 ? 1 : 2, hz);
  return { grid, par: s.perfect ? s.rolls + leeway : null, source: "template", tries: 41 };
}
// ==CORE END==
