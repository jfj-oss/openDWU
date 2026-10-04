// Timing hook for scripts/soak.mjs (`--hook scripts/soak-timing-hook.mjs`): per game year, the sim frame-time
// distribution (p50 / p99 / max wall ms), CPU ms (without the soak's scans / save checks: report.overhead), and wall
// ms per frame-driver pass (scheduler.ts setTickProfile:
// galaxy, empires, pirateEmpires, habitats, builtObjects, fleets, creatures, galaxyTimeSensitive+warnings); per slow
// frame, the pass that took the time and which empire ran. Results go to report.timing (<out>/<config>.json).
//
//   SOAK_SLOW_MS=250     frames at least this long are listed (default 250, at most 200 kept)
//   SOAK_CPUPROF=1       sample a V8 CPU profile per chunk (node:inspector) and keep, for each slow frame, the top
//                        self / inclusive functions of the samples inside that frame
//   SOAK_CPUPROF_US=500  sampling interval (µs)
//   SOAK_SAVE_YEARS=7,9  write a save (serializeGame text) after those game years to <out>/<config>-y<N>.save, for
//                        scripts/profile-save.mjs; SOAK_STOP_YEAR=N ends the run after year N
//
//   nice -n 15 node --expose-gc scripts/soak.mjs --run prewarp-shadows --hook scripts/soak-timing-hook.mjs
import { Session } from 'node:inspector';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SLOW_MS = Number(process.env.SOAK_SLOW_MS ?? 250);
const CPUPROF = process.env.SOAK_CPUPROF === '1';
const CPUPROF_US = Number(process.env.SOAK_CPUPROF_US ?? 500);
const YEAR_MS = 600_000;
const SAVE_YEARS = new Set(String(process.env.SOAK_SAVE_YEARS ?? '').split(',').filter((x) => x !== '').map(Number));
const STOP_YEAR = Number(process.env.SOAK_STOP_YEAR ?? 0);

let sched = null;
let prof = {};
let prevProf = {};
let startMs = 0;
let year = null;
let session = null;
/** Slow frames of the current chunk awaiting their profile samples: { rec, endUs, ms }. */
let pendingWindows = [];
const savedYears = new Set();

function newYear(idx) {
    return { year: idx + 1, frames: 0, times: [], passMs: {}, cpu0: process.cpuUsage(), wall0: performance.now(), ov0: overheadNow() };
}

/** soak.mjs report.overhead: CPU / wall ms of its scans, save checks and hook calls (left out of the year figures). */
let reportRef = null;
function overheadNow() {
    return { ...(reportRef?.overhead ?? { wallMs: 0, cpuMs: 0 }) };
}

