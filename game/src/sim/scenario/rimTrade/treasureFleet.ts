// Scenario package 19a addendum — the Concord's treasure fleet and stagnation (tasks/19-mod-layer-scenarios.md "19a
// addendum", tasks/M4-deferred-plan.md "19a follow-up"). Not a port: every stock call it makes is ported code.
//   Tech: the Concord starts at wizard tech level `rimTraderTechLevel` (createEmpireMidGame techLevel; Galaxy.7.cs
//     GenerateEmpire → ResearchSystem.SetTechTreeLevel) with the Ship Construction line (research.txt projects 105-112,
//     "ABILITIES ;Increased Construction Size, 2, <level>, <size>" = 230/300/400/500/650/800/1100/1500) researched up to
//     `rimTraderConstructionLevel`; research stops per industry once it holds a project of level `rimTraderResearchCap`
//     (the construction line excluded) — the researchFrozen query at Empire.3.cs PerformResearch.
//   Treasure fleet: Treasure Ships (designTemplates/oranthi/treasureship.txt through Empire.GenerateDesignFromSpec,
//     designGeneration.ts 776) plus the Concord's newest escorts, spawned the way Galaxy.8.cs 1474/1546
//     GenerateMilitaryConvoy / GenerateCivilianConvoy (Empire.1.cs 3899 CheckSendShipConvoysViaGateway) spawn a convoy
//     (GenerateNewBuiltObject + a Move mission), sailing one circuit of the nearest foreign space ports; at each stop it
//     buys rim goods and sells rare goods through the rim-trade ledger (the contract hooks of Empire.4.cs 1135
//     InitiateContract). Its ships carry a beacon: visible to every empire (objectVisibleToAll query at Empire.9.cs 3198
//     IsObjectVisibleToThisEmpire), like the original's galaxy-wide reveal (Galaxy.9.cs 1718 RevealObject).
//   Contact: at year `rimTraderContactYear` the Concord broadcasts to every empire it has not met (Galaxy.7.cs 3957
//     DoEmpireEncounter, as when a ship is sighted).
// Rnd: the periodic handler draws (GenerateDesignFromSpec's naming, GenerateNewBuiltObject's parking point / heading,
// DoEmpireEncounter's pre-warp messages); the query and event handlers never draw.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Design } from '../../design';
import type { Habitat } from '../../types';
import { BuiltObject } from '../../builtObject';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { Cargo, ResourceRef } from '../../cargo';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly, scenarioEmit } from '../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { noteVoiceCue, voicesOn } from '../llm/voiceCues';
import { registerScenarioMapFeatures, type ScenarioMapFeatures } from '../mapFeatures';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { EmpireMessageType } from '../../messages';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { abilityTypeFromFile, nodeIndustry, ResearchAbilityType, type TechNode } from '../../researchSystem';
import { IndustryType } from '../../types';
import { loadDesignSpecification, type DesignSpecification } from '../../data/designSpecifications';
import { ComponentType } from '../../data/components';
import { generateDesignFromSpec } from '../../designGeneration';
import { generateNewBuiltObject } from '../../empireEvents';
import { designsFindNewestCanBuild } from '../../forceStructure';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { galaxyResourceCurrentPrices } from '../../design';
import { cargoGetCargo, cargoRemove } from '../../logistics/orders';
import { contractListenersActive, emitContractInitiated } from '../../logistics/contractEvents';
import { doEmpireEncounter } from '../../exploration';
import { isRimTraderAI, rareGoodIds, rimGoodIds, rimTradeState, rimTraderAllowsRestrictedTrade, rimTraderEmpire, rimTraderPort, rimTraderStanding } from './common';

/** Manifest defaults (scenario.json) of the addendum's params. */
export const TREASURE_PARAM_DEFAULTS = {
    rimTraderTechLevel: 4,
    rimTraderConstructionLevel: 7,
    rimTraderResearchCap: 5,
    rimTraderContactYear: 1,
    treasureFleetSize: 6,
    treasureCircuitInterval: 360,
    treasureCircuitPorts: 4,
    treasureShipSize: 1100,
    treasureTradeLot: 200,
    treasureRaidPenalty: 3000,
} as const;

