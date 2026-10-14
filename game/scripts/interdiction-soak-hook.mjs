// Measurement hook for Defensive jump interdiction (scenarios/jump-interdiction): scripts/soak.mjs --set interdiction
// --hook scripts/interdiction-soak-hook.mjs. Counted the same way in both runs (ji-war-on-s1: the add-on on;
// ji-war-off-s1: the same galaxy, master switch off = the stock game) by sampling every 2 game seconds:
// pirate raids (a pirate fleet taking a new Raid mission target), pirate ships lost (a pirate warship seen earlier that is
// gone or destroyed), the add-on's own counters (interdicted jumps, escapes, raised raid needs, border base picks), and
// the war AI's aggression (must stay within ~15% of stock): empire ground invasions started / succeeded / failed and the
// year of the first (as scripts/orbital-soak-hook.mjs), strike missions (a normal empire's fleet taking a new Attack /
// Bombard / WaitAndBombard / Capture target owned by another empire) and battles (a system going from no fighting to
// armed ships under attack).
const SAMPLE_MS = 2000;
const RAID = 30; // BuiltObjectMissionType.Raid
let lastSample = -Infinity;
const raidTargetOf = new Map(); // fleet id -> last raid target
const pirateShips = new Map(); // ship -> true while alive
const counts = { raids: 0, pirateShipsLost: 0, pirateShipsSeen: 0 };
const STRIKE = new Set([9, 16, 27, 28]); // Attack, WaitAndBombard, Bombard, Capture
const strikeTargetOf = new Map(); // fleet -> last strike target
const war = { invasionsStarted: 0, invasionsSucceeded: 0, invasionsFailed: 0, firstInvasionYear: null, strikeMissions: 0, battles: 0 };
const activeInvasions = new Map(); // habitat index -> invader empire id
let fightingSystems = new Set();

function invaderOf(g, h) {
    for (const troop of h.invadingTroops.items) {
        const e = troop?.empire ?? null;
        if (e === null || troop.type === 5 /* TroopType.PirateRaider */) continue;
        if (e === g.independentEmpire || e.pirateEmpireBaseHabitat !== null || e === h.empire) continue;
        return e;
    }
    return null;
}

function sampleWar(g) {
    for (const h of g.habitats) {
        const e = h.invadingTroops !== null && h.invadingTroops.count > 0 ? invaderOf(g, h) : null;
        const was = activeInvasions.get(h.habitatIndex);
        if (e !== null && was === undefined) {
            activeInvasions.set(h.habitatIndex, e.empireId);
            war.invasionsStarted++;
            if (war.firstInvasionYear === null) war.firstInvasionYear = +(g.nowMs / 600_000).toFixed(2);
        } else if (e === null && was !== undefined) {
            activeInvasions.delete(h.habitatIndex);
            if (h.empire !== null && h.empire.empireId === was) war.invasionsSucceeded++;
            else war.invasionsFailed++;
        }
    }
    for (const e of g.empires) {
        if (e === g.independentEmpire || e.pirateEmpireBaseHabitat !== null) continue;
        for (const sg of e.shipGroups ?? []) {
            if (sg === null) continue;
            const m = sg.mission;
            let t = null;
            if (m !== null && STRIKE.has(m.type)) {
                t = m.targetHabitat ?? m.targetBuiltObject ?? null;
                if (t !== null && (t.empire === null || t.empire === e)) t = null;
            }
            const was = strikeTargetOf.get(sg) ?? null;
            if (t !== null && t !== was) war.strikeMissions++;
            strikeTargetOf.set(sg, t);
        }
    }
    const now = new Set();
    for (const b of g.builtObjects) {
        if (b === null || b.hasBeenDestroyed || b.role !== 1 || b.attackers === null || b.attackers.length === 0 || b.nearestSystemStar === null) continue;
        now.add(b.nearestSystemStar.systemIndex);
    }
    for (const s of now) if (!fightingSystems.has(s)) war.battles++;
    fightingSystems = now;
}

function sample(g) {
    const alive = new Set();
    for (const p of g.pirateEmpires) {
        for (const sg of p.shipGroups ?? []) {
            if (sg === null) continue;
            const m = sg.mission;
            const t = m !== null && m.type === RAID ? (m.targetHabitat ?? m.targetBuiltObject ?? null) : null;
            const was = raidTargetOf.get(sg) ?? null;
            if (t !== null && t !== was) counts.raids++;
            raidTargetOf.set(sg, t);
        }
        for (const b of p.builtObjects) {
            if (b === null || b.role !== 1 /* BuiltObjectRole.Military */) continue;
            if (b.topSpeed <= 0 || b.hasBeenDestroyed) continue;
            alive.add(b);
            if (!pirateShips.has(b)) {
                pirateShips.set(b, true);
                counts.pirateShipsSeen++;
            }
        }
    }
    for (const b of [...pirateShips.keys()]) {
        if (!alive.has(b)) {
            pirateShips.delete(b);
            if (b.hasBeenDestroyed) counts.pirateShipsLost++;
        }
    }
}

export function start(ctx) {
    ctx.report.interdiction = {};
}

export function frame(ctx, _dt, g) {
    if (g.nowMs - lastSample < SAMPLE_MS) return;
    lastSample = g.nowMs;
    sample(g);
    sampleWar(g);
}

export function chunk(ctx) {
    const g = ctx.g;
    const st = g.scenario?.state?.jumpInterdiction ?? null;
    ctx.report.interdiction = {
        gameYears: +(g.nowMs / 600_000).toFixed(2),
        on: g.scenario?.flags?.jumpInterdiction === true,
        ...counts,
        war: { ...war, invasionsInProgress: activeInvasions.size },
        galaxyCounters: { invasionAttempts: g.invasionAttempts, invasionSuccesses: g.invasionSuccesses, invasionFailures: g.invasionFailures },
        addon: st === null ? null : { ...st.stats, spoolingNow: st.spools.length },
    };
}
