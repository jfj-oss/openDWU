// Measurement hook for BVR combat: scripts/soak.mjs --set bvr --hook scripts/bvr-hook.mjs.
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
const BVR_FIRST = 129;
const BVR_LAST = 132;
const isBvrMissile = (c) => c.type === MISSILE && c.componentId >= BVR_FIRST && c.componentId <= BVR_LAST;
let live = new Map();
let lost = 0;
const lostBy = new Map();
let fighting = new Set();
let battles = 0;
let bvr = null;

const STRIKE = new Set([9, 16, 17, 27, 28, 30]);
const seenMissions = new WeakSet();
let strikes = 0;
let lastSample = -Infinity;

export function frame(ctx, _dt, g) {
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
    ctx.report.bvr = {};
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
    // Empires: colonies, wars, designs.
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
    let carrying = 0;
    let launchers = 0;
    let torpedoShips = 0;
    let fill = 0;
    let fillN = 0;
    let dry = 0;
    for (const b of now.keys()) {
        if (b.empire === null || b.empire.pirateEmpireBaseHabitat !== null) continue;
        const l = b.weapons.filter((w) => isBvrMissile(w.component)).length;
        const t = b.weapons.filter((w) => w.component.type === TORPEDO).length;
        if (l > 0) carrying++;
        if (t > 0) torpedoShips++;
        launchers += l;
        if (bvr !== null && (l > 0 || t > 0)) {
            const f = bvr.bvrMagazineFill(g, b);
            fill += f;
            fillN++;
            if (f <= 0.05) dry++;
        }
    }
    const designs = [];
    for (const e of empires) {
        const row = { empire: e.name.slice(0, 14) };
        for (const sub of [1, 2, 3, 4, 5]) {
            const d = e.designs.filter((x) => x.role === MILITARY && x.subRole === sub && !x.isObsolete).sort((a, b) => b.dateCreated - a.dateCreated)[0];
            if (d) row[`s${sub}`] = `L${d.components.filter(isBvrMissile).length}T${d.components.filter((c) => c.type === TORPEDO).length}P${d.components.filter((c) => c.type === PD).length}`;
        }
        designs.push(row);
    }
    const st = g.scenario?.state?.bvrCombat ?? null;
    ctx.report.bvr = {
        year: +(g.nowMs / 600000).toFixed(2),
        warshipsAlive: now.size,
        warshipsLost: lost,
        lostByEmpire: Object.fromEntries(lostBy),
        battles,
        empires: empires.length,
        pairsAtWar: wars,
        topColonyShare: totalCol > 0 ? +(colonies[0].colonies / totalCol).toFixed(3) : 0,
        colonies: colonies.map((c) => `${c.name.slice(0, 12)}:${c.colonies}`),
        aiStrikeMissions: strikes,
        launcherShips: carrying,
        launchers,
        torpedoShips,
        avgMagazineFill: fillN > 0 ? +(fill / fillN).toFixed(2) : null,
        dryShips: dry,
        counters: st === null ? null : {
            missilesFired: st.missilesFired, missileHits: st.missileHits, torpedoesFired: st.torpedoesFired, torpedoHits: st.torpedoHits,
            downedByPd: st.downedByPd, downedByGuns: st.downedByGuns, aiRearmTrips: st.aiRearmTrips, roundsLoaded: st.roundsLoaded, roundsCost: Math.round(st.roundsCost),
            magazinesTracked: st.mags.size,
        },
        designs,
    };
}
