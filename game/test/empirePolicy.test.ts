// Task 17d: Empire Policy panel model (Main.Part3.cs method_609 fill / method_597 apply) and the human player's
// new-game automation defaults (Start.2.cs 2122-2146 from Main.Part9.cs method_260).
import { beforeAll, describe, expect, it } from 'vitest';
import { AutomationLevel, type Empire } from '../src/sim/empire';
import { ComponentType } from '../src/sim/data/components';
import { ColonyPopulationPolicy, ComponentCategoryType, defaultEmpirePolicy, resolveTechFocuses } from '../src/sim/data/policies';
import { BuiltObjectFleeWhen } from '../src/sim/data/designTemplates';
import { IndustryType } from '../src/sim/types';
import { DEFAULT_GAME_OPTIONS_AUTOMATION } from '../src/sim/game';
import type { GameData } from '../src/sim/data/gameData';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import {
    applyPolicyPanel,
    buildPolicyPanel,
    fleeWhenIndex,
    levelIndex,
    panelControls,
    priorityIndex,
    readLevel,
    readPriority,
    resolveTechFocusIndexType,
    type ComboControl,
    type PolicyControl,
    type PolicyPanelContext,
} from '../src/ui/screens/empirePolicyModel';

const ctx: PolicyPanelContext = { facilities: [{ facilityId: 0, name: 'Troop Academy' }, { facilityId: 1, name: 'Wonder A' }, { facilityId: 2, name: 'Wonder B' }] };

/** A stand-in for the player's Empire with only the fields the panel reads/writes. */
function fakeEmpire(pirate = false, ownsColony = false): Empire {
    const e = {
        pirateEmpireBaseHabitat: pirate ? {} : null,
        colonies: [] as unknown[],
        controlColonization: AutomationLevel.FullyAutomated,
        controlColonyFacilities: AutomationLevel.FullyAutomated,
        controlColonyTaxRates: true,
        controlDiplomacyGifts: AutomationLevel.FullyAutomated,
        controlDiplomacyOffense: AutomationLevel.FullyAutomated,
        controlDiplomacyTreaties: AutomationLevel.FullyAutomated,
        controlTroopGeneration: true,
        controlAgentAssignment: AutomationLevel.FullyAutomated,
        controlDesigns: true,
        controlMilitaryAttacks: AutomationLevel.FullyAutomated,
        controlMilitaryFleets: true,
        controlResearch: true,
        controlStateConstruction: AutomationLevel.FullyAutomated,
    };
    if (ownsColony) e.colonies.push({ owner: e });
    return e as unknown as Empire;
}

function comboOf(controls: Map<string, PolicyControl>, name: string): ComboControl {
    const c = controls.get(name);
    if (c === undefined || c.kind !== 'combo') throw new Error(`no combo ${name}`);
    return c;
}

