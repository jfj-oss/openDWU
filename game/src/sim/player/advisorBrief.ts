// 18a — the chat advisor's brief: a compact, JSON-able snapshot of what the player's fleet admiral can see and order,
// handed to the local model as context. The model answers with command ids from `commands` (advisorCommands.ts
// validates and executes them through executeShipAction / submitProposal / buildNewShips — never around the rules).
//
// Which orders are listed follows the original right-click action menu, Main.Part8.cs 3202 method_344: the fleet
// branch (3213-3515) and the ship branch (3969-4960). The C# builds the menu for one target under the cursor; here
// each order lists the refs in the brief it may target (`to`), evaluated with the same predicates. Orders that the
// menu offers with a fixed target ("At nearest refuelling point", "Nearest unexplored system", "At nearest ship yard")
// are listed with that target resolved.
//
// Read-only: nothing here mutates the galaxy or draws galaxy.rnd (the brief is built from UI input between ticks; the
// digest must not move). That is why a few C# menu calls are left out, with a TODO(port) each:
// - EvaluateThreats (Galaxy.EvaluateThreats adds pirate empires to KnownPirateEmpires) for Escape — only a ship or fleet
//   that is under attack (Attackers.Count > 0) is offered Escape here;
// - Empire.ReviewLatestDesigns before the Retrofit sub-menu.
// Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Design } from '../design';
import { Habitat, HabitatCategoryType, type SystemInfo } from '../types';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from '../missions/mission';
import { ShipGroup, empireShipGroups } from '../fleets/shipGroup';
import {
    empireFleetMaximumCount,
    shipGroupCalculateRequiredFuel,
    shipGroupTotalBombardPower,
    shipGroupTotalFuelCapacity,
} from '../fleets/shipGroupTasks';
import { decideBestFleetRefuelPoint } from '../fleets/militaryAI';
import { canSendShipToBlockadeBuiltObject, canSendShipToBlockadeColony } from '../fleets/blockades';
import { checkEmpireCanRefuelAtEmpire, fastFindNearestRefuellingPoint } from '../movement';
import { determineFuelRequired } from '../logistics/refuel';
import { fastFindNearestSpacePort } from '../stationPlacement';
import { findNearestShipYard } from '../construction/empireConstruction';
import { canBuiltObjectColonizeHabitat } from '../construction/constructionQueue';
import { canEmpireColonizeHabitatRange } from '../exploration';
import { findNearestUnexploredHabitat } from '../visibility';
import { findNewestCanBuild, getBuildableDesignsBySubRoles } from '../designGeneration';
import { DiplomaticRelationType } from '../diplomacy';
import { Character, CharacterRole } from '../characters';
import { listProposals } from './diplomacyProposals';
import { findNearestShipYardBase } from './executeShipAction';

// ---------------------------------------------------------------------------------------------------------------
// Brief shape (JSON-able; C# names for enums)
// ---------------------------------------------------------------------------------------------------------------

/** What the player has selected (the HUD selection). */
export type AdvisorSelection = BuiltObject | Habitat | ShipGroup | null;

export interface BriefShip {
    ref: string;
    name: string;
    /** BuiltObjectSubRole name. */
    type: string;
    /** CurrentFuel / FuelCapacity, percent. */
    fuel: number;
    /** The nearest system (BuiltObject.NearestSystemStar). */
    at: string;
    /** BuiltObjectMissionType name ('None' when idle). */
    mission: string;
    idle?: true;
    damaged?: true;
    /** IsAutoControlled. */
    auto?: true;
    selected?: true;
}

export interface BriefFleet {
    ref: string;
    name: string;
    ships: number;
    lead: string;
    fuel: number;
    at: string;
    mission: string;
    damaged?: true;
    selected?: true;
}

export interface BriefPlace {
    ref: string;
    name: string;
    /** System (its star), Colony, Planet / Moon / GasCloud / Asteroid, or the base's BuiltObjectSubRole. */
    kind: string;
    /** Owning empire's name ('you' for the player). */
    owner?: string;
    /** System the place is in (omitted for a System). */
    sys?: string;
    /** Distance from the anchor (the selection, else the capital) in thousands of galaxy units. */
    dist: number;
    /** false: the player does not know every habitat's resources there yet (Galaxy FindNearestUnexploredHabitat). */
    explored?: boolean;
    refuel?: true;
}

export interface BriefEmpire {
    ref: string;
    name: string;
    /** DiplomaticRelationType name. */
    relation: string;
}

