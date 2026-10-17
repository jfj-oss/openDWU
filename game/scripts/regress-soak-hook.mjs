// Regression / balance measurement hook for scripts/soak.mjs (`--hook scripts/regress-soak-hook.mjs`; the `regress` set).
// Passive: reads state only (no Rnd, no writes), except the optional Game Editor spawns and the coordinated-landings flag flip
// asked for by the config's `hook` options:
//   hook: { sampleDays: 30,              game days between samples (default 30)
//           clFlag: true | false,        set scenario flag coordinatedLandings at start (A/B pairs)
//           spawn: [{ key, day }],       Game Editor threat spawns (playerOps editorSpawnThreat) once `day` game days have passed
//           timing: true }               also run scripts/soak-timing-hook.mjs (per-year frame-time percentiles)
// Writes report.regress = { rows (one per sample), waves (troop landing waves), killLog, events (counts), finalEvents } and,
// every five game years and at the end, <out>/<name>.events.json (the event log's entries that concern the threats / crisis /
// council / landings, resolved to text).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const YEAR_MS = 600_000;
const DAY_MS = YEAR_MS / 360;
let M = null;
let opts = {};
let rows = [];
let waves = [];
let openWaves = new Map(); // `${empireId}|${habitat name}` -> wave in progress
let troopRecs = []; // { bo, c, e }
let lastRefresh = -Infinity;
let lastSample = -Infinity;
let startMs = 0;
let ownerChanges = new Map(); // Habitat -> { to: empireId, t }
let kills = {}; // faction label -> { killed, lost }
let landingEvents = { total: 0, pirate: 0, lostWithTroops: 0 };
let spawned = new Set();
let handlersFor = null;
let unregister = [];
let timing = null;
let lastEventsDump = -Infinity;
let hookErrors = {};
let baseGameData = null;
let sd0 = 0;

const err = (where, e) => { hookErrors[where] = (hookErrors[where] ?? 0) + 1; if (hookErrors[where] <= 2) console.log(`! regress hook ${where}: ${String(e?.stack ?? e).split('\n').slice(0, 3).join(' / ')}`); };
const safe = (where, fn, dflt = null) => { try { return fn(); } catch (e) { err(where, e); return dflt; } };
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

export async function start(ctx) {
    opts = ctx.cfg.hook ?? {};
    const L = ctx.load;
    const keys = ['scnHooks', 'playerCommands', 'thFramework', 'thCult', 'thHive', 'thPurifier', 'thGenShips', 'thNavy', 'thCrisis', 'council', 'ledger', 'eventLog', 'chronicle', 'diplomacyTick', 'boTypes', 'designSpecs', 'governors', 'scenario', 'thRobot', 'thProbe', 'thWhale', 'simTime'];
    M = {};
    for (const k of keys) M[k] = await L(k);
    startMs = ctx.g.nowMs;
    sd0 = M.simTime.galaxyStarDate(ctx.g);
    baseGameData = ctx.gameData;
    ctx.report.regress = { rows, waves, kills, landingEvents, hookErrors, opts };
    if (opts.clFlag !== undefined && ctx.g.scenario !== null) ctx.g.scenario.flags.coordinatedLandings = opts.clFlag === true;
    ctx.report.regress.clFlagAtStart = ctx.g.scenario?.flags?.coordinatedLandings ?? null;
    if (opts.timing) { timing = await import(resolve(ctx.cfg.hookRoot ?? process.cwd(), 'scripts/soak-timing-hook.mjs')); await timing.start(ctx); }
    registerHandlers(ctx);
}

