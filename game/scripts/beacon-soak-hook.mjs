// Measurement hook for the Beacon (Giantworks wonder): scripts/soak.mjs --hook scripts/beacon-soak-hook.mjs --run beacon-... (sets 'beacon-short' /
// 'beacon-med' / 'beacon-long' in soak.mjs). Samples the Beacon's state every SAMPLE_DAYS game days into report.beacon:
//   - the Great Work (phase / progress / stage), the Watchers (modes, corrupted worlds, sightings, detections), the season (phase, groups,
//     departures, staging strength), the Reclaimers' ships, the processing worlds, the population eliminated, the stats counters;
//   - the AI's response: military ships of the ordinary empires whose mission targets the Beacon, a Reclaimer ship, a Reclaimer-held
//     world or a staging point; the Reclaimer ships and worlds in each empire's region; the empires' military and population;
//   - violations (stuck states, orphan ships, a cloaked Watcher targeted, non-simultaneous departures, NaN stats).
// Environment (all optional):
//   BEACON_MODE=natural|force|complete   natural: nothing forced (the config's params decide); force: the Game Editor key giantworks:beacon at start
//                                        (the Gathering starts at once); complete: force, then finish the work after BEACON_COMPLETE_DAYS (default 90).
//   BEACON_SAMPLE_DAYS=15                sampling period
//   BEACON_TIMING=1                      also run scripts/soak-timing-hook.mjs (per-year frame percentiles, report.timing)
//   BEACON_STOP_ON_END=1                 stop the run when the game ends (victory / loss) + BEACON_TAIL_DAYS (default 60)

const SAMPLE_DAYS = Number(process.env.BEACON_SAMPLE_DAYS ?? 15);
const MODE = process.env.BEACON_MODE ?? 'natural';
const COMPLETE_DAYS = Number(process.env.BEACON_COMPLETE_DAYS ?? 90);
const STOP_ON_END = process.env.BEACON_STOP_ON_END === '1';
const TAIL_DAYS = Number(process.env.BEACON_TAIL_DAYS ?? 60);
const DAY_MS = 600_000 / 360;

let M = null;
let timing = null;
let startMs = 0;
let recSeenMs = -1;
// years since the hook first saw the Reclamation (wall-sim time; the star date is a different unit)
function recYears(now, st) {
    if (st.phase === 'reclamation' && recSeenMs < 0) recSeenMs = now;
    return recSeenMs < 0 ? -1 : (now - recSeenMs) / 600_000;
}
let lastSample = -Infinity;
let completeAt = null;
let endedAt = null;
let prevStats = {};
let lastSeasonKey = '';
const phaseSince = {}; // key → { value, since }
let reportRef = null;
const seenFaction = new Set();
let factionLost = 0;
let completedYear = null;

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

export async function start(ctx) {
    const { load, g, report } = ctx;
    reportRef = report;
    M = {
        bs: await load('beaconState'), bf: await load('beaconFleet'), bc: await load('beaconCounter'), bh: await load('beaconHarvest').catch(() => null), beacon: await load('beacon'),
        thr: await load('threats'), hooks: await load('scnHooks'), own: await load('ownership').catch(() => null), gw: await load('gwState'), gwf: await load('gwFramework'), life: await load('gwLifecycle'), tf: await load('thFramework'), dip: await load('diplomacyTick'), mis: await load('missions'),
    };
    if (process.env.BEACON_TIMING === '1') {
        timing = await import('./soak-timing-hook.mjs');
        await timing.start?.(ctx);
    }
    startMs = g.nowMs;
    report.beacon = { mode: MODE, samples: [], events: [], violations: {}, seasons: [], final: null };
    if (MODE === 'force' || MODE === 'complete') {
        const ok = M.tf.spawnThreatNow(g, g.playerEmpire, 'giantworks:beacon');
        report.beacon.forced = ok;
        console.log(`  beacon hook: spawnThreatNow giantworks:beacon -> ${ok}`);
        if (!ok) console.log(`  beacon hook: spawn note ${M.gwf.spawnNote?.(g)} | works ${JSON.stringify(M.gw.greatWorks(g).map((w) => [w.wonder, w.phase]))} | log ${JSON.stringify((M.gw.gwState(g).log ?? []).slice(-6))}`);
        if (MODE === 'complete') completeAt = g.nowMs + COMPLETE_DAYS * DAY_MS;
    }
}

