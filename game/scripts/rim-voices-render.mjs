// Usage: node scripts/rim-voices-render.mjs [devServerUrl] [seeds]
//   e.g. (with `npx vite --port 5391 --strictPort` running) node scripts/rim-voices-render.mjs http://localhost:5391 5
// 19i audio addendum — verification without ears. Node has no Web Audio, so this drives a headless Chromium
// (playwright-core, like scripts/shot.mjs) on the dev server, imports the synth modules there, renders every
// creature voice and the hull creak with an OfflineAudioContext at FULL gain (gain 1, centre pan, through the real
// bus: reverb send + compressor), and prints peak / RMS / active length / spectral centroid per voice (worst peak and
// mean of the rest over `seeds` random seeds), plus a pan check. Nothing is saved.
import { chromium } from 'playwright-core';

const [base = 'http://localhost:5391', seedArg = '5'] = process.argv.slice(2);
const seeds = Math.max(1, +seedArg);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
// Any same-origin document will do; the module is served as text, then imported properly below.
await page.goto(`${base.replace(/\/$/, '')}/src/audio/signalStats.ts`);
const result = await page.evaluate(async (seeds) => {
    const synth = await import('/src/audio/rimCreatureSynth.ts');
    const calls = await import('/src/audio/rimCreatureCalls.ts');
    const stats = await import('/src/audio/signalStats.ts');
    const { CreatureType } = await import('/src/sim/creature.ts');
    const sr = 48000;
    const voices = [
        ['kaltor', (bus, rand, pan) => synth.playCreatureCall(bus, CreatureType.Kaltor, 0.05, pan, 1, rand)],
        ['rockSlug', (bus, rand, pan) => synth.playCreatureCall(bus, CreatureType.RockSpaceSlug, 0.05, pan, 1, rand)],
        ['desertSlug', (bus, rand, pan) => synth.playCreatureCall(bus, CreatureType.DesertSpaceSlug, 0.05, pan, 1, rand)],
        ['ardilus', (bus, rand, pan) => synth.playCreatureCall(bus, CreatureType.Ardilus, 0.05, pan, 1, rand)],
        ['silverMist', (bus, rand, pan) => synth.playCreatureCall(bus, CreatureType.SilverMist, 0.05, pan, 1, rand)],
        ['creak', (bus, rand, pan) => synth.playCreak(bus, 0.05, pan, 1, rand)],
    ];
    const render = async (play, seed, pan) => {
        const ctx = new OfflineAudioContext(2, sr * 7, sr);
        const rand = calls.seededRandom(seed);
        const bus = synth.createRimSynthBus(ctx, ctx.destination, rand);
        const end = play(bus, rand, pan);
        const buf = await ctx.startRendering();
        return { s: stats.signalStats([buf.getChannelData(0), buf.getChannelData(1)], sr), end };
    };
    const out = [];
    for (const [name, play] of voices) {
        const runs = [];
        for (let seed = 1; seed <= seeds; seed++) runs.push(await render(play, seed * 7919, 0));
        const mean = (f) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
        const panned = await render(play, 1, 0.8);
        out.push({
            voice: name,
            peakDbWorst: Math.max(...runs.map((r) => r.s.peakDb)),
            peakDbMean: mean((r) => r.s.peakDb),
            rmsDbMean: mean((r) => r.s.rmsDb),
            callS: [Math.min(...runs.map((r) => r.end - 0.05)), Math.max(...runs.map((r) => r.end - 0.05))],
            activeSMean: mean((r) => r.s.activeS),
            centroidHzMean: mean((r) => r.s.centroidHz),
            centroidHzRange: [Math.min(...runs.map((r) => r.s.centroidHz)), Math.max(...runs.map((r) => r.s.centroidHz))],
            panL_R_dB: panned.s.channelRmsDb,
        });
    }
    return out;
}, seeds);
await browser.close();
for (const l of logs) console.log(l);
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
console.log(`voice        peak(worst) peak(mean)  rms(mean)  call s        active s  centroid Hz (mean, range)   pan +0.8 L/R rms dB   [${seeds} seeds, gain 1]`);
for (const r of result) {
    console.log(
        `${r.voice.padEnd(12)} ${f(r.peakDbWorst).padStart(8)}   ${f(r.peakDbMean).padStart(8)}   ${f(r.rmsDbMean).padStart(8)}   ${f(r.callS[0], 2)}–${f(r.callS[1], 2)}`.padEnd(70) +
            `${f(r.activeSMean, 2).padStart(6)}   ${f(r.centroidHzMean, 0).padStart(6)} (${f(r.centroidHzRange[0], 0)}–${f(r.centroidHzRange[1], 0)})`.padEnd(32) +
            `  ${r.panL_R_dB.map((x) => f(x)).join(' / ')}`,
    );
}
const clip = result.filter((r) => r.peakDbWorst > -6);
console.log(clip.length === 0 ? 'OK: every voice peaks at or below -6 dBFS at full gain' : `WARN: above -6 dBFS: ${clip.map((r) => r.voice).join(', ')}`);