function pct(sorted, p) {
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function closeYear(ctx) {
    const y = year;
    const t = Float64Array.from(y.times).sort();
    const cpu = process.cpuUsage(y.cpu0);
    const ov = overheadNow();
    const ovCpu = ov.cpuMs - y.ov0.cpuMs;
    const ovWall = ov.wallMs - y.ov0.wallMs;
    const counts = ctx.g ? { builtObjects: ctx.g.builtObjects.length, habitats: ctx.g.habitats.length, creatures: ctx.g.creatures.length, colonies: ctx.g.empires.reduce((n, e) => n + e.colonies.length, 0) } : {};
    const sum = y.times.reduce((a, b) => a + b, 0);
    const out = { year: y.year, frames: y.frames, simMs: Math.round(sum), cpuMs: Math.round((cpu.user + cpu.system) / 1000 - ovCpu), wallMs: Math.round(performance.now() - y.wall0 - ovWall), overheadMs: Math.round(ovWall),
        p50: +pct(t, 0.5).toFixed(2), p99: +pct(t, 0.99).toFixed(1), p999: +pct(t, 0.999).toFixed(1), max: +(t[t.length - 1] ?? 0).toFixed(0),
        passMs: Object.fromEntries(Object.entries(y.passMs).map(([k, v]) => [k, Math.round(v)])), counts };
    const tm = ctx.report.timing;
    tm.years.push(out);
    console.log(`= timing y${out.year}: sim ${(out.simMs / 1000).toFixed(1)}s cpu ${(out.cpuMs / 1000).toFixed(1)}s p50 ${out.p50} p99 ${out.p99} max ${out.max} ms | ${Object.entries(out.passMs).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join(', ')} | bo ${counts.builtObjects}`);
}

function post(method, params) {
    return new Promise((res, rej) => session.post(method, params ?? {}, (err, r) => (err ? rej(err) : res(r))));
}

export async function start(ctx) {
    sched = await ctx.load('src/sim/tick/scheduler');
    startMs = ctx.g.nowMs;
    ctx.report.timing = { slowMs: SLOW_MS, years: [], slow: [] };
    reportRef = ctx.report;
    year = newYear(0);
    prof = {};
    prevProf = {};
    sched.setTickProfile(prof, () => performance.now());
    if (CPUPROF) {
        session = new Session();
        session.connect();
        await post('Profiler.enable');
        await post('Profiler.setSamplingInterval', { interval: CPUPROF_US });
        await post('Profiler.start');
    }
    const done = ctx.report.timing.years.length;
    if (SAVE_YEARS.has(done) && !savedYears.has(done)) {
        savedYears.add(done);
        const { serializeGame } = await ctx.load('save');
        const { GalaxyTime } = await ctx.load('time');
        const outArg = process.argv.indexOf('--out');
        const file = resolve(outArg >= 0 ? process.argv[outArg + 1] : '.', `${ctx.report.name}-y${done}.save`);
        writeFileSync(file, serializeGame(ctx.game, new GalaxyTime(), ctx.so));
        console.log(`= timing: saved ${file}`);
    }
    if (STOP_YEAR > 0 && done >= STOP_YEAR) return 'stop';
}

export function frame(ctx, dt, g) {
    // Pass deltas of this frame.
    const d = {};
    for (const k in prof) {
        const v = prof[k] - (prevProf[k] ?? 0);
        if (v !== 0) d[k] = v;
        prevProf[k] = prof[k];
        year.passMs[k] = (year.passMs[k] ?? 0) + v;
    }
    year.frames++;
    year.times.push(dt);
    if (dt >= SLOW_MS) {
        const st = g.scheduler;
        const lastEmpire = g.empires[(st.empireCursor - 1 + g.empires.length) % Math.max(1, g.empires.length)];
        const lastPirate = g.pirateEmpires.length > 0 ? g.pirateEmpires[(st.pirateCursor - 1 + g.pirateEmpires.length) % g.pirateEmpires.length] : null;
        const rec = { day: +((g.nowMs - startMs) / (YEAR_MS / 360)).toFixed(2), ms: Math.round(dt),
            pass: Object.fromEntries(Object.entries(d).filter(([, v]) => v >= 5).map(([k, v]) => [k, Math.round(v)])),
            galaxyFrame: st.galaxyFrameCounter === 1, empire: d.empires >= 5 ? lastEmpire?.name : undefined, pirate: d.pirateEmpires >= 5 ? lastPirate?.name : undefined,
            bo: g.builtObjects.length };
        const tm = ctx.report.timing;
        if (tm.slow.length < 200) tm.slow.push(rec);
        else {
            // Keep the 200 slowest.
            let mi = 0;
            for (let i = 1; i < tm.slow.length; i++) if (tm.slow[i].ms < tm.slow[mi].ms) mi = i;
            if (tm.slow[mi].ms < rec.ms) tm.slow[mi] = rec;
        }
        if (CPUPROF) pendingWindows.push({ rec, endUs: Number(process.hrtime.bigint() / 1000n), ms: dt });
    }
    if (g.nowMs - startMs >= (year.year) * YEAR_MS) {
        closeYear(ctx);
        year = newYear(year.year);
    }
}

/** Top functions (self and inclusive ms) of the profile samples within [fromUs, toUs]. */
function windowSummary(p, fromUs, toUs) {
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^.*\/dwu-soak-[^/]+\//, '')}:${n.callFrame.lineNumber + 1}`;
    const self = new Map(), incl = new Map();
    let t = p.startTime;
    let total = 0;
    for (let i = 0; i < p.samples.length; i++) {
        t += p.timeDeltas[i] ?? 0;
        if (t < fromUs || t > toUs) continue;
        const w = (p.timeDeltas[i + 1] ?? CPUPROF_US) / 1000;
        total += w;
        const n = byId.get(p.samples[i]);
        self.set(key(n), (self.get(key(n)) ?? 0) + w);
        const seen = new Set();
        for (let cur = p.samples[i]; cur !== undefined; cur = parent.get(cur)) {
            const k = key(byId.get(cur));
            if (seen.has(k)) continue;
            seen.add(k);
            incl.set(k, (incl.get(k) ?? 0) + w);
        }
    }
    const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0)} ${k}`);
    return { sampledMs: Math.round(total), self: top(self, 15), incl: top(incl, 45) };
}

export async function chunk(ctx) {
    // runGameSeconds clears the tick profile at the end of every call.
    sched.setTickProfile(prof, () => performance.now());
    if (CPUPROF) {
        const { profile } = await post('Profiler.stop');
        for (const w of pendingWindows) w.rec.cpu = windowSummary(profile, w.endUs - w.ms * 1000, w.endUs);
        pendingWindows = [];
        await post('Profiler.start');
    }
    const done = ctx.report.timing.years.length;
    if (SAVE_YEARS.has(done) && !savedYears.has(done)) {
        savedYears.add(done);
        const { serializeGame } = await ctx.load('save');
        const { GalaxyTime } = await ctx.load('time');
        const outArg = process.argv.indexOf('--out');
        const file = resolve(outArg >= 0 ? process.argv[outArg + 1] : '.', `${ctx.report.name}-y${done}.save`);
        writeFileSync(file, serializeGame(ctx.game, new GalaxyTime(), ctx.so));
        console.log(`= timing: saved ${file}`);
    }
    if (STOP_YEAR > 0 && done >= STOP_YEAR) return 'stop';
}
