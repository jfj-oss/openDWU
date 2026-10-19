// Measurement hook for Beached ships (scenarios/beaching): scripts/soak.mjs --set beaching --hook scripts/beaching-soak-hook.mjs.
// Samples every 10 game seconds. Reports (report.beaching): ships beached by AI empires and how often (a log of each: year,
// empire, colony, capital or not, ship size, quality lost), the colonies' current and peak quality loss, AI cleanups, and the
// invasion record: every colony invasion (enemy troops landing) classified by whether the colony had a beached ship when the
// landing began, with its outcome (the invader took the colony / the defender held), so beached colonies can be compared with the
// others (and with the same galaxy run with the add-on off). Invasion start / end as in the Veterans hook.
const SAMPLE_MS = 10_000;
const YEAR_MS = 600_000;
let lastSample = -Infinity;
const log = [];
let seenShips = new Set();
const inv = { beached: { started: 0, invaderWon: 0, defenderHeld: 0 }, plain: { started: 0, invaderWon: 0, defenderHeld: 0 } };
const active = new Map(); // habitatIndex → { invader, beached }
let peakLossPct = 0;
let scarSamples = 0;
let scarSum = 0;
const series = [];
let lastYear = -1;
let now = null;

function invaderOf(g, h) {
    for (const troop of h.invadingTroops.items) {
        const e = troop?.empire ?? null;
        if (e === null || troop.type === 5 /* PirateRaider */) continue;
        if (e === g.independentEmpire || e.pirateEmpireBaseHabitat !== null || e === h.empire) continue;
        return e;
    }
    return null;
}

function sample(g) {
    const st = g.scenario?.state?.beaching ?? null;
    const ships = st?.ships ?? [];
    const beachedColonies = new Set();
    for (const b of ships) if (b.beached !== undefined && !b.hasBeenDestroyed) beachedColonies.add(b.beached.colony);
    // new beachings (AI and human)
    const next = new Set();
    for (const b of ships) {
        if (b.beached === undefined) continue;
        next.add(b);
        if (!seenShips.has(b)) {
            const h = b.beached.colony;
            const e = b.empire;
            const human = e !== null && e === g.playerEmpire;
            log.push({ year: +(g.nowMs / YEAR_MS).toFixed(2), empire: e?.name ?? '?', colony: h.name, capital: e !== null && e.capital === h, human, size: b.size, armor: b.armor, lossPct: +((b.beached.lossUnits / Math.max(1e-9, st.colonies.get(h)?.base0 ?? 1)) * 100).toFixed(2), crew: b.beached.crew?.defendStrength ?? 0 });
        }
    }
    seenShips = next;
    // current scars
    let n = 0;
    let sum = 0;
    if (st !== null) {
        for (const [, s] of st.colonies) {
            if (s.lost > 1e-9 && s.base0 > 0) {
                const p = (s.lost / s.base0) * 100;
                n++;
                sum += p;
                if (p > peakLossPct) peakLossPct = p;
            }
        }
    }
    if (n > 0) {
        scarSamples++;
        scarSum += sum / n;
    }
    // invasions
    for (const h of g.habitats) {
        const e = h.invadingTroops !== null && h.invadingTroops.count > 0 ? invaderOf(g, h) : null;
        const was = active.get(h.habitatIndex);
        if (e !== null && was === undefined) {
            const beached = beachedColonies.has(h);
            active.set(h.habitatIndex, { invader: e.empireId, beached });
            (beached ? inv.beached : inv.plain).started++;
        } else if (e === null && was !== undefined) {
            active.delete(h.habitatIndex);
            const bucket = was.beached ? inv.beached : inv.plain;
            if (h.empire !== null && h.empire.empireId === was.invader) bucket.invaderWon++;
            else bucket.defenderHeld++;
        }
    }
    now = {
        year: +(g.nowMs / YEAR_MS).toFixed(2),
        beachedShipsNow: next.size,
        coloniesWithScar: n,
        meanScarPct: n > 0 ? +(sum / n).toFixed(2) : 0,
        stats: st?.stats ?? null,
        invasions: JSON.parse(JSON.stringify(inv)),
    };
    const year = Math.floor(g.nowMs / YEAR_MS);
    if (year !== lastYear) {
        lastYear = year;
        series.push({ year, beachedShipsNow: now.beachedShipsNow, aiBeached: st?.stats.ai ?? 0, meanScarPct: now.meanScarPct });
    }
}

export function start(ctx) {
    ctx.report.beaching = {};
}

export function frame(ctx, _dt, g) {
    if (g.nowMs - lastSample < SAMPLE_MS) return;
    lastSample = g.nowMs;
    sample(g);
}

export function chunk(ctx) {
    const g = ctx.g;
    const ai = log.filter((l) => !l.human);
    ctx.report.beaching = {
        gameYears: +(g.nowMs / YEAR_MS).toFixed(2),
        on: g.scenario?.flags?.beaching === true,
        aiOn: g.scenario?.flags?.beachingAI === true,
        now,
        aiBeachings: ai.length,
        aiBeachingsOnCapital: ai.filter((l) => l.capital).length,
        meanAiLossPct: ai.length > 0 ? +(ai.reduce((a, l) => a + l.lossPct, 0) / ai.length).toFixed(2) : 0,
        meanScarPctOverTime: scarSamples > 0 ? +(scarSum / scarSamples).toFixed(2) : 0,
        peakScarPct: +peakLossPct.toFixed(2),
        invasions: inv,
        galaxyCounters: { invasionAttempts: g.invasionAttempts, invasionSuccesses: g.invasionSuccesses, invasionFailures: g.invasionFailures },
        log,
        series,
    };
}
