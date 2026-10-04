// textkeys (fast companion of the textKeyLeaks.test.ts soak): the player-visible texts that format numbers, generated
// directly instead of waiting for a long run to raise them. Each is rendered the way the UI shows it
// (resolveGameText) and checked with test/helpers/textLeak.ts — no GameText key, no `|`-encoded fragment, no raw
// double's float tail (the "EmpireAbilityBonusEspionage|0.010000000000000002" event popup) — and against the C#'s
// number format.
//  - netNumberFormat.ts: .NET Framework ToString("0") / ("0%") / ("0.0") from the double's 15 significant digits.
//  - Galaxy.cs 2196 ResolveRaceBonuses / 2234-2312 ResolveEmpireAbilityBonusDescription*: every race's ability lines.
//  - Empire.cs 2897 ReviewEmpireAbilityBonuses: the lines for every race's bonus at every population share.
//  - The NewEmpireRaceAbility event of all four C# senders (events.ts sendNewEmpireRaceAbilityEvent) for every race.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { loadTextLeakContext, textLeak, FLOAT_TAIL, type TextLeakContext } from './helpers/textLeak';
import type { GameData } from '../src/sim/data/gameData';
import type { Race } from '../src/sim/data/races';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import type { Habitat } from '../src/sim/types';
import { HabitatCategoryType } from '../src/sim/types';
import { EventMessageType } from '../src/sim/eventTypes';
import { sendNewEmpireRaceAbilityEvent } from '../src/sim/events';
import { formatNet0, formatNetFixed, formatNetGrouped0, formatNetPercent0 } from '../src/sim/netNumberFormat';
import { resolveDescription } from '../src/sim/messages';
import { TroopType } from '../src/sim/cargo';
import { HabitatType, IndustryType } from '../src/sim/types';
import { generateAutomationMessageColonization, generateRetrofitRecommendationText } from '../src/sim/construction/empireConstruction';
import { TradeableItem, TradeableItemType } from '../src/sim/tradeItems';
import { Empire as EmpireClass } from '../src/sim/empire';
import { Habitat as HabitatClass } from '../src/sim/types';
import { GalaxyLocation } from '../src/sim/galaxyLocation';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { pirateBaseBonusAbandonedShipText, pirateBaseBonusExplorationText, pirateBaseBonusFactionJoinsText, pirateBaseBonusMoneyText } from '../src/sim/combat/pirateBaseBonusText';
import {
    generateAutomationMessagePiratesAttackPirates,
    generateAutomationMessagePiratesMission,
    generateAutomationMessageRaidBase,
    generateAutomationMessageRaidColony,
} from '../src/sim/pirates/pirateFleets';
import type { EmpireActivity } from '../src/sim/pirates/empireActivity';
import type { BuiltObject } from '../src/sim/builtObject';
import type { ShipGroup } from '../src/sim/fleets/shipGroup';
import type { TechNode } from '../src/sim/researchSystem';
import { formatNet, getText, resolveGameText } from '../src/sim/textResolver';
import {
    resolveEmpireAbilityBonusDescriptionEspionage,
    resolveEmpireAbilityBonusDescriptionResearch,
    resolveEmpireAbilityBonusDescriptionResourceExtraction,
    resolveEmpireAbilityBonusDescriptionShipMaintenance,
    resolveEmpireAbilityBonusDescriptionTrade,
    resolveRaceBonuses,
    reviewEmpireAbilityBonusesFull,
} from '../src/sim/treasury';

let gameData: GameData;
let ctx: TextLeakContext;

beforeAll(async () => {
    gameData = await loadGameDataFs(); // loads the GameText table (textResolver.ts)
    ctx = loadTextLeakContext();
}, 180000);

function expectShown(what: string, text: string): void {
    expect(textLeak(text, ctx), `${what}: ${JSON.stringify(text)}`).toBeNull();
}

/** The five bonuses ReviewEmpireAbilityBonuses grants: race field, empire field, resolver, GameText tag, sign. */
const EMPIRE_BONUSES = [
    { race: 'shipMaintenanceSavings', resolve: resolveEmpireAbilityBonusDescriptionShipMaintenance, tag: 'Ship Maintenance Ability Bonus', sign: '-' },
    { race: 'resourceExtractionBonus', resolve: resolveEmpireAbilityBonusDescriptionResourceExtraction, tag: 'Resource Extraction Ability Bonus', sign: '+' },
    { race: 'researchBonus', resolve: resolveEmpireAbilityBonusDescriptionResearch, tag: 'Research Ability Bonus', sign: '+' },
    { race: 'espionageBonus', resolve: resolveEmpireAbilityBonusDescriptionEspionage, tag: 'Espionage Ability Bonus', sign: '+' },
    { race: 'tradeBonus', resolve: resolveEmpireAbilityBonusDescriptionTrade, tag: 'Trade Ability Bonus', sign: '+' },
] as const;

