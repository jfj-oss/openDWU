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
import type { EmpirePolicy } from './policies';
import { parseEmpirePolicy } from './policies';
import { parseDesignNames } from './designNames';
import type { Plague } from './plagues';
import { parsePlagues } from './plagues';
import type { ResearchNode } from './research';
import { parseResearch } from './research';
import { designSpecificationFallbackFiles } from './designSpecifications';
import { parseCharacterFile, parseCharacterNames, type CharacterFileRow, type CharacterNames } from './characters';

// Sub role names Empire.GenerateDesignSpecifications (Empire.cs 4108) loads a
// design template for, plus "PlanetDestroyer" (same method,
// PlanetDestroyerDesignSpecification). Mirrors the calls in
// src/sim/empire.ts generateDesignSpecifications.
const DESIGN_SPECIFICATION_SUB_ROLE_NAMES = [
    'PlanetDestroyer', 'CapitalShip', 'Carrier', 'ColonyShip', 'ConstructionShip',
    'Cruiser', 'DefensiveBase', 'Destroyer', 'EnergyResearchStation', 'Escort',
    'ExplorationShip', 'Frigate', 'GasMiningShip', 'GasMiningStation',
    'HighTechResearchStation', 'LargeFreighter', 'LargeSpacePort', 'MediumFreighter',
    'MediumSpacePort', 'MiningShip', 'MiningStation', 'MonitoringStation',
    'PassengerShip', 'ResortBase', 'ResupplyShip', 'SmallFreighter', 'SmallSpacePort',
    'TroopTransport', 'WeaponsResearchStation',
];

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

    // Policy/<race>.txt and Policy/pirate/<race>.txt by race name (C2 starting techs).
    // A missing file is absent here; Galaxy.LoadEmpirePolicy then uses a default policy.
    policies?: Map<string, EmpirePolicy>;
    piratePolicies?: Map<string, EmpirePolicy>;

    // designTemplates/<race>/[pirate/]<subRole>.txt, keyed by the canonical
    // relative file path (see data/designSpecifications.ts
    // designSpecificationFallbackFiles). A missing file is simply absent;
    // loadDesignSpecification then falls back to the next candidate or to
    // the default design specification table.
    designSpecificationTexts?: Map<string, string>;
    /** designNames.txt families (Galaxy.4.cs LoadDesignNames). */
    designNames?: string[][];
    /** characterNames.txt (Galaxy.4.cs LoadAgentNames; one section per race family). */
    characterNames?: CharacterNames;
    /**
     * characters/<race name>.txt tokenized rows keyed by race name (Galaxy.4.cs LoadCharacters /
     * SetRaceStartupCharacters). A missing file is absent (C#: File.Exists false → empty list).
     */
    characterFiles?: Map<string, CharacterFileRow[]>;
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

    // Port of Galaxy.4.cs LoadEmpirePolicy (1696) file lookup, prefetched per race.
    const policies = new Map<string, EmpirePolicy>();
    const piratePolicies = new Map<string, EmpirePolicy>();
    await Promise.all(
        races.flatMap((r) =>
            ([[policies, 'Policy/'], [piratePolicies, 'Policy/pirate/']] as const).map(async ([map, dir]) => {
                try {
                    map.set(r.name, parseEmpirePolicy(await fetchText(resolveDataUrl(`${dir}${r.name}.txt`, customizationSet))));
                } catch {
                    // missing file → default policy
                }
            }),
        ),
    );

    // designTemplates/<race>/[pirate/]<subRole>.txt for every race and every
    // sub role Empire.GenerateDesignSpecifications loads (see
    // designSpecifications.ts designSpecificationFallbackFiles — no
    // DEFAULT-folder fallback, matching the C#). A "<!" response body means
    // the dev server served index.html for a missing static file (Vite's
    // SPA fallback) — treat that as missing too.
    const designSpecificationTexts = new Map<string, string>();
    const isMissingResponse = (text: string) => text.trimStart().startsWith('<!');
    const designSpecificationFiles = new Set<string>();
    for (const subRoleName of DESIGN_SPECIFICATION_SUB_ROLE_NAMES) {
        for (const isPirate of [false, true]) {
            for (const race of races) {
                for (const file of designSpecificationFallbackFiles(subRoleName, race.name, isPirate)) {
                    designSpecificationFiles.add(file);
                }
            }
        }
    }
    await Promise.all(
        [...designSpecificationFiles].map(async (file) => {
            try {
                const text = await fetchText(resolveDataUrl(file, customizationSet));
                if (!isMissingResponse(text)) designSpecificationTexts.set(file, text);
            } catch {
                // missing file → absent; loadDesignSpecification falls back.
            }
        }),
    );

    // Galaxy.4.cs LoadDesignNames (designNames.txt).
    let designNames: string[][] | undefined;
    try {
        designNames = parseDesignNames(await fetchText(resolveDataUrl('designNames.txt', customizationSet)));
    } catch {
        designNames = undefined;
    }

    // Galaxy.4.cs LoadAgentNames (characterNames.txt, RaceFamilies.Count sections) and
    // SetRaceStartupCharacters → LoadCharacters (characters\<race.Name>.txt; Windows paths are
    // case-insensitive, the shipped files are lower-case).
    let characterNames: CharacterNames | undefined;
    try {
        characterNames = parseCharacterNames(await fetchText(resolveDataUrl('characterNames.txt', customizationSet)), raceFamilies.length);
    } catch {
        characterNames = undefined;
    }
    const characterFiles = new Map<string, CharacterFileRow[]>();
    await Promise.all(
        races.map(async (r) => {
            const file = `characters/${r.name}.txt`;
            let text: string;
            try {
                text = await fetchText([...resolveDataUrl(file, customizationSet), ...resolveDataUrl(`characters/${r.name.toLowerCase()}.txt`, customizationSet)]);
            } catch {
                return; // missing file → no race starting characters
            }
            if (isMissingResponse(text)) return;
            characterFiles.set(r.name, parseCharacterFile(text, file));
        }),
    );

    return {
        characterNames,
        characterFiles,
        designNames,
        policies,
        piratePolicies,
        designSpecificationTexts,
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