/**
 * One order the model may pick. `to`: a single ref (fixed target), or the refs the order accepts as `targetId`
 * ('*' = any place / ship / fleet ref in the brief; 'places' = any place ref; 'systems' = any place of kind System;
 * 'ships' = any ship ref in `ships` but the actor).
 */
export interface BriefCommand {
    id: string;
    /** The ship / fleet / empire ref that carries the order out ('you' for empire-wide orders). */
    who: string;
    /** The order: a BuiltObjectMissionType / ShipActionType name, 'Build', or a diplomacy option id (DialogPartType). */
    do: string;
    to?: string | string[];
    /** Short human text for orders whose meaning is not obvious from `do`. */
    note?: string;
    /** Credits (Build: per ship; gifts: amount). */
    cost?: number;
    /** A war declaration: executed only with `confirm: true` in the model's command. */
    confirm?: true;
    /** Build: the design's name. */
    design?: string;
}

export interface AdvisorBrief {
    empire: { name: string; money: number };
    /** The character the advisor speaks as (Fleet Admiral, else the Leader), or null. */
    admiral: { name: string; role: string } | null;
    selection: string | null;
    distUnit: string;
    fleets: BriefFleet[];
    ships: BriefShip[];
    places: BriefPlace[];
    empires: BriefEmpire[];
    commands: BriefCommand[];
}

// ---------------------------------------------------------------------------------------------------------------
// Refs
// ---------------------------------------------------------------------------------------------------------------

export function shipRef(b: BuiltObject): string {
    return `s${b.builtObjectID}`;
}
export function habitatRef(h: Habitat): string {
    return `h${h.habitatIndex}`;
}
export function empireRef(e: Empire): string {
    return `e${e.empireId}`;
}
export function fleetRef(player: Empire, sg: ShipGroup): string {
    return `f${empireShipGroups(player).indexOf(sg)}`;
}

/** A ref from the brief back to the live object (null when it no longer exists). */
export type ResolvedRef = { kind: 'ship'; obj: BuiltObject } | { kind: 'habitat'; obj: Habitat } | { kind: 'fleet'; obj: ShipGroup } | { kind: 'empire'; obj: Empire };

