// Measurement hook for scripts/soak.mjs (`--hook scripts/rimtrade-measure-hook.mjs`): what the Rim Trade add-on
// (scenarios/rimTrade, tasks/19a-rim-trader.md) does over a game, per empire and per game year. Read-only: it reads the
// galaxy and the add-on's saved state, and listens to scenario events (no Rnd, no state written).
//
//   nice -n 15 node --expose-gc scripts/soak.mjs --run rimtrade-m-s1 --hook scripts/rimtrade-measure-hook.mjs \
//        --save-at 0 --scan-days 100000 --chunk 30 --out <dir>
//
// Per game year and empire: rim goods sold to the Concord (units / value; by the Concord's freighters and by the
// treasure fleet), rare goods bought (units / value; the colonies that received them), standing (credit × rate − debit)
// at year end, access opens / closes (sampled every chunk), colonies holding rare goods / stock super-luxuries and those
// whose only restricted resource is a rare good (the +30 development they owe the Rim Trade, Habitat.cs 447),
// colonies, population, development, tax revenue, treasury, warships and firepower, rim mining stations. For the
// Concord: treasury, navy, colonies, treasure-fleet stats, anger / strike stats and stranded (no fuel) warships.
// Results: report.rimMeasure (<out>/<config>.json).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const YEAR_S = 600;
const SAVE_YEARS = new Set(String(process.env.RIM_SAVE_YEARS ?? '').split(',').filter((x) => x !== '').map(Number));

let m = null;
let mods = null;
let elapsed = 0;
let yearIdx = 0;
let off = [];

function row(by, id) {
    return (by[id] ??= { rimUnits: 0, rimValue: 0, rimUnitsTreasure: 0, rareUnits: 0, rareValue: 0, rareUnitsTreasure: 0, rareColonies: {} });
}

function newYear() {
    return { year: yearIdx + 1, flows: {}, opens: {}, closes: {}, combat: { concordLost: 0, concordKills: 0, treasureLost: 0 }, snap: null };
}

export async function start(ctx) {
    const { load, g, report } = ctx;
    const [common, passive, treasure, wealth, hooks, dev, diplo, bt, designs, mv] = await Promise.all([
        load('src/sim/scenario/rimTrade/common'), load('src/sim/scenario/rimTrade/passive'), load('src/sim/scenario/rimTrade/treasureFleet'),
        load('src/sim/scenario/rimTrade/wealth'), load('src/sim/scenario/hooks'), load('src/sim/developmentLevel'), load('src/sim/diplomacy'),
        load('src/sim/builtObjectTypes'), load('src/sim/data/designSpecifications'), load('src/sim/movement'),
    ]);
    const [dtick, raids, rare, cdes] = await Promise.all([load('src/sim/diplomacyTick'), load('src/sim/scenario/rimTrade/treasureRaids'), load('src/sim/scenario/rimTrade/rareGoods'), load('src/sim/scenario/rimTrade/concordDesigns')]);
    mods = { common, passive, treasure, wealth, hooks, dev, diplo, bt, designs, mv, dtick, raids, rare, cdes };
    const r = common.rimTraderEmpire(g);
    m = { concordId: r?.empireId ?? -1, concordName: r?.name ?? null, years: [], accessOpen: {}, firstCredit: {}, firstAccess: {}, designs: [], strikesLog: [] };
    report.rimMeasure = m;
    m.cur = newYear();
    m.designs = concordDesigns(g, r);
    // Contracts: rim goods to the Concord, rare goods from it.
    off.push(hooks.registerScenarioEvent({ id: 'measure.contract', event: 'contractInitiated', run: (gg, ev) => {
        const rr = common.rimTraderEmpire(gg);
        if (rr === null || ev.resourceId < 0) return;
        const tr = treasureShips(gg);
        const viaFleet = ev.freighter != null && tr.includes(ev.freighter);
        if (ev.buyer === rr && ev.seller !== rr && common.isRimGood(gg, ev.resourceId)) {
            let creditor = ev.seller;
            const carrier = ev.freighter?.actualEmpire ?? null;
            if ((creditor === gg.independentEmpire || creditor.pirateEmpireBaseHabitat !== null) && carrier !== null && carrier !== rr) creditor = carrier;
            const x = row(m.cur.flows, creditor.empireId);
            x.rimUnits += ev.amount;
            x.rimValue += ev.value;
            if (viaFleet) x.rimUnitsTreasure += ev.amount;
            m.firstCredit[creditor.empireId] ??= m.cur.year;
        } else if (ev.seller === rr && ev.buyer !== rr && common.rareGoodIds(gg).includes(ev.resourceId)) {
            const x = row(m.cur.flows, ev.buyer.empireId);
            x.rareUnits += ev.amount;
            const mult = viaFleet ? 1 : common.rimParam(gg, 'rimTraderRarePriceMult');
            x.rareValue += ev.value * mult;
            if (viaFleet) x.rareUnitsTreasure += ev.amount;
            const dest = ev.destination;
            const name = dest?.name ?? '?';
            x.rareColonies[name] = (x.rareColonies[name] ?? 0) + ev.amount;
        }
    } }));
    off.push(hooks.registerScenarioEvent({ id: 'measure.kill', event: 'builtObjectKilledBy', run: (gg, ev) => {
        const rr = common.rimTraderEmpire(gg);
        if (rr === null) return;
        if (ev.builtObject.actualEmpire === rr || ev.builtObject.empire === rr) m.cur.combat.concordLost++;
        if (ev.destroyer === rr) m.cur.combat.concordKills++;
        if (treasureShips(gg).includes(ev.builtObject)) m.cur.combat.treasureLost++;
    } }));
}

