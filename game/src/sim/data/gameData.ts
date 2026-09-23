// Aggregates all game data loaders into a single typed GameData object.

import type { Race } from './races';
import { parseRace } from './races';
import type { RaceFamily } from './raceFamilies';
import { parseRaceFamilies } from './raceFamilies';
import type { BiasMatrix } from './biases';
import { parseRaceBiases, parseRaceFamilyBiases } from './biases';
import type { Government, GovernmentBiasRow } from './governments';
import { parseGovernments, parseGovernmentBiases } from './governments';

import type { Resource } from './resources';
import { parseResources } from './resources';
import type { Component } from './components';
import { parseComponents } from './components';
import type { Fighter } from './fighters';
import { parseFighters } from './fighters';
import type { Facility } from './facilities';
import { parseFacilities } from './facilities';
import type { Plague } from './plagues';
import { parsePlagues } from './plagues';
import type { ResearchNode } from './research';
import { parseResearch } from './research';

export interface GameData {
    // From 04a (races, governments)
    races: Race[];
    raceFamilies: RaceFamily[];
    raceBiases: BiasMatrix;
    raceFamilyBiases: BiasMatrix;
    governments: Government[];
    governmentBiases: GovernmentBiasRow[];

    // From 04b (resources, components, fighters, facilities, plagues, research)
    resources: Resource[];
    components: Component[];
    fighters: Fighter[];
    facilities: Facility[];
    plagues: Plague[];
    research: ResearchNode[];
}

export type FetchText = (candidates: string[]) => Promise<string>;

/**
 * Load all game data from remote URLs via fetch.
 * @param fetchText Browser fetch wrapper that tries multiple candidate URLs
 * @param customizationSet Optional customization folder name (e.g. "DistantWorldsExpanded")
 * @param raceFileNames Optional list of race file names (e.g. ["human.txt", "mechanoid.txt", ...]). If not provided, uses a default hardcoded list.
 */
export async function loadGameData(
    fetchText: FetchText,
    customizationSet?: string,
    raceFileNames?: string[]
): Promise<GameData> {
    // Import path resolution here to avoid circular dependencies
    const { resolveDataUrl } = await import('./paths');

    // Default race file names if not provided
    const raceFiles = raceFileNames || [
        'human.txt', 'mechanoid.txt', 'evuck.txt', 'ackdarians.txt', 'teekan.txt',
        'kaltor.txt', 'dryad.txt', 'illo.txt', 'evuckian.txt', 'tao.txt',
        'shaktur.txt', 'mithrilar.txt', 'human_pirate.txt', 'mechanoid_pirate.txt',
        'draxian.txt', 'magellan.txt', 'dhayut.txt', 'sentinel.txt', 'thrynn.txt',
        'soulless.txt', 'human_cai.txt', 'mechanoid_ancient.txt',
    ];

    // Fetch all individual race files and other data in parallel
    const [
        raceFamiliesText,
        raceBiasesText,
        raceFamilyBiasesText,
        governmentsText,
        governmentBiasesText,

        resourcesText,
        componentsText,
        fightersText,
        facilitiesText,
        plaguesText,
        researchText,
        ...raceFileResults
    ] = await Promise.all([
        // 04a non-race files
        fetchText(resolveDataUrl('raceFamilies.txt', customizationSet)),
        fetchText(resolveDataUrl('raceBiases.txt', customizationSet)),
        fetchText(resolveDataUrl('raceFamilyBiases.txt', customizationSet)),
        fetchText(resolveDataUrl('governments.txt', customizationSet)),
        fetchText(resolveDataUrl('governmentBiases.txt', customizationSet)),

        // 04b files
        fetchText(resolveDataUrl('resources.txt', customizationSet)),
        fetchText(resolveDataUrl('components.txt', customizationSet)),
        fetchText(resolveDataUrl('fighters.txt', customizationSet)),
        fetchText(resolveDataUrl('facilities.txt', customizationSet)),
        fetchText(resolveDataUrl('plagues.txt', customizationSet)),
        fetchText(resolveDataUrl('research.txt', customizationSet)),

        // Individual race files
        ...raceFiles.map((fileName) => fetchText(resolveDataUrl(`races/${fileName}`, customizationSet))),
    ]);

    // Parse races from individual files
    const raceFamilies = parseRaceFamilies(raceFamiliesText);
    const races = raceFileResults.map((text) => parseRace(text));

    return {
        // 04a data
        races,
        raceFamilies,
        raceBiases: parseRaceBiases(raceBiasesText),
        raceFamilyBiases: parseRaceFamilyBiases(raceFamilyBiasesText),
        governments: parseGovernments(governmentsText),
        governmentBiases: parseGovernmentBiases(governmentBiasesText),

        // 04b data
        resources: parseResources(resourcesText),
        components: parseComponents(componentsText),
        fighters: parseFighters(fightersText),
        facilities: parseFacilities(facilitiesText),
        plagues: parsePlagues(plaguesText),
        research: parseResearch(researchText),
    };
}
