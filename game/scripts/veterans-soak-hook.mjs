// Measurement hook for Veterans (scenarios/veterans): scripts/soak.mjs --set veterans --hook scripts/veterans-soak-hook.mjs.
// Samples every 10 game seconds: live warships (role Military) and troop units by rank (record rank; none = Green),
// warships lost (a known warship destroyed or gone; also how many of them were ranked), and the stock invasion
// counters. AI aggression (on vs off must stay close): empire invasions started / succeeded (as the orbital hook counts
// them) and the year of the first, strike missions (distinct Attack / Bombard missions of AI fleets and lone warships)
// and battles (warships entering combat: inBattle false → true). Writes report.veterans after every chunk, with a
// per-year series.
const SAMPLE_MS = 10_000;
const MILITARY = 1; // BuiltObjectRole.Military
let lastSample = -Infinity;
/** live warship → rank at the last sample */
let known = new Map();
const lost = { ships: 0, rankedShips: 0, byRank: [0, 0, 0, 0], flagships: 0 };
let knownFlags = new Set();
const series = [];
const STRIKE = new Set([9, 16, 17, 27]); // BuiltObjectMissionType Attack, WaitAndAttack, WaitAndBombard, Bombard
const strikes = new WeakSet();
const agg = { strikeMissions: 0, battles: 0, invasionsStarted: 0, invasionsSucceeded: 0, invasionsFailed: 0, firstInvasionYear: null };
const inBattle = new WeakSet();
const activeInv = new Map();

function invaderOf(g, h) {
    for (const troop of h.invadingTroops.items) {
        const e = troop?.empire ?? null;
        if (e === null || troop.type === 5 /* PirateRaider */) continue;
        if (e === g.independentEmpire || e.pirateEmpireBaseHabitat !== null || e === h.empire) continue;
        return e;
    }
    return null;
}

function sampleAggression(g) {
    const year = g.nowMs / 600_000;
    for (const h of g.habitats) {
        const e = h.invadingTroops !== null && h.invadingTroops.count > 0 ? invaderOf(g, h) : null;
        const was = activeInv.get(h.habitatIndex);
        if (e !== null && was === undefined) {
            activeInv.set(h.habitatIndex, e.empireId);
            agg.invasionsStarted++;
            if (agg.firstInvasionYear === null) agg.firstInvasionYear = +year.toFixed(2);
        } else if (e === null && was !== undefined) {
            activeInv.delete(h.habitatIndex);
            if (h.empire !== null && h.empire.empireId === was) agg.invasionsSucceeded++;
            else agg.invasionsFailed++;
        }
    }
    const note = (m, human) => {
        if (m === null || m === undefined || human || !STRIKE.has(m.type) || strikes.has(m)) return;
        strikes.add(m);
        agg.strikeMissions++;
    };
    for (const e of g.empires) {
        if (e === g.playerEmpire || e.pirateEmpireBaseHabitat !== null) continue;
        for (const sg of e.shipGroups ?? []) note(sg.mission, false);
    }
    for (const b of g.builtObjects) {
        if (b === null || b.hasBeenDestroyed || b.role !== MILITARY) continue;
        if (b.shipGroup === null && b.empire !== null && b.empire !== g.playerEmpire && b.empire.pirateEmpireBaseHabitat === null) note(b.mission, false);
        if (b.inBattle) {
            if (!inBattle.has(b)) {
                inBattle.add(b);
                agg.battles++;
            }
        } else inBattle.delete(b);
    }
}
let lastYear = -1;
let now = null;

function sample(g) {
    const ships = [0, 0, 0, 0];
    let battles = 0;
    const next = new Map();
    const recs = g.scenario?.state?.veterans?.ships ?? null; // Map<BuiltObject, record>
    for (const b of g.builtObjects) {
        if (b === null || b.hasBeenDestroyed || b.role !== MILITARY) continue;
        const rec = recs?.get(b);
        const r = rec?.rank ?? 0;
        ships[r]++;
        battles += rec?.battles ?? 0;
        next.set(b, r);
    }
    for (const [b, r] of known) {
        if (next.has(b)) continue;
        if (b.hasBeenDestroyed || !g.builtObjects.includes(b)) {
            lost.ships++;
            lost.byRank[r]++;
            if (r > 0) lost.rankedShips++;
        }
    }
    known = next;
    // Named ships (a generic name replaced) and flagships: fleets with one, fleets disorganised, flagships lost.
    let named = 0;
    if (recs !== null) for (const rec of recs.values()) if (rec.wasNamed !== undefined) named++;
    const flags = g.scenario?.state?.veterans?.flagships ?? null; // Map<ShipGroup, record>
    let fleets = 0;
    let reforming = 0;
    const nextFlags = new Set();
    if (flags !== null) {
        for (const f of flags.values()) {
            fleets++;
            if (f.penaltyUntil > 0) reforming++;
            if (f.ship !== null) nextFlags.add(f.ship);
        }
    }
    for (const b of knownFlags) if (!nextFlags.has(b) && b.hasBeenDestroyed) lost.flagships++;
    knownFlags = nextFlags;
    const troops = [0, 0, 0, 0];
    for (const e of g.empires) for (const t of e.troops?.items ?? []) if (t != null) troops[t.veteran?.rank ?? 0]++;
    const share = (a) => {
        const n = a[0] + a[1] + a[2] + a[3];
        return n === 0 ? 0 : +((a[2] + a[3]) / n).toFixed(4);
    };
    sampleAggression(g);
    now = { ...agg, ships, troops, shipBattlesCounted: battles, namedShips: named, flagshipFleets: fleets, fleetsReforming: reforming, veteranEliteShipShare: share(ships), veteranEliteTroopShare: share(troops) };
    const year = Math.floor(g.nowMs / 600_000);
    if (year !== lastYear) {
        lastYear = year;
        series.push({ year, ...now });
    }
}

export function start(ctx) {
    ctx.report.veterans = {};
}

export function frame(ctx, _dt, g) {
    if (g.nowMs - lastSample < SAMPLE_MS) return;
    lastSample = g.nowMs;
    sample(g);
}

export function chunk(ctx) {
    const g = ctx.g;
    ctx.report.veterans = {
        gameYears: +(g.nowMs / 600_000).toFixed(2),
        on: g.scenario?.flags?.veterans === true,
        now,
        lost,
        aggression: agg,
        galaxyCounters: { invasionAttempts: g.invasionAttempts, invasionSuccesses: g.invasionSuccesses, invasionFailures: g.invasionFailures },
        series,
    };
}
