// Save/load part 1 (task 11a1): serialize a Galaxy to a plain JSON-safe
// object and rebuild it without re-running generation. Object references
// are replaced by indices into the corresponding arrays (habitats, races);
// RNG state is snapshotted via Random.getState/setState (random.ts). The
// C# Galaxy ISerializable members are not ported — this is our own save
// format for the headless sim.

import { Galaxy } from '../galaxy';
import type { GameData } from '../data/gameData';
import { buildResourceSystem, type ResourceSystem } from '../resourceSystem';
import { buildResearchStatic, type ResearchStatic } from '../researchSystem';
import { EmpireTerritory } from '../territory';
import { Population, PopulationList } from '../population';
import { Creature, type AnchorPoint } from '../creature';
import { GalaxyLocation } from '../galaxyLocation';
import { Habitat, type SystemInfo } from '../types';
import { Random, type RandomState } from '../random';
import type { Race } from '../data/races';
import { CargoList, TroopList } from '../cargo';
import { Empire } from '../empire';
import { EmpireVisibility } from '../visibility';
import { ResearchSystem } from '../researchSystem';

// ---------------------------------------------------------------------------
// JSON shapes (key order is fixed so round-tripped strings compare equal)
// ---------------------------------------------------------------------------

interface HabitatJSON {
    name: string;
    category: number;
    type: number;
    xpos: number;
    ypos: number;
    parentIndex: number; // -1 = no parent
    orbitAngle: number;
    orbitDirection: boolean;
    orbitDistance: number;
    orbitSpeed: number;
    diameter: number;
    pictureRef: number;
    landscapePictureRef: number;
    baseQuality: number;
    atmosphere: number;
    atmosphereDensity: number;
    systemIndex: number;
    habitatIndex: number;
    scenicFactor: number;
    scenicFeature: string;
    researchBonus: number;
    researchBonusIndustry: number;
    hasRings: boolean;
    novaProgression: number;
    novaImageIndexMajor: number;
    novaImageIndexMinor: number;
    resources: { resourceId: number; abundance: number }[];
    population: { raceName: string; amount: number; unassimilatedAmount: number; growthRate: number }[];
    populationTotalAmount: number;
    cargo: null; // TODO(port): CargoList serialization — task 11a2.
    troops: null; // TODO(port): TroopList serialization — task 11a2.
    developmentLevel: number;
    ownerIndex: number; // -1 = unowned (empire index into the flat empire list)
    empireIndex: number; // -1 = none
    isRefuellingDepot: boolean;
    damage: number;
    troopsToRecruit: null; // TODO(port): task 11a2.
    invadingTroops: null; // TODO(port): task 11a2.
    colonyInfluenceRadius: number;
    facilities: null; // TODO(port): PlanetaryFacility model + serialization.
}

interface SystemJSON {
    systemStarIndex: number;
    habitatIndices: number[];
    sectorX: number;
    sectorY: number;
    planetCount: number | null;
    moonCount: number | null;
    independentColonyCount: number | null;
    dominantEmpire: { empireIndex: number; colonyCount: number; totalStrategicValue: number } | null;
    otherEmpires: { empireIndex: number; colonyCount: number; totalStrategicValue: number }[] | null;
}

// Task 11a2: one Empire (galaxy.empires / pirateEmpires / independentEmpire).
// Object references become indices/names into the save's own arrays: capital
// and home world → habitat index, colonies → habitat indices, dominant race →
// race name, government → id. Heavy engine state (visibility, research,
// built objects, ships, ...) is rebuilt on load, not serialized.
interface EmpireJSON {
    active: boolean;
    empireId: number;
    name: string;
    capitalIndex: number; // -1 = none
    homeWorldIndex: number; // -1 = none
    dominantRaceName: string | null;
    corruptionMultiplier: number;
    lastDisasterDate: number;
    policyName: string | null;
    reclusive: boolean;
    allowableGovernmentTypes: number[];
    governmentId: number;
    designNamesIndex: number;
    controlColonization: number;
    controlColonyDevelopment: boolean;
    controlColonyStockLevels: boolean;
    controlColonyTaxRates: boolean;
    controlDesigns: boolean;
    controlDiplomacyGifts: number;
    controlDiplomacyOffense: number;
    controlDiplomacyTreaties: number;
    controlMilitaryAttacks: number;
    controlMilitaryFleets: boolean;
    controlStateConstruction: number;
    controlTroopGeneration: boolean;
    controlAgentAssignment: number;
    controlResearch: boolean;
    controlColonyFacilities: number;
    controlPopulationPolicy: boolean;
    controlCharacterLocations: boolean;
    controlOfferPirateMissions: number;
    mainColor: number;
    secondaryColor: number;
    flagShape: number;
    smallFlagPicture: number;
    largeFlagPicture: number;
    troopDescription: string;
    troopPictureRef: number;
    stateMoney: number;
    canColonizeContinental: boolean;
    canColonizeMarshySwamp: boolean;
    canColonizeOcean: boolean;
    canColonizeDesert: boolean;
    canColonizeIce: boolean;
    canColonizeVolcanic: boolean;
    designPictureFamilyIndex: number;
    preWarpProgressEventsOccurred: boolean;
    initiateConstruction: boolean;
    expansion: number;
    playerEmpire: boolean;
    privateMoney: number;
    lastLeaderChangeDate: number;
    coloniesIndices: number[];
}

interface GalaxyLocationJSON {
    name: string;
    showName: boolean;
    type: number;
    xpos: number;
    ypos: number;
    width: number;
    height: number;
    pictureRef: number;
    message: string;
    effect: number;
    effectAmount: number;
    effectRandomSeed: number;
    shape: number;
    soundScheme: number;
    relatedRaceIndex: number; // -1 = none
}