/** The empire fields ReviewEmpireAbilityBonuses reads and writes (Empire.cs _ShipMaintenanceSavings … + …Race). */
function abilityEmpire(dominantRace: Race, colonies: Array<Array<{ race: Race; amount: number }>>): Empire {
    return {
        dominantRace,
        colonies: colonies.map((pops) => ({ population: { items: pops } })),
        shipMaintenanceSavings: 0,
        shipMaintenanceSavingsRace: null,
        resourceExtractionBonus: 0,
        resourceExtractionBonusRace: null,
        researchBonus: 0,
        researchBonusRace: null,
        espionageBonus: 0,
        espionageBonusRace: null,
        tradeBonus: 0,
        tradeBonusRace: null,
    } as unknown as Empire;
}
const abilityGalaxy = { independentEmpire: null } as unknown as Galaxy;

describe('netNumberFormat: .NET Framework custom numeric formats', () => {
    it('ToString("0%") rounds the 15-significant-digit value half away from zero', () => {
        expect(formatNetPercent0(0.010000000000000002)).toBe('1%');
        expect(formatNetPercent0(0.01)).toBe('1%');
        expect(formatNetPercent0(0.145)).toBe('15%'); // 0.145 * 100 = 14.499999999999998 in binary
        expect(formatNetPercent0(0.005)).toBe('1%');
        expect(formatNetPercent0(0.0049)).toBe('0%');
        expect(formatNetPercent0(0.6)).toBe('60%');
        expect(formatNetPercent0(1)).toBe('100%');
        expect(formatNetPercent0(12.5)).toBe('1250%');
        expect(formatNetPercent0(0)).toBe('0%');
        expect(formatNetPercent0(-0.004)).toBe('0%');
        expect(formatNetPercent0(-0.255)).toBe('-26%');
        expect(formatNetPercent0(0.30000000000000004)).toBe('30%');
    });
    it('ToString("0") / ("0.0") / ("0.00")', () => {
        expect(formatNet0(2.5)).toBe('3');
        expect(formatNet0(-2.5)).toBe('-3');
        expect(formatNet0(0.4999999999999999)).toBe('1'); // 15 digits: 0.500000000000000
        expect(formatNet0(1234567.89)).toBe('1234568');
        expect(formatNet0(0.3)).toBe('0');
        expect(formatNet0(-0.3)).toBe('0');
        expect(formatNetFixed(1.25, 1)).toBe('1.3');
        expect(formatNetFixed(0.05, 1)).toBe('0.1');
        expect(formatNetFixed(0.04, 1)).toBe('0.0');
        expect(formatNetFixed(-1.25, 1)).toBe('-1.3');
        expect(formatNetFixed(3, 2)).toBe('3.00');
        expect(formatNetFixed(1e-7, 2)).toBe('0.00');
        expect(formatNetFixed(99.995, 2)).toBe('100.00');
    });
    it('ToString("###,###,###,##0")', () => {
        expect(formatNetGrouped0(0)).toBe('0');
        expect(formatNetGrouped0(999.5)).toBe('1,000');
        expect(formatNetGrouped0(1234567.4)).toBe('1,234,567');
        expect(formatNetGrouped0(-25000)).toBe('-25,000');
    });
});