describe('17d empire policy panel model', () => {
    it('groups rows under the original header bands in method_609 order', () => {
        const sections = buildPolicyPanel(fakeEmpire(), defaultEmpirePolicy(), ctx);
        expect(sections.map((s) => s.title)).toEqual([
            'Diplomacy - Treaties',
            'Diplomacy - War and Trade Sanctions',
            'Diplomacy - Gifts',
            'Economy and Trade',
            'Intelligence - Mission Assignment',
            'Colonization',
            'Colonies - Facility Building',
            'Colonies - Tax Rates',
            'Research & Design',
            'Construction',
            'Troop Recruitment',
            'War & Attacks',
            'Boarding & Capture',
            'Fleet Formation',
        ]);
        const controls = panelControls(sections);
        // 13 automation combos (method_597 reads 13 Automation* controls).
        expect([...controls.keys()].filter((k) => k.startsWith('Automation')).length).toBe(13);
        const gifts = controls.get('DiplomacySendGiftsUpToAmount');
        expect(gifts).toEqual({ kind: 'numeric', min: 0, max: 100000, value: 20000 });
        expect(controls.get('FleetMilitaryProportionForFleets')).toEqual({ kind: 'numeric', min: 20, max: 80, value: 60 });
        expect(controls.get('TroopDefaultTransportLoadoutInfantry')).toEqual({ kind: 'numeric', min: 0, max: 100, value: 25 });
        expect(comboOf(controls, 'TradePriority').options.length).toBe(4);
        expect(comboOf(controls, 'TroopRecruitInfantryLevel').options.length).toBe(3);
        expect(comboOf(controls, 'ResearchDesignTechFocus1').options.length).toBe(34);
        expect(comboOf(controls, 'PrioritizeBuildWonderId').options).toEqual(['None', 'Troop Academy', 'Wonder A', 'Wonder B']);
        expect(comboOf(controls, 'AutomationTreaties').index).toBe(AutomationLevel.FullyAutomated);
        expect(comboOf(controls, 'AutomationResearch').index).toBe(1);
    });

    it('apply(fill(defaults)) reproduces the default EmpirePolicy except the controls a non-pirate panel lacks (method_597)', () => {
        const e = fakeEmpire();
        const p = defaultEmpirePolicy();
        const out = applyPolicyPanel(e, false, panelControls(buildPolicyPanel(e, p, ctx)), ctx);
        // The Pirates band only exists for a pirate empire: method_603 reads its absent check boxes as false.
        expect(out).toEqual({ ...p, bidOnPirateAttackMissions: false, bidOnPirateDefendMissions: false, acceptPirateSmugglingMissions: false });
        expect(e.controlDiplomacyTreaties).toBe(AutomationLevel.FullyAutomated);
        expect(e.controlResearch).toBe(true);
    });

    it('fill / read-back conversions match method_616-618 and method_599/606/608', () => {
        expect(priorityIndex(0.5, 4)).toBe(0);
        expect(priorityIndex(1.2, 4)).toBe(1);
        expect(priorityIndex(1.5, 4)).toBe(2);
        expect(priorityIndex(4.0, 4)).toBe(3);
        expect(priorityIndex(2.0, 3)).toBe(-1); // no selection on a 3-item combo
        expect(levelIndex(0, 4)).toBe(0);
        expect(levelIndex(0.5, 4)).toBe(1);
        expect(levelIndex(1.0, 4)).toBe(2);
        expect(levelIndex(1.5, 4)).toBe(3);
        expect(levelIndex(2.0, 4)).toBe(-1);
        expect(fleeWhenIndex(BuiltObjectFleeWhen.Never, 3)).toBe(0);
        expect(fleeWhenIndex(BuiltObjectFleeWhen.Armor50, 3)).toBe(1);
        const m = new Map<string, PolicyControl>([
            ['A', { kind: 'combo', reader: 'priority', options: ['a', 'b', 'c', 'd'], index: 3 }],
            ['B', { kind: 'combo', reader: 'priority', options: ['a', 'b', 'c'], index: -1 }],
            ['C', { kind: 'combo', reader: 'level', options: ['a', 'b', 'c', 'd'], index: 1 }],
        ]);
        expect(readPriority(m, 'A')).toBe(2.0);
        expect(readPriority(m, 'B')).toBe(1.0);
        expect(readLevel(m, 'C')).toBe(0.5);
        expect(readLevel(m, 'missing')).toBe(1.0);
    });

    it('applies edited controls through the method_597 conversions', () => {
        const e = fakeEmpire();
        const controls = panelControls(buildPolicyPanel(e, defaultEmpirePolicy(), ctx));
        comboOf(controls, 'AutomationTreaties').index = 0;
        comboOf(controls, 'AutomationConstruction').index = 1;
        comboOf(controls, 'AutomationResearch').index = 0;
        comboOf(controls, 'AutomationColonyTaxRates').index = 0;
        comboOf(controls, 'TradePriority').index = 3;
        comboOf(controls, 'ResearchIndustryFocus').index = 2;
        comboOf(controls, 'ResearchDesignTechFocus1').index = 2; // Phasers → a ComponentType focus
        comboOf(controls, 'ResearchDesignTechFocus2').index = 11; // Shields → a category focus
        comboOf(controls, 'NewColonyPopulationPolicyAllRaces').index = 3;
        comboOf(controls, 'DefaultMilitaryFleeWhen').index = 2;
        comboOf(controls, 'PrioritizeBuildWonderId').index = 2;
        (controls.get('TroopDefaultTransportLoadoutArmor') as { value: number }).value = 40;
        (controls.get('FleetTypicalSize') as { value: number }).value = 7;
        (controls.get('BuildPlanetDestroyers') as { checked: boolean }).checked = true;
        const p = applyPolicyPanel(e, false, controls, ctx);
        expect(e.controlDiplomacyTreaties).toBe(AutomationLevel.Undefined);
        expect(e.controlStateConstruction).toBe(AutomationLevel.PartiallyAutomated);
        expect(e.controlResearch).toBe(false);
        expect(e.controlColonyTaxRates).toBe(false);
        expect(p.tradePriority).toBe(2.0);
        expect(p.researchIndustryFocus).toBe(IndustryType.Energy);
        expect(p.researchDesignTechFocusType1).toBe(ComponentType.WeaponPhaser);
        expect(p.researchDesignTechFocus1).toBe(ComponentCategoryType.Undefined);
        expect(p.researchDesignTechFocus2).toBe(ComponentCategoryType.Shields);
        expect(resolveTechFocuses(p)).toEqual({ categories: [ComponentCategoryType.Shields], types: [ComponentType.WeaponPhaser] });
        expect(p.newColonyPopulationPolicyAllRaces).toBe(ColonyPopulationPolicy.Enslave);
        expect(p.defaultMilitaryFleeWhen).toBe(BuiltObjectFleeWhen.Shields50);
        expect(p.prioritizeBuildWonderId).toBe(1);
        expect(p.troopDefaultTransportLoadoutArmor).toBe(Math.fround(0.4));
        expect(p.fleetTypicalSize).toBe(7);
        expect(p.buildPlanetDestroyers).toBe(true);
        // A super-weapon focus has no ResolveTechFocusIndex entry: reopening the panel shows None (Galaxy.4.cs 490).
        expect(resolveTechFocusIndexType(ComponentType.WeaponSuperBeam)).toBe(0);
    });

    it('a pirate player keeps its colony/diplomacy/troop automation and hidden rows read back as the fallbacks', () => {
        const e = fakeEmpire(true, false);
        e.controlColonization = AutomationLevel.PartiallyAutomated;
        const sections = buildPolicyPanel(e, defaultEmpirePolicy(), ctx);
        const titles = sections.map((s) => s.title);
        expect(titles).not.toContain('Diplomacy - Treaties');
        expect(titles).not.toContain('Colonization');
        expect(titles).not.toContain('Troop Recruitment');
        expect(titles).toContain('Pirates');
        const controls = panelControls(sections);
        expect(controls.has('PirateSmugglerFreighterLevel')).toBe(true);
        expect(controls.has('ConstructionSpaceportSmallColonyPopulationThreshold')).toBe(false);
        comboOf(controls, 'AutomationAgentAssignment').index = 0;
        const p = applyPolicyPanel(e, true, controls, ctx);
        expect(e.controlColonization).toBe(AutomationLevel.PartiallyAutomated); // method_597 skips it for a pirate player
        expect(e.controlAgentAssignment).toBe(AutomationLevel.Undefined);
        expect(p.tradePriority).toBe(1.0); // method_608 fallback
        expect(p.diplomacySendGiftsUpToAmount).toBe(0); // method_604 fallback
        expect(p.colonyTaxRateMediumColony).toBe(0); // method_605 fallback
        expect(p.colonyAllowFacilitySpyAcademy).toBe(false); // method_603 fallback
        expect(p.prioritizeBuildWonderId).toBe(-1); // method_598 fallback
        expect(p.newColonyPopulationPolicyYourRaceFamily).toBe(ColonyPopulationPolicy.Assimilate);
        // A pirate with an owned colony gets the colony bands back (flag2).
        const withColony = buildPolicyPanel(fakeEmpire(true, true), defaultEmpirePolicy(), ctx).map((s) => s.title);
        expect(withColony).toContain('Colonization');
        expect(withColony).toContain('Troop Recruitment');
        expect(withColony).not.toContain('Diplomacy - Gifts');
    });
});