// BEACON_LANDING_PROBE=1: while a strike group has landed (state 'landed'), log the ground war at its target every PROBE_MS game ms.
const PROBE = process.env.BEACON_LANDING_PROBE === '1';
const probeLast = new Map();
function landingProbe(ctx, g) {
    const st = M.bs.peekBeaconState(g);
    if (!st || st.phase !== 'reclamation') return;
    const rec = (ctx.report.beacon.landings ??= []);
    for (const sn of st.seasons) for (const grp of sn.groups) {
        if (grp.state !== 'landed' || grp.target === null) continue;
        const last = probeLast.get(grp.id) ?? -Infinity;
        if (g.nowMs - last < 0.3 * DAY_MS) continue;
        probeLast.set(grp.id, g.nowMs);
        const t = grp.target;
        const inv = t.invadingTroops?.items ?? [];
        const gar = t.troops?.items ?? [];
        if (rec.length > 400) return;
        rec.push({ d: +((g.nowMs - startMs) / DAY_MS).toFixed(1), grp: grp.id, target: t.name, owner: t.empire?.name, pop: Math.round(t.population.totalAmount / 1e6), invaders: inv.length, invAtk: Math.round(t.invadingTroops?.totalAttackStrength ?? 0), garrison: gar.length, garDef: Math.round(t.troops?.totalDefendStrength ?? 0),
            transportsLoaded: grp.transports.filter((b) => (b.troops?.count ?? 0) > 0).length, ships: grp.ships.length, fails: grp.fails, committed: grp.committed });
    }
}

// BEACON_PROBES=purge,bargain: exercise rare counterplay paths that the AI almost never takes by itself (the soak report counts them under stats).
//   purge   - every 60 game days one corrupted world owned by an AI empire is revealed to its owner (counter-intelligence found it): the AI's pass purges it;
//   bargain - once the first season ran, the weakest AI empire is marked as having lost 5 worlds: at the next offer it takes the deal its own rule picks.
const PROBES = new Set(String(process.env.BEACON_PROBES ?? '').split(',').filter((x) => x !== ''));
let probeNextPurge = 0;
let probeBargainDone = false;
let probePlanetDone = false;
let probeLossDone = false;
let victoryStep = 0;
function runProbes(ctx, g) {
    const st = M.bs.peekBeaconState(g);
    if (!st || st.faction === null) return;
    const now = g.nowMs;
    if (PROBES.has('purge') && now >= probeNextPurge) {
        probeNextPurge = now + 60 * DAY_MS;
        const rec = st.corrupted.find((c) => c.ended === null && c.colony.empire && c.colony.empire !== g.independentEmpire && c.colony.empire !== g.playerEmpire && c.colony.empire !== st.faction);
        if (rec) {
            M.tf.revealTo(g, { knowledge: rec.knowledge }, rec.colony.empire, 3);
            (ctx.report.beacon.probes ??= []).push(['purge-reveal', +((now - startMs) / 600_000).toFixed(2), rec.colony.name, rec.colony.empire.name]);
        }
    }
    if (PROBES.has('fight')) fightProbe(ctx, g, st);
    // 'loss' probe: after BEACON_LOSS_YEARS (default 3) of the Reclamation, the eliminated count is set to 79 % of the baseline: the next drain must end the game in defeat.
    if (PROBES.has('loss') && !probeLossDone && st.phase === 'reclamation' && recYears(now, st) > Number(process.env.BEACON_LOSS_YEARS ?? 3)) {
        probeLossDone = true;
        st.popEliminated = Math.max(st.popEliminated, st.popBaseline * 0.79);
        (ctx.report.beacon.probes ??= []).push(['loss-set', +((now - startMs) / 600_000).toFixed(2), `eliminated ${r1(M.bf.eliminatedPct(st))}%`]);
    }
    // 'victory' probe: after BEACON_VICTORY_YEARS (default 4): the Beacon and both Watchers are destroyed (the kill event) and every held world goes back to its first owner.
    if (PROBES.has('victory') && st.phase === 'reclamation' && recYears(now, st) > Number(process.env.BEACON_VICTORY_YEARS ?? 4)) {
        if (victoryStep === 0) {
            victoryStep = 1;
            const a = normals(g, st).find((e) => e !== g.playerEmpire) ?? normals(g, st)[0];
            for (const b of [st.beacon, ...st.watchers.map((w) => w.ship)]) if (b && !b.hasBeenDestroyed) M.hooks.scenarioEmit(g, 'builtObjectKilledBy', { builtObject: b, destroyer: a });
            for (const b of [st.beacon, ...st.watchers.map((w) => w.ship)]) if (b && !b.hasBeenDestroyed) b.hasBeenDestroyed = true;
            (ctx.report.beacon.probes ??= []).push(['victory-kill', +((now - startMs) / 600_000).toFixed(2), `processing ${M.bf.processingWorlds(st).length}`]);
        }
        const held = [...st.faction.colonies];
        if (held.length > 0) {
            const to = normals(g, st).find((e) => e !== g.playerEmpire) ?? normals(g, st)[0];
            if (M.own) for (const c of held) M.own.takeOwnershipOfColonyFull(g, st.faction, c, to, false, false);
        }
    }
    // 'planet' probe: the first strike group found besieging a small world (diameter <= 400) is given the planet destroyer the siege rule would send after a long failed siege.
    if (PROBES.has('planet') && !probePlanetDone && st.phase === 'reclamation') {
        for (const sn of st.seasons) for (const grp of sn.groups) {
            if (probePlanetDone || grp.state !== 'siege' || grp.target === null || grp.target.diameter > 400 || grp.destroyer !== null) continue;
            probePlanetDone = true;
            M.bf.planetStrike(g, st, grp);
            (ctx.report.beacon.probes ??= []).push(['planet-strike', +((now - startMs) / 600_000).toFixed(2), grp.target.name, `pop ${Math.round(grp.target.population.totalAmount / 1e6)}M`, `destroyer ${grp.destroyer !== null}`]);
        }
    }
    if (PROBES.has('bargain') && !probeBargainDone && st.season !== null && st.stats.seasons >= 1) {
        const ns = normals(g, st).filter((e) => e !== g.playerEmpire && e.colonies.length >= 3);
        if (ns.length > 0) {
            const weakest = ns.sort((a, b) => M.dip.militaryPotency(a) - M.dip.militaryPotency(b))[0];
            st.lostBy[String(weakest.empireId)] = Math.max(st.lostBy[String(weakest.empireId)] ?? 0, 6);
            st.offered[String(weakest.empireId)] = -1e18;
            probeBargainDone = true;
            (ctx.report.beacon.probes ??= []).push(['bargain-mark', +((now - startMs) / 600_000).toFixed(2), weakest.name]);
        }
    }
}