describe('textkeys: ability bonus texts (Galaxy.ResolveEmpireAbilityBonusDescription*)', () => {
    it('the reported popup line: Haakonish espionage at 0.010000000000000002', () => {
        expect(resolveEmpireAbilityBonusDescriptionEspionage(0.010000000000000002)).toBe('Cunning Schemers: better spies +1%');
        expect(resolveEmpireAbilityBonusDescriptionEspionage(0)).toBe('');
        // The checker flags the text the popup showed before the fix, and its parts.
        expect(textLeak('imparting new special abilities to us:\n\nEmpireAbilityBonusEspionage|0.010000000000000002', ctx)).not.toBeNull();
        expect(textLeak('EmpireAbilityBonusEspionage', ctx)).not.toBeNull();
        expect(textLeak('Cunning Schemers: better spies +0.010000000000000002', ctx)).not.toBeNull();
    });

    it('every race: ResolveRaceBonuses lines', () => {
        let lines = 0;
        for (const race of gameData.races) {
            const list = resolveRaceBonuses(race);
            const positive = ['espionageBonus', 'researchBonus', 'resourceExtractionBonus', 'satisfactionModifier', 'shipMaintenanceSavings', 'troopMaintenanceSavings', 'warWearinessAttenuation', 'tradeBonus'].filter(
                (k) => (race as unknown as Record<string, number>)[k] > 0,
            );
            expect(list.length, race.name).toBe(positive.length);
            for (const line of list) {
                expectShown(`${race.name} race bonus`, line);
                expect(line, race.name).toMatch(/^[^|{}]+ [+-]\d+%$/);
                lines++;
            }
        }
        expect(lines).toBeGreaterThan(10);
    });

    it('every race and population share: ReviewEmpireAbilityBonuses lines, one per bonus, C# rounding', () => {
        const dominant = gameData.races.find((r) => EMPIRE_BONUSES.every((b) => (r as unknown as Record<string, number>)[b.race] === 0))!;
        expect(dominant).toBeDefined();
        let checked = 0;
        let multi = 0;
        for (const race of gameData.races) {
            if (race === dominant) continue;
            // Shares (Empire.cs 2933-2938: list[k] / (num6 / 5), at least 0.1, at most 1) that produce float tails.
            for (const [raceAmount, otherAmount] of [
                [10_000_000, 990_000_000], // floor 0.1
                [30_000_000, 70_000_000], // 0.3 / 5 → 0.30000000000000004-style products
                [11_000_000, 189_000_000], // 0.275
                [29_000_000, 1_000_000_000 - 29_000_000], // 0.145
                [33_333_333, 66_666_667],
                [1_000_000_000, 0], // capped at 1
            ]) {
                const empire = abilityEmpire(dominant, [[{ race, amount: raceAmount }], otherAmount > 0 ? [{ race: dominant, amount: otherAmount }] : []]);
                const r = reviewEmpireAbilityBonusesFull(abilityGalaxy, empire);
                const expected = EMPIRE_BONUSES.filter((b) => (race as unknown as Record<string, number>)[b.race] > 0);
                expect(r.descriptions.length, race.name).toBe(expected.length);
                if (expected.length > 0) expect(r.raceChanged).toBe(race);
                if (expected.length > 1) multi++;
                const e = empire as unknown as Record<string, number>; // the empire fields share the race fields' names
                r.descriptions.forEach((line, i) => {
                    const b = expected[i];
                    expectShown(`${race.name} ${b.tag}`, line);
                    expect(line).toBe(formatNet(getText(b.tag), [b.sign + formatNetPercent0(e[b.race])]));
                    checked++;
                });
            }
        }
        expect(checked).toBeGreaterThan(20);
        // Races with several bonuses get one line per bonus (races.txt has some).
        expect(multi).toBeGreaterThan(0);
    });

    it('every sender of the NewEmpireRaceAbility event, for every race with bonuses', () => {
        const senders = [
            { tag: 'Colonization Race Ability Bonus', suffix: ':\n' }, // BuiltObject.2.cs 1074
            { tag: 'Conquest New Race Ability', suffix: '\n' }, // Habitat.cs 4287
            { tag: 'Conquest New Race Ability Militia', suffix: '\n' }, // Habitat.cs 4290
            { tag: 'Revolt New Race Ability', suffix: '\n' }, // Habitat.cs 5975
            { tag: 'The recent revolt PLANETTYPE NAME RACE', suffix: ':\n' }, // Empire.cs 4861
        ];
        const received: Array<{ type: EventMessageType; title: string; message: string }> = [];
        const empire = { eventMessageRecipient: { receiveEventMessage: (type: EventMessageType, title: string, message: string) => received.push({ type, title, message }) } } as unknown as Empire;
        const habitat = { category: HabitatCategoryType.Planet, name: 'Haako 2' } as unknown as Habitat;
        const dominant = gameData.races.find((r) => EMPIRE_BONUSES.every((b) => (r as unknown as Record<string, number>)[b.race] === 0))!;
        let sent = 0;
        for (const race of gameData.races) {
            const { descriptions } = reviewEmpireAbilityBonusesFull(abilityGalaxy, abilityEmpire(dominant, [[{ race, amount: 13_000_000 }], [{ race: dominant, amount: 87_000_000 }]]));
            if (descriptions.length === 0) continue;
            for (const s of senders) {
                received.length = 0;
                sendNewEmpireRaceAbilityEvent(empire, s.tag, s.suffix, habitat, race, descriptions);
                expect(received.length).toBe(1);
                const ev = received[0];
                expect(ev.type).toBe(EventMessageType.NewEmpireRaceAbility);
                // As the event panel shows them (resolveGameText of title and text).
                const title = resolveGameText(ev.title);
                const message = resolveGameText(ev.message);
                expectShown(`${s.tag} title`, title);
                expectShown(`${s.tag} (${race.name})`, message);
                expect(title).toBe('New Ability for our Empire');
                const lines = message.split('\n');
                expect(lines[0]).toBe(formatNet(getText(s.tag), ['planet', 'Haako 2', race.name]) + (s.suffix === ':\n' ? ':' : ''));
                expect(lines[1]).toBe('');
                expect(lines.slice(2)).toEqual(descriptions);
                for (const l of lines.slice(2)) expect(l).not.toMatch(FLOAT_TAIL);
                sent++;
            }
        }
        expect(sent).toBeGreaterThan(10);
    });

    it('the reported popup, end to end: colonizing Haako 2 brings the Haakonish espionage bonus', () => {
        const haakonish = gameData.races.find((r) => r.name === 'Haakonish')!;
        expect(haakonish.espionageBonus).toBeGreaterThan(0);
        const dominant = gameData.races.find((r) => EMPIRE_BONUSES.every((b) => (r as unknown as Record<string, number>)[b.race] === 0))!;
        // The Haakonish at the 0.1 share floor: 10 / 100 × 0.1 → 0.010000000000000002.
        const { descriptions, raceChanged } = reviewEmpireAbilityBonusesFull(abilityGalaxy, abilityEmpire(dominant, [[{ race: haakonish, amount: 10_000_000 }], [{ race: dominant, amount: 990_000_000 }]]));
        expect(raceChanged).toBe(haakonish);
        let message = '';
        const empire = { eventMessageRecipient: { receiveEventMessage: (_t: EventMessageType, _title: string, m: string) => (message = m) } } as unknown as Empire;
        sendNewEmpireRaceAbilityEvent(empire, 'Colonization Race Ability Bonus', ':\n', { category: HabitatCategoryType.Planet, name: 'Haako 2' } as unknown as Habitat, haakonish, descriptions);
        // The Haakonish have two bonuses (ship maintenance 20, espionage 10): one line each, in the C# order.
        expect(resolveGameText(message)).toBe(
            'Our recent colonization of the planet Haako 2 has brought the Haakonish race into our empire, imparting new special abilities to us:\n\n' +
                'Master Engineers: ship maintenance -2%\nCunning Schemers: better spies +1%',
        );
    });
});