function treasureShips(g) {
    return g.scenario !== null && 'rimTreasure' in g.scenario.state ? mods.treasure.treasureState(g).ships : [];
}

function concordDesigns(g, r) {
    if (r === null) return [];
    const S = mods.bt.BuiltObjectSubRole;
    const subs = [S.Escort, S.Frigate, S.Destroyer, S.Cruiser, S.CapitalShip, S.Carrier, S.TroopTransport];
    const out = [];
    for (const d of r.designs) {
        if (d === null || d.isObsolete || !subs.includes(d.subRole)) continue;
        const live = r.builtObjects.filter((b) => b !== null && !b.hasBeenDestroyed && b.design === d);
        const s0 = live[0] ?? null;
        out.push({ name: d.name, subRole: mods.bt.BuiltObjectSubRole[d.subRole], size: d.size, price: Math.round(d.calculateCurrentPurchasePrice(g)), built: live.length,
            designRangeSectors: +(mods.cdes.designFuelRange(d) / g.sectorSize).toFixed(1), designWarp: d.warpSpeed, designTop: d.topSpeed, designFirepower: d.firepowerRaw, designShields: d.shieldsCapacity,
            maint: s0 ? Math.round(s0.annualSupportCost) : null, firepower: s0 ? Math.round(s0.firepowerRaw) : null, rangeSectors: s0 ? +(mods.mv.maximumFuelRange(s0) / g.sectorSize).toFixed(1) : null,
            fuel: s0 ? Math.round(s0.fuelCapacity) : null, warp: s0 ? Math.round(s0.warpSpeed) : null, shields: s0 ? Math.round(s0.shieldsCapacity) : null });
    }
    return out;
}

function militaryStats(g, e) {
    const Mil = mods.designs.BuiltObjectRole.Military;
    let n = 0, fire = 0, size = 0, noFuel = 0, range = 0, maint = 0;
    for (const b of e.builtObjects) {
        if (b === null || b.hasBeenDestroyed) continue;
        maint += b.annualSupportCost;
        if (b.role !== Mil) continue;
        n++;
        fire += b.firepowerRaw;
        size += b.size;
        if (b.fuelCapacity > 0 && b.currentFuel <= b.fuelCapacity * 0.01) noFuel++;
        range += mods.mv.maximumFuelRange(b);
    }
    return { warships: n, firepower: Math.round(fire), size: Math.round(size), noFuel, stateMaint: Math.round(maint), avgRangeSectors: n > 0 ? +(range / n / g.sectorSize).toFixed(1) : 0 };
}

