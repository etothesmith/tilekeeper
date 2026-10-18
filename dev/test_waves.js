// Runs the solver over every level's authored first wave and 200 generated waves per wave index.
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const src = !html.includes('==CORE START==') ? fs.readFileSync(__dirname + '/core.js', 'utf8')
  : html.slice(html.indexOf('// ==CORE START=='), html.indexOf('// ==CORE END=='));
const lvSrc = html.slice(html.indexOf('const LEVELS = ['), html.indexOf('let LV = LEVELS[0];'));
const mul = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const env = new Function('mulberry32', src + '\n' + lvSrc + '\nreturn { solveWave, buildWave, LEVELS, placeHazards };')(mul);
const { solveWave, buildWave, LEVELS, placeHazards } = env;
let ok = true;
for (const lv of LEVELS.filter(l => !process.argv[2] || process.argv.slice(2).some(p => l.id.startsWith(p)))) {
  const kc = Math.floor(lv.width / 2), kr = lv.length - 3;
  const conv = placeHazards(lv, 12345, kc, kr, mul);
  const a = solveWave(lv.firstWave.map(r => r.slice()), lv.width, lv.length, kc, kr, lv.width >= 7 ? 1 : 2, conv);
  const stats = { gen: 0, tmpl: 0, tries: 0, pars: [] };
  for (let s = 0; s < 200; s++) for (let i = 1; i < lv.waves + (lv.boss ? 2 : 0); i++) {
    const cv = placeHazards(lv, 1000 + s * 7919, kc, kr, mul);
    const w = buildWave(lv, i, 1000 + s * 7919, lv.width, lv.length, kc, kr, mul, cv);
    if (w.source === 'template') stats.tmpl++; else stats.gen++;
    stats.tries += w.tries; stats.pars.push(w.par);
    if (lv.boss) { const want = i < lv.boss.cores.length ? lv.boss.cores[i] : 1; const got = w.grid.flat().filter(t => t === 'C').length; if (got !== want) { ok = false; console.log('core count off', lv.id, i, got, want); } }
    if (lv.specialsCap != null && w.grid.flat().filter(t => !['N','A','F','C'].includes(t) && t[0] !== 'L').length > lv.specialsCap) { ok = false; console.log('specials over cap', lv.id); }
  }
  const n = stats.gen + stats.tmpl;
  const avg = (stats.pars.filter(p => p != null).reduce((x, y) => x + y, 0) / n).toFixed(1);
  const fb = (stats.tmpl / n * 100).toFixed(1);
  console.log(`${lv.id}  authored: ${a.perfect ? 'PASS par ' + a.rolls : 'FAIL ' + a.why}   generated: ${n} waves, fallback ${fb}%, avg tries ${(stats.tries / n).toFixed(2)}, avg par ${avg}`);
  if (!a.perfect || stats.tmpl / n >= 0.02 || stats.pars.some(p => p == null)) ok = false;
}
console.log(ok ? 'ALL TARGETS MET' : 'TARGETS MISSED');