export function resolveRef(galaxy: Galaxy, player: Empire, ref: string): ResolvedRef | null {
    const n = Number(ref.slice(1));
    if (!Number.isInteger(n) || n < 0) return null;
    switch (ref[0]) {
        case 's': {
            const b = galaxy.builtObjects.find((x) => x != null && x.builtObjectID === n);
            return b ? { kind: 'ship', obj: b } : null;
        }
        case 'h': {
            const h = galaxy.habitats[n];
            return h && h.habitatIndex === n ? { kind: 'habitat', obj: h } : null;
        }
        case 'f': {
            const sg = empireShipGroups(player)[n];
            return sg ? { kind: 'fleet', obj: sg } : null;
        }
        case 'e': {
            const e = galaxy.empires.find((x) => x.empireId === n);
            return e ? { kind: 'empire', obj: e } : null;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Validity predicates (Main.Part8.cs 3202 method_344), shared by the brief and advisorCommands.ts' re-check
// ---------------------------------------------------------------------------------------------------------------

/** A player ship the ship branch of method_344 gives movement orders to: owned, mobile, not a base, fully built. */
export function isOrderableShip(player: Empire, b: BuiltObject | null | undefined): b is BuiltObject {
    return (
        b != null &&
        b.owner === player &&
        b.role !== BuiltObjectRole.Base &&
        b.builtAt === null &&
        b.unbuiltComponentCount <= 0 &&
        b.topSpeed > 0
    );
}

/** FirepowerRaw > 0 || FighterCapacity > 0 (the attack / patrol / escort / blockade gate of the ship branch). */
export function shipHasWeapons(b: BuiltObject): boolean {
    return b.firepowerRaw > 0 || b.fighterCapacity > 0;
}

/** The target object of a mission order (Habitat / BuiltObject / ShipGroup), from a resolved ref. */
export type OrderTarget = Habitat | BuiltObject | ShipGroup;

function targetEmpire(t: OrderTarget): Empire | null {
    return t instanceof ShipGroup ? t.empire : t.empire;
}

/**
 * Main.Part8.cs 3289 / 4321: the "Attack X" condition — a colony of another (non-independent) empire, another empire's
 * ship or base, or another empire's fleet. (Creatures: TODO(port) — creatures have no brief ref yet.)
 */
export function canAttack(galaxy: Galaxy, own: Empire, t: OrderTarget): boolean {
    if (t instanceof Habitat) return t.empire !== null && t.empire !== galaxy.independentEmpire && t.empire !== own;
    return targetEmpire(t) !== own;
}

/** Main.Part8.cs 3297 / 4350: "Bombard X" — a colony of another non-independent empire. */
export function canBombardTarget(galaxy: Galaxy, own: Empire, t: OrderTarget): boolean {
    return t instanceof Habitat && t.empire !== null && t.empire !== galaxy.independentEmpire && t.empire !== own;
}

/** Main.Part8.cs 3319 / 4362: "Patrol X" — any habitat or base. */
export function canPatrolTarget(t: OrderTarget): boolean {
    return t instanceof Habitat || (!(t instanceof ShipGroup) && t.role === BuiltObjectRole.Base);
}

/** Main.Part8.cs 4368: "Escort X" — an own ship that is not a base (not the escort itself). */
export function canEscortTarget(own: Empire, self: BuiltObject, t: OrderTarget): boolean {
    return !(t instanceof Habitat) && !(t instanceof ShipGroup) && t !== self && t.role !== BuiltObjectRole.Base && t.empire === own;
}

/** Main.Part8.cs 3325 / 4374: "Blockade X" — another empire's colony or base that Empire.CanSendShipToBlockade* allows. */
export function canBlockadeTarget(galaxy: Galaxy, own: Empire, t: OrderTarget): boolean {
    if (t instanceof Habitat) {
        return t.empire !== null && t.empire !== galaxy.independentEmpire && t.empire !== own && canSendShipToBlockadeColony(galaxy, own, t);
    }
    if (t instanceof ShipGroup) return false;
    return t.role === BuiltObjectRole.Base && t.empire !== own && canSendShipToBlockadeBuiltObject(galaxy, own, t);
}

/** Main.Part8.cs 4818-4830 / 3417-3431: "Refuel … At X" — a refuelling depot the ship's empire may refuel at. */
export function canRefuelAt(galaxy: Galaxy, player: Empire, ship: BuiltObject, t: OrderTarget): boolean {
    if (t instanceof ShipGroup || t === ship) return false;
    if (!t.isRefuellingDepot) return false;
    return checkEmpireCanRefuelAtEmpire(galaxy, ship, player, t.empire);
}

/**
 * Main.Part8.cs 4652: "Colonize X" — a colony ship (non-pirate empire, working HabitationColonization component) and an
 * unowned / independent habitat that Empire.CanBuiltObjectColonizeHabitat and CanEmpireColonizeHabitatRange allow.
 */
export function canColonizeTarget(galaxy: Galaxy, ship: BuiltObject, t: OrderTarget): boolean {
    const empire = ship.empire;
    if (ship.subRole !== BuiltObjectSubRole.ColonyShip || empire === null || empire.pirateEmpireBaseHabitat !== null) return false;
    if (!(t instanceof Habitat) || (t.empire !== null && t.empire !== galaxy.independentEmpire)) return false;
    return canBuiltObjectColonizeHabitat(galaxy, empire, ship, t).result && canEmpireColonizeHabitatRange(galaxy, empire, t);
}

/** Galaxy.DetermineHabitatSystemStar: the star of the habitat's system. */
function systemStarOf(galaxy: Galaxy, h: Habitat): Habitat {
    return galaxy.determineHabitatSystemStar(h);
}

function systemOf(galaxy: Galaxy, h: Habitat): SystemInfo | null {
    return galaxy.systems[h.systemIndex] ?? null;
}

/** Every habitat of the system known (Galaxy.6.cs 4501 FindNearestUnexploredHabitat counts any unknown habitat). */
export function isSystemExplored(player: Empire, system: SystemInfo): boolean {
    if (!player.resourceMap.checkResourcesKnown(system.systemStar)) return false;
    for (const h of system.habitats) if (!player.resourceMap.checkResourcesKnown(h)) return false;
    return true;
}

/**
 * Main.Part8.cs 4410: the ship branch's "Explore > Nearest unexplored system" target —
 * Galaxy.FindNearestUnexploredHabitat(ship, ActualEmpire, includeAsteroids: true), as its system star.
 */
export function nearestUnexploredSystemStar(galaxy: Galaxy, ship: BuiltObject): Habitat | null {
    const empire = ship.actualEmpire;
    if (empire === null) return null;
    const h = findNearestUnexploredHabitat(galaxy, ship.xpos, ship.ypos, empire.visibility, true);
    return h === null ? null : systemStarOf(galaxy, h);
}

/**
 * Main.Part8.cs 4832-4838: the ship's "Refuel > At nearest refuelling point" — Galaxy.FastFindNearestRefuellingPoint
 * with DetermineFuelRequired(true); a military ship also considers deployed resupply ships.
 */
export function nearestShipRefuellingPoint(galaxy: Galaxy, ship: BuiltObject): BuiltObject | Habitat | null {
    const fuelTypes = determineFuelRequired(ship, true);
    const so =
        ship.role !== BuiltObjectRole.Military
            ? fastFindNearestRefuellingPoint(galaxy, ship.xpos, ship.ypos, fuelTypes, ship.actualEmpire, ship)
            : fastFindNearestRefuellingPoint(galaxy, ship.xpos, ship.ypos, fuelTypes, ship.actualEmpire, ship, true, null);
    return so instanceof Habitat || (so !== null && (so as BuiltObject).builtObjectID !== undefined) ? (so as BuiltObject | Habitat) : null;
}

/**
 * Main.Part8.cs 3434-3452: the fleet's "Refuel all ships > At nearest refuelling point" — Empire.DecideBestFleetRefuelPoint
 * with ShipGroup.CalculateRequiredFuel, else Galaxy.FastFindNearestRefuellingPoint (with resupply ships, ship count);
 * then "At your nearest Space Port" (FastFindNearestSpacePort).
 */
export function nearestFleetRefuellingPoint(galaxy: Galaxy, player: Empire, sg: ShipGroup): BuiltObject | Habitat | null {
    const lead = sg.leadShip;
    if (lead === null || sg.empire === null) return null;
    const required = shipGroupCalculateRequiredFuel(sg);
    let so = decideBestFleetRefuelPoint(galaxy, player, lead.xpos, lead.ypos, sg.empire, required, null);
    if (so === null) so = fastFindNearestRefuellingPoint(galaxy, lead.xpos, lead.ypos, required, sg.empire, lead, true, null, sg.ships.length);
    if (so === null) so = fastFindNearestSpacePort(galaxy, lead.xpos, lead.ypos, sg.empire);
    return so instanceof Habitat || (so !== null && (so as BuiltObject).builtObjectID !== undefined) ? (so as BuiltObject | Habitat) : null;
}

/**
 * Main.Part8.cs 4889-4893: the Retrofit sub-menu's designs — DesignList.GetBuildableDesignsBySubRoles({ SubRole }) minus
 * the ship's own design (not offered while a retrofit is pending). The brief offers the newest (FindNewestCanBuild).
 * TODO(port): Empire.ReviewLatestDesigns() before the list (Main.Part8.cs 4885) mutates the empire — left out.
 */
export function retrofitDesignFor(player: Empire, ship: BuiltObject): Design | null {
    if (ship.retrofitDesign !== null) return null;
    const m = builtObjectMission(ship.mission);
    if (m !== null && m.type === BuiltObjectMissionType.Retrofit) return null;
    const buildable = getBuildableDesignsBySubRoles(player.designs, [ship.subRole], player).filter((d) => d !== ship.design);
    if (buildable.length === 0) return null;
    const newest = findNewestCanBuild(player.designs, ship.subRole, player, ship.parentHabitat);
    return newest !== null && buildable.includes(newest) ? newest : buildable[0];
}

/** Main.Part2.cs 404 method_628 rows the state builds (the private freighter / mining / passenger rows are left out). */
export const ADVISOR_BUILD_SUBROLES: readonly BuiltObjectSubRole[] = [
    BuiltObjectSubRole.Escort,
    BuiltObjectSubRole.Frigate,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.TroopTransport,
    BuiltObjectSubRole.Carrier,
    BuiltObjectSubRole.ResupplyShip,
    BuiltObjectSubRole.ExplorationShip,
    BuiltObjectSubRole.ConstructionShip,
];

/**
 * Main.Part2.cs 799 method_629 / 873 method_630 (ui/screens/buildOrder.ts buildOrderRow): the Build Order row's design —
 * FindNewestCanBuild when the sub-role has buildable designs and the empire has construction yards (colony,
 * construction and resupply ships need none).
 */
export function buildOrderDesign(player: Empire, subRole: BuiltObjectSubRole): Design | null {
    const buildable = getBuildableDesignsBySubRoles(player.designs, [subRole], player);
    if (buildable.length === 0) return null;
    if (
        player.constructionYards.length <= 0 &&
        subRole !== BuiltObjectSubRole.ColonyShip &&
        subRole !== BuiltObjectSubRole.ConstructionShip &&
        subRole !== BuiltObjectSubRole.ResupplyShip
    ) {
        return null;
    }
    return findNewestCanBuild(player.designs, subRole, player);
}

// ---------------------------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------------------------

const MAX_SHIPS = 24;
const NEAR_SYSTEMS = 10;
const MAX_COLONIES = 8;
const MAX_CONTACTS = 8;

function pct(cur: number, cap: number): number {
    return cap > 0 ? Math.round((100 * cur) / cap) : 100;
}

function missionName(mission: unknown): string {
    const m = builtObjectMission(mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined ? 'None' : BuiltObjectMissionType[m.type];
}

function ownerName(player: Empire, e: Empire | null): string | undefined {
    if (e === null) return undefined;
    return e === player ? 'you' : e.name;
}

/** The character the advisor speaks as: the empire's Fleet Admiral, else its Leader. */
export function advisorCharacter(player: Empire): Character | null {
    const chars = (player.characters as unknown[]).filter((c): c is Character => c instanceof Character);
    return chars.find((c) => c.role === CharacterRole.FleetAdmiral) ?? chars.find((c) => c.role === CharacterRole.Leader) ?? null;
}

/**
 * Build the advisor brief for `player` with the HUD `selection`. Pure: reads the galaxy, never mutates it, no Rnd.
 */
export function buildAdvisorBrief(galaxy: Galaxy, player: Empire, selection: AdvisorSelection): AdvisorBrief {
    const selectedShip = selection !== null && !(selection instanceof Habitat) && !(selection instanceof ShipGroup) ? selection : null;
    const selectedFleet = selection instanceof ShipGroup ? selection : null;
    const anchor: { xpos: number; ypos: number } =
        selectedFleet?.leadShip ?? selectedShip ?? (selection instanceof Habitat ? selection : null) ?? player.capital ?? { xpos: 0, ypos: 0 };
    const dist = (o: { xpos: number; ypos: number }): number => Math.round(galaxy.calculateDistance(anchor.xpos, anchor.ypos, o.xpos, o.ypos) / 100) / 10;

    const brief: AdvisorBrief = {
        empire: { name: player.name, money: Math.round(player.stateMoney) },
        admiral: null,
        selection: null,
        distUnit: 'thousand galaxy units from the selection (else your capital)',
        fleets: [],
        ships: [],
        places: [],
        empires: [],
        commands: [],
    };
    const admiral = advisorCharacter(player);
    if (admiral !== null) brief.admiral = { name: admiral.name, role: CharacterRole[admiral.role] };

    // --- places -----------------------------------------------------------------------------------------------
    const placeRefs = new Set<string>();
    const addHabitat = (h: Habitat): string => {
        const ref = habitatRef(h);
        if (placeRefs.has(ref)) return ref;
        placeRefs.add(ref);
        const sys = systemOf(galaxy, h);
        const isStar = sys !== null && sys.systemStar === h;
        const place: BriefPlace = { ref, name: h.name, kind: 'System', dist: dist(h) };
        if (isStar) {
            place.explored = sys !== null && isSystemExplored(player, sys);
            const dom = sys?.dominantEmpire?.empire ?? null;
            if (place.explored && dom !== null) place.owner = ownerName(player, dom);
        } else {
            place.kind = h.empire !== null && h.population.items.length > 0 ? 'Colony' : HabitatCategoryType[h.category];
            const o = ownerName(player, h.empire);
            if (o !== undefined) place.owner = o;
            if (sys !== null) place.sys = sys.systemStar.name;
        }
        if (h.isRefuellingDepot) place.refuel = true;
        brief.places.push(place);
        return ref;
    };
    const addBase = (b: BuiltObject): string => {
        const ref = shipRef(b);
        if (placeRefs.has(ref)) return ref;
        placeRefs.add(ref);
        const place: BriefPlace = { ref, name: b.name, kind: BuiltObjectSubRole[b.subRole], dist: dist(b) };
        const o = ownerName(player, b.empire);
        if (o !== undefined) place.owner = o;
        if (b.nearestSystemStar !== null) place.sys = b.nearestSystemStar.name;
        if (b.isRefuellingDepot) place.refuel = true;
        brief.places.push(place);
        return ref;
    };
    const addTarget = (t: BuiltObject | Habitat): string => (t instanceof Habitat ? addHabitat(t) : t.role === BuiltObjectRole.Base ? addBase(t) : shipRef(t));

    // Nearby systems (by star distance to the anchor), then the player's colonies.
    const systemsByDist = galaxy.systems
        .filter((s) => s.systemStar !== undefined)
        .map((s) => ({ s, d: galaxy.calculateDistanceSquared(anchor.xpos, anchor.ypos, s.systemStar.xpos, s.systemStar.ypos) }))
        .sort((a, b) => a.d - b.d);
    const nearSystems = systemsByDist.slice(0, NEAR_SYSTEMS).map((x) => x.s);
    for (const s of nearSystems) addHabitat(s.systemStar);
    const colonies = [...player.colonies].sort((a, b) => dist(a) - dist(b)).slice(0, MAX_COLONIES);
    for (const c of colonies) addHabitat(c);
    // Known foreign colonies and bases in the explored nearby systems (targets for attack / blockade / patrol).
    let contacts = 0;
    for (const s of nearSystems) {
        if (contacts >= MAX_CONTACTS || !isSystemExplored(player, s)) continue;
        for (const h of s.habitats) {
            if (contacts >= MAX_CONTACTS) break;
            if (h.empire !== null && h.empire !== player && h.population.items.length > 0) {
                addHabitat(h);
                contacts++;
            }
            for (const b of h.basesAtHabitat) {
                if (contacts < MAX_CONTACTS && b != null && b.empire !== null && b.empire !== player) {
                    addBase(b);
                    contacts++;
                }
            }
        }
    }

    // --- ships and fleets -------------------------------------------------------------------------------------
    const orderable = player.builtObjects.filter((b) => isOrderableShip(player, b) && b.shipGroup === null);
    const shipIdle = (b: BuiltObject): boolean => missionName(b.mission) === 'None';
    orderable.sort((a, b) => {
        const ka = (a === selectedShip ? 0 : 2) + (shipIdle(a) ? 0 : 1);
        const kb = (b === selectedShip ? 0 : 2) + (shipIdle(b) ? 0 : 1);
        return ka - kb || dist(a) - dist(b);
    });
    const ships = orderable.slice(0, MAX_SHIPS);
    for (const b of ships) {
        const s: BriefShip = {
            ref: shipRef(b),
            name: b.name,
            type: BuiltObjectSubRole[b.subRole],
            fuel: pct(b.currentFuel, b.fuelCapacity),
            at: b.nearestSystemStar?.name ?? '(Deep Space)',
            mission: missionName(b.mission),
        };
        if (shipIdle(b)) s.idle = true;
        if (b.damagedComponentCount > 0) s.damaged = true;
        if (b.isAutoControlled) s.auto = true;
        if (b === selectedShip) s.selected = true;
        brief.ships.push(s);
    }
    const fleets = empireShipGroups(player).filter((sg): sg is ShipGroup => sg !== null && sg.leadShip !== null && sg.ships.length > 0);
    for (const sg of fleets) {
        const lead = sg.leadShip!;
        let fuel = 0;
        for (const b of sg.ships) fuel += b.currentFuel;
        const f: BriefFleet = {
            ref: fleetRef(player, sg),
            name: sg.name ?? '(Unnamed fleet)',
            ships: sg.ships.length,
            lead: lead.name,
            fuel: pct(fuel, shipGroupTotalFuelCapacity(sg)),
            at: lead.nearestSystemStar?.name ?? '(Deep Space)',
            mission: sg.mission === null || sg.mission.type === BuiltObjectMissionType.Undefined ? 'None' : BuiltObjectMissionType[sg.mission.type],
        };
        if (sg.ships.some((b) => b.damagedComponentCount > 0)) f.damaged = true;
        if (sg === selectedFleet) f.selected = true;
        brief.fleets.push(f);
    }
    if (selectedShip !== null) brief.selection = selectedShip.owner === player && selectedShip.shipGroup === null ? shipRef(selectedShip) : null;
    if (selectedFleet !== null) brief.selection = fleetRef(player, selectedFleet);
    if (selection instanceof Habitat) brief.selection = addHabitat(selection);
    if (selectedShip !== null && brief.selection === null) {
        if (selectedShip.role === BuiltObjectRole.Base) brief.selection = addBase(selectedShip);
        else if (selectedShip.shipGroup instanceof ShipGroup && selectedShip.owner === player) brief.selection = fleetRef(player, selectedShip.shipGroup);
    }

    // --- orders -----------------------------------------------------------------------------------------------
    // Ids are assigned at the end, after the orders are grouped by who carries them out.
    const cmd = (c: Omit<BriefCommand, 'id'>): void => {
        brief.commands.push({ id: '', ...c });
    };

    // Resolve target lists lazily after all places are known: collect per-command predicates first.
    const deferred: { c: Omit<BriefCommand, 'id'>; pred: (t: OrderTarget) => boolean }[] = [];

    for (const b of ships) {
        const who = shipRef(b);
        // 4190: Move to X (any target).
        cmd({ who, do: 'Move', to: '*' });
        const armed = shipHasWeapons(b);
        if (armed) {
            deferred.push({ c: { who, do: 'Attack' }, pred: (t) => canAttack(galaxy, player, t) });
            deferred.push({ c: { who, do: 'Patrol' }, pred: (t) => canPatrolTarget(t) });
            deferred.push({ c: { who, do: 'Escort' }, pred: (t) => canEscortTarget(player, b, t) });
            deferred.push({ c: { who, do: 'Blockade' }, pred: (t) => canBlockadeTarget(galaxy, player, t) });
        }
        if (b.bombardWeaponPower > 0) deferred.push({ c: { who, do: 'Bombard' }, pred: (t) => canBombardTarget(galaxy, player, t) });
        // 4400-4423: Explore (sensors).
        if (b.sensorResourceProfileSensorRange > 0) {
            const star = nearestUnexploredSystemStar(galaxy, b);
            if (star !== null) cmd({ who, do: 'Explore', to: addHabitat(star), note: 'nearest unexplored system' });
            cmd({ who, do: 'Explore', to: 'systems' });
        }
        // 4652: Colonize.
        if (b.subRole === BuiltObjectSubRole.ColonyShip) {
            for (const s of nearSystems) {
                if (!isSystemExplored(player, s)) continue;
                for (const h of s.habitats) if (canColonizeTarget(galaxy, b, h)) addHabitat(h);
            }
            deferred.push({ c: { who, do: 'Colonize' }, pred: (t) => canColonizeTarget(galaxy, b, t) });
        }
        // 4716-4731: Repair (damaged) at the nearest ship yard.
        if (b.damagedComponentCount > 0) {
            const yard = findNearestShipYard(galaxy, player, b, true, true);
            if (yard instanceof Habitat || (yard !== null && (yard as BuiltObject).builtObjectID !== undefined)) {
                cmd({ who, do: 'Repair', to: addTarget(yard as BuiltObject | Habitat), note: 'at nearest ship yard' });
            }
        }
        // 4815-4848: Refuel at the nearest refuelling point / at a depot.
        const rp = nearestShipRefuellingPoint(galaxy, b);
        if (rp !== null) cmd({ who, do: 'Refuel', to: addTarget(rp), note: 'at nearest refuelling point' });
        deferred.push({ c: { who, do: 'Refuel' }, pred: (t) => canRefuelAt(galaxy, player, b, t) });
        // 4849-4884 / 4885-4912: Retrofit to the newest design at the nearest ship yard base.
        const design = retrofitDesignFor(player, b);
        const yardBase = design !== null ? findNearestShipYardBase(galaxy, player, b) : null;
        if (design !== null && yardBase !== null) cmd({ who, do: 'Retrofit', to: addBase(yardBase), design: design.name, note: 'at nearest ship yard' });
        // 4760-4765: Stop (has a mission). 4766-4786: Escape (TODO(port): EvaluateThreats — see header).
        if (!shipIdle(b)) cmd({ who, do: 'Hold', note: 'stop, cancel the mission' });
        if ((b.attackers ?? []).length > 0) cmd({ who, do: 'Escape' });
        // 4787-4803: Join Fleet ((New Fleet) while under FleetMaximumCount, or an existing fleet).
        if (b.firepowerRaw > 0 || b.troopCapacity > 0 || b.bombardWeaponPower > 0 || b.fighterCapacity > 0) {
            if (empireShipGroups(player).length < empireFleetMaximumCount(player)) cmd({ who, do: 'JoinShipGroup', note: 'form a new fleet' });
            if (fleets.length > 0) cmd({ who, do: 'JoinShipGroup', to: fleets.map((sg) => fleetRef(player, sg)) });
        }
        // 4953-4958: Automate.
        if (!b.isAutoControlled) cmd({ who, do: 'AutomateShip' });
    }

    for (const sg of fleets) {
        const who = fleetRef(player, sg);
        const lead = sg.leadShip!;
        cmd({ who, do: 'Move', to: '*' });
        deferred.push({ c: { who, do: 'Attack' }, pred: (t) => canAttack(galaxy, player, t) && t !== sg });
        deferred.push({ c: { who, do: 'Patrol' }, pred: (t) => canPatrolTarget(t) });
        deferred.push({ c: { who, do: 'Blockade' }, pred: (t) => canBlockadeTarget(galaxy, player, t) });
        if (shipGroupTotalBombardPower(sg) > 0) deferred.push({ c: { who, do: 'Bombard' }, pred: (t) => canBombardTarget(galaxy, player, t) });
        // 3409-3460: Refuel all ships.
        const rp = nearestFleetRefuellingPoint(galaxy, player, sg);
        if (rp !== null) cmd({ who, do: 'Refuel', to: addTarget(rp), note: 'all ships, at nearest refuelling point' });
        deferred.push({ c: { who, do: 'Refuel' }, pred: (t) => canRefuelAt(galaxy, player, lead, t) });
        // 3461-3487: Repair and Refuel damaged ships.
        if (sg.ships.some((b) => b.damagedComponentCount > 0)) {
            const yard = findNearestShipYard(galaxy, player, lead, true, false);
            if (yard !== null) cmd({ who, do: 'Repair', to: addTarget(yard as BuiltObject | Habitat), note: 'damaged ships, at nearest ship yard' });
        }
        // 3488-3504: Retrofit to latest designs at the nearest ship yard.
        const yard2 = findNearestShipYard(galaxy, player, lead, true, false);
        if (yard2 !== null) cmd({ who, do: 'Retrofit', to: addTarget(yard2 as BuiltObject | Habitat), note: 'to latest designs, at nearest ship yard' });
        // 3378-3407: Stop / Escape.
        if (sg.mission !== null && sg.mission.type !== BuiltObjectMissionType.Undefined) cmd({ who, do: 'Hold', note: 'stop, cancel the mission' });
        if ((lead.attackers ?? []).length > 0) cmd({ who, do: 'Escape' });
        // 3505-3510: Return to base (gather point), Disband.
        if (sg.gatherPoint instanceof Habitat) cmd({ who, do: 'Move', to: addHabitat(sg.gatherPoint), note: 'return to base' });
        cmd({ who, do: 'DisbandShipGroup' });
    }

    // Deferred target lists over the final places + ships + fleets.
    const allTargets: { ref: string; t: OrderTarget }[] = [];
    for (const p of brief.places) {
        const r = resolveRef(galaxy, player, p.ref);
        if (r !== null && (r.kind === 'habitat' || r.kind === 'ship')) allTargets.push({ ref: p.ref, t: r.obj });
    }
    for (const b of ships) allTargets.push({ ref: shipRef(b), t: b });
    for (const sg of fleets) allTargets.push({ ref: fleetRef(player, sg), t: sg });
    for (const d of deferred) {
        const to = allTargets.filter((x) => d.pred(x.t)).map((x) => x.ref);
        if (to.length === 0) continue;
        const allPlaces = brief.places.length > 0 && brief.places.every((p) => to.includes(p.ref)) && to.length === brief.places.length;
        const otherShips = brief.ships.filter((s) => s.ref !== d.c.who).map((s) => s.ref);
        const allShips = otherShips.length > 0 && to.length === otherShips.length && otherShips.every((r) => to.includes(r));
        cmd({ ...d.c, to: allPlaces ? 'places' : allShips ? 'ships' : to });
    }

    // --- empire-wide orders: diplomacy (met empires) and the Build Order ---------------------------------------
    for (const e of galaxy.empires) {
        if (e === player || !e.active || e === galaxy.independentEmpire) continue;
        const rel = player.diplomaticRelations.byEmpire(e);
        if (rel === null || rel.type === DiplomaticRelationType.NotMet) continue;
        const who = empireRef(e);
        brief.empires.push({ ref: who, name: e.name, relation: DiplomaticRelationType[rel.type] });
        // listProposals reads Obtain*Relation both ways; only call it when both relations exist (read-only).
        if (e.diplomaticRelations.byEmpire(player) === null) continue;
        for (const o of listProposals(galaxy, player, e)) {
            if (!o.enabled) continue;
            const c: Omit<BriefCommand, 'id'> = { who, do: o.id };
            if (o.cost > 0) c.cost = Math.round(o.cost);
            if (o.part === 'WAR_DECLARE') c.confirm = true;
            cmd(c);
        }
    }
    for (const subRole of ADVISOR_BUILD_SUBROLES) {
        const design = buildOrderDesign(player, subRole);
        if (design === null) continue;
        cmd({ who: 'you', do: 'Build', design: design.name, note: BuiltObjectSubRole[subRole], cost: Math.round(design.calculateCurrentPurchasePrice(galaxy)) });
    }
    // Group by actor (ships, fleets, empires, then 'you'), keeping each actor's order; then number them.
    const order = new Map<string, number>();
    for (const c of brief.commands) if (!order.has(c.who)) order.set(c.who, order.size);
    brief.commands = brief.commands
        .map((c, i) => ({ c, i }))
        .sort((a, b) => order.get(a.c.who)! - order.get(b.c.who)! || a.i - b.i)
        .map((x, i) => ({ ...x.c, id: `c${i + 1}` }));
    return brief;
}

/** Rough token count of the brief as sent (JSON chars / 4). */
export function briefTokenEstimate(brief: AdvisorBrief): number {
    return Math.ceil(JSON.stringify(brief).length / 4);
}