// 'fight' probe: the first time a Watcher is seen uncloaked (a sighting), an AI empire "attacks" it (the same event a real shot raises): it must go
// to 'fight', be at locked war with the attacker only, and slip away (cloaked, 'return') within 60 days.
let fightState = null;
function fightProbe(ctx, g, st) {
    const now = g.nowMs;
    if (fightState === null) {
        const w = st.watchers.find((x) => !x.dead && x.mode === 'sighting' && x.ship && x.ship.cloaked !== true);
        if (!w) return;
        const attacker = normals(g, st).find((e) => e !== g.playerEmpire && e.colonies.length > 0);
        if (!attacker) return;
        M.hooks.scenarioEmit(g, 'builtObjectAttacked', { builtObject: w.ship, attacker: null, attackingEmpire: attacker });
        fightState = { w, attacker, at: now, modeAfter: w.mode, warAfter: attacker.diplomaticRelations.byEmpire(st.faction)?.type };
        (ctx.report.beacon.probes ??= []).push(['fight-attack', +((now - startMs) / 600_000).toFixed(2), `W${w.index}`, attacker.name, `mode ${w.mode}`, `war ${fightState.warAfter}`]);
        return;
    }
    if (fightState.done) return;
    const { w } = fightState;
    if (w.mode === 'return' || w.mode === 'parked' || w.mode === 'dead') {
        fightState.done = true;
        (ctx.report.beacon.probes ??= []).push(['fight-slipped', +((now - startMs) / 600_000).toFixed(2), `after ${r1((now - fightState.at) / DAY_MS)} days`, `mode ${w.mode}`, `cloaked ${w.ship?.cloaked}`]);
    } else if (now - fightState.at > 120 * DAY_MS) {
        fightState.done = true;
        viol(ctx.report, 'Watcher did not slip away after being attacked', `mode ${w.mode} after ${r1((now - fightState.at) / DAY_MS)} days`);
    }
}

export function frame(ctx, dt, g) {
    timing?.frame?.(ctx, dt, g);
    if (PROBE && M) landingProbe(ctx, g);
    if (g.nowMs - lastSample < SAMPLE_DAYS * DAY_MS) return;
    lastSample = g.nowMs;
    try {
        if (PROBES.size > 0) runProbes(ctx, g);
        sample(ctx, g);
    } catch (e) {
        const v = (ctx.report.beacon.violations['hook error'] ??= { count: 0, examples: [] });
        v.count++;
        if (v.examples.length < 3) v.examples.push(String(e?.stack ?? e).split('\n').slice(0, 4).join(' / '));
    }
}

export async function chunk(ctx) {
    const r = await timing?.chunk?.(ctx);
    if (r === 'stop') return 'stop';
    const g = ctx.g;
    if (completeAt !== null && g.nowMs >= completeAt) {
        completeAt = null;
        const w = M.gw.greatWorks(g).find((x) => x.wonder === 'beacon');
        if (w && w.phase === 'building') {
            M.life.completeWork(g, w);
            console.log(`  beacon hook: work completed by the hook at year ${((g.nowMs - startMs) / 600_000).toFixed(2)}`);
        }
    }
    if (STOP_ON_END) {
        const st = M.bs.peekBeaconState(g);
        if (st?.ended && endedAt === null) endedAt = g.nowMs;
        if (endedAt !== null && g.nowMs - endedAt >= TAIL_DAYS * DAY_MS) return 'stop';
    }
    return undefined;
}

export function finish(ctx) {
    // soak.mjs has no finish hook; the sampler writes report.beacon.final at every sample.
    void ctx;
}

function viol(report, key, example) {
    const v = (report.beacon.violations[key] ??= { count: 0, examples: [] });
    v.count++;
    if (v.examples.length < 4) v.examples.push(example);
}