function registerHandlers(ctx) {
    const g = ctx.g;
    if (g.scenario === null || handlersFor === g.scenario.id) return;
    handlersFor = g.scenario.id;
    const { registerScenarioEvent } = M.scnHooks;
    const gate = { scenarioId: g.scenario.id };
    unregister.push(registerScenarioEvent({ id: 'rg.owner', ...gate, event: 'colonyOwnerChanged', run: (gal, e) => {
        ownerChanges.set(e.colony, { to: e.to?.empireId ?? -1, from: e.from?.empireId ?? -1, t: gal.nowMs });
    } }));
    unregister.push(registerScenarioEvent({ id: 'rg.killed', ...gate, event: 'builtObjectKilledBy', run: (gal, e) => safe('killed', () => {
        const bo = e.builtObject;
        if (bo.role !== M.designSpecs.BuiltObjectRole.Military) return;
        const owner = bo.actualEmpire ?? bo.empire;
        const label = (x) => (x == null ? null : factionLabel(gal, x));
        const lo = label(owner), ld = label(e.destroyer);
        if (lo !== null) (kills[lo] ??= { killed: 0, lost: 0 }).lost++;
        if (ld !== null) (kills[ld] ??= { killed: 0, lost: 0 }).killed++;
    }) }));
}

/** A label for the crisis factions only (others return null so the log stays small). */
function factionLabel(g, e) {
    const { CRISIS_ENTRIES } = M.thCrisis;
    for (const entry of CRISIS_ENTRIES) {
        const f = M.thFramework.peekThreatState(g, entry.key)?.faction ?? null;
        if (f === e) return entry.key;
    }
    for (const st of safe('gsl', () => M.thGenShips.genShipsStates(g), [])) {
        if (st.pirate === e) return 'genShipsPirates';
    }
    return null;
}

const SUB = () => M.boTypes.BuiltObjectSubRole;

function shipCounts(e) {
    const S = SUB();
    const R = M.designSpecs.BuiltObjectRole;
    let war = 0, trans = 0, mine = 0, port = 0, builders = 0, other = 0;
    for (const b of e.builtObjects) {
        if (b == null || b.hasBeenDestroyed) continue;
        const sr = b.subRole;
        if (b.role === R.Military) {
            if (sr === S.TroopTransport) trans++;
            else war++;
        } else if (sr === S.MiningStation || sr === S.GasMiningStation) mine++;
        else if (sr === S.SmallSpacePort || sr === S.MediumSpacePort || sr === S.LargeSpacePort) port++;
        else if (sr === S.ConstructionShip) builders++;
        else other++;
    }
    return { war, trans, mine, port, builders, other };
}

function troopStats(e) {
    let total = 0, min = Infinity, n = 0;
    for (const h of e.colonies) {
        if (h.hasBeenDestroyed) continue;
        const t = h.troops?.totalDefendStrength ?? 0;
        total += t;
        if (t < min) min = t;
        n++;
    }
    return { total: Math.round(total / 1000), min: n === 0 ? 0 : Math.round(min / 1000), avg: n === 0 ? 0 : Math.round(total / n / 1000) };
}

function facSnap(g, e) {
    if (e == null) return null;
    const c = shipCounts(e);
    const t = troopStats(e);
    c.stn = e.miningStations ? e.miningStations.filter((b) => !b.hasBeenDestroyed).length : -1;
    return { act: e.active ? 1 : 0, col: e.colonies.length, pop: Math.round(e.totalPopulation / 1e6), ...c, mil: Math.round(M.diplomacyTick.militaryPotency(e) / 1000), trK: t.total, trMinK: t.min, trAvgK: t.avg, moneyK: Math.round((e.stateMoney + e.privateMoney) / 1000), tech: r1(M.thRobot.empireTechLevel(e)) };
}

const NAVY_KEYS = ['pendingStrength', 'shipsSpawned', 'shipsPumped', 'pumpBought', 'pumpBank', 'pumpBanked', 'pumpReleased', 'stationsTaken', 'stationsFounded', 'founderNoTarget', 'founderNoMoney', 'founderFailed', 'garrisonAdded', 'garrisonHeld', 'defendOrders', 'attackFlips'];
function navySnap(n) {
    if (!n) return null;
    const o = {};
    for (const k of NAVY_KEYS) if (n[k] !== undefined) o[k] = Math.round(n[k]);
    o.ports = n.portColonies?.length ?? 0;
    o.garrisoned = n.garrisoned?.length ?? 0;
    if (n.secure) o.secure = { start: r2(n.secure.start / YEAR_MS * 0 + n.secure.start), ended: n.secure.ended ?? null, reason: n.secure.reason ?? null };
    return o;
}

function year(g) { return r2((g.nowMs - startMs) / YEAR_MS); }