function snapshot(g) {
    const { common } = mods;
    const r = common.rimTraderEmpire(g);
    const rimIds = new Set(common.rimGoodIds(g));
    const rareIds = new Set(common.rareGoodIds(g));
    const superIds = new Set(g.resourceSystem.superLuxuryResources.map((x) => x.resourceId));
    const empires = {};
    for (const e of g.empires) {
        if (e === null || !e.active || e === g.independentEmpire || e.pirateEmpireBaseHabitat !== null) continue;
        let pop = 0, devSum = 0, tax = 0, withRare = 0, withStock = 0, rareOnly = 0, n = 0;
        const fxCount = {};
        for (const c of e.colonies) {
            if (c === null || c.hasBeenDestroyed) continue;
            n++;
            pop += c.population.totalAmount;
            devSum += mods.dev.habitatDevelopmentLevel(c);
            tax += c.annualTaxRevenue;
            let rare = false, stock = false;
            if (c.cargo !== null) for (const x of c.cargo.items) {
                if (x.empire !== c.owner || !(x.amount > 0)) continue;
                const id = x.commodity.resourceId;
                if (rareIds.has(id)) rare = true;
                else if (superIds.has(id)) stock = true;
            }
            if (rare) withRare++;
            for (const fx of mods.rare.rareGoodEffects(g, c)) fxCount[fx.kind] = (fxCount[fx.kind] ?? 0) + 1;
            if (stock) withStock++;
            if (rare && !stock) rareOnly++;
        }
        // Rim mining stations: mining bases at habitats holding a rim good.
        let rimMines = 0;
        for (const b of [...e.builtObjects, ...e.privateBuiltObjects]) {
            if (b === null || b.hasBeenDestroyed || b.parentHabitat === null) continue;
            if (b.subRole !== mods.bt.BuiltObjectSubRole.MiningStation && b.subRole !== mods.bt.BuiltObjectSubRole.GasMiningStation) continue;
            if (b.parentHabitat.resources.some((x) => rimIds.has(x.resourceId))) rimMines++;
        }
        // Restricted resources this empire's colonies may order (Galaxy.3.cs 367, the first 3 found): rare goods among them?
        const avail = [];
        for (const e2 of g.empires) {
            if (e2 === null) continue;
            let sup = null;
            if (e2 === e) sup = supplies(e);
            else {
                const rel = mods.diplo.obtainDiplomaticRelation(e2, e);
                if (rel.type !== mods.diplo.DiplomaticRelationType.NotMet && rel.supplyRestrictedResources) sup = supplies(e2);
            }
            if (sup !== null) for (const s of g.resourceSystem.superLuxuryResources) if (sup.includes(s.resourceId) && !avail.includes(s.resourceId)) avail.push(s.resourceId);
            if (avail.length >= 3) break;
        }
        const relR = r !== null && e !== r ? mods.diplo.obtainDiplomaticRelation(r, e) : null;
        const anger = g.scenario !== null && 'rimAnger' in g.scenario.state ? common.rimAngerState(g).byEmpire[e.empireId] : undefined;
        empires[e.empireId] = {
            name: e.name, concord: e === r, colonies: n, pop: Math.round(pop / 1e6), avgDev: n > 0 ? +(devSum / n).toFixed(1) : 0, tax: Math.round(tax), money: Math.round(e.stateMoney),
            withRare, withStock, rareOnly, rimMines, fxCount, strongestFleetFp: strongestFleet(e), availRestricted: avail.map((id) => g.resourceSystem.byId.get(id)?.name ?? id), rareInAvail: avail.some((id) => rareIds.has(id)),
            standing: e !== r ? Math.round(common.rimTraderStanding(g, e.empireId)) : null, access: relR?.supplyRestrictedResources ?? null, relation: relR?.type ?? null,
            anger: anger ? +anger.anger.toFixed(2) : 0, ledger: anger?.ledger ? { taken: Math.round(anger.ledger.taken), inflicted: Math.round(anger.ledger.inflicted), open: anger.ledger.open } : null,
            angerCounts: anger?.counts ?? null, ...militaryStats(g, e),
        };
    }
    const out = { empires };
    if (r !== null) {
        const ts = g.scenario !== null && 'rimTreasure' in g.scenario.state ? mods.treasure.treasureState(g) : null;
        const an = g.scenario !== null && 'rimAnger' in g.scenario.state ? common.rimAngerState(g) : null;
        const nav = mods.wealth.rimNavyState(g);
        out.concord = {
            treasure: ts ? { ...ts.stats, ...(ts.stats2 ?? {}), fleetShips: ts.ships.filter((b) => !b.hasBeenDestroyed).length, escortFp: Math.round(ts.ships.filter((b) => !b.hasBeenDestroyed && !ts.treasure.includes(b)).reduce((n, b) => n + b.firepowerRaw, 0)), sailing: ts.sailing, treasureShipSize: ts.design?.size ?? null, treasureRangeSectors: ts.design ? +(mods.cdes.designFuelRange(ts.design) / g.sectorSize).toFixed(1) : null, stragglersNow: (ts.stragglers ?? []).length, requests: (ts.requests ?? []).length } : null,
            raids: g.scenario !== null && 'rimRaids' in g.scenario.state ? (() => { const rs = mods.raids.raidState(g); return { active: rs.active.length, log: rs.log.length, losses: rs.losses.length }; })() : null,
            anger: an ? { ...an.stats, strikesAtSea: (an.strikes ?? []).length, strikeShips: (an.strikes ?? []).reduce((s, f) => s + f.ships.length, 0) } : null,
            navy: { ...nav, spent: Math.round(nav.spent) }, stats: common.rimTradeState(g).stats,
        };
    }
    return out;
}

