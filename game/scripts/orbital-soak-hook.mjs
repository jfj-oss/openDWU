// Measurement hook for Orbital superiority (scenarios/orbital-superiority): scripts/soak.mjs --set orbital --hook
// scripts/orbital-soak-hook.mjs. Counts empire ground invasions the same way in both runs (os-on-s1: the add-on on;
// os-off-s1: the same galaxy, master switch off = the stock game) by sampling every colony every 2 game seconds:
// an invasion starts when a normal empire's troops (not pirate raiders) stand on another's colony and ends when none is
// left (succeeded = the colony is the invader's). Also the stock galaxy counters and, with the add-on on, its own
// stats (relief fleets, held / aborted landings, withdrawals). Writes report.orbital after every chunk.
const SAMPLE_MS = 2000;
let lastSample = -Infinity;
/** habitat index → invader empire id */
const active = new Map();
const counts = { started: 0, succeeded: 0, failed: 0, byPlayer: 0, firstYear: null };
/** decade index → { started, succeeded, failed } */
const decades = {};
const dec = (g) => (decades[Math.floor(g.nowMs / 600_000 / 10)] ??= { started: 0, succeeded: 0, failed: 0 });

function invaderOf(g, h) {
    const t = h.invadingTroops;
    if (t === null || t.count === 0) return null;
    for (const troop of t.items) {
        const e = troop?.empire ?? null;
        if (e === null || troop.type === 5 /* TroopType.PirateRaider */) continue;
        if (e === g.independentEmpire || e.pirateEmpireBaseHabitat !== null || e === h.empire) continue;
        return e;
    }
    return null;
}

// Strikes: every new fleet mission (a new mission object; BuiltObjectRole.Base = 8) of a normal empire's fleet of an attack type against another
// empire's colony / base / ship or fleet, by kind (BuiltObjectMissionType: Blockade 8, Attack 9, WaitAndAttack 16,
// WaitAndBombard 17, Bombard 27, Capture 28, Raid 30).
const STRIKE_TYPES = new Map([[8, 'blockade'], [9, 'attack'], [16, 'attack'], [17, 'bombard'], [27, 'bombard'], [28, 'capture'], [30, 'raid']]);
const seenMissions = new WeakSet();
const strikes = { total: 0, byKind: {}, byTarget: { colony: 0, base: 0, ship: 0, other: 0 } };
const strikeDecades = {};

function sampleStrikes(g) {
    for (const e of g.empires) {
        if (e === null || e === g.independentEmpire || e.pirateEmpireBaseHabitat !== null) continue;
        for (const f of e.shipGroups) {
            const m = f.mission;
            if (m == null || seenMissions.has(m)) continue;
            seenMissions.add(m);
            const kind = STRIKE_TYPES.get(m.type);
            if (kind === undefined) continue;
            const th = m.targetHabitat ?? null;
            const tb = m.targetBuiltObject ?? null;
            const ts = m.targetShipGroup ?? null;
            const owner = th !== null ? th.empire : tb !== null ? tb.empire : ts !== null ? ts.empire : null;
            if (owner === null || owner === e) continue;
            strikes.total++;
            strikes.byKind[kind] = (strikes.byKind[kind] ?? 0) + 1;
            strikes.byTarget[th !== null ? 'colony' : tb !== null ? (tb.role === 8 ? 'base' : 'ship') : ts !== null ? 'ship' : 'other']++;
            const d = Math.floor(g.nowMs / 600_000 / 10);
            strikeDecades[d] = (strikeDecades[d] ?? 0) + 1;
        }
    }
}

function sample(g) {
    sampleStrikes(g);
    for (const h of g.habitats) {
        const e = h.invadingTroops !== null && h.invadingTroops.count > 0 ? invaderOf(g, h) : null;
        const was = active.get(h.habitatIndex);
        if (e !== null && was === undefined) {
            active.set(h.habitatIndex, e.empireId);
            counts.started++;
            dec(g).started++;
            if (counts.firstYear === null) counts.firstYear = +(g.nowMs / 600_000).toFixed(2);
            if (e === g.playerEmpire) counts.byPlayer++;
        } else if (e === null && was !== undefined) {
            active.delete(h.habitatIndex);
            if (h.empire !== null && h.empire.empireId === was) {
                counts.succeeded++;
                dec(g).succeeded++;
            } else {
                counts.failed++;
                dec(g).failed++;
            }
        }
    }
}

// Invasion candidates the AI's target query judged (scenario/orbital/orbitalAI.ts noteCandidate; measurement only).
globalThis.__orbitalDiag = { seen: new Set(), records: [] };

function median(xs) {
    if (xs.length === 0) return null;
    const a = [...xs].sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
}

function candidateSummary() {
    const r = globalThis.__orbitalDiag.records;
    const by = {};
    for (const v of ['go', 'short', 'cooldown']) {
        const x = r.filter((c) => c.verdict === v);
        by[v] = { n: x.length, ships: median(x.map((c) => c.ships)), fleetFp: median(x.map((c) => c.fleetFp)), defShips: median(x.map((c) => c.defShips)), defBases: median(x.map((c) => c.defBases)), gather: median(x.map((c) => c.gather)) };
    }
    const single = r.filter((c) => c.defShips + c.defBases > 0);
    by.singleFleetBelowDefence = single.filter((c) => c.fleetFp < c.defShips + c.defBases).length;
    by.withDefence = single.length;
    return by;
}

export function start(ctx) {
    ctx.report.orbital = {};
}

export function frame(ctx, _dt, g) {
    if (g.nowMs - lastSample < SAMPLE_MS) return;
    lastSample = g.nowMs;
    sample(g);
}

export function chunk(ctx) {
    const g = ctx.g;
    const st = g.scenario?.state?.orbitalSuperiority ?? null;
    ctx.report.orbital = {
        gameYears: +(g.nowMs / 600_000).toFixed(2),
        on: g.scenario?.flags?.orbitalSuperiority === true,
        invasions: { ...counts, inProgress: active.size },
        decades,
        strikes: { ...strikes, decades: strikeDecades },
        galaxyCounters: { invasionAttempts: g.invasionAttempts, invasionSuccesses: g.invasionSuccesses, invasionFailures: g.invasionFailures },
        addon: st === null ? null : { ...st.stats, holdsNow: st.holds.length, invasionsNow: st.invasions.length },
        candidates: candidateSummary(),
    };
}
