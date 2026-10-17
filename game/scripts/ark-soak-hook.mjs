// Measurement hook for the Ark Engine (Giantworks): scripts/soak.mjs --set ark --hook scripts/ark-soak-hook.mjs.
// Samples galaxy.scenario.state.giantworksArk every ~2 game seconds (the sim's own record is read only) and writes report.ark:
// the Ark's phases (a timeline), visits (colony, empire, people taken), people aboard and grown, transports launched / landed /
// lost, fights, escapes, the shield level and the longest sample gap.
const SAMPLE_MS = 2000;
let lastSample = -Infinity;
const timeline = [];
let lastKey = '';
let peakAboard = 0;

export function start(ctx) {
    ctx.report.ark = {};
}

export function frame(ctx, _dt, g) {
    if (g.nowMs - lastSample < SAMPLE_MS) return;
    lastSample = g.nowMs;
    const st = g.scenario?.state?.giantworksArk;
    if (!st || !st.arks) return;
    const yr = +(g.nowMs / 600_000).toFixed(2);
    const arks = st.arks.map((rec) => {
        const ship = rec.ship;
        let aboard = 0;
        for (const k of Object.keys(rec.aboard)) aboard += rec.aboard[k];
        peakAboard = Math.max(peakAboard, aboard);
        const key = `${rec.workId}:${rec.phase}${rec.fight ? '+fight' : ''}${rec.breached ? '+breached' : ''}:${rec.target?.colony?.name ?? '-'}`;
        if (key !== lastKey) {
            lastKey = key;
            timeline.push([yr, key, Math.round(aboard / 1e6), rec.visits.length]);
        }
        return {
            workId: rec.workId,
            phase: rec.phase,
            aboardM: Math.round(aboard / 1e6),
            peakAboardM: Math.round(peakAboard / 1e6),
            stats: { ...rec.stats, takenM: Math.round(rec.stats.taken / 1e6), grownM: Math.round(rec.stats.grown / 1e6) },
            fights: rec.fights,
            escapes: rec.escapes,
            died: rec.died,
            shieldsPct: ship && ship.shieldsCapacity > 0 ? Math.round((100 * ship.currentShields) / ship.shieldsCapacity) : null,
            inFlight: rec.transports.length,
            visits: rec.visits.map((v) => ({ empire: v.empire, colony: v.colony, startYear: +(v.start / 600_000).toFixed(2), endYear: +(v.end / 600_000).toFixed(2), takenM: Math.round(v.taken / 1e6), why: v.why })),
            target: rec.target ? { colony: rec.target.colony.name, empire: rec.target.empire.name, decision: rec.target.decision, plan: rec.target.plan } : null,
        };
    });
    const log = (g.scenario?.state?.giantworks?.log ?? []).filter((l) => /\bark\b|strike at the Ark/i.test(l.text)).slice(-150).map((l) => `y${(l.date / 600_000).toFixed(2)} ${l.text}`);
    ctx.report.ark = { origins: st.origins.length, tracked: st.tracked, arks, timeline: timeline.slice(-200), log };
}
