// Cross-platform determinism runner (docs/MULTIPLAYER.md "Cross-platform determinism check"). scripts/determinism-check.mjs
// bundles this file with rolldown into one self-contained ESM file that runs under plain Node or an Electron binary with
// ELECTRON_RUN_AS_NODE=1 (the release app's V8), on any machine with a DW:U data folder. It prints one line per
// checkpoint: case, game ms, stateDigest, Galaxy.Rnd draw count and (every --save-every checkpoints) a sha1 of the whole
// save text. Two machines' outputs are compared line by line.
//
//   <node|electron> runner.mjs --data <DW:U folder> --case <name> [--years 3] [--every 10] [--save-every 6]
//        [--log <command log json>] [--record <out json>] [--files]
// Cases: s1 (seed 1, 300 stars, 4 empires), s7 (seed 7, 700 stars, 10 empires), smart (seed 3, 300 stars, 4 empires,
// Smarter AI as a composite add-on, every sub-switch on), script (seed 1 + the scripted player orders of
// test/helpers/commandScript.ts issued live; --record writes the resulting command log), replay (seed 1 + a recorded
// command log from --log, applied at its frame boundaries).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadGameData, type FetchText, type GameData } from '../../src/sim/data/gameData';
import { createGame, type CreateGameOptions, type Game } from '../../src/sim/game';
import { GalaxyShape } from '../../src/sim/types';
import { runGameSeconds } from '../../src/sim/tick/harness';
import { stateDigest } from '../../src/sim/tick/digest';
import { GalaxyTime } from '../../src/sim/galaxyTime';
import { serializeGame } from '../../src/sim/save/gameSave';
import type { StartGameOptions } from '../../src/sim/startGameOptions';
import { commandLog, type CommandLogEntry } from '../../src/sim/player/commandLog';
import { flushPlayerCommands, runScheduledUntil, scheduleCommandLog } from '../../src/sim/player/playerCommands';
import { parseScenarioManifest } from '../../src/sim/scenario/manifest';
import { applyScenarioOverlay, type ScenarioOverlay } from '../../src/sim/scenario/overlay';
import { addonCatalog, compositeOverlay, compositeScenarioManifest, defaultSmarterAIChoice, resolveAddonSwitches, withSmarterAI } from '../../src/sim/scenario/addons';
import { commandScript, dueSteps, issueStep, runScripted, setRunId } from '../../test/helpers/commandScript';
import { detPow } from '../../src/sim/detMath';

declare const __SCENARIOS__: { manifest: Record<string, unknown>; files: Record<string, string> }[];

function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i < 0 || process.argv[i + 1] === undefined ? fallback : process.argv[i + 1];
}

const dataDir = resolve(arg('data', ''));
const caseName = arg('case', 's1');
const years = Number(arg('years', '3'));
const every = Number(arg('every', '10'));
const saveEvery = Number(arg('save-every', '6'));
const logPath = arg('log', '');
const recordPath = arg('record', '');
// --files: print each data file's hash (to find the file behind a data fingerprint mismatch).
const listFiles = process.argv.includes('--files');

// --- Game data from a folder (test/helpers/loadGameDataFs.ts, with the folder as an argument). Every file read is
// fingerprinted (path + content) so a data mismatch between the machines is told apart from a sim divergence.
async function loadData(root: string): Promise<{ data: GameData; fingerprint: string; files: number }> {
    const reads = new Map<string, string>();
    const fetchText: FetchText = async (candidates: string[]) => {
        for (const c of candidates) {
            const rel = decodeURIComponent(c.replace(/^\/assets\/dwu\/?/, ''));
            const p = resolve(root, rel);
            if (!existsSync(p)) continue;
            const text = readFileSync(p, 'utf-8');
            reads.set(rel, text);
            return text;
        }
        throw new Error(`Could not load any of: ${candidates.join(', ')}`);
    };
    const txt = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.txt')).sort() : []);
    const races = txt(resolve(root, 'races'));
    const templates = txt(resolve(root, 'designTemplates', 'DEFAULT')).map((f) => f.replace(/\.txt$/, ''));
    const policyDir = resolve(root, 'Policy');
    const policies = existsSync(policyDir) ? readdirSync(policyDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.txt')).map((e) => e.name).sort() : [];
    policies.push(...txt(resolve(policyDir, 'pirate')).map((f) => `pirate/${f}`));
    const data = await loadGameData(fetchText, undefined, races, templates, policies);
    const h = createHash('sha1');
    // Paths lower-cased: a case-insensitive file system (macOS) opens the first candidate spelling, Linux a later one.
    const keys = [...reads.keys()].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
    for (const k of keys) {
        h.update(`${k.toLowerCase()}\0${reads.get(k)!}\0`);
        if (listFiles) console.log(`# file ${createHash('sha1').update(reads.get(k)!).digest('hex').slice(0, 12)} ${k}`);
    }
    return { data, fingerprint: h.digest('hex'), files: reads.size };
}

function options(data: GameData, seed: number, stars: number, empires: number, sectors: number): CreateGameOptions {
    const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age: 1, techLevel: 0.5 });
    return {
        seed, shape: GalaxyShape.Spiral, starCount: stars, sectorWidth: sectors, sectorHeight: sectors,
        systemNames: Array.from({ length: stars }, (_, i) => `S${i}`), gameData: data,
        player: s('Human'), aiEmpires: Array.from({ length: empires - 1 }, () => s('(Random)')), piratePrevalence: 1,
    };
}

