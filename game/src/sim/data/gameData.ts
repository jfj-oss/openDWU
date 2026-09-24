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
import type { AgentNames, SubRoleNameSet } from './names';
import { parseAgentNames, parseColonyNames, parseDesignNames, parseShipNames } from './names';
import type { EmpirePolicy } from './policy';
import { parseEmpirePolicy } from './policy';
import type { DesignSpecification } from './designTemplates';
import { parseDesignSpecification } from './designTemplates';
import { BuiltObjectSubRole } from './names';

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

    // From 04d1 (name lists)
    colonyNames: string[];
    shipNames: SubRoleNameSet;
    agentNames: AgentNames[];
    designNames: string[][];

    // From 04d2 (empire policies)
    policies: EmpirePolicy[];

    // From 04d3 (design templates). Keyed by sub-role file name (e.g. "frigate").
    // TODO(port): public/asset-manifest.json does not enumerate the
    // designTemplates/DEFAULT/ folder, so the browser path cannot discover the
    // files — see loadGameData below. The test helper enumerates them via fs.
    designTemplates: Map<string, DesignSpecification>;
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
    raceFileNames?: string[],
    designTemplateFiles?: string[]
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

        colonyNamesText,
        shipNamesText,
        characterNamesText,
        designNamesText,

        // 04d2 policy file. The C# engine loads every Policy/*.txt (plus
        // Policy/pirate/*.txt) listed in the asset manifest; the manifest does
        // not yet enumerate them, so for now only default.txt is loaded, and a
        // missing file is tolerated (the C# LoadFromFile swallows IO errors
        // and leaves the policy at its defaults).
        // TODO(port): enumerate Policy/ and Policy/pirate/ files from
        // public/asset-manifest.json once it lists them — EmpirePolicy.cs
        // LoadFromFile / Galaxy.?.cs policy loading.
        policyText,
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

        // 04d1 name-list files. LoadColonyNames / LoadShipNames return an empty
        // result when the file is missing (no fallback throw), so a failed fetch
        // is tolerated here; agent/design names are required by the engine.
        fetchText(resolveDataUrl('colonyNames.txt', customizationSet)).catch(() => ''),
        fetchText(resolveDataUrl('shipNames.txt', customizationSet)).catch(() => ''),
        fetchText(resolveDataUrl('characterNames.txt', customizationSet)),
        fetchText(resolveDataUrl('designNames.txt', customizationSet)),

        // 04d2 policy file (optional — see note above)
        fetchText(resolveDataUrl('Policy/default.txt', customizationSet)).catch(() => ''),

        // Individual race files
        ...raceFiles.map((fileName) => fetchText(resolveDataUrl(`races/${fileName}`, customizationSet))),
    ]);

    // Parse races from individual files
    const raceFamilies = parseRaceFamilies(raceFamiliesText);
    const races = raceFileResults.map((text) => parseRace(text));

    // 04d3 design templates: one file per sub-role in designTemplates/DEFAULT/.
    // The C# engine loads designTemplates/<race>/<subRole>.txt for every
    // BuiltObjectSubRole; the DEFAULT set is what ships with the game. The
    // browser cannot enumerate a folder, so callers pass the file names
    // explicitly (the test helper discovers them via node:fs). A missing file
    // is tolerated — the C# LoadFromFile falls back to the built-in
    // standAlone specification when the file does not exist.
    const templateFiles = designTemplateFiles ?? [];
    const designTemplates = new Map<string, DesignSpecification>();
    if (templateFiles.length > 0) {
        const templateTexts = await Promise.all(
            templateFiles.map((fileName) =>
                fetchText(resolveDataUrl(`designTemplates/DEFAULT/${fileName}.txt`, customizationSet)).catch(() => '')
            )
        );
        for (let i = 0; i < templateFiles.length; i++) {
            const text = templateTexts[i];
            if (text === '') {
                continue;
            }
            const fileName = templateFiles[i];
            const subRoleName = fileName.replace(/\.txt$/, '');
            const subRole = resolveBuiltObjectSubRole(subRoleName);
            if (subRole === BuiltObjectSubRole.Undefined) {
                continue;
            }
            designTemplates.set(subRoleName, parseDesignSpecification(text, subRoleName, subRole, true));
        }
    }

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

        // 04d1 data
        colonyNames: parseColonyNames(colonyNamesText),
        shipNames: parseShipNames(shipNamesText),
        agentNames: parseAgentNames(characterNamesText, raceFamilies),
        designNames: parseDesignNames(designNamesText),

        // 04d2 data
        policies: policyText === '' ? [] : [parseEmpirePolicy(policyText)],

        // 04d3 data
        designTemplates,
    };
}

// Case-insensitive match of a sub-role file name against BuiltObjectSubRole
// member names (the same matching parseShipNames uses for shipNames.txt keys).
function resolveBuiltObjectSubRole(name: string): BuiltObjectSubRole {
    const lower = name.toLowerCase();
    for (const key of Object.keys(BuiltObjectSubRole) as (keyof typeof BuiltObjectSubRole)[]) {
        if (typeof BuiltObjectSubRole[key] !== 'number') {
            continue;
        }
        if (key.toLowerCase() === lower) {
            return BuiltObjectSubRole[key];
        }
    }
    return BuiltObjectSubRole.Undefined;
}