function sample(ctx) {
    const g = ctx.g;
    const row = { y: year(g) };
    const normals = safe('normals', () => M.thCrisis.crisisNormals(g), []);
    row.n = safe('n', () => {
        let col = 0, mil = 0, war = 0, pop = 0, trans = 0;
        for (const e of normals) { col += e.colonies.length; mil += M.diplomacyTick.militaryPotency(e); pop += e.totalPopulation; const c = shipCounts(e); war += c.war; trans += c.trans; }
        return { emp: normals.length, col, war, trans, milK: Math.round(mil / 1000), popB: r2(pop / 1e9), avgMilK: normals.length ? Math.round(mil / normals.length / 1000) : 0, maxMilK: Math.round(Math.max(0, ...normals.map((e) => M.diplomacyTick.militaryPotency(e))) / 1000) };
    });
    row.me = safe('player', () => (g.playerEmpire ? facSnap(g, g.playerEmpire) : null));
    row.pir = safe('pirates', () => ({ fac: g.pirateEmpires.filter((p) => p.active).length, ships: g.pirateEmpires.reduce((n, p) => n + p.builtObjects.length, 0) }));
    // Cult
    row.cult = safe('cult', () => {
        const st = M.thCult.peekCultState(g);
        if (st === null) return null;
        const held = M.thCult.cultHeldColonies(g, st);
        let believerGov = 0;
        if (st.faction) for (const h of st.faction.colonies) { const gov = M.governors.colonyGovernor(h); if (gov !== null && st.converted.some((r) => r.character === gov)) believerGov++; }
        return { conv: st.converted.length, held: held.length, risings: st.risings ?? 0, converts: st.converts ?? 0, worldConverts: st.worldConverts ?? 0, ended: st.ended ? 1 : 0, believerGov, fac: facSnap(g, st.faction), navy: navySnap(st.navy), forced: st.forced ? 1 : 0 };
    });
    row.hive = safe('hive', () => {
        const st = M.thHive.peekHiveState(g);
        if (st === null) return null;
        return { nodes: st.nodes.length, absorbed: st.absorbed.length, ended: st.ended ? 1 : 0, fac: facSnap(g, st.faction), navy: navySnap(st.navy) };
    });
    row.pur = safe('purifier', () => {
        const st = M.thPurifier.peekPurifierState(g);
        if (st === null) return null;
        const alive = (b) => b != null && !b.hasBeenDestroyed;
        return { phase: st.phase, mode: st.mode, worlds: st.worlds, bodies: st.bodies, kills: st.kills, losses: st.losses, escorts: st.escorts.filter(alive).length, guards: st.guards.filter(alive).length, destroyer: alive(st.destroyer) ? 1 : 0, dmg: r2(M.thPurifier.purifierDamage(st)), retargets: st.retargets, launches: st.launches, repairs: st.repairs, portTrips: st.portTrips, rudder: st.rudderTotal, exposed: st.exposed ? 1 : 0, victims: st.victims.length, killer: st.killer?.name ?? null, hunted: st.hunted.length, huntOthers: st.huntOthers ? 1 : 0, program: st.program, fac: facSnap(g, st.faction) };
    });
    row.gen = safe('genShips', () => {
        const list = M.thGenShips.genShipsStates(g);
        if (list.length === 0) return null;
        const alive = (b) => b != null && !b.hasBeenDestroyed;
        return list.map((st) => ({ i: st.index, fl: st.flavour, ph: st.phase, out: st.outcome, ans: st.answer, owner: st.owner?.name ?? null, esc: st.escorts.filter(alive).length, tr: st.transports.filter(alive).length, ws: alive(st.worldShip) ? 1 : 0, wsFate: st.worldShipFate, land: st.landings, tgt: st.target?.name ?? null, settle: st.settleAt?.name ?? null, retake: st.retake?.name ?? null, str: Math.round(st.fleetStrength / 1000), ownStr: Math.round(st.ownerStrengthAtSpawn / 1000), hit: st.stationsHit ?? 0, pirate: st.pirate ? facSnap(g, st.pirate) : null, fac: st.faction && st.phase === 'settled' ? facSnap(g, st.faction) : null, navy: navySnap(st.navy), pumped: st.pumped ?? 0 }));
    });
    row.other = safe('otherThreats', () => {
        const o = {};
        const pr = M.thProbe.peekProbeSwarmState?.(g);
        if (pr) o.probe = { phase: pr.phase, ships: pr.ships?.length ?? 0, stations: pr.stations?.length ?? 0 };
        const wh = M.thWhale.peekVoidWhaleState?.(g);
        if (wh) o.whale = { phase: wh.phase, mode: wh.mode, creature: wh.creature ? 1 : 0 };
        return Object.keys(o).length ? o : null;
    });
    row.crisis = safe('crisis', () => {
        const s = g.scenario;
        if (s === null || !('crisis' in s.state)) return null;
        const st = s.state.crisis;
        const act = M.thCrisis.activeCrises(g).map((c) => c.entry.key);
        const fight = {};
        for (const [k, v] of Object.entries(st.fight)) { const key = k.split(':')[0]; const f = (fight[key] ??= { kills: 0, lost: 0, attacks: 0, empires: 0 }); f.kills += v.kills; f.lost += v.lost; f.attacks += v.attacks; f.empires++; }
        const done = {};
        for (const k of Object.keys(st.done)) { const kind = k.split(':')[0]; done[kind] = (done[kind] ?? 0) + 1; }
        return { active: act, hits: st.hits.length, harmed: Object.keys(st.harmed).filter((k) => st.harmed[k]), fight, done, crowding: st.crowding.length };
    });
    row.council = safe('council', () => {
        const cs = M.council.peekCouncilState(g);
        if (cs === null) return null;
        return cs.councils.map((c) => ({ id: c.id, members: c.members.length, results: c.results.length, threats: c.threats.map((t) => t.name), sanctions: c.sanctions.length, condemned: Object.keys(c.condemned).length, blocs: c.blocs.length, motion: c.motion?.kind ?? null }));
    });
    row.rep = safe('rep', () => {
        const rs = M.ledger.peekReputationState(g);
        if (rs === null) return null;
        let pairs = 0, entries = 0;
        const bySource = {};
        const crisisCauses = {};
        for (const list of Object.values(rs.pairs)) {
            pairs++;
            for (const en of list) {
                entries++;
                bySource[en.source] = (bySource[en.source] ?? 0) + 1;
                if (en.source === 'crisis') { const c = (crisisCauses[en.cause] ??= { n: 0, sum: 0 }); c.n++; c.sum = r2(c.sum + en.value); }
            }
        }
        return { pairs, entries, crisisCauses };
    });
    row.cl = safe('cl', () => {
        // holding: ships holding in orbit now (their hold is younger than the 25-day timeout + a margin); stale: a clTarget left on a re-tasked ship.
        let holding = 0, stale = 0, oldestD = 0;
        const sd = M.simTime.galaxyStarDate(g);
        for (const rec of troopRecs) {
            const b = rec.bo;
            if (b.hasBeenDestroyed || b.clTarget === undefined) continue;
            const age = (sd - (b.clSince ?? sd)) / DAY_MS;
            if (age <= 40) { holding++; oldestD = Math.max(oldestD, age); } else stale++;
        }
        return { holding, stale, oldestD: Math.round(oldestD), tracked: troopRecs.length, openWaves: openWaves.size };
    });
    row.ev = safe('eventLog', () => ({ n: M.eventLog.eventLogEntries(g).length }));
    row.fin = g.gameIsFinished ? 1 : 0;
    row.mem = { heapMB: Math.round(process.memoryUsage().heapUsed / 1048576) };
    rows.push(row);
}