function smarterAIGame(base: GameData): Game {
    const overlays: ScenarioOverlay[] = __SCENARIOS__.map((o) => ({ manifest: parseScenarioManifest(o.manifest), files: new Map(Object.entries(o.files)) }));
    const byId = new Map(overlays.map((o) => [o.manifest.id, o] as const));
    const cat = addonCatalog(overlays.map((o) => o.manifest));
    const choice = { ...defaultSmarterAIChoice(), enabled: true, designTune: true, weaponFocus: true, designScale: true, designTrim: true };
    const { picked, overrides } = withSmarterAI([], { flags: {}, params: {} }, choice);
    const data = applyScenarioOverlay(base, compositeOverlay(compositeScenarioManifest(cat, picked), byId));
    const { flags, params } = resolveAddonSwitches(cat, picked, overrides);
    return createGame({ ...options(data, 3, 300, 4, 8), scenarioFlags: flags, scenarioParams: params });
}

function saveHash(game: Game): string {
    const time = new GalaxyTime();
    time.bindGalaxy(game.galaxy);
    return createHash('sha1').update(serializeGame(game, time, {} as StartGameOptions)).digest('hex').slice(0, 16);
}

// The engine's Math.pow and the sim's detPow over the same 200k inputs: the native hash may differ between machines
// (that is why the sim uses detPow), the detPow hash must not.
function powHash(pow: (x: number, y: number) => number): string {
    let seed = 1234567;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
    const h = createHash('sha1'), out = new Float64Array(1);
    for (let i = 0; i < 200_000; i++) {
        out[0] = pow(rnd() * [3e6, 1e5, 2, 40][i & 3], [1.8, 0.75, 4, (rnd() - 0.5) * 20][i & 3]);
        h.update(new Uint8Array(out.buffer));
    }
    return h.digest('hex').slice(0, 12);
}

const { data, fingerprint, files } = await loadData(dataDir);
console.log(`# ${caseName} data ${fingerprint} (${files} files) ${process.platform}-${process.arch} v8 ${process.versions.v8}${process.versions.electron ? ` electron ${process.versions.electron}` : ''}`);
console.log(`# pow: detPow ${powHash(detPow)}, native Math.pow ${powHash(Math.pow)}`);

const t0 = Date.now();
let game: Game;
if (caseName === 's7') game = createGame(options(data, 7, 700, 10, 12));
else if (caseName === 'smart') game = smarterAIGame(data);
else game = createGame(options(data, 1, 300, 4, 8));
const g = game.galaxy;
if (caseName === 'replay') {
    if (logPath === '') throw new Error('--case replay needs --log');
    scheduleCommandLog(g, JSON.parse(readFileSync(logPath, 'utf8')) as CommandLogEntry[]);
}
const script = commandScript(1);
if (caseName === 'script') setRunId(g, 'detcheck');

const line = (n: number) => `${caseName} ${g.nowMs} ${stateDigest(g)} ${g.rnd.drawCount}${n % saveEvery === 0 ? ` save ${saveHash(game)}` : ''}`;
console.log(line(0));
const endMs = Math.round(years * 600_000);
for (let n = 1; g.nowMs < endMs; n++) {
    const until = Math.min(endMs, n * every * 1000);
    if (caseName === 'script') {
        runScripted(script, game, until);
        // Orders due exactly at the checkpoint apply now, as the replay applies its entries for this boundary in
        // runScheduledUntil's last flush (else the two streams differ at those checkpoints only).
        for (const st of dueSteps(script, g)) issueStep(g, game.playerEmpire, st);
        flushPlayerCommands(g);
    }
    else if (caseName === 'replay') runScheduledUntil(g, until);
    else runGameSeconds(g, (until - g.nowMs) / 1000);
    console.log(line(n));
}
if (recordPath !== '') writeFileSync(recordPath, JSON.stringify(commandLog(g)));
console.log(`# done ${caseName}: ${(g.nowMs / 600_000).toFixed(2)} game years, ${g.builtObjects.length} built objects, ${((Date.now() - t0) / 1000).toFixed(0)} s wall`);
