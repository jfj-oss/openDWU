// The Hollow Fleet soak measurement (scripts/soak.mjs --set hollow-fleet --hook scripts/hollow-fleet-hook.mjs). Reads only.
// Writes report.hollowFleet: the schedule, then every ~30 game days the fleet's ships, losses, kills, engagements, phase and
// which empires know how many stops; the last sample is the end state.
let last = -1;
function sample(ctx) {
    const g = ctx.g;
    const st = g.scenario?.state?.hollowFleet;
    const r = (ctx.report.hollowFleet ??= { rows: [] });
    if (!st) return;
    if (!r.stops && st.stops.length > 0) r.stops = st.stops.map((s) => ({ system: g.systems[s.systemIndex].systemStar.name, x: Math.round(s.x), y: Math.round(s.y), linger: s.linger, travel: s.travel })), (r.cycleDays = st.cycleDays), (r.startShips = st.ships.length), (r.startStrength = Math.round(st.startStrength));
    const day = Math.floor(g.nowMs / (600_000 / 360));
    if (last >= 0 && day - last < 30) return;
    last = day;
    const alive = st.ships.filter((b) => !b.hasBeenDestroyed);
    const b0 = alive[0];
    const pos = b0 ? { x: Math.round(b0.xpos), y: Math.round(b0.ypos), warp: b0.warpSpeed, top: b0.topSpeed, cur: Math.round(b0.currentSpeed), mission: b0.mission ? b0.mission.type : null } : null;
    r.rows.push({ day, pos, phase: st.phase, ships: st.ships.filter((b) => !b.hasBeenDestroyed).length, losses: st.losses, kills: st.kills, engagements: st.engagements, ambushes: st.ambushes.length, known: st.known.map((k) => `${k.empireId}:${k.sightings.length}${k.cycleKnown ? 'c' : ''}`).join(' '), bounty: st.bounty, killsBy: st.killsBy });
}
export function start(ctx) { sample(ctx); }
export function chunk(ctx) { sample(ctx); }
