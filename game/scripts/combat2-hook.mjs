// Measurement hook for the six combat changes after BVR combat (decoys, ambush, critical hits, damage control, armour facing, surrender and
// wrecks): scripts/soak.mjs --set combat2 --hook scripts/combat2-hook.mjs. Same measures as bvr-hook.mjs (warships lost, battles, wars, the
// strongest empire's share of the colonies, AI strike missions), plus the changes' own counters (scenario.state.combat2.stats), the wrecks
// (total now, the most in one system now and at the peak, over time) and BVR's counters. Reads only: no Rnd, no state changes.
// Per chunk (60 game seconds): the live warships (role Military, mobile) of every normal empire; a warship that is gone with
// hasBeenDestroyed counts as lost, by empire; a battle = a system (or deep-space sector) where a warship is under attack, counted once
// per episode. With the add-on: launcher-carrying warships and the launchers they carry, the average magazine fill, the add-on's own
// counters (missiles / torpedoes fired and landed, shot down by point defence / guns, rearm trips, rounds loaded and their cost),
// and the newest design of each hull per empire with its launcher / torpedo / point-defence counts. Both runs: empires at war, the
// strongest empire's share of the colonies, and the AI war activity (fleet strike missions, invasions).
// Writes report.bvr every chunk (the last one is the end state). Reads only: no Rnd, no state changes.
const MILITARY = 1; // BuiltObjectRole.Military
const PD = 5; // ComponentType.WeaponPointDefense
const MISSILE = 4;
const TORPEDO = 2;
const BVR_NAMES = new Set(['Javelin Missile Launcher', 'Longbow Missile Launcher', 'Stormspear Missile Launcher', 'Skyfire Missile Launcher']);
const isBvrMissile = (c) => c.type === MISSILE && BVR_NAMES.has(c.name ?? c.def?.name ?? '');
let live = new Map();
let lost = 0;
const lostBy = new Map();
let fighting = new Set();
let battles = 0;
let bvr = null;

const STRIKE = new Set([9, 16, 17, 27, 28, 30]);
const seenMissions = new WeakSet();
let strikes = 0;
let wreckPeakSystem = 0;
let wreckPeakTotal = 0;
let lastYearLogged = -1;
const wrecksByYear = [];
let lastSample = -Infinity;

const frameTimes = [];
export function frame(ctx, dt, g) {
    frameTimes.push(dt);
    if (g.nowMs - lastSample < 2000) return;
    lastSample = g.nowMs;
    for (const e of g.empires) {
        if (e == null || e === g.playerEmpire || e === g.independentEmpire || e.pirateEmpireBaseHabitat !== null) continue;
        for (const f of e.shipGroups) {
            const m = f?.mission ?? null;
            if (m !== null && STRIKE.has(m.type) && !seenMissions.has(m)) {
                seenMissions.add(m);
                strikes++;
            }
        }
    }
}

export async function start(ctx) {
    ctx.report.combat2 = {};
    bvr = await ctx.load('bvr');
}

function normal(g) {
    return g.empires.filter((e) => e != null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active);
}

function warships(g) {
    const out = [];
    for (const e of [...g.empires, ...g.pirateEmpires]) {
        if (e == null) continue;
        for (const b of e.builtObjects) if (b != null && b.role === MILITARY && b.topSpeed > 0 && b.builtAt === null) out.push(b);
    }
    return out;
}

export function chunk(ctx) {
    const g = ctx.g;
    const now = new Map();
    const fightNow = new Set();
    for (const b of warships(g)) {
        now.set(b, b.empire?.name ?? '?');
        if ((b.attackers ?? []).length > 0) {
            const s = b.nearestSystemStar;
            fightNow.add(s !== null ? s : `${Math.trunc(b.xpos / 100000)},${Math.trunc(b.ypos / 100000)}`);
        }
    }
    for (const [b, name] of live) {
        if (!now.has(b) && b.hasBeenDestroyed) {
            lost++;
            lostBy.set(name, (lostBy.get(name) ?? 0) + 1);
        }
    }
    for (const k of fightNow) if (!fighting.has(k)) battles++;
    fighting = fightNow;
    live = now;
    const empires = normal(g);
    const colonies = empires.map((e) => ({ name: e.name, colonies: e.colonies.length })).sort((a, b) => b.colonies - a.colonies);
    const totalCol = colonies.reduce((s, c) => s + c.colonies, 0);
    let wars = 0;
    for (let i = 0; i < empires.length; i++) {
        for (let j = i + 1; j < empires.length; j++) {
            const r = empires[i].diplomaticRelations.byEmpire(empires[j]);
            if (r != null && r.type === 7) wars++;
        }
    }
    // Wrecks now: the debris fields' records, per system.
    const wk = g.scenario?.state?.wreckage ?? null;
    let wrecksNow = 0;
    let maxInSystem = 0;
    if (wk !== null) {
        const per = new Map();
        for (const f of wk.fields) {
            wrecksNow += f.wrecks.length;
            per.set(f.systemIndex, (per.get(f.systemIndex) ?? 0) + f.wrecks.length);
        }
        for (const v of per.values()) maxInSystem = Math.max(maxInSystem, v);
    }
    wreckPeakSystem = Math.max(wreckPeakSystem, maxInSystem);
    wreckPeakTotal = Math.max(wreckPeakTotal, wrecksNow);
    const year = +(g.nowMs / 600000).toFixed(2);
    if (Math.floor(year) > lastYearLogged) {
        lastYearLogged = Math.floor(year);
        wrecksByYear.push(`y${lastYearLogged}:${wrecksNow}/${maxInSystem}`);
    }
    const c2 = g.scenario?.state?.combat2 ?? null;
    const st = g.scenario?.state?.bvrCombat ?? null;
    ctx.report.combat2 = {
        year,
        warshipsAlive: now.size,
        warshipsLost: lost,
        lostByEmpire: Object.fromEntries(lostBy),
        battles,
        empires: empires.length,
        pairsAtWar: wars,
        topColonyShare: totalCol > 0 ? +(colonies[0].colonies / totalCol).toFixed(3) : 0,
        colonies: colonies.map((c) => `${c.name.slice(0, 12)}:${c.colonies}`),
        aiStrikeMissions: strikes,
        wrecks: { now: wrecksNow, maxInOneSystemNow: maxInSystem, peakInOneSystem: wreckPeakSystem, peakTotal: wreckPeakTotal, byYear_total_slash_maxSystem: wrecksByYear },
        frameMs: (() => { const a = [...frameTimes].sort((x, y) => x - y); const q = (p) => +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2); return { n: a.length, p50: q(0.5), p99: q(0.99), p999: q(0.999), max: +a[a.length - 1].toFixed(0) }; })(),
        combat2Stats: c2 === null ? null : c2.stats,
        combat2Tracked: c2 === null ? null : { decoyPools: c2.decoys.size, ambush: c2.ambush.size, crits: c2.crits.size, dc: c2.dc.size, struckNow: c2.struck.size, calm: c2.calm.size, flank: c2.flank.size },
        bvr: st === null ? null : { missilesFired: st.missilesFired, missileHits: st.missileHits, torpedoesFired: st.torpedoesFired, torpedoHits: st.torpedoHits, downedByPd: st.downedByPd, roundsLoaded: st.roundsLoaded, aiRearmTrips: st.aiRearmTrips },
    };
}
