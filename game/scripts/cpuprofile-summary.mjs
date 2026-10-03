#!/usr/bin/env node
// Summarise a V8 .cpuprofile (node --cpu-prof): top self-time functions and top inclusive-time call paths.
//   node scripts/cpuprofile-summary.mjs <file.cpuprofile> [--self 30] [--paths 15] [--incl 30] [--depth 6] [--under fn]
//        [--lines 'fn;...'] [--children 'fn;name src/file.ts:line;...']
// Self time is per function (name + file:line). Inclusive time counts a function once per sample even when it
// recurses. Paths are the hottest call chains (by inclusive time, ending at a sim function), shown as the last
// --depth frames below the tick roots.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : Number(process.argv[i + 1]); };
const nSelf = opt('self', 30), nPaths = opt('paths', 15), nIncl = opt('incl', 30), depth = opt('depth', 6);
const p = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
// sample weights (µs) from timeDeltas
// --under fnName: only samples whose stack contains that function (e.g. runGameSeconds: the sim run, not createGame).
const under = (() => { const i = process.argv.indexOf('--under'); return i < 0 ? null : process.argv[i + 1]; })();
const weight = new Map();
const inside = new Map();
const isUnder = (id) => {
    if (under === null) return true;
    if (inside.has(id)) return inside.get(id);
    const n = byId.get(id);
    const r = n.callFrame.functionName === under || (parent.has(id) && isUnder(parent.get(id)));
    inside.set(id, r);
    return r;
};
for (let i = 0; i < p.samples.length; i++) if (isUnder(p.samples[i])) weight.set(p.samples[i], (weight.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0));
const total = [...weight.values()].reduce((a, b) => a + b, 0);
const short = (u) => u.replace(/^file:\/\/.*?\/dwu-profile-sim-[^/]+\//, '').replace(/^file:\/\/.*\/node_modules\//, 'nm/').replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '');
const key = (n) => `${n.callFrame.functionName || '(anon)'} ${short(n.callFrame.url)}:${n.callFrame.lineNumber + 1}`;
const self = new Map(), incl = new Map(), paths = new Map();
for (const [id, w] of weight) {
    const n = byId.get(id);
    self.set(key(n), (self.get(key(n)) ?? 0) + w);
    const seen = new Set();
    const chain = [];
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
        const k = key(byId.get(cur));
        chain.push(byId.get(cur).callFrame.functionName || '(anon)');
        if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + w); }
    }
    // path: strip the leaf if it is a VM builtin / (program)/(gc); keep the deepest `depth` frames
    const frames = chain.reverse().filter((f) => f !== '(root)');
    for (let d = 1; d <= frames.length; d++) {
        const pk = frames.slice(Math.max(0, d - depth), d).join(' > ');
        if (d === frames.length || true) paths.set(pk, (paths.get(pk) ?? 0) + (d === frames.length ? w : 0));
    }
}
// inclusive per path prefix (a path's time = every sample passing through that exact chain suffix window)
const pathIncl = new Map();
for (const [id, w] of weight) {
    const frames = [];
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) frames.push(byId.get(cur).callFrame.functionName || '(anon)');
    frames.reverse();
    const seen = new Set();
    for (let d = 1; d <= frames.length; d++) {
        const pk = frames.slice(Math.max(0, d - depth), d).join(' > ');
        if (!seen.has(pk)) { seen.add(pk); pathIncl.set(pk, (pathIncl.get(pk) ?? 0) + w); }
    }
}
const pct = (w) => `${((100 * w) / total).toFixed(1).padStart(5)}%  ${(w / 1000).toFixed(0).padStart(7)} ms`;
const top = (m, n, f = () => true) => [...m].filter(([k]) => f(k)).sort((a, b) => b[1] - a[1]).slice(0, n);
console.log(`${file}: ${(total / 1e6).toFixed(1)} s sampled`);
console.log(`\n== top ${nSelf} self time`);
for (const [k, w] of top(self, nSelf)) console.log(`${pct(w)}  ${k}`);
console.log(`\n== top ${nIncl} inclusive time (functions)`);
for (const [k, w] of top(incl, nIncl, (k) => !k.startsWith('(') && !k.includes('profile-sim'))) console.log(`${pct(w)}  ${k}`);
console.log(`\n== top ${nPaths} inclusive call paths (last ${depth} frames, leaf-ish: paths whose leaf is a sim function)`);
const simFn = new Set([...incl.keys()].filter((k) => k.includes('src/sim/')).map((k) => k.split(' ')[0]));
const cand = top(pathIncl, 100000, (k) => { const fs = k.split(' > '); return fs.length === depth && simFn.has(fs[fs.length - 1]); });
// keep only paths not dominated by an already-listed path with the same prefix (avoid 15 variants of one chain)
const shown = [];
for (const [k, w] of cand) {
    if (shown.length >= nPaths) break;
    if (shown.some(([s]) => s.startsWith(k.split(' > ').slice(0, depth - 1).join(' > ')))) continue;
    shown.push([k, w]);
}
for (const [k, w] of shown) console.log(`${pct(w)}  ${k}`);
// --lines 'fnName[;name src/file.ts:line]': per-line self samples (positionTicks) of those functions (bundle line numbers; keep the
// bundle with profile-sim --keep-bundle to read them).
const linesOpt = (() => { const i = process.argv.indexOf('--lines'); return i < 0 ? [] : process.argv[i + 1].split(/[;,]/); })();
for (const fn of linesOpt) {
    const ticks = new Map();
    let url = '';
    for (const n of p.nodes) {
        if (fn.includes(' ') ? key(n) !== fn : n.callFrame.functionName !== fn) continue;
        url = n.callFrame.url;
        for (const t of n.positionTicks ?? []) ticks.set(t.line, (ticks.get(t.line) ?? 0) + t.ticks);
    }
    const sum = [...ticks.values()].reduce((a, b) => a + b, 0);
    console.log(`\n== ${fn} (${short(url)}) self ticks by line (${sum} ticks)`);
    for (const [l, t] of [...ticks].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${((100 * t) / sum).toFixed(1).padStart(5)}%  line ${l}`);
}
// --children 'fnName[;name src/file.ts:line]': inclusive time of each direct callee of those functions (merged over call sites).
const childOpt = (() => { const i = process.argv.indexOf('--children'); return i < 0 ? [] : process.argv[i + 1].split(';'); })();
if (childOpt.length > 0) {
    const inclNode = new Map();
    const sumNode = (n) => { let w = weight.get(n.id) ?? 0; for (const c of n.children ?? []) w += sumNode(byId.get(c)); inclNode.set(n.id, w); return w; };
    sumNode(p.nodes[0]);
    for (const fn of childOpt) {
        const kids = new Map();
        let tot = 0;
        for (const n of p.nodes) {
            // fn is a function name, or `name src/file.ts:line` (a key as printed above) to pick one of several same-named
            const match = (node) => (fn.includes(' ') ? key(node) === fn : node.callFrame.functionName === fn);
            if (!match(n)) continue;
            // skip recursive inner occurrences
            let rec = false;
            for (let cur = parent.get(n.id); cur !== undefined; cur = parent.get(cur)) if (match(byId.get(cur))) { rec = true; break; }
            if (rec) continue;
            tot += inclNode.get(n.id);
            for (const c of n.children ?? []) { const cn = byId.get(c); const k = key(cn); kids.set(k, (kids.get(k) ?? 0) + inclNode.get(c)); }
        }
        console.log(`\n== ${fn} (${(tot / 1000).toFixed(0)} ms) callees`);
        for (const [k, w] of [...kids].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${pct(w)}  ${k}`);
    }
}
