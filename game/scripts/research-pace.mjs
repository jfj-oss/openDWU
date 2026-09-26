#!/usr/bin/env node
// Research-pace probe (tasks/RESEARCH-PACE-2026-09-26.md). Read-only: builds the sim-run default game (700 stars, 12x12,
// 10 empires, age 1, tech 0.5, pirates 1), runs it in `step`-second runGameSeconds chunks and prints, per empire, the
// research inputs (lab totals, ResearchXPotential, AnnualResearchPotential, CalculateResearchOutputBonuses and its terms),
// the queue heads (progress/cost) and every completed project with its game day. Nothing in the game state is written.
//
//   node scripts/research-pace.mjs [seed=1] [seconds=1200] [step=10]
import { build } from 'rolldown';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seed = Number(process.argv[2] ?? 1), seconds = Number(process.argv[3] ?? 1200), step = Number(process.argv[4] ?? 30);
const MODULES = { game: '/src/sim/game.ts', types: '/src/sim/types.ts', load: '/test/helpers/loadGameDataFs.ts', harness: '/src/sim/tick/harness.ts', rt: '/src/sim/researchTick.ts', emp: '/src/sim/empire.ts', ch: '/src/sim/characters.ts' };
const bundleDir = mkdtempSync(resolve(tmpdir(), 'dwu-rp-'));
await build({ cwd: root, input: Object.fromEntries(Object.entries(MODULES).map(([k, v]) => [k, '.' + v])), platform: 'node', transform: { define: { __dirname: JSON.stringify(resolve(root, 'test/helpers')) } },
  output: { dir: bundleDir, format: 'esm', preserveModules: true, preserveModulesRoot: root }, write: true, logLevel: 'warn' });
const load = (k) => import(resolve(bundleDir, k + '.js'));
const { createGame } = await load('game'); const { GalaxyShape, IndustryType } = await load('types');
const { loadGameDataFs } = await load('load'); const { runGameSeconds } = await load('harness'); const rt = await load('rt'); const emp = await load('emp'); const ch = await load('ch');
const gameData = await loadGameDataFs();
const stars = 700, sectors = 12, age = 1, tech = 0.5;
const s = (race) => ({ race, homeSystemFavourability: 'Normal', proximityDistance: 'Random', startLocation: '(Random)', age, techLevel: tech });
const game = createGame({ seed, shape: GalaxyShape.Spiral, starCount: stars, sectorWidth: sectors, sectorHeight: sectors,
  systemNames: Array.from({ length: stars }, (_, i) => `S${i}`), gameData, galaxyAge: age,
  player: s('Human'), aiEmpires: Array.from({ length: 9 }, () => s('(Random)')), piratePrevalence: 1 });
const g = game.galaxy;
const emps = g.empires.filter((e) => e && e.pirateEmpireBaseHabitat === null && e.research?.techTree);
const IND = [['E', IndustryType.Energy, 'researchQueueEnergy'], ['H', IndustryType.HighTech, 'researchQueueHighTech'], ['W', IndustryType.Weapon, 'researchQueueWeapons']];
const day = () => (g.nowMs / 1000 / 600 * 365).toFixed(0);
function snap(e) {
  const pot = {}; for (const [k, ind] of IND) pot[k] = rt.researchPotential(e, ind);
  const tot = rt.calculateResearchTotal(e); const ann = rt.annualResearchPotential(e);
  const bon = {}; for (const [k, ind] of IND) bon[k] = rt.calculateResearchOutputBonuses(e, ind);
  let labs = { E: 0, H: 0, W: 0, n: 0 };
  for (const b of [...e.builtObjects, ...e.privateBuiltObjects]) if (b && b.isResearchLab) { labs.n++; labs.E += b.researchEnergy; labs.H += b.researchHighTech; labs.W += b.researchWeapons; }
  const q = {}; for (const [k, , f] of IND) q[k] = e.research[f].map((n) => `${n.def.name}[L${n.def.techLevel} ${n.progress.toFixed(0)}/${n.cost.toFixed(0)}${n.isRushing ? ' R' : ''}]`).join(' ; ');
  return { pop: e.totalPopulation, eff: e.economyEfficiency, rate: e.difficultyFactors?.researchRate, pot, ann, tot, bon, labs, q, researched: e.research.techTree.filter((n) => n.isResearched).length, speedMod: g.researchSpeedModifier };
}
const f = (x) => typeof x === 'number' ? x.toFixed(x > 100 ? 0 : 3) : x;
const done = new Map(emps.map((e) => [e, new Set(e.research.techTree.filter((n) => n.isResearched).map((n) => n.def.projectId))]));
for (const e of emps) { const gov = emp.empireGovernmentAttributes(e); const L = ch.empireLeader(e); console.log('BONUS', e.name, 'gov', gov?.name, gov?.researchSpeed, 'leader', L?.name, L?.researchEnergy, L?.researchHighTech, L?.researchWeapons, 'rb', e.researchBonus, 'spec', e.specialBonusResearchEnergy, e.specialBonusResearchHighTech, e.specialBonusResearchWeapons, 'stn', e.researchBonusEnergy, e.researchBonusHighTech, e.researchBonusWeapons, 'res', rt.getResearchResourceBonus(e, IndustryType.Energy), rt.getResearchResourceBonus(e, IndustryType.HighTech), rt.getResearchResourceBonus(e, IndustryType.Weapon), 'rate', e.difficultyFactors?.researchRate); const s0 = snap(e); console.log('START', e.name, e.dominantRace?.name, JSON.stringify(s0, (k, v) => typeof v === 'number' ? Number(f(v)) : v)); }
const prog0 = new Map();
for (let t = step; t <= seconds; t += step) {
  runGameSeconds(g, step);
  for (const e of emps) {
    const set = done.get(e);
    for (const n of e.research.techTree) if (n.isResearched && !set.has(n.def.projectId)) { set.add(n.def.projectId); console.log(`DONE d${day()} ${e.name} ${n.def.name} L${n.def.techLevel} ind ${n.def.industry ?? ''} cost ${n.cost.toFixed(0)} self ${n.selfResearched}`); }
  }
  if (t % 120 === 0 || t === step) for (const e of emps.slice(0, seconds > 700 ? 10 : 1)) console.log('SNAP d' + day(), e.name, JSON.stringify(snap(e), (k, v) => typeof v === 'number' ? Number(f(v)) : v));
}
for (const e of emps) console.log('END', e.name, 'researched', done.get(e).size, 'start', e.research.techTree.filter((n) => n.selfResearched).length);
