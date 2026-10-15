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