describe('17d human player automation defaults (Start.2.cs 2122-2146)', () => {
    let gameData: GameData;
    beforeAll(async () => {
        gameData = await loadGameDataFs();
    });

    it('a new game gives the human the method_260 GameOptions defaults and leaves AI empires FullyAutomated', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        expect(p).toBe(game.galaxy.playerEmpire);
        expect(p.controlAgentAssignment).toBe(AutomationLevel.PartiallyAutomated);
        expect(p.controlMilitaryAttacks).toBe(AutomationLevel.PartiallyAutomated);
        expect(p.controlColonization).toBe(AutomationLevel.FullyAutomated);
        expect(p.controlColonyTaxRates).toBe(true);
        expect(p.controlDiplomacyGifts).toBe(AutomationLevel.Undefined);
        expect(p.controlMilitaryFleets).toBe(true);
        expect(p.controlStateConstruction).toBe(AutomationLevel.PartiallyAutomated);
        expect(p.controlDesigns).toBe(true);
        expect(p.controlDiplomacyTreaties).toBe(AutomationLevel.PartiallyAutomated);
        expect(p.controlTroopGeneration).toBe(true);
        expect(p.controlDiplomacyOffense).toBe(AutomationLevel.PartiallyAutomated);
        expect(p.controlResearch).toBe(true);
        expect(p.controlColonyFacilities).toBe(AutomationLevel.PartiallyAutomated);
        expect(p.controlPopulationPolicy).toBe(true);
        expect(p.controlCharacterLocations).toBe(true);
        expect(p.controlOfferPirateMissions).toBe(AutomationLevel.PartiallyAutomated);
        expect(DEFAULT_GAME_OPTIONS_AUTOMATION.controlDiplomaticGiftsDefault).toBe(AutomationLevel.Undefined);
        const ais = game.galaxy.empires.filter((e) => e !== p);
        expect(ais.length).toBeGreaterThan(0);
        for (const e of ais) {
            expect(e.controlStateConstruction).toBe(AutomationLevel.FullyAutomated);
            expect(e.controlDiplomacyTreaties).toBe(AutomationLevel.FullyAutomated);
            expect(e.controlDiplomacyGifts).toBe(AutomationLevel.FullyAutomated);
            expect(e.controlAgentAssignment).toBe(AutomationLevel.FullyAutomated);
            expect(e.controlColonyFacilities).toBe(AutomationLevel.FullyAutomated);
            expect(e.controlMilitaryAttacks).toBe(AutomationLevel.FullyAutomated);
        }
    }, 300000);
});
