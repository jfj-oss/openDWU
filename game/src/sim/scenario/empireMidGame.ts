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
    /** Capital habitat (empire) or base habitat (pirate). */
    home: Habitat;
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
    if ((spec.kind ?? 'empire') === 'pirate') {
        // As createGame's pirate player / generateNewPirateEmpires: a surface point for the base, then GeneratePirateEmpire.
        const pt = galaxy.selectRelativeHabitatSurfacePoint(spec.home);
        empire = generatePirateEmpire(
            galaxy,
            { independentColonies: galaxy.independentColonies, startingAge: galaxy.startingAge, difficultyLevel: galaxy.difficultyLevel },
            spec.home,
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
        const fav = spec.homeSystemFavourability ?? 'Normal';
        const { homeSystemFactor } = Galaxy.resolveHomeSystem(fav);
        empire = generateEmpire(
            galaxy,
            false,
            spec.name ?? '',
            spec.home,
            race,
            race.designsPictureFamilyIndex,
            spec.governmentId ?? defaultGovernmentId(race),
            homeSystemFactor,
            fav,
            spec.age ?? 1,
            spec.techLevel ?? 0.5,
            1.0,
            false,
        ).empire;
        if (empire.policy !== null) spec.configurePolicy?.(empire.policy);
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