interface CreatureJSON {
    creatureId: number;
    name: string;
    type: number;
    xpos: number;
    ypos: number;
    size: number;
    currentSpeed: number;
    targetHeading: number;
    topSpeed: number;
    parentHabitatIndex: number; // -1 = none
    hasBeenDestroyed: boolean;
    attackStrength: number;
    pictureRef: number;
    maxSize: number;
    damage: number;
    damageKillThreshold: number;
    turnRate: number;
    accelerationRate: number;
    healRate: number;
    birthDate: number;
    anchorHabitatIndex: number; // -1 = none
    anchorPoint: AnchorPoint | null;
    anchorRange: number;
    attackRange: number;
    nearestSystemStarIndex: number; // -1 = none
    movementSpeed: number;
    movementSpeedBase: number;
    hyperSpeed: number;
    hyperCountdown: number;
    canHide: boolean;
    isBenign: boolean;
    lungeSpeed: number;
    lungeSpeedBase: number;
    lungeLength: number;
    lungeAccelerationRate: number;
    lungeInterval: number;
    lastLunge: number;
    parentOffsetX: number;
    parentOffsetY: number;
    locationLocked: boolean;
    lastPositionX: number;
    lastPositionY: number;
    parentX: number;
    parentY: number;
    currentHeading: number;
    turnDirection: number;
    targetSpeed: number;
    distanceToTarget: number;
    isVisible: boolean;
    isAttacking: boolean;
    reproductionCounter: number;
    movementSlowedLocation: boolean;
    hyperjumpDisabledLocation: boolean;
    creaturePullAmountLocation: number;
    creaturePullAngleLocation: number;
    creatureDamageAmountLocation: number;
    lastTouch: number;
    lastShortTouch: number;
    lastPeriodicTouch: number;
    lastLongTouch: number;
    promptSystemCheck: boolean;
}