describe('textkeys: enum and argument texts found in the same audit', () => {
    it('ResolveDescription(TroopType) / (IndustryType) use their GameText cases (Galaxy.7.cs 5406, Galaxy.2.cs 2327)', () => {
        const troop = TroopType as unknown as Record<number, string>;
        expect(resolveDescription(troop, TroopType.Armored)).toBe('Armored Forces');
        expect(resolveDescription(troop, TroopType.Artillery)).toBe('Planetary Defense Unit');
        expect(resolveDescription(troop, TroopType.SpecialForces)).toBe('Special Forces');
        expect(resolveDescription(troop, TroopType.PirateRaider)).toBe('Pirate Raider');
        expect(resolveDescription(IndustryType as unknown as Record<number, string>, IndustryType.Weapon)).toBe('Weapons');
    });

    it('a template without items ignores surplus deferred arguments, like string.Format', () => {
        expect(resolveGameText('GameEventAction Title UnlockTech|Hyperdrive')).toBe('New Tech unlocked');
        expectShown('UnlockTech title', resolveGameText('GameEventAction Title UnlockTech|Hyperdrive'));
    });

    it('the colonization advisor text names the planet type and category (Empire.10.cs 3646)', () => {
        const star = { name: 'Sol' };
        const galaxy = { determineHabitatSystemStar: () => star } as unknown as Galaxy;
        const target = { name: 'Earth', type: HabitatType.Continental, category: HabitatCategoryType.Planet } as unknown as Habitat;
        const text = generateAutomationMessageColonization(galaxy, target, { name: 'Colony Ship 1' } as never, null);
        expectShown('Automation Colonization Existing Ship', text);
        expect(text).toBe(formatNet(getText('Automation Colonization Existing Ship'), ['continental', 'planet', 'Earth', 'Sol', 'Colony Ship 1']));
    });
});

