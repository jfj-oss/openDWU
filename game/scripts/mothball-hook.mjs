// Mothballing soak measurement (scripts/soak.mjs --set mothballing --hook scripts/mothball-hook.mjs). Reads only (no
// sim calls), the same for the on and off runs:
//   - per game year: the AI empires' fleets and the share in reserve / reactivating / on the way, the package's
//     statistics (upkeep saved, wars on a mothballed navy, AI review outcomes);
//   - war engagement (AI empires only): distinct offensive missions started (Attack 9, WaitAndAttack 16, Bombard 27,
//     Capture 28, Raid 30, Blockade 8) and invasions started (UnloadTroops 22) by their ships, colonies taken from
//     another empire (invasions succeeded) and the year of the first, warship-in-battle samples, warships lost;
//   - new wars (empire pairs newly at War, DiplomaticRelationType 7) and, for AI empires at war, the share of their
//     warship strength in a mothball phase (sampled every chunk).
// Writes report.mothball.
const YEAR_MS = 600_000;
const WAR = 7;
const OFFENSIVE = new Set([8, 9, 16, 27, 28, 30]);
const UNLOAD = 22;
const MILITARY = 1; // BuiltObjectRole.Military

let seenMissions = new WeakSet();
let owners = new Map();
let warships = new Map();
let lastWars = null;
let lastYear = -1;

function ai(ctx, e) {
    return e !== null && e.active && e !== ctx.g.playerEmpire && e.pirateEmpireBaseHabitat === null;
}

function strength(b) {
    return b.firepowerRaw > 0 ? b.firepowerRaw : 0;
}

function sampleChunk(ctx, m) {
    const g = ctx.g;
    // wars
    const now = new Set();
    const atWar = new Set();
    for (const e of g.empires) {
        if (e === null || !e.active) continue;
        for (const r of e.diplomaticRelations.toArray()) {
            if (r.type !== WAR || !r.otherEmpire) continue;
            now.add(Math.min(e.empireId, r.otherEmpire.empireId) + ':' + Math.max(e.empireId, r.otherEmpire.empireId));
            if (r.otherEmpire.pirateEmpireBaseHabitat === null) atWar.add(e);
        }
    }
    if (lastWars !== null) for (const k of now) if (!lastWars.has(k)) m.newWars++;
    lastWars = now;
    // missions, battles, losses, mothballed share at war
    const alive = new Map();
    for (const e of g.empires) {
        if (!ai(ctx, e)) continue;
        let tot = 0, mb = 0;
        for (const b of e.builtObjects) {
            if (b === null || b.hasBeenDestroyed || b.role !== MILITARY) continue;
            alive.set(b, e);
            const s = strength(b);
            tot += s;
            if (b.mothball !== undefined) mb += s;
            if (b.inBattle) m.battleSamples++;
            const mi = b.mission;
            if (mi && !seenMissions.has(mi)) {
                seenMissions.add(mi);
                if (OFFENSIVE.has(mi.type)) m.offensiveMissions++;
                else if (mi.type === UNLOAD) m.invasionsStarted++;
            }
        }
        for (const sg of e.shipGroups) {
            const mi = sg?.mission;
            if (mi && !seenMissions.has(mi)) {
                seenMissions.add(mi);
                if (OFFENSIVE.has(mi.type)) m.offensiveMissions++;
                else if (mi.type === UNLOAD) m.invasionsStarted++;
            }
        }
        if (atWar.has(e) && tot > 0) {
            m.warShareSum += mb / tot;
            m.warShareSamples++;
            if (mb / tot > m.warShareMax) m.warShareMax = +(mb / tot).toFixed(3);
        }
    }
    for (const [b] of warships) if (!alive.has(b) && b.hasBeenDestroyed) m.warshipsLost++;
    warships = alive;
    // colonies taken from another empire
    for (const e of g.empires) {
        if (e === null || !e.active || e.pirateEmpireBaseHabitat !== null) continue;
        for (const h of e.colonies ?? []) {
            const prev = owners.get(h);
            if (prev !== undefined && prev !== e && prev.pirateEmpireBaseHabitat === null && prev !== g.independentEmpire) {
                m.coloniesTaken++;
                if (m.firstInvasionYear === null) m.firstInvasionYear = +(g.nowMs / YEAR_MS).toFixed(2);
            }
            owners.set(h, e);
        }
    }
}

function sampleYear(ctx, rows) {
    const g = ctx.g;
    let fleets = 0, reserve = 0, reactivating = 0, travel = 0;
    for (const e of g.empires) {
        if (!ai(ctx, e)) continue;
        for (const sg of e.shipGroups) {
            if (sg === null || sg.ships.length === 0) continue;
            fleets++;
            const phases = sg.ships.map((b) => (b.mothball === undefined ? -1 : b.mothball.phase));
            if (phases.includes(0)) travel++;
            else if (phases.includes(2)) reactivating++;
            else if (phases.includes(1)) reserve++;
        }
    }
    const st = g.scenario?.state?.mothballing ?? null;
    const m = ctx.report.mothball;
    rows.push({
        year: +(g.nowMs / YEAR_MS).toFixed(2), aiFleets: fleets, reserve, reactivating, travel,
        share: fleets > 0 ? +((reserve + reactivating + travel) / fleets).toFixed(3) : 0,
        offensive: m.offensiveMissions, invasions: m.invasionsStarted, taken: m.coloniesTaken, battle: m.battleSamples, lost: m.warshipsLost, wars: m.newWars,
        stats: st ? { ...st.stats, reviews: { ...st.stats.reviews }, upkeepSaved: Math.round(st.stats.upkeepSaved) } : null,
    });
}

export function start(ctx) {
    ctx.report.mothball = { years: [], newWars: 0, offensiveMissions: 0, invasionsStarted: 0, coloniesTaken: 0, firstInvasionYear: null, battleSamples: 0, warshipsLost: 0, warShareSum: 0, warShareSamples: 0, warShareMax: 0 };
    sampleChunk(ctx, ctx.report.mothball);
}

export function chunk(ctx) {
    const m = ctx.report.mothball;
    sampleChunk(ctx, m);
    m.warShareMean = m.warShareSamples > 0 ? +(m.warShareSum / m.warShareSamples).toFixed(4) : 0;
    const y = Math.floor(ctx.g.nowMs / YEAR_MS);
    if (y !== lastYear) {
        lastYear = y;
        sampleYear(ctx, m.years);
    }
}