export function treasureParam(galaxy: Galaxy, name: keyof typeof TREASURE_PARAM_DEFAULTS): number {
    return scenarioParam(galaxy, name, TREASURE_PARAM_DEFAULTS[name]);
}

/** A treasure ship docks when its lead ship is this close to the port (world units). */
export const TREASURE_DOCK_RANGE = 2000;
/** Marker / route colour (Oranthi gold). */
export const TREASURE_COLOR = 0xffd24a;

export interface TreasureFleetState {
    /** Star date the package started (contact broadcast timing). */
    startStarDate: number;
    contactDone: boolean;
    /** The Treasure Ship design (kept out of the Concord's design list so its AI never builds it as a freighter). */
    design: Design | null;
    /** The convoy: treasure ships first, then escorts. */
    ships: BuiltObject[];
    treasure: BuiltObject[];
    /** This voyage's ports, in order; the fleet then returns to the Concord port. */
    circuit: BuiltObject[];
    /** Index into circuit of the port sailed to; circuit.length = homeward. */
    leg: number;
    sailing: boolean;
    /** Star date of the last departure (-1: never sailed). */
    lastDeparture: number;
    /** Research cap reached in every industry (set yearly). */
    researchCapped: boolean;
    stats: { voyages: number; stops: number; rimUnits: number; rimValue: number; rareUnits: number; rareValue: number; lost: number };
}

export function treasureState(galaxy: Galaxy): TreasureFleetState {
    return scenarioState<TreasureFleetState>(galaxy, 'rimTreasure', () => ({
        startStarDate: galaxyStarDate(galaxy),
        contactDone: false,
        design: null,
        ships: [],
        treasure: [],
        circuit: [],
        leg: 0,
        sailing: false,
        lastDeparture: -1,
        researchCapped: false,
        stats: { voyages: 0, stops: 0, rimUnits: 0, rimValue: 0, rareUnits: 0, rareValue: 0, lost: 0 },
    }));
}

function hasTreasureState(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && 'rimTreasure' in galaxy.scenario.state;
}

// ---------------------------------------------------------------------------------------------------------------
// Tech (creation) and the research cap
// ---------------------------------------------------------------------------------------------------------------

/** research.txt ABILITIES type 2 (Increased Construction Size): the Ship Construction line. */
export function isConstructionSizeNode(n: TechNode): boolean {
    return n.def.abilities.some((a) => abilityTypeFromFile(a.type) === ResearchAbilityType.ConstructionSize);
}

/** The highest Ship Construction level `empire` has researched (research.txt ability level; 0 = none). */
export function constructionLevel(empire: Empire): number {
    let lvl = 0;
    for (const n of empire.research.techTree) {
        if (!n.isResearched) continue;
        for (const a of n.def.abilities) if (abilityTypeFromFile(a.type) === ResearchAbilityType.ConstructionSize) lvl = Math.max(lvl, a.level);
    }
    return lvl;
}

/** Highest tech level researched in `industry`, the construction line excluded (ResearchNodeList 691 GetHighestResearchedProjectForIndustry). */
export function highestResearchedLevel(empire: Empire, industry: IndustryType): number {
    let lvl = 0;
    for (const n of empire.research.techTree) if (n.isResearched && nodeIndustry(n) === industry && !isConstructionSizeNode(n)) lvl = Math.max(lvl, n.def.techLevel);
    return lvl;
}

/**
 * Creation tech (step 1): tech level `techLevel` (SetTechTreeLevel, as GenerateEmpire does; `apply` false when the
 * empire was just generated with it) and the Ship Construction line up to `rimTraderConstructionLevel` with its parents.
 */
