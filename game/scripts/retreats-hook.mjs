// Measurement hook for the Fighting retreats add-on: scripts/soak.mjs --set retreats --hook scripts/retreats-hook.mjs.
// Per chunk: the live warships (role Military; bases excluded) of every empire and pirate faction; a warship that is
// gone with HasBeenDestroyed counts as lost; a battle = a system (or deep-space sector) where a warship is under attack,
// counted once per episode (it must be quiet for a chunk before it counts again). With the add-on: the ships seen in a
// withdrawing fleet (frWithdrawal) and whether they are still alive at the end, plus the add-on's own counters.
// Writes report.retreats every chunk (the last one is the end state). Reads only: no Rnd, no state changes.
const MILITARY = 1; // BuiltObjectRole.Military
let live = new Map();
let lost = 0;
let lostWithdrawn = 0;
const withdrawn = new Set();
let fighting = new Set();
let battles = 0;

// War AI activity, sampled every 2 game seconds the same way in both runs: AI empire fleet strike missions (each new
// Attack / WaitAndAttack / WaitAndBombard / Bombard / Capture / Raid fleet mission object counts once) and ground
// invasions (as scripts/orbital-soak-hook.mjs: a normal empire's troops on another's colony; succeeded = it changed hands).
const STRIKE = new Set([9, 16, 17, 27, 28, 30]);
const seenMissions = new WeakSet();
let strikes = 0;
const invading = new Map();
const inv = { started: 0, succeeded: 0, failed: 0, firstYear: null };
let lastSample = -Infinity;

function invaderOf(g, h) {
    for (const troop of h.invadingTroops.items) {
        const e = troop?.empire ?? null;
        if (e === null || troop.type === 5 || e === g.independentEmpire || e.pirateEmpireBaseHabitat !== null || e === h.empire) continue;
        return e;
    }
    return null;
}

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
    for (const h of g.habitats) {
        const e = h.invadingTroops !== null && h.invadingTroops.count > 0 ? invaderOf(g, h) : null;
        const was = invading.get(h.habitatIndex);
        if (e !== null && was === undefined) {
            invading.set(h.habitatIndex, e.empireId);
            inv.started++;
            if (inv.firstYear === null) inv.firstYear = +(g.nowMs / 600000).toFixed(2);
        } else if (e === null && was !== undefined) {
            invading.delete(h.habitatIndex);
            if (h.empire !== null && h.empire.empireId === was) inv.succeeded++;
            else inv.failed++;
        }
    }
}

export function start(ctx) {
    ctx.report.retreats = {};
}

function warships(g) {
    const out = [];
    for (const e of [...g.empires, ...g.pirateEmpires]) {
        if (e == null) continue;
        for (const b of e.builtObjects) if (b != null && b.role === MILITARY && b.topSpeed > 0) out.push(b);
    }
    return out;
}

export function chunk(ctx) {
    const g = ctx.g;
    const now = new Map();
    const fightNow = new Set();
    for (const b of warships(g)) {
        now.set(b, true);
        if (b.shipGroup?.frWithdrawal !== undefined) withdrawn.add(b);
        if ((b.attackers ?? []).length > 0) {
            const s = b.nearestSystemStar;
            fightNow.add(s !== null ? s : `${Math.trunc(b.xpos / 100000)},${Math.trunc(b.ypos / 100000)}`);
        }
    }
    for (const b of live.keys()) {
        if (!now.has(b) && b.hasBeenDestroyed) {
            lost++;
            if (withdrawn.has(b)) lostWithdrawn++;
        }
    }
    for (const k of fightNow) if (!fighting.has(k)) battles++;
    fighting = fightNow;
    live = now;
    let survived = 0;
    for (const b of withdrawn) if (!b.hasBeenDestroyed) survived++;
    const st = g.scenario?.state?.fightingRetreats ?? null;
    ctx.report.retreats = {
        year: +(g.nowMs / 600000).toFixed(2), warshipsAlive: now.size, warshipsLost: lost, battles,
        shipsWithdrawn: withdrawn.size, withdrawnSurvived: survived, withdrawnLaterLost: lostWithdrawn,
        aiStrikeMissions: strikes, invasions: { ...inv, inProgress: invading.size },
        counters: st === null ? null : { fleetWithdrawals: st.fleetWithdrawals, fleetsResumed: st.fleetsResumed },
    };
}
