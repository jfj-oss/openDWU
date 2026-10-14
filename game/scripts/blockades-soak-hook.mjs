// Measurement hook for Blockades that bite (scenarios/blockades-bite): scripts/soak.mjs --set blockades --hook
// scripts/blockades-soak-hook.mjs. bb-war-on-s1: the add-on on (its own stats: blockades started / ended, broken by
// relief, tax and port trade income lost, AI blockade duties and relief fleets); bb-war-off-s1: the same galaxy with the
// master switch off (the stock game). Both: the stock declared blockades seen (sampled every 2 game seconds), empire
// colony tax revenue and population totals, empire ground invasions (started / succeeded / failed, year of the first),
// fleet strike missions, military ships destroyed (battles) and the galaxy's invasion counters. Writes report.blockades after every chunk.
const SAMPLE_MS = 2000;
let lastSample = -Infinity;
const stock = { declaredSeen: 0, maxDeclaredAtOnce: 0 };
const seen = new Set();
// Empire ground invasions (as scripts/orbital-soak-hook.mjs): habitat index → invader empire id.
const active = new Map();
const inv = { started: 0, succeeded: 0, failed: 0, firstYear: null };
// Fleet strike missions: each new Attack (9) / WaitAndAttack (16) / Bombard (27) / WaitAndBombard (17) mission object of an
// empire fleet; blockade missions (8) apart.
const STRIKE = new Set([9, 16, 17, 27]);
const missionsSeen = new WeakSet();
const missions = { strikes: 0, blockades: 0 };

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

export function start(ctx) {
    ctx.report.blockades = {};
}

export function frame(ctx, _dt, g) {
    if (g.nowMs - lastSample < SAMPLE_MS) return;
    lastSample = g.nowMs;
    let n = 0;
    for (const b of g.blockades) {
        if (!b.targetIsColony || b.colony === null) continue;
        n++;
        const key = `${b.colony.habitatIndex}:${b.dateInitiated}`;
        if (!seen.has(key)) {
            seen.add(key);
            stock.declaredSeen++;
        }
    }
    stock.maxDeclaredAtOnce = Math.max(stock.maxDeclaredAtOnce, n);
    for (const h of g.habitats) {
        const e = h.invadingTroops !== null && h.invadingTroops.count > 0 ? invaderOf(g, h) : null;
        const was = active.get(h.habitatIndex);
        if (e !== null && was === undefined) {
            active.set(h.habitatIndex, e.empireId);
            inv.started++;
            if (inv.firstYear === null) inv.firstYear = +(g.nowMs / 600_000).toFixed(2);
        } else if (e === null && was !== undefined) {
            active.delete(h.habitatIndex);
            if (h.empire !== null && h.empire.empireId === was) inv.succeeded++;
            else inv.failed++;
        }
    }
    for (const e of g.empires) {
        if (e === null || e.pirateEmpireBaseHabitat !== null || e === g.independentEmpire) continue;
        for (const f of e.shipGroups) {
            const m = f.mission;
            if (m == null || missionsSeen.has(m)) continue;
            if (STRIKE.has(m.type)) {
                missionsSeen.add(m);
                missions.strikes++;
            } else if (m.type === 8) {
                missionsSeen.add(m);
                missions.blockades++;
            }
        }
    }
}

export function chunk(ctx) {
    const g = ctx.g;
    const st = g.scenario?.state?.blockadesBite ?? null;
    let tax = 0;
    let pop = 0;
    let colonies = 0;
    let kills = 0;
    for (const e of g.empires) {
        if (e === null || e.pirateEmpireBaseHabitat !== null || e === g.independentEmpire) continue;
        kills += e.counters?.destroyedEnemyMilitaryShipCount ?? 0;
        for (const h of e.colonies) {
            colonies++;
            tax += h.annualTaxRevenue;
            pop += h.population.totalAmount;
        }
    }
    ctx.report.blockades = {
        gameYears: +(g.nowMs / 600_000).toFixed(2),
        on: g.scenario?.flags?.blockadesBite === true,
        stockDeclared: { ...stock },
        colonies,
        annualTaxRevenue: Math.round(tax),
        populationM: Math.round(pop / 1e6),
        invasions: { ...inv, inProgress: active.size },
        fleetMissions: { ...missions },
        militaryShipsDestroyed: kills,
        galaxyCounters: { invasionAttempts: g.invasionAttempts, invasionSuccesses: g.invasionSuccesses, invasionFailures: g.invasionFailures },
        addon: st === null ? null : { ...st.stats, taxLost: Math.round(st.stats.taxLost), portTradeLost: Math.round(st.stats.portTradeLost), activeNow: st.active.length, dutiesNow: st.duties.length },
    };
}