// ---------------------------------------------------------------------------------------------------------------
// Troop landings (coordinated landings): per-frame check of the troop-carrying ships (refreshed every 3 game days)
// ---------------------------------------------------------------------------------------------------------------

function refreshTroopShips(g) {
    const prev = new Map(troopRecs.map((r) => [r.bo, r.c]));
    const prevRec = new Map(troopRecs.map((r) => [r.bo, r]));
    const next = [];
    const seen = new Set();
    const lists = [...g.empires, ...g.pirateEmpires];
    for (const e of lists) {
        if (e == null) continue;
        const isPirate = g.pirateEmpires.includes(e) || e.pirateEmpireBaseHabitat != null;
        for (const list of [e.builtObjects, e.privateBuiltObjects]) {
            for (const bo of list ?? []) {
                if (bo == null || seen.has(bo)) continue;
                const c = bo.troops ? bo.troops.count : 0;
                if (c <= 0) continue;
                seen.add(bo);
                next.push({ bo, c: prev.get(bo) ?? c, e, pirate: isPirate, tgt: prevRec.get(bo)?.tgt ?? null });
            }
        }
    }
    troopRecs = next;
}

function frameTroops(ctx, g) {
    const now = g.nowMs;
    if (now - lastRefresh >= 3 * DAY_MS) { lastRefresh = now; refreshTroopShips(g); closeWaves(g, now); }
    for (const rec of troopRecs) {
        const bo = rec.bo;
        const c = bo.troops ? bo.troops.count : 0;
        // The landing branch clears colonyToAttack in the same call that unloads, so the target is remembered each frame.
        const tgt = bo.colonyToAttack ?? bo.mission?.targetHabitat ?? null;
        if (tgt !== null && tgt !== undefined) rec.tgt = tgt;
        if (c < rec.c) {
            if (bo.hasBeenDestroyed) landingEvents.lostWithTroops++;
            else if (rec.pirate) landingEvents.pirate++;
            else landing(g, now, rec, bo, rec.c - c);
        }
        rec.c = c;
    }
}

