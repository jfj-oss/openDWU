// createEmpireMidGame (tasks/MODLAYER-DESIGN.md §4): a new AI empire or pirate faction during play, generalising how
// the game itself does it — Galaxy.8.cs 1348 GenerateShakturi (story/storyEvents.ts generateShakturi: GenerateEmpire at
// a habitat + the starting-empire set-up + evaluation biases) and Galaxy.8.cs GeneratePirateEmpire (pirates.ts
// generatePirateEmpire + the Empire-ctor touch times, as galaxyTick.ts does for factions created mid-game).
// Not a port itself; every step it runs is ported code. Draws galaxy.rnd (GenerateEmpire's / the set-up's /
// GeneratePirateEmpire's draws), so call it only from scenario hooks (Rnd policy, hooks.ts).

import { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { getGovernmentsStatic } from '../empire';
import type { Race } from '../data/races';
import type { EmpirePolicy } from '../data/policies';
import type { Habitat } from '../types';
import { generateEmpire } from '../empireGeneration';
import { Empire as EmpireClass } from '../empire';
import type { BuiltObject } from '../builtObject';
import { loadEmpirePolicy } from '../researchSystem';
import { takeOwnershipOfBuiltObject, takeOwnershipOfColonyFull } from '../combat/ownership';
import { empireStorySetup, galaxyRaceByName } from '../story/storyEvents';
import { resetEmpireTouchTimesForAge } from '../tick/gameStart';
import { initEmpireTouchTimes } from '../tick/empireTick';
import { generatePirateEmpire, PiratePlayStyle } from '../pirates';
import { obtainEmpireEvaluation } from '../diplomacy';
import { declareWar } from '../diplomacyTick';

export interface MidGameEmpireSpec {
    /** 'empire' (default): a normal AI empire whose capital is `home`; 'pirate': a pirate faction based at `home`. */
    kind?: 'empire' | 'pirate';
    /** Race (a galaxy race or its name). */
    race: Race | string;
    /** Empire name ('' / omitted: generated as the game does). */
    name?: string;
    /** Capital habitat (empire) or base habitat (pirate). Optional with adoptOnly. */
    home?: Habitat | null;
    /**
     * Adopt instead of generate (19b/19f): construct the Empire (policy, tech, design specifications, AI on, touch
     * times) without GenerateEmpire — no capital is taken or reshaped (capital null until the empire owns a colony:
     * takeOwnershipOfColonyFull → selectBestCandidateForCapital). `adopt` lists what it takes over right away.
     */
    adoptOnly?: boolean;
    /** adoptOnly: colonies / ships / bases handed to the new empire (stock ownership transfer, in list order). */
    adopt?: { colonies?: Habitat[]; builtObjects?: BuiltObject[] };
    /**
     * Keep the home planet as it is (19c): GenerateEmpire runs with no favourability (no diameter / quality / system
     * rewrite) and the capital's resources, diameter and quality are restored afterwards.
     */
    preserveHome?: boolean;
    /** Override the home-system factor (scales GenerateEmpire's starting population: ≈ factor × 2.2e9 at age 0). */
    homeSystemFactor?: number;
    /** Empire age (GenerateEmpire's; default 1) — sets colony count / development around the capital. */
    age?: number;
    /** Tech level (default 0.5, the "Normal" start). */
    techLevel?: number;
    /** Government id (default: the race's preferred starting government, else the first generally available one). */
    governmentId?: number;
    /** Home-system favourability text (default "Normal"). */
    homeSystemFavourability?: string;
    /** Run the standard starting-empire set-up (space ports, mining / research stations, ships, missions). Default true. */
    setup?: boolean;
    /** Pirate play style (pirates; default Balanced). */
    piratePlayStyle?: PiratePlayStyle;
    /**
     * 'empire' kind (not adoptOnly): runs right after GenerateEmpire (and configurePolicy), before the starting-empire
     * set-up — e.g. extra starting colonies (19a rimTraderStartColonies), which the set-up then equips like the
     * wizard's starting colonies (space ports, mining stations, garrisons). May draw galaxy.rnd.
     */
    beforeSetup?: (empire: Empire) => void;
    /** Adjust the loaded policy before the set-up (e.g. aggressive posture). */
    configurePolicy?: (policy: EmpirePolicy) => void;
    /** Evaluation bias set both ways between the new empire and every other normal empire (default: left as generated). */
    relationBias?: number;
    /** Empires the new empire declares war on right away. */
    atWarWith?: Empire[];
}

function resolveRace(galaxy: Galaxy, race: Race | string): Race {
    if (typeof race !== 'string') return race;
    const r = galaxyRaceByName(galaxy, race);
    if (r === null) throw new Error(`createEmpireMidGame: no race "${race}" in this galaxy`);
    return r;
}

/** adoptOnly: the Empire ctor (capital null) plus GenerateEmpire's non-capital steps (Galaxy.7.cs 5092 / 5282-5287). */
function adoptEmpire(galaxy: Galaxy, spec: MidGameEmpireSpec, race: Race): Empire {
    const policy = loadEmpirePolicy(galaxy.researchStatic, race, false);
    const empire = new EmpireClass(galaxy, spec.name ?? race.name, null, race, spec.governmentId ?? defaultGovernmentId(race), 1.0, policy, false);
    empire.playerEmpire = false;
    if (race.designsPictureFamilyIndex >= 0) empire.designPictureFamilyIndex = race.designsPictureFamilyIndex;
    empire.preWarpProgressEventsOccurred = true;
    galaxy.empires.push(empire);
    empire.generateDesignSpecifications(galaxy, race, false, race.name);
    if (galaxy.researchStatic !== null) empire.research.setTechTreeLevel(galaxy.rnd, race, spec.techLevel ?? 0.5, false);
    empire.research.update(race);
    empire.reviewResearchAbilities();
    empire.reviewDesignsBuiltObjectsImprovedComponents();
    empire.reviewTroopTypes();
    if (empire.policy !== null) spec.configurePolicy?.(empire.policy);
    initEmpireTouchTimes(galaxy, empire);
    for (const colony of spec.adopt?.colonies ?? []) {
        takeOwnershipOfColonyFull(galaxy, empire, colony, empire, false, false); // as GenerateEmpire's capital hand-over
    }
    for (const bo of spec.adopt?.builtObjects ?? []) {
        takeOwnershipOfBuiltObject(galaxy, empire, bo, empire);
    }
    return empire;
}

function defaultGovernmentId(race: Race): number {
    if (race.preferredStartingGovernment >= 0) return race.preferredStartingGovernment;
    const g = getGovernmentsStatic().find((x) => x !== null && x.availability === 0 && x.specialFunctionCode === 0);
    return g?.governmentId ?? 0;
}

/**
 * Creates the empire / faction and returns it, or null when the galaxy has no empire id left
 * (Galaxy.MaximumEmpireCount, the GenerateShakturi guard). The new empire is AI-controlled.
 */
export function createEmpireMidGame(galaxy: Galaxy, spec: MidGameEmpireSpec): Empire | null {
    if (galaxy.nextEmpireId >= galaxy.maximumEmpireCount) return null;
    const race = resolveRace(galaxy, spec.race);
    let empire: Empire;
    if (spec.adoptOnly === true) {
        empire = adoptEmpire(galaxy, spec, race);
    } else if (spec.home == null) {
        throw new Error('createEmpireMidGame: `home` is required unless adoptOnly');
    } else if ((spec.kind ?? 'empire') === 'pirate') {
        // As createGame's pirate player / generateNewPirateEmpires: a surface point for the base, then GeneratePirateEmpire.
        const home = spec.home;
        const pt = galaxy.selectRelativeHabitatSurfacePoint(home);
        empire = generatePirateEmpire(
            galaxy,
            { independentColonies: galaxy.independentColonies, startingAge: galaxy.startingAge, difficultyLevel: galaxy.difficultyLevel },
            home,
            Math.trunc(pt.x),
            Math.trunc(pt.y),
            race,
            -1,
            spec.techLevel ?? 0.5,
            spec.piratePlayStyle ?? PiratePlayStyle.Balanced,
            false,
            false,
        );
        if (spec.name !== undefined && spec.name !== '') empire.name = spec.name;
        if (empire.policy !== null) spec.configurePolicy?.(empire.policy);
        // Empire.cs 4320: the ctor stamps the touch times at CurrentDateTime (galaxyTick.ts does the same for new factions).
        initEmpireTouchTimes(galaxy, empire);
    } else {
        const home = spec.home;
        const fav = spec.homeSystemFavourability ?? 'Normal';
        const homeSystemFactor = spec.homeSystemFactor ?? Galaxy.resolveHomeSystem(fav).homeSystemFactor;
        const kept = spec.preserveHome === true ? { resources: home.resources.map((r) => ({ ...r })), diameter: home.diameter, baseQuality: home.baseQuality } : null;
        empire = generateEmpire(
            galaxy,
            false,
            spec.name ?? '',
            home,
            race,
            race.designsPictureFamilyIndex,
            spec.governmentId ?? defaultGovernmentId(race),
            homeSystemFactor,
            kept !== null ? '' : fav,
            spec.age ?? 1,
            spec.techLevel ?? 0.5,
            1.0,
            false,
        ).empire;
        if (kept !== null) {
            home.resources = kept.resources;
            home.diameter = kept.diameter;
            home.baseQuality = kept.baseQuality;
        }
        if (empire.policy !== null) spec.configurePolicy?.(empire.policy);
        spec.beforeSetup?.(empire);
        if (spec.setup ?? true) empireStorySetup(galaxy, empire, 3.5, true, false);
        else resetEmpireTouchTimesForAge(galaxy, empire);
    }
    if (spec.relationBias !== undefined) {
        for (const other of galaxy.empires) {
            if (other === empire || other === galaxy.independentEmpire) continue;
            obtainEmpireEvaluation(galaxy, empire, other).bias = spec.relationBias;
            obtainEmpireEvaluation(galaxy, other, empire).bias = spec.relationBias;
        }
    }
    for (const enemy of spec.atWarWith ?? []) declareWar(galaxy, empire, enemy);
    return empire;
}