export function applyConcordTech(galaxy: Galaxy, r: Empire, setLevel: boolean): void {
    const race = r.dominantRace;
    const techLevel = treasureParam(galaxy, 'rimTraderTechLevel');
    if (setLevel && techLevel !== 0.5) r.research.setTechTreeLevel(galaxy.rnd, race, techLevel, false);
    const target = Math.trunc(treasureParam(galaxy, 'rimTraderConstructionLevel'));
    const mark = (n: TechNode): void => {
        if (n.isResearched) return;
        n.isResearched = true;
        n.selfResearched = true;
        n.progress = n.cost;
        for (const p of n.parentNodes ?? []) mark(p);
    };
    for (const n of r.research.techTree) {
        if (n.def.abilities.some((a) => abilityTypeFromFile(a.type) === ResearchAbilityType.ConstructionSize && a.level <= target)) mark(n);
    }
    const rs = r.research;
    rs.researchQueueWeapons = rs.researchQueueWeapons.filter((n) => !n.isResearched);
    rs.researchQueueEnergy = rs.researchQueueEnergy.filter((n) => !n.isResearched);
    rs.researchQueueHighTech = rs.researchQueueHighTech.filter((n) => !n.isResearched);
    rs.update(race);
    r.reviewResearchAbilities();
    r.reviewDesignsBuiltObjectsImprovedComponents();
}

/** researchFrozen query: the Concord AI stops researching an industry at the cap (construction line excluded). Pure. */
export function concordResearchFrozen(galaxy: Galaxy, value: boolean, args: { empire: Empire; industry: number }): boolean {
    if (value || !isRimTraderAI(galaxy, args.empire)) return value;
    const cap = treasureParam(galaxy, 'rimTraderResearchCap');
    if (!(cap > 0)) return value;
    return highestResearchedLevel(args.empire, args.industry as IndustryType) >= cap;
}

function yearlyCapCheck(galaxy: Galaxy): void {
    const r = rimTraderEmpire(galaxy);
    if (r === null || !isRimTraderAI(galaxy, r)) return;
    const st = treasureState(galaxy);
    const cap = treasureParam(galaxy, 'rimTraderResearchCap');
    st.researchCapped = cap > 0 && [IndustryType.Weapon, IndustryType.Energy, IndustryType.HighTech].every((i) => highestResearchedLevel(r, i) >= cap);
}

// ---------------------------------------------------------------------------------------------------------------
// Treasure Ship design
// ---------------------------------------------------------------------------------------------------------------

function cargoRuleIndex(spec: DesignSpecification): number {
    return spec.componentRules.findIndex((c) => c.componentType === ComponentType.StorageCargo);
}

/**
 * The Treasure Ship: the scenario template (LargeFreighter hull) through GenerateDesignFromSpec, its cargo bays scaled
 * so the design reaches `treasureShipSize` (≤ the Concord's civilian construction size). Draws Rnd (design naming).
 */
export function generateTreasureShipDesign(galaxy: Galaxy, r: Empire): Design | null {
    const loaded = loadDesignSpecification(galaxy.designSpecificationTexts, 'TreasureShip', BuiltObjectSubRole.LargeFreighter, true, 'Oranthi', false, true);
    const base = loaded ?? loadDesignSpecification(galaxy.designSpecificationTexts, 'LargeFreighter', BuiltObjectSubRole.LargeFreighter, true, null, false, false);
    if (base === null) return null;
    const spec: DesignSpecification = { ...base, componentRules: base.componentRules.map((c) => ({ ...c })) };
    const target = Math.min(treasureParam(galaxy, 'treasureShipSize'), r.maximumConstructionSize(BuiltObjectSubRole.LargeFreighter));
    const ci = cargoRuleIndex(spec);
    const now = galaxyStarDate(galaxy);
    let design: Design | null = null;
    for (let pass = 0; pass < 4; pass++) {
        try {
            design = generateDesignFromSpec(galaxy, r, spec, 0.0, now);
        } catch {
            return null;
        }
        if (design === null || ci < 0) break;
        const bays = design.components.filter((c) => c.type === ComponentType.StorageCargo);
        const baySize = bays.length > 0 ? bays[0].size : 0;
        if (baySize <= 0) break;
        const delta = Math.trunc((target - design.size) / baySize);
        if (delta === 0 || (delta > 0 && design.size >= target - baySize)) break;
        spec.componentRules[ci].amount = Math.max(1, spec.componentRules[ci].amount + delta);
    }
    if (design !== null) design.name = scenarioText('Scenario RimTrade Treasure Ship');
    return design;
}

