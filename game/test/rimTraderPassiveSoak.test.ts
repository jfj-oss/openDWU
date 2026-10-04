// @slow
// Scenario 19a — the Concord's passive posture over 3 game years (flag rimTraderPassive, default on), and the flag-off
// path: with the passive posture off, one starting colony, the old cap of 4, no per-colony treasure escorts and the
// wealth / navy params at their neutral values (stock treasury, no income, price factor 1, no warships), a rimTrade
// game is byte-identical to the rimTrade game before these features (digests pinned from 4c1ffbc, the merged head they were added on).
import { beforeAll, describe, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { CreateGameOptions } from '../src/sim/game';
import type { Empire } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { builtObjectMission } from '../src/sim/missions/mission';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { registerScenarioEvent, scenarioEmit } from '../src/sim/scenario';
import { rimAngerState, rimAngeredAt, rimAngeredAtAnyone, rimLedgerOpen, rimParam, rimTraderEmpire } from '../src/sim/scenario/rimTrade/common';
import { distanceToConcordSpace, inConcordSpace, inRetaliationRange, isStrikeShip, missionPoint, rimStrikeReview } from '../src/sim/scenario/rimTrade/passive';
import { treasureState } from '../src/sim/scenario/rimTrade/treasureFleet';
import { concordWarships, rimNavyState } from '../src/sim/scenario/rimTrade/wealth';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const forceOranthi = (o: CreateGameOptions): CreateGameOptions => ({ ...o, aiEmpires: [{ ...o.aiEmpires[0], race: 'Oranthi' }, ...o.aiEmpires.slice(1)] });

describe('19a Concord — flag off is byte-identical', () => {
    // [forced Oranthi, start digest, digest after 1 year] from the rimTrade game (default flags / params then).
    // Repinned at c5cff32 (moon orbit-speed fix, Habitat.cs 924/986): it changes moon positions from generation onward, so
    // every digest moved (start and 1 year). The pre-feature values from 4c1ffbc were 2726246819d1c846/10b1026d25ff71f1
    // (wizard Oranthi) and 4fd8498a373af023/bd3751a3fd90f0d5 (Concord created at start); the test passes unchanged at
    // c5cff32^ and the only sim change since is c5cff32, so the flag-off path is still identical to the feature-free game.
    // Repinned again at 990fb8c: f2aa5bc (orbit spacing so bodies never overlap, a requested deviation) changes generation,
    // and later deliberate generation changes (0198eda SelectHabitatPictures and others, each repinned in the golden pins)
    // shift the Rnd stream; the c5cff32 values were 2477059f19d2da47/fe7c3e8fd4b91dbb and 4a9c0d151a4302cf/9029719465f2dcd0.
    const PINS: [boolean, string, string][] = [
        [true, 'aae3cd943610cba5', '7ebf83ea39581249'],
        [false, 'af20ac37e16a82a1', '9494f88633de1e94'],
    ];
    for (const [forced, d0, d1] of PINS) {
        it(`passive off, 1 starting colony, cap 4 (${forced ? 'wizard Oranthi' : 'Concord created at start'}): 1 year matches the pre-feature digests`, () => {
            const { game } = createScenarioGame(base, {
                scenario: 'rimTrade',
                flags: { rimTraderPassive: false },
                params: { rimTraderStartColonies: 1, rimTraderMaxColonies: 4, treasureFleetPerColony: 0, rimTraderStartMoney: 0, rimTraderTradeHouseIncome: 0, rimTraderRarePriceMult: 1, rimTraderStartWarships: 0, rimTraderNavyTarget: 0 },
                options: forced ? forceOranthi : undefined,
            });
            expect(stateDigest(game.galaxy)).toBe(d0);
            runGameSeconds(game.galaxy, YEAR_LENGTH / 1000);
            expect(stateDigest(game.galaxy)).toBe(d1);
        }, 3600000);
    }
});

describe('19a Concord — passive posture soak', () => {
    for (const forced of [false, true]) {
        it(`3 years (${forced ? 'wizard Oranthi, colonies in several systems' : 'Concord created at start'}): warships keep to Concord space, no unprovoked war, colonies within the cap`, () => {
            const { game } = createScenarioGame(base, { scenario: 'rimTrade', options: forced ? forceOranthi : undefined });
            const g = game.galaxy;
            const r = rimTraderEmpire(g)!;
            const startColonies = r.colonies.length;
            const startNavy = concordWarships(r).length;
            expect(startColonies).toBeGreaterThanOrEqual(3);
            const declared: { target: Empire; angered: boolean }[] = [];
            const off = registerScenarioEvent({
                id: 'test.concordWar',
                event: 'warDeclared',
                run: (gg, p) => {
                    if (p.empire === r) declared.push({ target: p.target, angered: rimAngeredAt(gg, p.target) });
                },
            });
            const summary: string[] = [];
            let offenders = new Set<unknown>();
            let maxWarships = 0;
            let outsideSamples = 0;
            try {
                for (let month = 1; month <= 36; month++) {
                    runGameSeconds(g, YEAR_LENGTH / 1000 / 12);
                    const ts = treasureState(g);
                    const angry = rimAngeredAtAnyone(g);
                    const now = new Set<unknown>();
                    let warships = 0;
                    for (const b of r.builtObjects) {
                        if (b === null || b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || ts.ships.includes(b) || isStrikeShip(g, b)) continue; // strike fleets sail galaxy-wide by design
                        warships++;
                        const m = builtObjectMission(b.mission);
                        const t = m === null ? null : (m.targetBuiltObject ?? m.targetHabitat ?? m.targetCreature ?? m.targetShipGroup);
                        const dest = m === null ? null : missionPoint(t, m.x, m.y);
                        const inside = inConcordSpace(g, r, b.xpos, b.ypos);
                        const homeward = dest !== null && inConcordSpace(g, r, dest.x, dest.y);
                        const retaliating = angry && inRetaliationRange(g, r, b.xpos, b.ypos) && (dest === null || inRetaliationRange(g, r, dest.x, dest.y));
                        // A mission beyond Concord space is only ever a retaliation within range.
                        const destOk = dest === null || homeward || (angry && inRetaliationRange(g, r, dest.x, dest.y));
                        if (!inside) outsideSamples++;
                        if ((!inside && !homeward && !retaliating) || !destOk) now.add(b);
                    }
                    maxWarships = Math.max(maxWarships, warships);
                    // The leash (every long block) brings a stray home: none may stay unjustified two samples running.
                    const stuck = [...now].filter((b) => offenders.has(b));
                    expect(stuck.map((b) => (b as { name: string }).name)).toEqual([]);
                    offenders = now;
                    expect(r.colonies.length).toBeLessThanOrEqual(Math.max(startColonies, rimParam(g, 'rimTraderMaxColonies')));
                    if (month % 6 === 0) {
                        const wars = g.empires.filter((e) => e !== null && e !== r && e.active && obtainDiplomaticRelation(r, e).type === DiplomaticRelationType.War).map((e) => e!.name);
                        summary.push(`month ${month}: warships ${warships}, strays ${now.size}, colonies ${r.colonies.length}, wars ${wars.join('/') || '-'}, anger ${JSON.stringify(rimAngerState(g).byEmpire)}`);
                    }
                }
            } finally {
                off();
            }
            console.log(summary.join('\n'));
            if (process.env.DWU_SOAK_OUT) appendFileSync(process.env.DWU_SOAK_OUT, `${forced ? 'wizard' : 'created'}: declared ${declared.length}\n` + summary.join('\n') + '\n');
            expect(maxWarships).toBeGreaterThan(0);
            // The navy target: with the 5M treasury and trade-house income, the Concord orders warships toward 80.
            const endNavy = concordWarships(r).length;
            if (process.env.DWU_SOAK_OUT) appendFileSync(process.env.DWU_SOAK_OUT, `navy ${startNavy} → ${endNavy}, bought ${rimNavyState(g).bought}, spent ${Math.round(rimNavyState(g).spent)}, treasury ${Math.round(r.stateMoney)}\n`);
            // (Seed 1: the rich Concord's own stock construction AI outbuilds the target, so the yearly top-up may buy
            // nothing; either way the navy reaches it.)
            expect(endNavy).toBeGreaterThanOrEqual(rimParam(g, 'rimTraderNavyTarget'));
            expect(startNavy).toBeGreaterThanOrEqual(rimParam(g, 'rimTraderStartWarships'));
            void outsideSamples;
            // No war declared by the Concord unless it had been provoked by the target.
            for (const d of declared) expect(d.angered).toBe(true);
        }, 3600000);
    }
});

describe('19a Concord — a tit-for-tat strike reaches a distant offender without war', () => {
    it('seed 1: an open ledger sends strike fleets 4+ sectors out; they destroy offender assets within 16 months; no war', () => {
        const { game } = createScenarioGame(base, { scenario: 'rimTrade', options: forceOranthi });
        const g = game.galaxy;
        const r = rimTraderEmpire(g)!;
        const x = g.empires.find((e): e is Empire => e !== null && e !== r && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null)!;
        obtainDiplomaticRelation(r, x).type = DiplomaticRelationType.None;
        obtainDiplomaticRelation(x, r).type = DiplomaticRelationType.None;
        const declared: Empire[] = [];
        const off = registerScenarioEvent({ id: 'test.strikeWar', event: 'warDeclared', run: (_g, p) => void (p.empire === r && declared.push(p.target)) });
        try {
            scenarioEmit(g, 'warDamageInflicted', { inflictor: x, victim: r, builtObject: null, habitat: r.capital!, value: 500 });
            expect(rimStrikeReview(g)).toBeGreaterThan(0);
            const fleets = rimAngerState(g).strikes!;
            const range = g.maxSolarSystemSize + rimParam(g, 'rimTraderRetaliationRange') * g.sectorSize;
            expect(fleets.some((f) => distanceToConcordSpace(g, r, f.target!.xpos, f.target!.ypos) > range)).toBe(true);
            let inflicted = 0;
            for (let month = 1; month <= 16 && inflicted === 0; month++) {
                runGameSeconds(g, YEAR_LENGTH / 1000 / 12);
                inflicted = rimAngerState(g).byEmpire[x.empireId].ledger?.inflicted ?? 0;
                if (!rimLedgerOpen(g, x)) inflicted = Math.max(inflicted, 1);
            }
            expect(inflicted).toBeGreaterThan(0);
            expect(declared).toEqual([]);
        } finally {
            off();
        }
    }, 3600000);
});