function landing(g, now, rec, bo, dropped) {
    landingEvents.total++;
    const tgt = rec.tgt ?? null;
    if (tgt === null) { landingEvents.noTarget = (landingEvents.noTarget ?? 0) + 1; return; }
    if (tgt.empire === rec.e) { landingEvents.friendly = (landingEvents.friendly ?? 0) + 1; return; } // reinforcements unloading at its own colony
    const key = `${rec.e.empireId}|${tgt.name}`;
    let w = openWaves.get(key);
    if (w === undefined || now - w.last > 4 * DAY_MS) {
        w = { emp: rec.e.name, empId: rec.e.empireId, tgt: tgt.name, tgtOwner: tgt.empire?.name ?? null, tgtOwnerId: tgt.empire?.empireId ?? -1, habitat: tgt, first: now, last: now, ships: 0, troops: 0, y: year(g) };
        openWaves.set(key, w);
    }
    w.last = now;
    w.ships++;
    w.troops += dropped;
}

/** A wave ends 4 game days after its last landing; its outcome is read 30 game days after its first. */
function closeWaves(g, now) {
    for (const [key, w] of openWaves) {
        if (now - w.first < 30 * DAY_MS || now - w.last < 4 * DAY_MS) continue;
        openWaves.delete(key);
        const oc = ownerChanges.get(w.habitat);
        const won = oc !== undefined && oc.t >= w.first && oc.t <= now && oc.to === w.empId;
        waves.push({ y: w.y, emp: w.emp, tgt: w.tgt, tgtOwner: w.tgtOwner, ships: w.ships, troops: w.troops, spanD: r1((w.last - w.first) / DAY_MS), won: won ? 1 : 0 });
        if (waves.length > 5000) waves.shift();
    }
    for (const [h, oc] of ownerChanges) if (now - oc.t > 90 * DAY_MS) ownerChanges.delete(h);
}

// ---------------------------------------------------------------------------------------------------------------
// Game Editor spawns
// ---------------------------------------------------------------------------------------------------------------

function runSpawns(ctx) {
    const g = ctx.g;
    const dayNow = (g.nowMs - startMs) / DAY_MS;
    for (const sp of opts.spawn ?? []) {
        const id = `${sp.key}@${sp.day}`;
        if (spawned.has(id) || dayNow < sp.day) continue;
        spawned.add(id);
        const entry = { key: sp.key, day: sp.day, result: 'pending', hadScenario: g.scenario !== null, y: year(g) };
        (ctx.report.regress.spawns ??= []).push(entry);
        // The command is applied at the next frame boundary; its result arrives through the callback.
        safe('spawn', () => M.playerCommands.issuePlayerCommand(g, g.playerEmpire, 'editorSpawnThreat', [sp.key], (r) => { entry.result = r; entry.scenarioIdAfter = g.scenario?.id ?? null; console.log(`  spawn ${sp.key} (day ${sp.day}): ${r}`); }, (why) => { entry.result = `failed: ${why}`; }));
    }
}