// ---------------------------------------------------------------------------------------------------------------
// The convoy
// ---------------------------------------------------------------------------------------------------------------

function alive(r: Empire, b: BuiltObject): boolean {
    return !b.hasBeenDestroyed && b.actualEmpire === r;
}

function isNormalEmpire(galaxy: Galaxy, e: Empire | null, r: Empire): e is Empire {
    return e !== null && e !== r && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

/** The circuit: the nearest `treasureCircuitPorts` space ports of met, non-hostile empires, nearest-neighbour ordered. */
export function treasureCircuit(galaxy: Galaxy, r: Empire, from: { xpos: number; ypos: number }): BuiltObject[] {
    const n = Math.trunc(treasureParam(galaxy, 'treasureCircuitPorts'));
    const candidates: BuiltObject[] = [];
    for (const e of galaxy.empires) {
        if (!isNormalEmpire(galaxy, e, r)) continue;
        const t = obtainDiplomaticRelation(r, e).type;
        if (t === DiplomaticRelationType.NotMet || t === DiplomaticRelationType.War || t === DiplomaticRelationType.TradeSanctions) continue;
        for (const p of e.spacePorts) if (!p.hasBeenDestroyed && p.isSpacePort) candidates.push(p);
    }
    const d = (a: { xpos: number; ypos: number }, b: { xpos: number; ypos: number }): number => (a.xpos - b.xpos) ** 2 + (a.ypos - b.ypos) ** 2;
    candidates.sort((a, b) => d(a, from) - d(b, from) || a.builtObjectID - b.builtObjectID);
    const chosen = candidates.slice(0, Math.max(0, n));
    // Nearest-neighbour tour from home.
    const out: BuiltObject[] = [];
    let at = from;
    while (chosen.length > 0) {
        let best = 0;
        for (let i = 1; i < chosen.length; i++) if (d(chosen[i], at) < d(chosen[best], at)) best = i;
        at = chosen[best];
        out.push(chosen.splice(best, 1)[0]);
    }
    return out;
}

/** Spawns one convoy ship at the port, as GenerateMilitaryConvoy does (GenerateNewBuiltObject + state ownership). */
function spawnShip(galaxy: Galaxy, r: Empire, design: Design, port: BuiltObject | Habitat): BuiltObject {
    const p = galaxy.selectRelativeParkingPoint();
    const bo = generateNewBuiltObject(galaxy, r, design, null, port.xpos + p.x, port.ypos + p.y);
    // A state convoy: freighter hulls are private by default (Empire.cs 4341 isState); the treasure fleet is the state's.
    const i = r.privateBuiltObjects.indexOf(bo);
    if (i >= 0) r.privateBuiltObjects.splice(i, 1);
    if (!r.builtObjects.includes(bo)) r.builtObjects.push(bo);
    bo.owner = r;
    bo.isAutoControlled = false;
    bo.supportCostFactor = Math.fround(0.2);
    return bo;
}

function escortDesign(r: Empire): Design | null {
    for (const sub of [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Escort]) {
        const d = designsFindNewestCanBuild(r.designs, sub);
        if (d !== null) return d;
    }
    return null;
}

/** Fills the convoy up to treasureFleetSize (⌈size / 3⌉ treasure ships, the rest escorts), paying the purchase price. */
function musterFleet(galaxy: Galaxy, r: Empire, port: BuiltObject | Habitat, st: TreasureFleetState): void {
    const size = Math.trunc(treasureParam(galaxy, 'treasureFleetSize'));
    const wantTreasure = Math.ceil(size / 3);
    st.design ??= generateTreasureShipDesign(galaxy, r);
    const free = st.stats.voyages === 0; // the first fleet is the Concord's inheritance
    const buy = (d: Design): boolean => {
        if (free) return true;
        const price = d.calculateCurrentPurchasePrice(galaxy);
        if (r.stateMoney < price) return false;
        r.stateMoney -= price;
        return true;
    };
    while (st.design !== null && st.treasure.length < wantTreasure && buy(st.design)) {
        const bo = spawnShip(galaxy, r, st.design, port);
        st.treasure.push(bo);
        st.ships.splice(st.treasure.length - 1, 0, bo);
    }
    const esc = escortDesign(r);
    while (esc !== null && st.ships.length < size && buy(esc)) st.ships.push(spawnShip(galaxy, r, esc, port));
}

function prune(r: Empire, st: TreasureFleetState): void {
    st.ships = st.ships.filter((b) => alive(r, b));
    st.treasure = st.treasure.filter((b) => alive(r, b));
}

function sailTo(galaxy: Galaxy, st: TreasureFleetState, target: BuiltObject | Habitat): void {
    for (const b of st.ships) {
        const m = builtObjectMission(b.mission);
        if (m !== null && m.type === BuiltObjectMissionType.Move && m.target === target) continue;
        assignMission(galaxy, b, BuiltObjectMissionType.Move, target, null, BuiltObjectMissionPriority.High);
    }
}

function refuel(st: TreasureFleetState): void {
    for (const b of st.ships) b.currentFuel = b.fuelCapacity;
}

/** Emits one treasure-fleet trade to the contract listeners (freight overlay) and the scenario ledger. No Rnd. */
function emitTrade(galaxy: Galaxy, seller: Empire, buyer: Empire, sellingPoint: BuiltObject | Habitat, destination: BuiltObject | Habitat, resourceId: number, amount: number, value: number, freighter: BuiltObject): void {
    if (contractListenersActive()) emitContractInitiated(galaxy, { starDate: galaxyStarDate(galaxy), seller, sellingPoint, buyer, destination, resourceId, componentId: -1, amount, value, isState: true, freighter });
    scenarioEmit(galaxy, 'contractInitiated', { seller, buyer, sellingPoint, destination, resourceId, componentId: -1, amount, value, isState: true, freighter });
}

/** A stop at a foreign port: buy its rim goods, then sell rare goods up to the host's standing. No Rnd. */
export function treasureTradeAt(galaxy: Galaxy, r: Empire, st: TreasureFleetState, port: BuiltObject): void {
    const host = port.actualEmpire;
    const lead = st.treasure[0] ?? null;
    const home = rimTraderPort(galaxy);
    if (host === null || lead === null || lead.cargo === null || port.cargo === null || home === null) return;
    const prices = galaxyResourceCurrentPrices(galaxy);
    const lot = Math.trunc(treasureParam(galaxy, 'treasureTradeLot')) * st.treasure.length;
    // Buy rim goods (credit).
    for (const id of rimGoodIds(galaxy)) {
        const c = cargoGetCargo(port.cargo, id, host);
        const price = prices[id] ?? 0;
        if (c === null || price <= 0) continue;
        const qty = Math.min(c.available, lot, Math.floor(Math.max(0, r.stateMoney) / price));
        if (qty <= 0) continue;
        const value = qty * price;
        if (c.amount - qty <= 0) cargoRemove(port.cargo, c);
        else c.amount -= qty;
        lead.cargo.add(new Cargo(new ResourceRef(id), qty, r));
        r.stateMoney -= value;
        host.stateMoney += value;
        emitTrade(galaxy, host, r, port, home, id, qty, value, lead);
        st.stats.rimUnits += qty;
        st.stats.rimValue += value;
    }
    // Sell rare goods (debit), only to a host the Concord trades with, never below zero standing.
    const rel = obtainDiplomaticRelation(r, host);
    if (!rel.supplyRestrictedResources && !rimTraderAllowsRestrictedTrade(galaxy, r, host)) return;
    for (const id of rareGoodIds(galaxy)) {
        const price = prices[id] ?? 0;
        const budget = Math.min(rimTraderStanding(galaxy, host.empireId), Math.max(0, host.stateMoney) * 0.5);
        if (price <= 0 || budget <= 0) continue;
        let qty = Math.min(lot, Math.floor(budget / price));
        for (const ship of st.treasure) {
            if (qty <= 0 || ship.cargo === null) continue;
            const c = cargoGetCargo(ship.cargo, id, r);
            if (c === null) continue;
            const take = Math.min(c.amount, qty);
            if (take <= 0) continue;
            const value = take * price;
            if (c.amount - take <= 0) cargoRemove(ship.cargo, c);
            else c.amount -= take;
            port.cargo.add(new Cargo(new ResourceRef(id), take, host));
            host.stateMoney -= value;
            r.stateMoney += value;
            emitTrade(galaxy, r, host, home, port, id, take, value, ship);
            st.stats.rareUnits += take;
            st.stats.rareValue += value;
            qty -= take;
        }
    }
}

/** Loads rare goods from the Concord port into the treasure ships (up to each ship's cargo capacity, shared evenly). */
function loadRareGoods(galaxy: Galaxy, r: Empire, st: TreasureFleetState, port: BuiltObject | Habitat): void {
    if (port.cargo === null) return;
    const ids = rareGoodIds(galaxy);
    for (const ship of st.treasure) {
        if (ship.cargo === null) continue;
        const share = Math.floor(ship.cargoCapacity / Math.max(1, ids.length));
        for (const id of ids) {
            const c = cargoGetCargo(port.cargo, id, r);
            const qty = Math.min(c?.available ?? 0, Math.floor(share / Math.max(1, st.treasure.length)) || share);
            if (c === null || qty <= 0) continue;
            if (c.amount - qty <= 0) cargoRemove(port.cargo, c);
            else c.amount -= qty;
            ship.cargo.add(new Cargo(new ResourceRef(id), qty, r));
        }
    }
}

/** Home: everything in the holds goes into the port's hold. */
function unload(r: Empire, st: TreasureFleetState, port: BuiltObject | Habitat): void {
    if (port.cargo === null) return;
    for (const ship of st.ships) {
        if (ship.cargo === null) continue;
        for (const c of [...ship.cargo.items]) {
            if (c.empire !== r || c.commodityComponent !== null || c.commodity.resourceId < 0) continue;
            port.cargo.add(new Cargo(new ResourceRef(c.commodity.resourceId), c.amount, r));
            cargoRemove(ship.cargo, c);
        }
    }
}

function lead(st: TreasureFleetState): BuiltObject | null {
    return st.treasure[0] ?? st.ships[0] ?? null;
}

function portLabel(galaxy: Galaxy, p: BuiltObject | Habitat): string {
    const star = p instanceof BuiltObject ? p.nearestSystemStar : galaxy.determineHabitatSystemStar(p);
    return star !== null ? `${p.name} (${star.name})` : p.name;
}

function depart(galaxy: Galaxy, r: Empire, st: TreasureFleetState, home: BuiltObject | Habitat, now: number): void {
    const circuit = treasureCircuit(galaxy, r, home);
    if (circuit.length === 0) return;
    musterFleet(galaxy, r, home, st);
    if (st.treasure.length === 0) return;
    loadRareGoods(galaxy, r, st, home);
    refuel(st);
    st.circuit = circuit;
    st.leg = 0;
    st.sailing = true;
    st.lastDeparture = now;
    st.stats.voyages++;
    sailTo(galaxy, st, circuit[0]);
    const route = circuit.map((p) => portLabel(galaxy, p)).join(', ');
    scenarioNews(galaxy, r, scenarioText('Scenario RimTrade Treasure Departs', r.name, portLabel(galaxy, home), route), undefined, lead(st));
}

function arrive(galaxy: Galaxy, r: Empire, st: TreasureFleetState, port: BuiltObject): void {
    treasureTradeAt(galaxy, r, st, port);
    refuel(st);
    st.stats.stops++;
    const host = port.actualEmpire;
    if (host !== null) {
        const m = scenarioMessage(galaxy, host, scenarioText('Scenario RimTrade Treasure Title'), scenarioText('Scenario RimTrade Treasure Docks Host', r.name, portLabel(galaxy, port)), { type: EmpireMessageType.GeneralGoodEvent, sender: r, subject: lead(st) });
        // 19s-2 voices (flag llmVoices; inert otherwise, no state): the mask-ritual greeting as the treasure fleet docks.
        if (host === galaxy.playerEmpire && voicesOn(galaxy)) {
            noteVoiceCue(galaxy, {
                kind: 'concord',
                empire: host,
                message: m,
                voice: r,
                other: host,
                speaker: r.leader,
                role: `the treasure-fleet mask-bearer of the ${r.name}`,
                facts: { occasion: 'treasure fleet arrival', concord: r.name, port: portLabel(galaxy, port), ships: st.treasure.length, voyage: st.stats.voyages },
            });
        }
        scenarioNews(galaxy, r, scenarioText('Scenario RimTrade Treasure Docks', r.name, portLabel(galaxy, port), host.name), (e) => e !== host, lead(st));
    }
}

/** The periodic convoy handler (every long block). */
export function treasureFleetTick(galaxy: Galaxy): void {
    const r = rimTraderEmpire(galaxy);
    if (r === null || !isRimTraderAI(galaxy, r)) return;
    const st = treasureState(galaxy);
    const now = galaxyStarDate(galaxy);
    // Contact broadcast (follow-up tuning).
    const contactYear = treasureParam(galaxy, 'rimTraderContactYear');
    if (!st.contactDone && contactYear > 0 && now - st.startStarDate >= contactYear * YEAR_LENGTH) {
        st.contactDone = true;
        const home = rimTraderPort(galaxy);
        for (const e of galaxy.empires) {
            if (!isNormalEmpire(galaxy, e, r) || obtainDiplomaticRelation(r, e).type !== DiplomaticRelationType.NotMet) continue;
            doEmpireEncounter(galaxy, r, e, home);
        }
    }
    if (Math.trunc(treasureParam(galaxy, 'treasureFleetSize')) <= 0) return;
    prune(r, st);
    const home = rimTraderPort(galaxy);
    if (home === null) return;
    if (!st.sailing) {
        const interval = treasureParam(galaxy, 'treasureCircuitInterval') * GAME_DAY_LENGTH;
        if (st.lastDeparture < 0 || now - st.lastDeparture >= interval) depart(galaxy, r, st, home, now);
        return;
    }
    const l = lead(st);
    if (l === null) {
        // Fleet lost at sea.
        st.sailing = false;
        return;
    }
    // Skip ports that are gone or turned hostile.
    while (st.leg < st.circuit.length) {
        const p = st.circuit[st.leg];
        const host = p.actualEmpire;
        const bad = p.hasBeenDestroyed || host === null || host === r || obtainDiplomaticRelation(r, host).type === DiplomaticRelationType.War;
        if (!bad) break;
        st.leg++;
    }
    const target: BuiltObject | Habitat = st.leg < st.circuit.length ? st.circuit[st.leg] : home;
    const dist = galaxy.calculateDistance(l.xpos, l.ypos, target.xpos, target.ypos);
    if (dist > TREASURE_DOCK_RANGE) {
        sailTo(galaxy, st, target);
        return;
    }
    if (st.leg < st.circuit.length) {
        arrive(galaxy, r, st, target as BuiltObject);
        st.leg++;
        sailTo(galaxy, st, st.leg < st.circuit.length ? st.circuit[st.leg] : home);
        return;
    }
    // Home.
    unload(r, st, home);
    refuel(st);
    st.sailing = false;
    st.circuit = [];
    st.leg = 0;
    scenarioNews(galaxy, r, scenarioText('Scenario RimTrade Treasure Returns', r.name, portLabel(galaxy, home)), undefined, l);
}

// ---------------------------------------------------------------------------------------------------------------
// Beacon, raids, map features
// ---------------------------------------------------------------------------------------------------------------

/** objectVisibleToAll query: the convoy's ships are known to every empire. Pure. */
export function treasureBeaconVisible(galaxy: Galaxy, value: boolean, args: { object: BuiltObject | Habitat }): boolean {
    if (value || !(args.object instanceof BuiltObject) || !hasTreasureState(galaxy)) return value;
    return treasureState(galaxy).ships.includes(args.object) && !args.object.hasBeenDestroyed;
}

/** A convoy ship destroyed: the attacker's standing with the Concord drops (NewsNet). No Rnd. */
export function treasureShipDestroyed(galaxy: Galaxy, ev: { builtObject: BuiltObject; destroyer: Empire | null }): void {
    if (!hasTreasureState(galaxy)) return;
    const st = treasureState(galaxy);
    if (!st.ships.includes(ev.builtObject)) return;
    const r = rimTraderEmpire(galaxy);
    st.stats.lost++;
    if (r === null || ev.destroyer === null || ev.destroyer === r) return;
    const isTreasure = st.treasure.includes(ev.builtObject);
    const penalty = treasureParam(galaxy, 'treasureRaidPenalty') * (isTreasure ? 1 : 0.25);
    const row = (rimTradeState(galaxy).ledger[ev.destroyer.empireId] ??= { credit: 0, debit: 0 });
    row.debit += penalty;
    if (isTreasure) scenarioNews(galaxy, r, scenarioText('Scenario RimTrade Treasure Raided', r.name, ev.destroyer.name), undefined, ev.builtObject);
}

export function treasureMapFeatures(galaxy: Galaxy): ScenarioMapFeatures | null {
    if (!hasTreasureState(galaxy) || !scenarioFlag(galaxy, 'rimTrader')) return null;
    const st = treasureState(galaxy);
    const l = st.treasure.find((b) => !b.hasBeenDestroyed) ?? st.ships.find((b) => !b.hasBeenDestroyed) ?? null;
    const out: ScenarioMapFeatures = { markers: [], routes: [] };
    if (l === null) return out;
    if (scenarioFlag(galaxy, 'treasureBeacon')) out.markers.push({ x: l.xpos, y: l.ypos, label: scenarioText('Scenario RimTrade Treasure Fleet'), color: TREASURE_COLOR });
    const home = rimTraderPort(galaxy);
    if (st.sailing && home !== null && st.circuit.length > 0) {
        const points = [home, ...st.circuit, home].map((p) => ({ x: p.xpos, y: p.ypos }));
        out.routes.push({ points, color: TREASURE_COLOR, activeLeg: st.leg });
    }
    return out;
}

registerScenarioQuery({ id: 'rimTrade.researchCap', flag: 'rimTrader', query: 'researchFrozen', run: concordResearchFrozen });
registerScenarioQuery({ id: 'rimTrade.beacon', flag: 'treasureBeacon', query: 'objectVisibleToAll', run: (g, v, a) => treasureBeaconVisible(g, v, a) });
registerScenarioEvent({ id: 'rimTrade.treasureRaid', flag: 'rimTrader', event: 'builtObjectKilledBy', run: treasureShipDestroyed });
registerScenarioPeriodic({ id: 'rimTrade.treasure', flag: 'rimTrader', periodDays: 10, run: (g) => treasureFleetTick(g) });
registerScenarioYearly({ id: 'rimTrade.researchCapYear', flag: 'rimTrader', order: 11, run: (g) => yearlyCapCheck(g) });
registerScenarioMapFeatures('rimTrade.treasure', (g) => treasureMapFeatures(g));
