// Measurement hook for the dark themes (docs/DARK_THEMES.md §soaks): scripts/soak.mjs --set dark-themes --hook
// scripts/dark-themes-hook.mjs. Writes report.darkThemes every 30 game days (the last one is the end state):
//   slavery: per AI empire its species, government, when it adopted slavery, its penal colonies against its enslavable
//            people, and per penal colony workers / target / multiplier, tax and luxury output against the same colony
//            free, garrison held / needed, revolts;
//   scorched earth / war crimes: their add-on state when they run.
// A config whose name ends in "-noslave" switches AI slavery off (SLAVERY_PARAMS.AI_ADOPT_SCORE = Infinity): the baseline.
const YEAR_MS = 600_000;
let mods = null;
let lastDay = -1;

export async function start(ctx) {
    mods = { s: await ctx.load('slavery'), r: await ctx.load('slaveryReview') };
    if (String(ctx.report.name).endsWith('-noslave')) mods.s.SLAVERY_PARAMS.AI_ADOPT_SCORE = Infinity;
    ctx.report.darkThemes = {};
}

/** empire name → game year it was first seen allowing slavery (sampled every 30 days). */
const adopted = new Map();

function adoptedYear(g, e, allow) {
    if (allow && !adopted.has(e.name)) adopted.set(e.name, +(g.nowMs / YEAR_MS).toFixed(1));
    return adopted.get(e.name) ?? null;
}

export function chunk(ctx) {
    const g = ctx.g;
    const day = Math.floor(g.nowMs / (YEAR_MS / 360));
    if (lastDay >= 0 && day - lastDay < 30) return;
    lastDay = day;
    const { s, r } = mods;
    const empires = [];
    for (const e of g.empires) {
        if (e === null || e === g.independentEmpire || e.pirateEmpireBaseHabitat !== null) continue;
        const st = e.slavery;
        const penal = (st?.penal ?? []).map((h) => {
            const l = r.penalLedger(g, h);
            return {
                name: h.name, pop: h.population?.totalAmount ?? 0, workers: l.workers, target: Math.round(l.target), multiplier: +l.multiplier.toFixed(2),
                taxFree: Math.round(l.taxFree), taxPenal: Math.round(l.taxPenal), outputFree: Math.round(l.outputFree), outputPenal: Math.round(l.outputPenal),
                luxuryValue: Math.round(l.luxuryValue), garrisonUpkeep: Math.round(l.garrisonUpkeep), net: Math.round(l.net),
                garrison: h.troops?.totalDefendStrength ?? 0, garrisonNeed: s.penalGarrisonRequired(g, h), rebelling: h.rebelling,
                years: +s.penalYears(g, h).toFixed(1), workersArrived: h.slavery?.workersArrived ?? 0, extraLuxury: h.slavery?.extraLuxury ?? 0,
            };
        });
        empires.push({
            name: e.name, active: e.active, human: e === g.playerEmpire, race: e.dominantRace?.name, government: e.governmentId,
            score: r.aiSlaveryScore(e), allow: s.slaveryAllowed(e), adoptedYear: adoptedYear(g, e, s.slaveryAllowed(e)),
            enslavable: r.enslavablePool(e), colonies: e.colonies.length, money: Math.round(e.stateMoney), penal, stats: st?.stats ?? null,
        });
    }
    const wc = g.scenario?.state?.warCrimes ?? null;
    const sc = g.scenario?.state?.scorchedEarth ?? null;
    ctx.report.darkThemes = {
        gameYears: +(g.nowMs / YEAR_MS).toFixed(2),
        slavery: empires,
        scorch: sc === null ? null : { ...sc.stats, burningNow: sc.burning.length, siegesNow: sc.sieges.length },
        warCrimes: wc === null ? null : { totals: wc.totals, records: Object.values(wc.records).map((r) => ({ name: r.name, score: Math.round(r.score), counts: r.counts, tribunals: r.tribunals })), tribunals: wc.tribunals },
    };
}