/** A game that started without a scenario now holds the bare 'threat-framework' one: the save check reloads it with that overlay. */
function fixGameData(ctx) {
    const g = ctx.g;
    if (g.scenario === null || ctx.cfg.addons !== undefined || ctx.cfg.scenario !== undefined || ctx.gameData !== baseGameData) return;
    ctx.gameData = M.scenario.scenarioGameData(baseGameData, g.scenario.id);
    console.log(`  save checks now reload with the '${g.scenario.id}' scenario data`);
}

// ---------------------------------------------------------------------------------------------------------------
// Event-log dump
// ---------------------------------------------------------------------------------------------------------------

function dumpEvents(ctx) {
    const entries = M.eventLog.eventLogEntries(ctx.g);
    const byCat = {};
    const bySource = {};
    for (const e of entries) {
        byCat[e.category] = (byCat[e.category] ?? 0) + 1;
        bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    }
    ctx.report.regress.events = { total: entries.length, byCat, bySource };
}

const SKIP_CAT = new Set(['economy', 'exploration', 'pirate']);
let keptEvents = [];
let lastEventId = -1;

/** Copies the interesting new event-log entries (the log is a ring of eventLogSize entries; the economy spam would push them out). */
function captureEvents(ctx) {
    const entries = M.eventLog.eventLogEntries(ctx.g);
    for (const e of entries) {
        if (e.id <= lastEventId) continue;
        lastEventId = e.id;
        if (SKIP_CAT.has(e.category) || e.source.startsWith('rim')) continue;
        if (keptEvents.length >= 30000) return;
        let text = '';
        try { text = M.chronicle.resolveEntryText(e); } catch { text = e.textKey; }
        let title = '';
        try { title = M.chronicle.resolveEntryTitle(e); } catch { title = e.titleKey ?? ''; }
        keptEvents.push({ id: e.id, y: r2((e.starDate - sd0) / YEAR_MS), cat: e.category, imp: e.importance, src: e.source, title, text: text.length > 400 ? text.slice(0, 400) : text, ...(e.place ? { place: e.place.name ?? null } : {}) });
    }
}

async function dumpEventsFile(ctx) {
    const file = resolve(ctx.outDir, `${ctx.name}.events.json`);
    writeFileSync(file, JSON.stringify({ name: ctx.name, total: keptEvents.length, entries: keptEvents }));
}

function purifierHistory(ctx) {
    const st = safe('purHist', () => M.thPurifier.peekPurifierState(ctx.g));
    if (st !== null && st !== undefined) ctx.report.regress.purifierHistory = st.history.map((h) => ({ ...h }));
}

export function frame(ctx, dt, g) {
    if (M === null) return;
    timing?.frame?.(ctx, dt, g);
    safe('frameTroops', () => frameTroops(ctx, g));
    if (g.nowMs - lastSample >= (opts.sampleDays ?? 30) * DAY_MS) {
        lastSample = g.nowMs;
        safe('sample', () => sample(ctx));
    }
}

export async function chunk(ctx) {
    if (M === null) return;
    safe('spawns', () => runSpawns(ctx));
    safe('fixGameData', () => fixGameData(ctx));
    safe('register', () => registerHandlers(ctx));
    const g = ctx.g;
    const y = (g.nowMs - startMs) / YEAR_MS;
    safe('purHist', () => purifierHistory(ctx));
    safe('events', () => dumpEvents(ctx));
    safe('capture', () => captureEvents(ctx));
    const last = y >= ctx.report.years - ctx.chunkSeconds / (YEAR_MS / 1000) * 0.99;
    if (y - lastEventsDump >= 5 || last) {
        lastEventsDump = y;
        try { await dumpEventsFile(ctx); } catch (e) { err('eventsFile', e); }
    }
    if (timing?.chunk) await timing.chunk(ctx);
}