function stuck(report, key, value, now, limitDays, what, extra = '') {
    const rec = phaseSince[key];
    if (rec === undefined || rec.value !== value) {
        phaseSince[key] = { value, since: now, flagged: false };
        return;
    }
    if (!rec.flagged && now - rec.since > limitDays * DAY_MS) {
        rec.flagged = true;
        viol(report, `stuck: ${what}`, `${key}=${value} for ${r1((now - rec.since) / DAY_MS)} days (d${r1((now - startMs) / DAY_MS)}) ${extra}`);
    }
}

function normals(g, st) {
    return g.empires.filter((e) => e !== null && e !== g.independentEmpire && e.active && e.pirateEmpireBaseHabitat === null && e !== st?.faction && e.name !== 'The Founders\' Compact');
}

function missionOf(M_, bo) {
    const m = bo.mission ?? bo.shipGroup?.mission ?? null;
    return m;
}

function sample(ctx, g) {
    const { report } = ctx;
    const now = g.nowMs;
    const years = (now - startMs) / 600_000;
    const st = M.bs.peekBeaconState(g);
    const work = M.gw.greatWorks(g).find((x) => x.wonder === 'beacon') ?? M.gw.greatWorks(g)[0] ?? null;
    const s = { y: r2(years) };
    if (work) s.gw = [work.phase, r2(work.progress), work.stage, work.convoys.length, work.delivered, work.lost];
    const faction = st?.faction ?? null;
    const ns = normals(g, st);
    // The ordinary empires: colonies, population (millions), military.
    const pops = ns.map((e) => e.colonies.reduce((a, c) => a + (c.hasBeenDestroyed ? 0 : c.population.totalAmount), 0) / 1e6);
    const mils = ns.map((e) => M.dip.militaryPotency(e));
    s.emp = ns.length;
    s.col = ns.reduce((a, e) => a + e.colonies.length, 0);
    s.pop = r1(pops.reduce((a, b) => a + b, 0));
    s.mil = Math.round(mils.reduce((a, b) => a + b, 0));
    s.milTop = Math.round([...mils].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0) / 3);
    s.bo = g.builtObjects.length;
    {
        // the garrisons of the ordinary empires' colonies (what the Reclaimers face) and the troops the AI carries in transports
        const gar = [];
        let troopCarried = 0;
        for (const e of ns) {
            for (const c of e.colonies) gar.push(c.troops?.totalDefendStrength ?? 0);
            for (const b of e.builtObjects) if (!b.hasBeenDestroyed && b.troops && b.troops.count > 0) troopCarried += b.troops.totalAttackStrength;
        }
        gar.sort((a, b) => a - b);
        s.gar = gar.length ? [gar[Math.floor(gar.length * 0.5)], gar[Math.floor(gar.length * 0.9)], gar[gar.length - 1]] : [];
        const garN = [];
        for (const e of ns) for (const c of e.colonies) garN.push(c.troops?.count ?? 0);
        garN.sort((a, b) => a - b);
        s.garN = garN.length ? [garN[Math.floor(garN.length * 0.5)], garN[Math.floor(garN.length * 0.9)], garN[garN.length - 1]] : [];
        s.troopsCarried = Math.round(troopCarried);
    }
    if (st) {
        s.ph = st.phase;
        if (completedYear === null && st.phase !== 'watching') completedYear = s.y;
        s.w = st.watchers.map((w) => (w.dead ? 'X' : w.mode[0] + (w.ship?.cloaked ? '' : '!'))).join('');
        s.cor = st.corrupted.filter((c) => c.ended === null).length;
        // the siphon (the Beacon's completion gate), purges in progress, the cattle interception counts, the research moratorium
        if (st.siphon) s.siph = { total: Math.round(st.siphon.total), rate: r1(st.siphon.rate), gate: st.siphon.gateDate > 0 };
        s.purging = st.corrupted.filter((c) => c.purge !== undefined).length;
        s.icpt = (st.intercepts ?? []).map((r) => r1(r.n));
        if (st.moratorium) s.mor = { until: Math.round(st.moratorium.until), breakers: st.moratorium.breakers.length, sanctioned: st.moratorium.sanctioned.length };
        s.wStr = st.watchers.map((w) => (w.dead || !w.ship || w.ship.hasBeenDestroyed ? 0 : Math.round(M.thr.calculateOverallStrengthFactor(w.ship))));
        s.elim = r1(M.bf.eliminatedPct(st));
        // the Watcher fleets: mode (d defence / o offensive), live escorts, strength (Watcher and escorts), the world held
        s.wf = (st.watcherFleets ?? []).map((f) => [f.mode[0], f.ships.filter((b) => !b.hasBeenDestroyed).length, Math.round(M.bf.watcherFleetStrength(st, f)), f.post ? f.post.name : null]);
        s.proc = M.bf.processingWorlds(st).length;
        s.rec = st.reclamationDate > 0 ? r2((now - st.reclamationDate) / 600_000) : null;
        s.beacon = st.beacon ? (st.beacon.hasBeenDestroyed ? 'destroyed' : 'alive') : null;
        if (st.beacon && !st.beacon.hasBeenDestroyed) {
            const full = (list) => Math.round(list.reduce((a, b) => a + (b.hasBeenDestroyed ? 0 : M.thr.calculateOverallStrengthFactor(b)), 0));
            s.beaconStr = full([st.beacon]);
            s.guardStr = full(st.guards);
            s.aiFull = Math.round(ns.reduce((a, e) => a + e.builtObjects.reduce((q, b) => q + (b.role === 1 && !b.hasBeenDestroyed && b.topSpeed > 0 ? M.thr.calculateOverallStrengthFactor(b) : 0), 0), 0));
            const comps = st.beacon.components?.items ?? st.beacon.components ?? [];
            const arr = Array.isArray(comps) ? comps : [];
            const dmg = arr.filter((c) => c.status === 2).length;
            s.beaconDmg = arr.length > 0 ? r2(dmg / arr.length) : 0;
            s.beaconSh = st.beacon.shieldsCapacity > 0 ? r2(st.beacon.currentShields / st.beacon.shieldsCapacity) : 0;
        }
        const season = st.season;
        if (season) {
            s.sn = season.n;
            s.sp = season.phase;
            s.grp = season.groups.map((x) => x.state[0]).join('');
            s.stg = season.staging.map((p) => Math.round(p.strength));
            s.stgKnown = season.staging.map((p) => p.knowledge.length);
            if (season.phase === 'prep') {
                // Do the coalition's ships arrive? Per staging point: AI warships within 100k / 1M of it, nearest AI warship ordered at a Reclaimer ship.
                s.stgNear = season.staging.map((p) => {
                    let n1 = 0, n2 = 0, nearestOrdered = Infinity;
                    for (const e of ns) for (const b of e.builtObjects) {
                        if (b.hasBeenDestroyed || b.role !== 1) continue;
                        const d = Math.hypot(b.xpos - p.x, b.ypos - p.y);
                        if (d < 100000) n1++;
                        if (d < 1000000) n2++;
                        const m = b.mission ?? b.shipGroup?.mission ?? null;
                        if (m && m.type === 9 && m.targetBuiltObject && m.targetBuiltObject.actualEmpire === faction && d < nearestOrdered) nearestOrdered = d;
                    }
                    return [n1, n2, Number.isFinite(nearestOrdered) ? Math.round(nearestOrdered / 1000) : null];
                });
            }
        }
        // The faction's ships by kind and where they are.
        if (faction) {
            let ships = 0, mil = 0, transports = 0, idleMil = 0, strength = 0;
            const tracked = new Set();
            for (const sn of st.seasons) for (const grp of sn.groups) for (const b of [...grp.ships, ...grp.transports]) tracked.add(b);
            for (const r of st.raids) for (const b of r.ships) tracked.add(b);
            for (const b of [...st.reserve, ...st.guards, ...st.thrallShips, ...(st.watcherFleets ?? []).flatMap((f) => f.ships)]) tracked.add(b);
            for (const w of st.watchers) if (w.ship) tracked.add(w.ship);
            if (st.beacon) tracked.add(st.beacon);
            let orphans = 0;
            for (const b of faction.builtObjects) {
                if (b.hasBeenDestroyed) continue;
                ships++;
                if (b.troopCapacity > 0) transports++;
                else mil++;
                // (the bases, ports and civilian ships that came with a conquered world are the faction's too, with no orders: not a leak)
                if (!tracked.has(b) && b.role === 1 && b.topSpeed > 0 && [1, 2, 3, 4, 5, 7].includes(b.subRole)) {
                    orphans++;
                }
            }
            // Reclaimer warships lost so far (seen alive at an earlier sample, destroyed since): how hard the AI hits them.
            for (const b of seenFaction) if (b.hasBeenDestroyed) { seenFaction.delete(b); factionLost++; }
            for (const b of faction.builtObjects) if (!b.hasBeenDestroyed) seenFaction.add(b);
            s.lost = factionLost;
            s.fs = ships;
            s.fm = mil;
            s.ft = transports;
            s.orph = orphans;
            if (orphans > 40 && orphans > ships * 0.25) {
                const bySub = {}, byMission = {};
                let near = 0, loaded = 0, atWorld = 0;
                const bpos = st.beacon && !st.beacon.hasBeenDestroyed ? st.beacon : null;
                for (const b of faction.builtObjects) {
                    if (b.hasBeenDestroyed || tracked.has(b) || b.role !== 1 || !(b.topSpeed > 0) || ![1, 2, 3, 4, 5, 7].includes(b.subRole)) continue;
                    bySub[b.subRole] = (bySub[b.subRole] ?? 0) + 1;
                    const m = b.mission ?? b.shipGroup?.mission ?? null;
                    byMission[m?.type ?? 'none'] = (byMission[m?.type ?? 'none'] ?? 0) + 1;
                    if (bpos && Math.hypot(b.xpos - bpos.xpos, b.ypos - bpos.ypos) < 80000) near++;
                    if ((b.troops?.count ?? 0) > 0) loaded++;
                    if (faction.colonies.some((c) => Math.hypot(b.xpos - c.xpos, b.ypos - c.ypos) < 40000)) atWorld++;
                }
                viol(report, 'orphan Reclaimer ships (not in any group / raid / reserve / guard)', `${orphans} of ${ships} at d${r1((now - startMs) / DAY_MS)}: subRole ${JSON.stringify(bySub)} mission ${JSON.stringify(byMission)} nearBeacon ${near} loaded ${loaded} atHeldWorld ${atWorld} seasons ${st.seasons.map((q) => q.n).join(',')}`);
            }
            s.fcol = faction.colonies.length;
        }
        if (M.bh && faction) {
            // the harvest: live cores, people in the pens (M), cattle ships in flight, the biofuel accounts, last month's income, the Reclaimers' warship strength
            const live = M.bh.liveCores(st);
            const fuel = st.fuel ?? null;
            let fStr = 0;
            for (const b of faction.builtObjects) if (!b.hasBeenDestroyed && b.role === 1 && b.topSpeed > 0) fStr += M.thr.calculateOverallStrengthFactor(b);
            s.h = { cores: live.length, want: M.bh.coreCountFor(g, M.bf.processingWorlds(st).length), pens: Math.round(live.reduce((a, c) => a + c.waiting, 0) / 1e6), cattle: (st.cattle ?? []).length,
                fuel: fuel ? [Math.round(fuel.fleet), Math.round(fuel.troops)] : null, inc: fuel ? fuel.monthly.at(-1) ?? 0 : 0, fStr: Math.round(fStr) };
            // per core: AI warships ordered at the world (Attack / Bombard / Invade) or at its harvester, enemy troops on its ground, its garrison (k)
            s.h.coreAtk = live.map((c) => {
                let atW = 0, atH = 0;
                for (const e of ns) for (const b of e.builtObjects) {
                    if (b.hasBeenDestroyed || b.role !== 1) continue;
                    const m = b.mission ?? b.shipGroup?.mission ?? null;
                    if (!m) continue;
                    if (m.targetHabitat === c.colony) atW++;
                    else if (c.harvester && m.targetBuiltObject === c.harvester) atH++;
                }
                const inv = (c.colony.invadingTroops?.items ?? []).filter((t) => t.empire !== faction).length;
                return [atW, atH, inv, Math.round((c.colony.troops?.totalDefendStrength ?? 0) / 1000)];
            });
        }
        s.st = { ...st.stats };
        {
            // the crisis hooks: the council's verdict on the faction, the crisis records (opportunists reported, empires credited for fighting it)
            const cs = g.scenario?.state?.council;
            const crisis = g.scenario?.state?.crisis;
            s.crisis = { councils: cs ? cs.councils.length : 0, threat: cs ? cs.councils.filter((c) => c.threats.includes(faction)).length : 0, sanction: cs ? cs.councils.filter((c) => (c.sanctions ?? []).some((x) => x.target === faction)).length : 0,
                hits: crisis ? crisis.hits.length : 0, fighters: crisis ? Object.keys(crisis.fight).filter((k) => k.startsWith('beacon:')).length : 0, credited: crisis ? Object.keys(crisis.done).filter((k) => k.includes('beacon')).length : 0 };
        }
        {
            const wc = g.scenario?.state?.warCrimes;
            if (wc) s.wc = { collab: wc.totals?.collaboration ?? 0, greatWork: wc.totals?.greatWork ?? 0, tribunals: (wc.tribunals ?? []).length, passed: (wc.tribunals ?? []).filter((t) => t.passed).length };
        }
        if (st.ai?.last) s.aiLast = st.ai.last;
        {
            // The held lead ships of the coalition: how many are near the Beacon operation's waypoint, and what missions they carry.
            const op = st.ai?.ops?.beacon;
            const held = (st.ai?.held ?? []).filter((b) => !b.hasBeenDestroyed);
            if (held.length > 0) {
                const byMission = {};
                let near = 0, sumD = 0;
                for (const b of held) {
                    const m = missionOf(M, b);
                    const k = m ? String(m.type) : 'none';
                    byMission[k] = (byMission[k] ?? 0) + 1;
                    if (op && op.wx !== undefined) { const d = Math.hypot(b.xpos - op.wx, b.ypos - op.wy); sumD += d; if (d <= 250000) near++; }
                }
                s.aiHeld = { n: held.length, near, avgD: Math.round(sumD / held.length / 1000) + 'k', m: byMission };
            }
        }
        if (st.ai?.ops) s.aiOps = Object.entries(st.ai.ops).map(([k, v]) => `${k}${v.go ? '!' : ''}:${v.there ?? 0}/${v.need ?? 0}`).join(',');
        // Every recent season's groups: C taken, the first letter of the state otherwise; landings / failed landings.
        s.sg = st.seasons.map((sn) => [sn.n, sn.groups.map((x) => (x.target && x.target.empire === faction ? 'C' : x.state[0]) + x.landings + '/' + x.fails).join(' ')]);
        // Events from the stat counters.
        for (const [k, v] of Object.entries(st.stats)) {
            const d = v - (prevStats[k] ?? 0);
            if (d !== 0 && !['spawned', 'transportsSpawned', 'popDrained', 'popDestroyed'].includes(k)) report.beacon.events.push([r2(years), k, d]);
            if (typeof v !== 'number' || !Number.isFinite(v)) viol(report, 'non-finite stat', `${k}=${v}`);
        }
        prevStats = { ...st.stats };
        if (!Number.isFinite(st.popEliminated)) viol(report, 'non-finite popEliminated', String(st.popEliminated));
        // Season records (once per season change).
        const key = season ? `${season.n}:${season.phase}` : '-';
        if (key !== lastSeasonKey) {
            lastSeasonKey = key;
            if (season) {
                // Where the staging points lie relative to the empires' colonies (sectors): the nearest colony, and how many empires lie within 2 / 4 / 8 sectors.
                const sect = g.sectorSize;
                const stagingGeo = season.staging.map((p) => {
                    let near = Infinity;
                    const within = [new Set(), new Set(), new Set()];
                    for (const e of ns) for (const c of e.colonies) {
                        const d = Math.hypot(c.xpos - p.x, c.ypos - p.y) / sect;
                        if (d < near) near = d;
                        [2, 4, 8].forEach((lim, i) => { if (d <= lim) within[i].add(e.empireId); });
                    }
                    return { x: Math.round(p.x), y: Math.round(p.y), nearestSectors: r1(near), empires: within.map((t) => t.size) };
                });
                const rec = { y: r2(years), n: season.n, phase: season.phase, staging: stagingGeo, galaxySize: [g.sizeX, g.sizeY, sect], groups: season.groups.length, budget: Math.round(season.budget), spawned: Math.round(season.spawned), planned: r1(season.plannedTravelDays), departed: season.departed > 0 ? r2((season.departed - startMs) / 600_000) : null,
                    targets: season.groups.map((x) => `${x.target?.name ?? '?'}@${x.target?.empire?.name ?? 'ind'}`), ships: season.groups.map((x) => x.ships.length), transports: season.groups.map((x) => x.transports.length),
                    regiments: season.groups.map((x) => x.transports.reduce((n, b) => n + (b.troops?.count ?? 0), 0)), troopCap: season.groups.flatMap((x) => x.transports.map((b) => b.troopCapacity))[0] ?? null,
                    defRegs: season.groups.map((x) => x.target?.troops?.count ?? 0), defStr: season.groups.map((x) => Math.round(x.target?.troops?.totalDefendStrength ?? 0)) };
                report.beacon.seasons.push(rec);
            }
        }
        // Violations: departures simultaneous; stuck states.
        for (const sn of st.seasons) {
            if (sn.departures.length > 1 && new Set(sn.departures).size > 1) viol(report, 'departures not simultaneous', `season ${sn.n}: ${[...new Set(sn.departures)].join(',')}`);
        }
        if (season) {
            stuck(report, 'season', `${season.n}:${season.phase}`, now, season.phase === 'quiet' ? 900 : 700, 'season phase');
            for (const grp of season.groups) if (grp.state !== 'done') stuck(report, `group${grp.id}`, grp.state, now, grp.state === 'gather' ? 600 : 800, `group ${grp.state}`);
        }
        for (const w of st.watchers) if (!w.dead) {
            const sh = w.ship;
            const m = sh?.mission ?? null;
            if (sh && !sh.hasBeenDestroyed && faction && sh.actualEmpire !== faction) viol(report, 'Watcher no longer owned by the faction', `watcher${w.index} now ${sh.actualEmpire?.name} (mode ${w.mode}, dead ${w.dead}, faction active ${faction.active}, empire ${sh.empire?.name}, phase ${st.phase}) d${r1((now - startMs) / DAY_MS)}`);
            stuck(report, `watcher${w.index}`, w.mode, now, { parked: 4000, travel: 1100, return: 300, dwell: 150, sighting: 100, fight: 200, lead: 1e9 }[w.mode] ?? 600, `watcher ${w.mode}`,
                sh ? `pos ${Math.round(sh.xpos)},${Math.round(sh.ypos)} home ${Math.round(w.homeX)},${Math.round(w.homeY)} galaxy ${g.sizeX}x${g.sizeY} fuel ${Math.round(sh.currentFuel)}/${Math.round(sh.fuelCapacity)} speed ${sh.currentSpeed}/${sh.warpSpeed} mission ${m?.type} target ${w.target?.name ?? '-'} auto ${sh.isAutoControlled}` : '');
        }
        // Cloak: no ordinary empire's ship may be ordered at a cloaked Watcher.
        const cloaked = st.watchers.filter((w) => !w.dead && w.ship && w.ship.cloaked === true).map((w) => w.ship);
        // AI response.
        const ai = { beacon: 0, ship: 0, colony: 0, staging: 0, nearBeacon: 0, nearBeaconStrength: 0 };
        const stagePts = st.season && st.season.phase === 'prep' ? st.season.staging : [];
        const bpos = st.beacon && !st.beacon.hasBeenDestroyed ? st.beacon : null;
        for (const e of ns) {
            for (const b of e.builtObjects) {
                if (b.hasBeenDestroyed || b.role !== 1 /* Military */) continue;
                const m = missionOf(M, b);
                if (m) {
                    const tb = m.targetBuiltObject ?? null;
                    const th = m.targetHabitat ?? null;
                    if (tb && cloaked.includes(tb) && !M.beacon.cloakLapsedFor(tb, e, now)) {
                        const wr = st.watchers.find((x) => x.ship === tb);
                        viol(report, 'AI ship targets a cloaked Watcher', `${e.name} ${b.name} mission ${m.type} prio ${m.priority} grp ${b.shipGroup ? b.shipGroup.name : '-'} own ${b.mission ? 'ship' : 'fleet'} dist ${Math.round(Math.hypot(b.xpos - tb.xpos, b.ypos - tb.ypos))} watcher ${wr?.index} mode ${wr?.mode} cloakSeenBy ${JSON.stringify(tb.cloakSeenBy ?? [])} d${r1((now - startMs) / DAY_MS)}`);
                    }
                    if (bpos && tb === bpos) ai.beacon++;
                    else if (tb && tb.actualEmpire === faction) ai.ship++;
                    else if (th && th.empire === faction) ai.colony++;
                    else if (stagePts.length > 0 && m.x !== undefined && stagePts.some((p) => Math.hypot((m.x ?? 0) - p.x, (m.y ?? 0) - p.y) < 40000)) ai.staging++;
                }
                if (bpos && Math.hypot(b.xpos - bpos.xpos, b.ypos - bpos.ypos) < 60000) {
                    ai.nearBeacon++;
                }
            }
        }
        s.ai = ai;
        if (st.ended) s.ended = true;
        report.beacon.final = { y: s.y, phase: st.phase, ended: st.ended, elim: s.elim, stats: { ...st.stats }, seasons: st.stats.seasons, salvage: st.salvage.map((x) => [x.empireId, x.points, x.steps]),
            bargains: st.bargains.map((b) => [b.empireId, b.kind, b.discovered, b.ended]), watchersDead: st.watchers.filter((w) => w.dead).length, beaconDestroyed: st.beaconDestroyed, processingNow: s.proc,
            harvest: M.bh ? (() => {
                const sect = g.sectorSize;
                const live = M.bh.liveCores(st);
                let minD = null;
                for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
                    const d = Math.hypot(live[i].colony.xpos - live[j].colony.xpos, live[i].colony.ypos - live[j].colony.ypos) / sect;
                    if (minD === null || d < minD) minD = d;
                }
                const fuel = st.fuel ?? {};
                return { model: Number(g.scenario?.params?.beaconFundingModel ?? 2), stars: g.starCount, coreTarget: M.bh.coreTarget(g), liveCores: live.length, minCoreSectors: minD === null ? null : r1(minD),
                    cores: (st.cores ?? []).map((c) => [c.colony.name, r2((c.since - (st.reclamationDate || 0)) / 600_000), c.ended, Math.round(c.received / 1e6), Math.round(c.processed / 1e6), Math.round(c.colony.xpos / sect * 10) / 10, Math.round(c.colony.ypos / sect * 10) / 10]),
                    fuel: { fleet: Math.round(fuel.fleet ?? 0), troops: Math.round(fuel.troops ?? 0), income: Math.round(fuel.income ?? 0), ships: Math.round(fuel.spentShips ?? 0), troopsSpent: Math.round(fuel.spentTroops ?? 0), start: Math.round(fuel.startGrant ?? 0) },
                    launches: st.launches ?? 0 };
            })() : null,
            siphon: st.siphon ? { total: Math.round(st.siphon.total), gateDate: st.siphon.gateDate, byEmpire: st.siphon.byEmpire } : null,
            completedYear: completedYear,
            diet: (() => { const d = g.scenario?.state?.interstellarDiet; return d ? { sessions: d.counters?.sessions, proposed: d.counters?.proposed, passed: d.counters?.passed, members: d.members?.length } : null; })(),
            moratoriumVotes: ((g.scenario?.state?.interstellarDiet ?? g.scenario?.state?.diet)?.history ?? []).filter((h) => h.kind === 'beaconMoratorium').map((h) => [h.result, h.yes, h.no]),
            corruptedEver: st.stats.corrupted, lostBy: st.lostBy, beaconLaunches: st.ai?.launches ?? 0, guards: st.guards.filter((b) => !b.hasBeenDestroyed).length };
    }
    report.beacon.samples.push(s);
}
