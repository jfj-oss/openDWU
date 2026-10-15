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
const counts = { started: 0, succeeded: 0, failed: 0, byPlayer: 0 };

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

function sample(g) {
    for (const h of g.habitats) {
        const e = h.invadingTroops !== null && h.invadingTroops.count > 0 ? invaderOf(g, h) : null;
        const was = active.get(h.habitatIndex);
        if (e !== null && was === undefined) {
            active.set(h.habitatIndex, e.empireId);
            counts.started++;
            if (e === g.playerEmpire) counts.byPlayer++;
        } else if (e === null && was !== undefined) {
            active.delete(h.habitatIndex);
            if (h.empire !== null && h.empire.empireId === was) counts.succeeded++;
            else counts.failed++;
        }
    }
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
        galaxyCounters: { invasionAttempts: g.invasionAttempts, invasionSuccesses: g.invasionSuccesses, invasionFailures: g.invasionFailures },
        addon: st === null ? null : { ...st.stats, holdsNow: st.holds.length, invasionsNow: st.invasions.length },
    };
}