/** A plain object that passes `instanceof Class` (the texts only read names / positions). */
function fake<T>(cls: { prototype: T }, fields: Record<string, unknown>): T {
    return Object.assign(Object.create(cls.prototype as object), fields) as T;
}

describe('textkeys: trade, pirate-base, pirate advisor and retrofit texts', () => {
    // A galaxy of 10 × 10 sectors (Galaxy.SectorSize 2,000,000) whose habitats' system star is their parent.
    const galaxy = {
        sectorSize: 2_000_000,
        sectorWidth: 10,
        sectorHeight: 10,
        independentEmpire: null as unknown,
        determineHabitatSystemStar: (h: { parent?: unknown }) => h.parent ?? h,
        researchStatic: { componentsById: new Map([[7, { name: 'Shockwave Torpedo' }], [9, { name: 'Ion Shield' }]]) },
    } as unknown as Galaxy;
    const sol = fake(HabitatClass, { name: 'Sol', category: HabitatCategoryType.Star, type: HabitatType.MainSequence, xpos: 5_000_000, ypos: 3_000_000, parent: null });
    const earth = fake(HabitatClass, { name: 'Earth', category: HabitatCategoryType.Planet, type: HabitatType.Continental, xpos: 5_000_100, ypos: 3_000_000, parent: sol, empire: null });
    const enemy = fake(EmpireClass, { name: 'Ackdarian Empire' });
    const pirates = fake(EmpireClass, { name: 'Black Raiders' });
    const station = { name: 'Raider Base', xpos: 5_000_200, ypos: 3_000_000, nearestSystemStar: sol, parentHabitat: earth, empire: pirates, subRole: BuiltObjectSubRole.SmallSpacePort } as unknown as BuiltObject;
    const fleet = { name: '1st Raid Fleet' } as unknown as ShipGroup;

    it('TradeableItem.ToString: every item type uses its GameText format (TradeableItem.cs 36-140)', () => {
        const items: Array<[TradeableItemType, unknown, number]> = [
            [TradeableItemType.Money, 12345.6, 12345],
            [TradeableItemType.Colony, earth, 250000],
            [TradeableItemType.Base, station, 1234567],
            [TradeableItemType.TerritoryMap, null, 5000],
            [TradeableItemType.GalaxyMap, null, 9000],
            [TradeableItemType.AdoptGovernmentStyle, { name: 'Democracy', governmentId: 3 }, 1000],
            [TradeableItemType.ThreatenWar, null, 0],
            [TradeableItemType.DeclareWarOther, enemy, 20000],
            [TradeableItemType.ThreatenTradeSanctions, null, 0],
            [TradeableItemType.InitiateTradeSanctionsOther, enemy, 15000],
            [TradeableItemType.EndWar, null, 3000],
            [TradeableItemType.EndWarOther, enemy, 3000],
            [TradeableItemType.LiftTradeSanctions, null, 2000],
            [TradeableItemType.LiftTradeSanctionsOther, enemy, 2000],
            [TradeableItemType.ResearchProject, { def: { name: 'Hyperdrive' } }, 45000],
            [TradeableItemType.ContactEmpire, enemy, 10000],
            [TradeableItemType.SecretLocation, fake(GalaxyLocation, { name: 'Ancient Ruins' }), 30000],
            [TradeableItemType.SystemMap, sol, 2000],
            [TradeableItemType.IndependentColonyLocation, earth, 20000],
        ];
        const enumNames = new Set(Object.keys(TradeableItemType).filter((k) => Number.isNaN(Number(k))));
        for (const [type, item, value] of items) {
            for (const showValue of [true, false]) {
                const text = new TradeableItem(type, item, value).toString(showValue, galaxy);
                const what = `${TradeableItemType[type]} (${showValue})`;
                expectShown(what, text);
                expect(text.length, what).toBeGreaterThan(0);
                for (const w of text.split(/[\s(),]+/)) expect(enumNames.has(w) && /[a-z][A-Z]/.test(w), `${what}: ${text}`).toBe(false);
            }
        }
        expect(new TradeableItem(TradeableItemType.Money, 12345.6, 12345).toString(true, galaxy)).toBe(formatNet(getText('Trade Description Money'), ['12,346']));
        expect(new TradeableItem(TradeableItemType.Base, station, 1234567).toString(true, galaxy)).toBe('Raider Base (Sol system, sector C2) (1,234,567)');
        expect(new TradeableItem(TradeableItemType.Colony, earth, 250000).toString(false, galaxy)).toBe(formatNet(getText('Trade Description Colony NAME PLANETTYPE SYSTEMNAME'), ['Earth', resolveDescription(HabitatType as unknown as Record<number, string>, HabitatType.Continental), 'Sol']));
        const hidden = new TradeableItem(TradeableItemType.SecretLocation, fake(GalaxyLocation, { name: 'Ancient Ruins' }), 30000);
        hidden.showSecretLocationNames = false;
        expect(hidden.toString(false, galaxy)).toBe(getText('Secret Location'));
    });

    it('pirate-base destruction bonus events (BuiltObject.2.cs 5022-5100 / Fighter.cs 979-1057)', () => {
        const wreck = { name: 'Old Cruiser', xpos: 7_100_000, ypos: 9_500_000, subRole: BuiltObjectSubRole.Cruiser } as unknown as BuiltObject;
        const race = gameData.races[0];
        const texts = [
            pirateBaseBonusAbandonedShipText(galaxy, station, wreck, sol),
            pirateBaseBonusMoneyText(station, 4321.987654321),
            pirateBaseBonusFactionJoinsText(station, pirates),
            pirateBaseBonusExplorationText(galaxy, station, earth, race),
        ];
        for (const t of texts) {
            expectShown('pirate base bonus title', t.title);
            expectShown('pirate base bonus message', t.message);
        }
        expect(texts[0].message).toContain('abandoned cruiser named Old Cruiser');
        expect(texts[0].message).toContain('the Sol system in sector D5');
        expect(texts[1].message).toContain('totals to 4322 credits'); // num5.ToString("#0")
        expect(texts[3].title).toBe(`Independent Colony of ${race.name}s`);
        expect(texts[3].message).toContain('the Sol system in sector C2');
    });

    it('pirate advisor texts (Empire.10.cs 3861-3960)', () => {
        const requester = fake(EmpireClass, { name: 'Haakonish Republic' });
        const mission = { target: station, targetEmpire: enemy, requestingEmpire: requester } as unknown as EmpireActivity;
        const colony = fake(HabitatClass, { name: 'Mars', category: HabitatCategoryType.Planet, type: HabitatType.Desert, parent: sol, empire: enemy });
        const independent = fake(HabitatClass, { name: 'Titan', category: HabitatCategoryType.Moon, type: HabitatType.Ice, parent: sol, empire: null });
        const g = { ...galaxy, independentEmpire: null, determineHabitatSystemStar: () => sol } as unknown as Galaxy;
        const texts = [
            generateAutomationMessagePiratesMission(g, 'Automation Pirate Attack Mission', mission, fleet),
            generateAutomationMessagePiratesMission(g, 'Automation Pirate Defend Mission', mission, fleet),
            generateAutomationMessagePiratesAttackPirates(g, station, fleet),
            generateAutomationMessageRaidBase(g, station, fleet),
            generateAutomationMessageRaidColony(g, colony, fleet),
            generateAutomationMessageRaidColony(g, independent, fleet), // empire null === IndependentEmpire (null here)
        ];
        for (const t of texts) expectShown('pirate advisor', t);
        expect(texts[0]).toBe(formatNet(getText('Automation Pirate Attack Mission'), ['Haakonish Republic', 'Raider Base', 'Ackdarian Empire', 'Sol', '1st Raid Fleet']));
        expect(texts[2]).toBe(formatNet(getText('Automation Pirate Attack Pirate'), ['Black Raiders', 'Raider Base', 'Sol', '1st Raid Fleet']));
        expect(texts[5]).toBe(formatNet(getText('Automation Raid Independent Colony'), ['Titan', 'Sol', '1st Raid Fleet']));
    });

    it('retrofit advisor text: the unlocked components, then the cost (Empire.6.cs 3418-3448)', () => {
        const projects = [{ def: { components: [7, 9] } }, { def: { components: [] } }] as unknown as TechNode[];
        const withComponents = generateRetrofitRecommendationText(galaxy, projects, false, 123456.7);
        expectShown('retrofit', withComponents);
        expect(withComponents).toBe(formatNet(getText('Retrofit Recommendation Message Components'), ['    Shockwave Torpedo\n    Ion Shield\n']) + formatNet(getText('Retrofit Recommendation Explanation'), ['123,457']));
        const plain = generateRetrofitRecommendationText(galaxy, [], true, 999);
        expect(plain).toBe(getText('Retrofit Recommendation Message') + formatNet(getText('Retrofit Recommendation Explanation Partial'), ['999']));
    });
});
