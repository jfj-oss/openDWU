// Measurement hook for Generation Ships: scripts/soak.mjs --set gen-ships --hook scripts/genships-soak-hook.mjs.
// Samples the ships' scenario states every 2 game seconds and writes report.genShips: per ship (flavour, target empire,
// phase, outcome, escorts at their peak / alive, gas stations hit, pirate faction formed) plus wave totals and the
// battles (military ships of the faction / its pirates and of the targets destroyed).
const SAMPLE_MS = 2000;
let lastSample = -Infinity;
const ships = new Map();

export function start(ctx) {
    ctx.report.genShips = {};
}

export function frame(ctx, _dt, g) {
    if (g.nowMs - lastSample < SAMPLE_MS) return;
    lastSample = g.nowMs;
    const state = g.scenario?.state ?? {};
    for (const key of Object.keys(state).filter((k) => k === 'generationShips' || k.startsWith('generationShips#')).sort()) {
        const st = state[key];
        if (st === null || typeof st !== 'object' || st.phase === 'waiting') continue;
        const row = ships.get(key) ?? { key, arrivedYear: +(g.nowMs / 600_000).toFixed(2), peakEscorts: 0 };
        row.flavour = st.flavour;
        row.target = st.owner?.name ?? null;
        row.phase = st.phase;
        row.outcome = st.outcome;
        row.worldShipFate = st.worldShipFate;
        row.answer = st.answer;
        row.escortsAlive = st.escorts.length;
        row.peakEscorts = Math.max(row.peakEscorts, st.escorts.length);
        // Patrol check: escort + transport mission types now, the share within 3 world-ship patrol radii, ships out of fuel.
        const ws = st.worldShip;
        const mt = {};
        let near = 0;
        let dry = 0;
        for (const b of [...st.escorts, ...st.transports]) {
            const t = b.mission?.type ?? 'none';
            mt[t] = (mt[t] ?? 0) + 1;
            if (ws && Math.hypot(b.xpos - ws.xpos, b.ypos - ws.ypos) < 6000) near++;
            if (b.fuelCapacity > 0 && b.currentFuel < 0.02 * b.fuelCapacity) dry++;
        }
        const yr = +(g.nowMs / 600_000).toFixed(2);
        if (row.lastTl === undefined || yr - row.lastTl >= 0.05) (row.timeline ??= []).push([+(g.nowMs / 600_000).toFixed(2), st.phase, ws ? 1 : 0, st.escorts.length, st.transports.length, near, dry, JSON.stringify(mt)]);
        if (row.lastTl === undefined || yr - row.lastTl >= 0.05) row.lastTl = yr;
        row.missions = mt;
        row.nearWorldShip = near;
        row.dry = (row.dry ?? 0) + (dry > 0 ? 1 : 0);
        row.wsFuel = ws ? +(ws.currentFuel / Math.max(1, ws.fuelCapacity)).toFixed(2) : null;
        row.fleetStrength = Math.round(st.fleetStrength);
        row.stationsHit = st.stationsHit ?? 0;
        row.strikeDone = st.strikeDone ?? false;
        row.pirate = st.pirate?.name ?? null;
        row.pirateShips = (st.pirateShips ?? []).filter((b) => !b.hasBeenDestroyed).length;
        ships.set(key, row);
    }
    const rows = [...ships.values()];
    ctx.report.genShips = {
        planned: state.generationShips?.planned ?? 0,
        arrived: rows.length,
        ships: rows,
        stationsHit: rows.reduce((n, r) => n + r.stationsHit, 0),
        piratesFormed: rows.filter((r) => r.pirate !== null).length,
        outcomes: rows.reduce((o, r) => ((o[r.outcome ?? r.phase] = (o[r.outcome ?? r.phase] ?? 0) + 1), o), {}),
        escortsLost: rows.reduce((n, r) => n + (r.peakEscorts - r.escortsAlive), 0),
    };
}