export interface GalaxySaveJSON {
    version: 1;
    randomSeed: number;
    rnd: RandomState;
    cryptoRnd: RandomState;
    sizeX: number;
    sizeY: number;
    sectorSize: number;
    sectorWidth: number;
    sectorHeight: number;
    starCount: number;
    galaxyShape: number;
    colonyPrevalence: number;
    creaturePrevalence: number;
    allowGiantKaltorGeneration: boolean;
    currentTimeSeconds: number;
    nextCreatureId: number;
    silverMistCreatureCount: number;
    independentCount: number;
    lifePrevalence: number;
    age: number;
    colonyNames: string[] | null;
    colonyNameIndex: number;
    nextEmpireId: number;
    empireTerritoryColonyInfluenceRangeFactor: number;
    empires: EmpireJSON[];
    pirateEmpires: EmpireJSON[];
    independentEmpire: EmpireJSON | null;
    playerEmpire: number; // index into the flat empire list, -1 = none
    systemNames: string[];
    systemNamesUsedPlain: boolean[];
    systemNamesUsedAlternative: boolean[];
    starClusterLocations: { x: number; y: number }[];
    starClusterPortions: number[];
    raceUsed: boolean[] | null;
    raceIndependentColonyCount: number[] | null;
    continentalRaces: number[]; // indices into gameData.races
    marshySwampRaces: number[];
    desertRaces: number[];
    oceanRaces: number[];
    iceRaces: number[];
    volcanicRaces: number[];
    barrenRockRaces: number[];
    habitats: HabitatJSON[];
    systems: SystemJSON[];
    galaxyLocations: GalaxyLocationJSON[];
    creatures: CreatureJSON[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function habitatIndexOf(galaxy: Galaxy, habitat: Habitat | null): number {
    if (habitat === null) return -1;
    const index = galaxy.habitats.indexOf(habitat);
    if (index < 0) throw new Error('Habitat is not in galaxy.habitats.');
    return index;
}

function raceIndexOf(races: Race[], race: Race | null): number {
    if (race === null) return -1;
    const index = races.indexOf(race);
    if (index < 0) throw new Error('Race is not in galaxy.races.');
    return index;
}

/** Flat list of all empires in save order: galaxy.empires, then
 *  pirateEmpires, then independentEmpire. The index into this list is what
 *  habitat ownerIndex/empireIndex and system dominantEmpire/otherEmpires
 *  store (task 11a2). */
export function flatEmpireList(galaxy: Galaxy): Empire[] {
    const list = [...galaxy.empires, ...galaxy.pirateEmpires];
    if (galaxy.independentEmpire !== null) list.push(galaxy.independentEmpire);
    return list;
}

/** Convert an Empire to its JSON shape (see EmpireJSON). Habitat references
 *  become indices via habitatIndexOf; the dominant race becomes its name. */
function empireToJSON(galaxy: Galaxy, e: Empire): EmpireJSON {
    // TODO(port): policy — EmpirePolicy data model not ported yet; carry the
    // policy's Name when it has one (the C# save serializes by name).
    const policy = e.policy as { name?: unknown } | null;
    return {
        active: e.active,
        empireId: e.empireId,
        name: e.name,
        capitalIndex: habitatIndexOf(galaxy, e.capital),
        homeWorldIndex: habitatIndexOf(galaxy, e.homeWorld),
        dominantRaceName: e.dominantRace?.name ?? null,
        corruptionMultiplier: e.corruptionMultiplier,
        lastDisasterDate: e.lastDisasterDate,
        policyName: typeof policy?.name === 'string' ? policy.name : null,
        reclusive: e.reclusive,
        allowableGovernmentTypes: [...e.allowableGovernmentTypes],
        governmentId: e.governmentId,
        designNamesIndex: e.designNamesIndex,
        controlColonization: e.controlColonization,
        controlColonyDevelopment: e.controlColonyDevelopment,
        controlColonyStockLevels: e.controlColonyStockLevels,
        controlColonyTaxRates: e.controlColonyTaxRates,
        controlDesigns: e.controlDesigns,
        controlDiplomacyGifts: e.controlDiplomacyGifts,
        controlDiplomacyOffense: e.controlDiplomacyOffense,
        controlDiplomacyTreaties: e.controlDiplomacyTreaties,
        controlMilitaryAttacks: e.controlMilitaryAttacks,
        controlMilitaryFleets: e.controlMilitaryFleets,
        controlStateConstruction: e.controlStateConstruction,
        controlTroopGeneration: e.controlTroopGeneration,
        controlAgentAssignment: e.controlAgentAssignment,
        controlResearch: e.controlResearch,
        controlColonyFacilities: e.controlColonyFacilities,
        controlPopulationPolicy: e.controlPopulationPolicy,
        controlCharacterLocations: e.controlCharacterLocations,
        controlOfferPirateMissions: e.controlOfferPirateMissions,
        mainColor: e.mainColor,
        secondaryColor: e.secondaryColor,
        flagShape: e.flagShape,
        smallFlagPicture: e.smallFlagPicture,
        largeFlagPicture: e.largeFlagPicture,
        troopDescription: e.troopDescription,
        troopPictureRef: e.troopPictureRef,
        stateMoney: e.stateMoney,
        canColonizeContinental: e.canColonizeContinental,
        canColonizeMarshySwamp: e.canColonizeMarshySwamp,
        canColonizeOcean: e.canColonizeOcean,
        canColonizeDesert: e.canColonizeDesert,
        canColonizeIce: e.canColonizeIce,
        canColonizeVolcanic: e.canColonizeVolcanic,
        designPictureFamilyIndex: e.designPictureFamilyIndex,
        preWarpProgressEventsOccurred: e.preWarpProgressEventsOccurred,
        initiateConstruction: e.initiateConstruction,
        expansion: e.expansion,
        playerEmpire: e.playerEmpire,
        privateMoney: e.privateMoney,
        lastLeaderChangeDate: e.lastLeaderChangeDate,
        coloniesIndices: e.colonies.map((h) => habitatIndexOf(galaxy, h)),
    };
}

/** Rebuild an Empire without running its constructor (it consumes the
 *  galaxy RNG for colours/names and builds visibility/research). Heavy
 *  engine state gets minimal stand-ins; visibility is rebuilt afterwards
 *  (it needs the restored habitats/systems). */
function empireFromJSON(
    galaxy: Galaxy,
    races: Race[],
    e: EmpireJSON,
    habitats: Habitat[],
    isIndependent: boolean,
): Empire {
    const raceByName = (name: string | null): Race | null =>
        name === null ? null : (races.find((r) => r.name === name) ?? null);
    const habAt = (i: number): Habitat | null => (i < 0 ? null : habitats[i]);
    const empire = createInstance(Empire, {
        galaxy,
        active: e.active,
        empireId: e.empireId,
        counters: {}, // TODO(port): EmpireCounters — EmpireCounters.cs.
        pirateEconomy: {}, // TODO(port): PirateEconomy — PirateEconomy.cs.
        name: e.name,
        capital: habAt(e.capitalIndex),
        homeWorld: habAt(e.homeWorldIndex),
        dominantRace: raceByName(e.dominantRaceName),
        corruptionMultiplier: e.corruptionMultiplier,
        lastDisasterDate: e.lastDisasterDate,
        // TODO(port): policy — restore from policyName once the EmpirePolicy
        // data model is ported; {} matches the class default.
        policy: {},
        reclusive: e.reclusive,
        allowableGovernmentTypes: [...e.allowableGovernmentTypes],
        governmentId: e.governmentId,
        designNamesIndex: e.designNamesIndex,
        builtObjects: [],
        shipGroups: [],
        designs: [],
        latestDesigns: [],
        foreignDesigns: [],
        characters: [],
        troops: new TroopList(),
        intelligenceMissions: [],
        outlaws: [],
        diplomaticRelations: [],
        proposedDiplomaticRelations: [],
        colonies: e.coloniesIndices.map((i) => habitats[i]),
        constructionYards: [],
        distressSignals: [],
        manufacturers: [],
        privateBuiltObjects: [],
        refuellingDepots: [],
        resourceExtractors: [],
        spacePorts: [],
        miningStations: [],
        freighters: [],
        constructionShips: [],
        longRangeScanners: [],
        researchFacilities: [],
        resortBases: [],
        resupplyShips: [],
        planetDestroyers: [],
        messages: [],
        empireEvaluations: [],
        controlColonization: e.controlColonization,
        controlColonyDevelopment: e.controlColonyDevelopment,
        controlColonyStockLevels: e.controlColonyStockLevels,
        controlColonyTaxRates: e.controlColonyTaxRates,
        controlDesigns: e.controlDesigns,
        controlDiplomacyGifts: e.controlDiplomacyGifts,
        controlDiplomacyOffense: e.controlDiplomacyOffense,
        controlDiplomacyTreaties: e.controlDiplomacyTreaties,
        controlMilitaryAttacks: e.controlMilitaryAttacks,
        controlMilitaryFleets: e.controlMilitaryFleets,
        controlStateConstruction: e.controlStateConstruction,
        controlTroopGeneration: e.controlTroopGeneration,
        controlAgentAssignment: e.controlAgentAssignment,
        controlResearch: e.controlResearch,
        controlColonyFacilities: e.controlColonyFacilities,
        controlPopulationPolicy: e.controlPopulationPolicy,
        controlCharacterLocations: e.controlCharacterLocations,
        controlOfferPirateMissions: e.controlOfferPirateMissions,
        mainColor: e.mainColor,
        secondaryColor: e.secondaryColor,
        flagShape: e.flagShape,
        smallFlagPicture: e.smallFlagPicture,
        largeFlagPicture: e.largeFlagPicture,
        troopDescription: e.troopDescription,
        troopPictureRef: e.troopPictureRef,
        stateMoney: e.stateMoney,
        canColonizeContinental: e.canColonizeContinental,
        canColonizeMarshySwamp: e.canColonizeMarshySwamp,
        canColonizeOcean: e.canColonizeOcean,
        canColonizeDesert: e.canColonizeDesert,
        canColonizeIce: e.canColonizeIce,
        canColonizeVolcanic: e.canColonizeVolcanic,
        designPictureFamilyIndex: e.designPictureFamilyIndex,
        preWarpProgressEventsOccurred: e.preWarpProgressEventsOccurred,
        initiateConstruction: e.initiateConstruction,
        expansion: e.expansion,
        playerEmpire: e.playerEmpire,
        privateMoney: e.privateMoney,
        research: new ResearchSystem(galaxy.researchStatic),
        lastLeaderChangeDate: e.lastLeaderChangeDate,
        designSpecifications: [],
        planetDestroyerDesignSpecification: null,
    });
    // Visibility must be created after habitats/systems exist (its ctor sizes
    // the resource map and builds one SystemVisibility per system).
    empire.visibility = new EmpireVisibility(galaxy, empire.visibilityOwner(isIndependent));
    return empire;
}
function createInstance<T>(ctor: new (...args: never[]) => T, fields: Record<string, unknown>): T {
    const instance = Object.create(ctor.prototype) as T;
    for (const key of Object.keys(fields)) {
        (instance as unknown as Record<string, unknown>)[key] = fields[key];
    }
    return instance;
}

/** Habitat._anglePerSecond is private; recompute it on load exactly like
 *  the constructor does ((2π) / (orbitPathLength / orbitSpeed)). */
function setAnglePerSecond(habitat: Habitat, value: number): void {
    (habitat as unknown as { _anglePerSecond: number })._anglePerSecond = value;
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/** Convert a Galaxy into a plain JSON-safe object (see GalaxySaveJSON). */
export function galaxyToJSON(galaxy: Galaxy): GalaxySaveJSON {
    const races = galaxy.races;

    // Task 11a2: flat empire list + index map for all empire references.
    const empires = flatEmpireList(galaxy);
    const empireIndex = new Map<Empire, number>();
    empires.forEach((e, i) => empireIndex.set(e, i));
    const empireIndexOf = (e: Empire | null): number => {
        if (e === null) return -1;
        const i = empireIndex.get(e);
        if (i === undefined) throw new Error('Empire is not in the galaxy.');
        return i;
    };

    const habitats: HabitatJSON[] = galaxy.habitats.map((h) => ({
        name: h.name,
        category: h.category,
        type: h.type,
        xpos: h.xpos,
        ypos: h.ypos,
        parentIndex: habitatIndexOf(galaxy, h.parent),
        orbitAngle: h.orbitAngle,
        orbitDirection: h.orbitDirection,
        orbitDistance: h.orbitDistance,
        orbitSpeed: h.orbitSpeed,
        diameter: h.diameter,
        pictureRef: h.pictureRef,
        landscapePictureRef: h.landscapePictureRef,
        baseQuality: h.baseQuality,
        atmosphere: h.atmosphere,
        atmosphereDensity: h.atmosphereDensity,
        systemIndex: h.systemIndex,
        habitatIndex: h.habitatIndex,
        scenicFactor: h.scenicFactor,
        scenicFeature: h.scenicFeature,
        researchBonus: h.researchBonus,
        researchBonusIndustry: h.researchBonusIndustry,
        hasRings: h.hasRings,
        novaProgression: h.novaProgression,
        novaImageIndexMajor: h.novaImageIndexMajor,
        novaImageIndexMinor: h.novaImageIndexMinor,
        resources: h.resources.map((r) => ({ resourceId: r.resourceId, abundance: r.abundance })),
        population: h.population.items.map((p) => ({
            raceName: p.race.name,
            amount: p.amount,
            unassimilatedAmount: p.unassimilatedAmount,
            growthRate: p.growthRate,
        })),
        populationTotalAmount: h.population.totalAmount,
        cargo: null,
        troops: null,
        developmentLevel: h.developmentLevel,
        ownerIndex: empireIndexOf(h.owner),
        empireIndex: empireIndexOf(h.empire),
        isRefuellingDepot: h.isRefuellingDepot,
        damage: h.damage,
        troopsToRecruit: null,
        invadingTroops: null,
        colonyInfluenceRadius: h.colonyInfluenceRadius,
        facilities: null,
    }));

    const systems: SystemJSON[] = galaxy.systems.map((sys) => ({
        systemStarIndex: habitatIndexOf(galaxy, sys.systemStar),
        habitatIndices: sys.habitats.map((h) => habitatIndexOf(galaxy, h)),
        sectorX: sys.sector.x,
        sectorY: sys.sector.y,
        planetCount: sys.planetCount ?? null,
        moonCount: sys.moonCount ?? null,
        independentColonyCount: sys.independentColonyCount ?? null,
        dominantEmpire: sys.dominantEmpire === null || sys.dominantEmpire === undefined
            ? null
            : {
                  empireIndex: empireIndexOf(sys.dominantEmpire.empire),
                  colonyCount: sys.dominantEmpire.colonyCount,
                  totalStrategicValue: sys.dominantEmpire.totalStrategicValue,
              },
        otherEmpires: sys.otherEmpires === null || sys.otherEmpires === undefined
            ? null
            : sys.otherEmpires.map((o) => ({
                  empireIndex: empireIndexOf(o.empire),
                  colonyCount: o.colonyCount,
                  totalStrategicValue: o.totalStrategicValue,
              })),
    }));

    const galaxyLocations: GalaxyLocationJSON[] = galaxy.galaxyLocations.map((loc) => ({
        name: loc.name,
        showName: loc.showName,
        type: loc.type,
        xpos: loc.xpos,
        ypos: loc.ypos,
        width: loc.width,
        height: loc.height,
        pictureRef: loc.pictureRef,
        message: loc.message,
        effect: loc.effect,
        effectAmount: loc.effectAmount,
        effectRandomSeed: loc.effectRandomSeed,
        shape: loc.shape,
        soundScheme: loc.soundScheme,
        relatedRaceIndex: raceIndexOf(races, loc.relatedRace),
    }));

    const creatures: CreatureJSON[] = galaxy.creatures.map((c) => ({
        creatureId: c.creatureId,
        name: c.name,
        type: c.type,
        xpos: c.xpos,
        ypos: c.ypos,
        size: c.size,
        currentSpeed: c.currentSpeed,
        targetHeading: c.targetHeading,
        topSpeed: c.topSpeed,
        parentHabitatIndex: habitatIndexOf(galaxy, c.parentHabitat),
        hasBeenDestroyed: c.hasBeenDestroyed,
        attackStrength: c.attackStrength,
        pictureRef: c.pictureRef,
        maxSize: c.maxSize,
        damage: c.damage,
        damageKillThreshold: c.damageKillThreshold,
        turnRate: c.turnRate,
        accelerationRate: c.accelerationRate,
        healRate: c.healRate,
        birthDate: c.birthDate,
        anchorHabitatIndex: habitatIndexOf(galaxy, c.anchorHabitat),
        anchorPoint: c.anchorPoint,
        anchorRange: c.anchorRange,
        attackRange: c.attackRange,
        nearestSystemStarIndex: habitatIndexOf(galaxy, c.nearestSystemStar),
        movementSpeed: c.movementSpeed,
        movementSpeedBase: c.movementSpeedBase,
        hyperSpeed: c.hyperSpeed,
        hyperCountdown: c.hyperCountdown,
        canHide: c.canHide,
        isBenign: c.isBenign,
        lungeSpeed: c.lungeSpeed,
        lungeSpeedBase: c.lungeSpeedBase,
        lungeLength: c.lungeLength,
        lungeAccelerationRate: c.lungeAccelerationRate,
        lungeInterval: c.lungeInterval,
        lastLunge: c.lastLunge,
        parentOffsetX: c.parentOffsetX,
        parentOffsetY: c.parentOffsetY,
        locationLocked: c.locationLocked,
        lastPositionX: c.lastPositionX,
        lastPositionY: c.lastPositionY,
        parentX: c.parentX,
        parentY: c.parentY,
        currentHeading: c.currentHeading,
        turnDirection: c.turnDirection,
        targetSpeed: c.targetSpeed,
        distanceToTarget: c.distanceToTarget,
        isVisible: c.isVisible,
        isAttacking: c.isAttacking,
        reproductionCounter: c.reproductionCounter,
        movementSlowedLocation: c.movementSlowedLocation,
        hyperjumpDisabledLocation: c.hyperjumpDisabledLocation,
        creaturePullAmountLocation: c.creaturePullAmountLocation,
        creaturePullAngleLocation: c.creaturePullAngleLocation,
        creatureDamageAmountLocation: c.creatureDamageAmountLocation,
        lastTouch: c.lastTouch,
        lastShortTouch: c.lastShortTouch,
        lastPeriodicTouch: c.lastPeriodicTouch,
        lastLongTouch: c.lastLongTouch,
        promptSystemCheck: c.promptSystemCheck,
    }));

    return {
        version: 1,
        randomSeed: galaxy.randomSeed,
        rnd: galaxy.rnd.getState(),
        cryptoRnd: galaxy.cryptoRnd.getState(),
        sizeX: galaxy.sizeX,
        sizeY: galaxy.sizeY,
        sectorSize: galaxy.sectorSize,
        sectorWidth: galaxy.sectorWidth,
        sectorHeight: galaxy.sectorHeight,
        starCount: galaxy.starCount,
        galaxyShape: galaxy.galaxyShape,
        colonyPrevalence: galaxy.colonyPrevalence,
        creaturePrevalence: galaxy.creaturePrevalence,
        allowGiantKaltorGeneration: galaxy.allowGiantKaltorGeneration,
        currentTimeSeconds: galaxy.currentTimeSeconds,
        nextCreatureId: galaxy.nextCreatureId,
        silverMistCreatureCount: galaxy.silverMistCreatureCount,
        independentCount: galaxy.independentCount,
        lifePrevalence: galaxy.lifePrevalence,
        age: galaxy.age,
        colonyNames: galaxy.colonyNames,
        colonyNameIndex: galaxy.colonyNameIndex,
        nextEmpireId: galaxy.nextEmpireId,
        empireTerritoryColonyInfluenceRangeFactor: galaxy.empireTerritoryColonyInfluenceRangeFactor,
        empires: galaxy.empires.map((e) => empireToJSON(galaxy, e)),
        pirateEmpires: galaxy.pirateEmpires.map((e) => empireToJSON(galaxy, e)),
        independentEmpire: galaxy.independentEmpire === null ? null : empireToJSON(galaxy, galaxy.independentEmpire),
        playerEmpire: empireIndexOf(galaxy.playerEmpire),
        systemNames: [...(galaxy as unknown as { systemNames: string[] }).systemNames],
        systemNamesUsedPlain: [...(galaxy as unknown as { systemNamesUsedPlain: boolean[] }).systemNamesUsedPlain],
        systemNamesUsedAlternative: [...(galaxy as unknown as { systemNamesUsedAlternative: boolean[] }).systemNamesUsedAlternative],
        starClusterLocations: [...(galaxy as unknown as { starClusterLocations: { x: number; y: number }[] }).starClusterLocations],
        starClusterPortions: [...(galaxy as unknown as { starClusterPortions: number[] }).starClusterPortions],
        raceUsed: (() => {
            const v = (galaxy as unknown as { raceUsed: boolean[] | null }).raceUsed;
            return v ? [...v] : null;
        })(),
        raceIndependentColonyCount: (() => {
            const v = (galaxy as unknown as { raceIndependentColonyCount: number[] | null }).raceIndependentColonyCount;
            return v ? [...v] : null;
        })(),
        continentalRaces: galaxy.continentalRaces.map((r) => raceIndexOf(races, r)),
        marshySwampRaces: galaxy.marshySwampRaces.map((r) => raceIndexOf(races, r)),
        desertRaces: galaxy.desertRaces.map((r) => raceIndexOf(races, r)),
        oceanRaces: galaxy.oceanRaces.map((r) => raceIndexOf(races, r)),
        iceRaces: galaxy.iceRaces.map((r) => raceIndexOf(races, r)),
        volcanicRaces: galaxy.volcanicRaces.map((r) => raceIndexOf(races, r)),
        barrenRockRaces: galaxy.barrenRockRaces.map((r) => raceIndexOf(races, r)),
        habitats,
        systems,
        galaxyLocations,
        creatures,
    };
}

// ---------------------------------------------------------------------------
// Deserialize
// ---------------------------------------------------------------------------

/** Rebuild a Galaxy from a galaxyToJSON object. Static data (resources,
 *  research, races) comes from gameData, mirroring generateGalaxy's wiring. */
export function galaxyFromJSON(obj: GalaxySaveJSON, gameData: GameData): Galaxy {
    const races = gameData.races;
    const raceByIndex = (i: number): Race | null => (i < 0 ? null : races[i]);

    // --- Galaxies are rebuilt without the constructor (it seeds the RNGs
    //     and clamps physical dimensions); every field is assigned below.
    const galaxy = createInstance(Galaxy, {});
    const g = galaxy as unknown as Record<string, unknown>;

    g.randomSeed = obj.randomSeed;
    g.rnd = new Random(0);
    g.cryptoRnd = new Random(0);
    (g.rnd as Random).setState(obj.rnd);
    (g.cryptoRnd as Random).setState(obj.cryptoRnd);
    g.sizeX = obj.sizeX;
    g.sizeY = obj.sizeY;
    g.sectorSize = obj.sectorSize;
    g.sectorWidth = obj.sectorWidth;
    g.sectorHeight = obj.sectorHeight;
    g.starCount = obj.starCount;
    g.galaxyShape = obj.galaxyShape;
    g.colonyPrevalence = obj.colonyPrevalence;
    g.creaturePrevalence = obj.creaturePrevalence;
    g.allowGiantKaltorGeneration = obj.allowGiantKaltorGeneration;
    g.currentTimeSeconds = obj.currentTimeSeconds;
    g.nextCreatureId = obj.nextCreatureId;
    g.silverMistCreatureCount = obj.silverMistCreatureCount;
    g.independentCount = obj.independentCount;
    g.lifePrevalence = obj.lifePrevalence;
    g.age = obj.age;
    g.colonyNames = obj.colonyNames;
    g.colonyNameIndex = obj.colonyNameIndex;
    g.nextEmpireId = obj.nextEmpireId;
    g.empireTerritoryColonyInfluenceRangeFactor = obj.empireTerritoryColonyInfluenceRangeFactor;
    // empires/pirateEmpires/independentEmpire/playerEmpire are restored after
    // habitats and systems exist (empire visibility is built from them).
    g.systemNames = obj.systemNames;
    g.systemNamesUsedPlain = obj.systemNamesUsedPlain;
    g.systemNamesUsedAlternative = obj.systemNamesUsedAlternative;
    g.starClusterLocations = obj.starClusterLocations;
    g.starClusterPortions = obj.starClusterPortions;
    g.raceUsed = obj.raceUsed;
    g.raceIndependentColonyCount = obj.raceIndependentColonyCount;
    g.stepOrder = [];
    g.stepOrderDirty = true; // lazy: step() rebuilds before first use
    g.resources = gameData.resources;
    g.resourceSystem = buildResourceSystem(gameData.resources, gameData.components);
    g.researchStatic = buildResearchStatic(gameData.research, gameData.components, gameData.races);
    g.races = races;
    g.continentalRaces = obj.continentalRaces.map((i) => raceByIndex(i)!);
    g.marshySwampRaces = obj.marshySwampRaces.map((i) => raceByIndex(i)!);
    g.desertRaces = obj.desertRaces.map((i) => raceByIndex(i)!);
    g.oceanRaces = obj.oceanRaces.map((i) => raceByIndex(i)!);
    g.iceRaces = obj.iceRaces.map((i) => raceByIndex(i)!);
    g.volcanicRaces = obj.volcanicRaces.map((i) => raceByIndex(i)!);
    g.barrenRockRaces = obj.barrenRockRaces.map((i) => raceByIndex(i)!);
    g.empireTerritory = new EmpireTerritory(); // TODO(port): restore territory — task 11a2.
    g.galaxyLocations = [];
    g.galaxyLocationIndex = [];
    g.habitats = [];
    g.systems = [];
    g.creatures = [];
    g.habitatIndexGrid = [];
    g.systemsIndexGrid = [];

    // --- Habitats: construct without the ctor (it validates category/type
    //     and performs the initial 30s orbit move), then re-link parents.
    const habitats: Habitat[] = obj.habitats.map((hj) => {
        const population = new PopulationList();
        population.items = hj.population.map((pj) => {
            const race = races.find((r) => r.name === pj.raceName);
            if (!race) throw new Error(`Unknown race ${pj.raceName} in save.`);
            const p = new Population();
            p.race = race;
            p.amount = pj.amount;
            p.unassimilatedAmount = pj.unassimilatedAmount;
            p.growthRate = pj.growthRate;
            return p;
        });
        population.totalAmount = hj.populationTotalAmount;
        const habitat = createInstance(Habitat, {
            name: hj.name,
            category: hj.category,
            type: hj.type,
            xpos: hj.xpos,
            ypos: hj.ypos,
            parent: null,
            orbitAngle: hj.orbitAngle,
            orbitDirection: hj.orbitDirection,
            orbitDistance: hj.orbitDistance,
            orbitSpeed: hj.orbitSpeed,
            diameter: hj.diameter,
            pictureRef: hj.pictureRef,
            landscapePictureRef: hj.landscapePictureRef,
            baseQuality: hj.baseQuality,
            atmosphere: hj.atmosphere,
            atmosphereDensity: hj.atmosphereDensity,
            systemIndex: hj.systemIndex,
            habitatIndex: hj.habitatIndex,
            scenicFactor: hj.scenicFactor,
            scenicFeature: hj.scenicFeature,
            researchBonus: hj.researchBonus,
            researchBonusIndustry: hj.researchBonusIndustry,
            hasRings: hj.hasRings,
            novaProgression: hj.novaProgression,
            novaImageIndexMajor: hj.novaImageIndexMajor,
            novaImageIndexMinor: hj.novaImageIndexMinor,
            resources: hj.resources.map((r) => ({ ...r })),
            population,
            cargo: null, // TODO(port): task 11a2.
            troops: null, // TODO(port): task 11a2.
            developmentLevel: hj.developmentLevel,
            owner: null, // re-linked from ownerIndex after empires are restored.
            empire: null, // re-linked from empireIndex after empires are restored.
            isRefuellingDepot: hj.isRefuellingDepot,
            damage: hj.damage,
            troopsToRecruit: null, // TODO(port): task 11a2.
            invadingTroops: null, // TODO(port): task 11a2.
            colonyInfluenceRadius: hj.colonyInfluenceRadius,
            facilities: null, // TODO(port): task 11a2.
        });
        if (hj.parentIndex >= 0) {
            // Parent is linked in the second pass; _anglePerSecond is
            // recomputed there (it depends only on orbitDistance/orbitSpeed).
            setAnglePerSecond(habitat, (Math.PI * 2.0) / ((Math.PI * hj.orbitDistance * 2.0) / hj.orbitSpeed));
        } else {
            setAnglePerSecond(habitat, 0);
        }
        return habitat;
    });
    for (let i = 0; i < habitats.length; i++) {
        const parentIndex = obj.habitats[i].parentIndex;
        habitats[i].parent = parentIndex < 0 ? null : habitats[parentIndex];
    }
    g.habitats = habitats;

    // --- Systems: re-link by habitat index; count fields restored verbatim
    //     (updateSystemInfo would recompute them against the not-yet-loaded
    //     empires and diverge from the saved values).
    const systems: SystemInfo[] = obj.systems.map((sj) => {
        const sys: SystemInfo = {
            systemStar: habitats[sj.systemStarIndex],
            habitats: sj.habitatIndices.map((i) => habitats[i]),
            sector: { x: sj.sectorX, y: sj.sectorY },
            planetCount: sj.planetCount ?? undefined,
            moonCount: sj.moonCount ?? undefined,
            independentColonyCount: sj.independentColonyCount ?? undefined,
            dominantEmpire: null, // re-linked after empires are restored.
            otherEmpires: null, // re-linked after empires are restored.
        };
        return sys;
    });
    g.systems = systems;

    // --- Empires (task 11a2): rebuild without the constructor, then re-link
    //     habitat owner/empire refs and system dominant/other empire info.
    const flatEmpires: Empire[] = [
        ...obj.empires.map((e) => empireFromJSON(galaxy, races, e, habitats, false)),
        ...obj.pirateEmpires.map((e) => empireFromJSON(galaxy, races, e, habitats, false)),
    ];
    const independentEmpire = obj.independentEmpire === null ? null : empireFromJSON(galaxy, races, obj.independentEmpire, habitats, true);
    if (independentEmpire !== null) flatEmpires.push(independentEmpire);
    g.empires = flatEmpires.slice(0, obj.empires.length);
    g.pirateEmpires = flatEmpires.slice(obj.empires.length, obj.empires.length + obj.pirateEmpires.length);
    g.independentEmpire = independentEmpire;
    g.playerEmpire = obj.playerEmpire < 0 ? null : flatEmpires[obj.playerEmpire];
    for (let i = 0; i < habitats.length; i++) {
        const hj = obj.habitats[i];
        habitats[i].owner = hj.ownerIndex < 0 ? null : flatEmpires[hj.ownerIndex];
        habitats[i].empire = hj.empireIndex < 0 ? null : flatEmpires[hj.empireIndex];
    }
    for (let i = 0; i < systems.length; i++) {
        const sj = obj.systems[i];
        systems[i].dominantEmpire = sj.dominantEmpire === null ? null : {
            empire: flatEmpires[sj.dominantEmpire.empireIndex],
            colonyCount: sj.dominantEmpire.colonyCount,
            totalStrategicValue: sj.dominantEmpire.totalStrategicValue,
        };
        systems[i].otherEmpires = sj.otherEmpires === null ? null : sj.otherEmpires.map((o) => ({
            empire: flatEmpires[o.empireIndex],
            colonyCount: o.colonyCount,
            totalStrategicValue: o.totalStrategicValue,
        }));
    }

    // --- Index grids, filled exactly like generateGalaxy/updateSystemInfo.
    galaxy.initIndexGrids();
    for (const sys of systems) {
        const cell = galaxy.resolveIndex(sys.systemStar.xpos, sys.systemStar.ypos);
        galaxy.systemsIndexGrid[cell.x][cell.y].push(sys);
        for (const habitat of sys.habitats) {
            const hc = galaxy.resolveIndex(habitat.xpos, habitat.ypos);
            galaxy.habitatIndexGrid[hc.x][hc.y].push(habitat);
        }
    }

    // --- Galaxy locations: rebuild + re-index (like generateNebulae).
    const galaxyLocations: GalaxyLocation[] = obj.galaxyLocations.map((lj) =>
        createInstance(GalaxyLocation, {
            name: lj.name,
            showName: lj.showName,
            type: lj.type,
            xpos: lj.xpos,
            ypos: lj.ypos,
            width: lj.width,
            height: lj.height,
            pictureRef: lj.pictureRef,
            message: lj.message,
            effect: lj.effect,
            effectAmount: lj.effectAmount,
            effectRandomSeed: lj.effectRandomSeed,
            shape: lj.shape,
            soundScheme: lj.soundScheme,
            relatedRace: raceByIndex(lj.relatedRaceIndex),
        }),
    );
    g.galaxyLocations = galaxyLocations;
    const indexMaxX = Math.trunc(obj.sizeX / 400_000);
    const indexMaxY = Math.trunc(obj.sizeY / 400_000);
    const locationGrid: GalaxyLocation[][][] = [];
    for (let i = 0; i < indexMaxX; i++) {
        locationGrid.push(Array.from({ length: indexMaxY }, () => []));
    }
    g.galaxyLocationIndex = locationGrid;
    for (const location of galaxyLocations) {
        galaxy.addGalaxyLocationIndex(location);
    }

    // --- Creatures: rebuild without the ctor (it consumes the galaxy RNG),
    //     then re-link habitat refs and system membership.
    const creatures: Creature[] = obj.creatures.map((cj) => {
        const creature = createInstance(Creature, {
            creatureId: cj.creatureId,
            name: cj.name,
            type: cj.type,
            galaxy,
            xpos: cj.xpos,
            ypos: cj.ypos,
            size: cj.size,
            currentSpeed: cj.currentSpeed,
            targetHeading: cj.targetHeading,
            topSpeed: cj.topSpeed,
            parentHabitat: null,
            hasBeenDestroyed: cj.hasBeenDestroyed,
            attackStrength: cj.attackStrength,
            pictureRef: cj.pictureRef,
            maxSize: cj.maxSize,
            damage: cj.damage,
            damageKillThreshold: cj.damageKillThreshold,
            turnRate: cj.turnRate,
            accelerationRate: cj.accelerationRate,
            healRate: cj.healRate,
            birthDate: cj.birthDate,
            anchorHabitat: null,
            anchorPoint: cj.anchorPoint,
            anchorRange: cj.anchorRange,
            attackRange: cj.attackRange,
            nearestSystemStar: null,
            movementSpeed: cj.movementSpeed,
            movementSpeedBase: cj.movementSpeedBase,
            hyperSpeed: cj.hyperSpeed,
            hyperCountdown: cj.hyperCountdown,
            canHide: cj.canHide,
            isBenign: cj.isBenign,
            lungeSpeed: cj.lungeSpeed,
            lungeSpeedBase: cj.lungeSpeedBase,
            lungeLength: cj.lungeLength,
            lungeAccelerationRate: cj.lungeAccelerationRate,
            lungeInterval: cj.lungeInterval,
            lastLunge: cj.lastLunge,
            parentOffsetX: cj.parentOffsetX,
            parentOffsetY: cj.parentOffsetY,
            locationLocked: cj.locationLocked,
            lastPositionX: cj.lastPositionX,
            lastPositionY: cj.lastPositionY,
            parentX: cj.parentX,
            parentY: cj.parentY,
            currentHeading: cj.currentHeading,
            turnDirection: cj.turnDirection,
            targetSpeed: cj.targetSpeed,
            distanceToTarget: cj.distanceToTarget,
            isVisible: cj.isVisible,
            isAttacking: cj.isAttacking,
            reproductionCounter: cj.reproductionCounter,
            movementSlowedLocation: cj.movementSlowedLocation,
            hyperjumpDisabledLocation: cj.hyperjumpDisabledLocation,
            creaturePullAmountLocation: cj.creaturePullAmountLocation,
            creaturePullAngleLocation: cj.creaturePullAngleLocation,
            creatureDamageAmountLocation: cj.creatureDamageAmountLocation,
            lastTouch: cj.lastTouch,
            lastShortTouch: cj.lastShortTouch,
            lastPeriodicTouch: cj.lastPeriodicTouch,
            lastLongTouch: cj.lastLongTouch,
            promptSystemCheck: cj.promptSystemCheck,
        });
        if (cj.parentHabitatIndex >= 0) creature.parentHabitat = habitats[cj.parentHabitatIndex];
        if (cj.anchorHabitatIndex >= 0) creature.anchorHabitat = habitats[cj.anchorHabitatIndex];
        if (cj.nearestSystemStarIndex >= 0) creature.nearestSystemStar = habitats[cj.nearestSystemStarIndex];
        return creature;
    });
    g.creatures = creatures;
    // Galaxy.4.cs 2349-2355: creatures join their parent habitat's system.
    for (const c of creatures) {
        const ph = c.parentHabitat;
        if (ph === null) continue;
        const sys = systems[ph.systemIndex];
        if (!sys.creatures) sys.creatures = [];
        if (!sys.creatures.includes(c)) sys.creatures.push(c);
    }

    return galaxy;
}