function strongestFleet(e) {
    let best = 0;
    for (const sg of e.shipGroups ?? []) {
        if (sg === null) continue;
        let fp = 0;
        for (const b of sg.ships) if (!b.hasBeenDestroyed) fp += b.firepowerRaw;
        best = Math.max(best, fp);
    }
    return Math.round(best);
}

function supplies(e) {
    return mods.dtick.determineResourcesEmpireSupplies(e);
}

export async function chunk(ctx) {
    const { g } = ctx;
    const { common } = mods;
    elapsed += ctx.chunkSeconds;
    const r = common.rimTraderEmpire(g);
    if (r !== null) {
        for (const e of g.empires) {
            if (e === null || e === r || !e.active) continue;
            const open = mods.diplo.obtainDiplomaticRelation(r, e).supplyRestrictedResources;
            const was = m.accessOpen[e.empireId] ?? false;
            if (open && !was) { m.cur.opens[e.empireId] = (m.cur.opens[e.empireId] ?? 0) + 1; m.firstAccess[e.empireId] ??= m.cur.year; }
            if (!open && was) m.cur.closes[e.empireId] = (m.cur.closes[e.empireId] ?? 0) + 1;
            m.accessOpen[e.empireId] = open;
        }
        // Strike fleets: distance to target and fuel, sampled.
        if (g.scenario !== null && 'rimAnger' in g.scenario.state) {
            for (const f of common.rimAngerState(g).strikes ?? []) {
                const t = f.target;
                const live = f.ships.filter((b) => !b.hasBeenDestroyed);
                if (t === null || live.length === 0) continue;
                const d = live.map((b) => g.calculateDistance(b.xpos, b.ypos, t.xpos, t.ypos));
                const dry = live.filter((b) => b.currentFuel <= b.fuelCapacity * 0.01).length;
                if (m.strikesLog.length < 400) m.strikesLog.push({ day: Math.round(elapsed / 600 * 360), target: f.targetEmpireId, ships: live.length, minDistSectors: +(Math.min(...d) / g.sectorSize).toFixed(2), dry });
            }
        }
    }
    if (elapsed >= (yearIdx + 1) * YEAR_S) {
        m.cur.snap = snapshot(g);
        m.years.push(m.cur);
        yearIdx++;
        m.cur = newYear();
        if (yearIdx === 1 || yearIdx % 5 === 0) m.designs = concordDesigns(g, r);
        if (g.scenario !== null && 'rimRaids' in g.scenario.state) { const rs = mods.raids.raidState(g); m.raidLog = rs.log; m.losses = rs.losses; }
        printYear(m.years.at(-1));
        // RIM_SAVE_YEARS=10,20,...: a checkpoint save (serializeGame text) after those game years, under the --out dir.
        if (SAVE_YEARS.has(yearIdx)) {
            const { serializeGame } = await ctx.load('save');
            writeFileSync(resolve(process.env.RIM_SAVE_DIR ?? '.', `${ctx.report.name}-y${yearIdx}.save`), serializeGame(ctx.game));
            console.log(`= checkpoint y${yearIdx}`);
        }
    }
}

function printYear(y) {
    const parts = [];
    for (const [id, e] of Object.entries(y.snap.empires)) {
        const f = y.flows[id];
        parts.push(`${e.name.slice(0, 18)}${e.concord ? '*' : ''}: col ${e.colonies} dev ${e.avgDev} rim ${f ? Math.round(f.rimUnits) : 0} rare ${f ? Math.round(f.rareUnits) : 0} st ${e.standing} acc ${e.access ? 'Y' : '-'} wRare ${e.withRare} ships ${e.warships} fp ${e.firepower}`);
    }
    console.log(`= year ${y.year}\n  ` + parts.join('\n  ') + `\n  concord ${JSON.stringify(y.snap.concord)}`);
}
