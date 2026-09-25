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
import type { AgentNames, SubRoleNameSet } from './names';
import { parseAgentNames, parseColonyNames, parseShipNames } from './names';
import type { DesignSpecification } from './designTemplates';
import { parseDesignSpecification } from './designTemplates';
import { BuiltObjectSubRole } from './names';

/** Race files shipped in the stock DW:U install (`races/`). */
export const DEFAULT_RACE_FILES: readonly string[] = [
    'ackdarian.txt', 'atuuk.txt', 'boskara.txt', 'dhayut.txt', 'gizurean.txt', 'haakonish.txt',
    'human.txt', 'ikkuro.txt', 'ketarov.txt', 'kiadian.txt', 'mechanoid.txt', 'mortalen.txt',
    'naxxilian.txt', 'quameno.txt', 'securan.txt', 'shakturi.txt', 'shandar.txt', 'sluken.txt',
    'teekan.txt', 'ugnari.txt', 'wekkarus.txt', 'zenox.txt',
];

import { designSpecificationFallbackFiles } from './designSpecifications';
import { parseCharacterFile, parseCharacterNames, type CharacterFileRow, type CharacterNames } from './characters';
import { loadText } from '../textResolver';

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

    // From 04d1 (name lists)
    colonyNames: string[];
    shipNames: SubRoleNameSet;
    agentNames: AgentNames[];

    // From 04d2 (empire policies, file-keyed; the sim uses `policies` by
    // race name below). Keyed by file name relative to Policy/
    // (e.g. "Ackdarian.txt" for Policy/Ackdarian.txt, "pirate/Ackdarian.txt"
    // for Policy/pirate/Ackdarian.txt) — mirrors Galaxy.LoadEmpirePolicy's
    // (name, isPirate) keying.
    policiesByFile: Map<string, EmpirePolicy>;

    // From 04d3 (design templates). Keyed by sub-role file name (e.g. "frigate").
    designTemplates: Map<string, DesignSpecification>;
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

/** Shape of public/asset-manifest.json entries this loader consumes. */
type AssetManifest = Record<string, string[]>;

export type FetchText = (candidates: string[]) => Promise<string>;

// Fetches and parses public/asset-manifest.json (written by
// scripts/gen-asset-manifest.mjs). Returns null when it cannot be fetched or
// parsed (e.g. no DW:U install linked, or running against a bespoke
// FetchText that doesn't serve it) — callers fall back to their own defaults.
async function fetchManifest(fetchText: FetchText): Promise<AssetManifest | null> {
    try {
        const text = await fetchText(['/asset-manifest.json']);
        return JSON.parse(text) as AssetManifest;
    } catch {
        return null;
    }
}

/**
 * Load all game data from remote URLs via fetch.
 * @param fetchText Browser fetch wrapper that tries multiple candidate URLs
 * @param customizationSet Optional customization folder name (e.g. "DistantWorldsExpanded")
 * @param raceFileNames Optional list of race file names (e.g. ["human.txt", "mechanoid.txt", ...]).
 *   If not provided, uses public/asset-manifest.json's "races" list when available,
 *   else a default hardcoded list.
 * @param designTemplateFiles Optional list of designTemplates/DEFAULT/ sub-role file names
 *   (without the .txt extension). If not provided, uses the manifest's
 *   "designTemplates/DEFAULT" list when available, else none.
 * @param policyFileNames Optional list of Policy/ file names to load, relative to Policy/
 *   (e.g. "Ackdarian.txt", and "pirate/Ackdarian.txt" for Policy/pirate/Ackdarian.txt).
 *   If not provided, uses the manifest's "Policy" + "Policy/pirate" lists when available,
 *   else falls back to trying just "default.txt".
 */
export async function loadGameData(
    fetchText: FetchText,
    customizationSet?: string,
    raceFileNames?: string[],
    designTemplateFiles?: string[],
    policyFileNames?: string[]
): Promise<GameData> {
    // Import path resolution here to avoid circular dependencies
    const { resolveDataUrl } = await import('./paths');

    // The manifest is only needed to fill in defaults for parameters the
    // caller did not supply explicitly; skip the fetch entirely when every
    // relevant list was passed in (keeps the fs-backed test helper, which
    // always supplies all three, from touching /asset-manifest.json).
    const needManifest = raceFileNames === undefined || designTemplateFiles === undefined || policyFileNames === undefined;
    const manifest = needManifest ? await fetchManifest(fetchText) : null;

    // Default: the manifest's races/ listing when available, else the 22
    // race files of the stock DW:U install.
    const raceFiles = raceFileNames ?? manifest?.races ?? [...DEFAULT_RACE_FILES];

    // Default: the manifest's designTemplates/DEFAULT listing (strip .txt),
    // else no design templates.
    const defaultTemplateFiles = (manifest?.['designTemplates/DEFAULT'] ?? []).map((f) => f.replace(/\.txt$/i, ''));
    const templateFiles = designTemplateFiles ?? defaultTemplateFiles;

    // Default: every Policy/*.txt plus Policy/pirate/*.txt from the manifest
    // (pirate files prefixed "pirate/" to disambiguate from the top-level
    // file of the same name — mirrors Galaxy.LoadEmpirePolicy(name, isPirate)).
    // Policy/default.txt this loader tolerates missing (the C# LoadFromFile
    // swallows IO errors and leaves the policy at its defaults).
    const defaultPolicyFiles = manifest
        ? [...(manifest['Policy'] ?? []), ...(manifest['Policy/pirate'] ?? []).map((f) => `pirate/${f}`)]
        : ['default.txt'];
    const policyFiles = policyFileNames ?? defaultPolicyFiles;

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

        policyTexts,
        raceFileResults,
        gameTextText,
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

        // 04d2 policy files: every entry of policyFiles, each tolerated missing.
        Promise.all(
            policyFiles.map((fileName) => fetchText(resolveDataUrl(`Policy/${fileName}`, customizationSet)).catch(() => ''))
        ),

        // Individual race files
        Promise.all(raceFiles.map((fileName) => fetchText(resolveDataUrl(`races/${fileName}`, customizationSet)))),

        // Start.cs 885-899: TextResolver.LoadText(GameText.txt), the customization set's copy replacing the
        // stock one when present (LoadText clears first). Display text only; a missing file leaves tags unresolved.
        fetchText(resolveDataUrl('GameText.txt', customizationSet)).catch(() => ''),
    ]);
    if (gameTextText !== '') loadText(gameTextText);

    // Parse races from individual files
    const raceFamilies = parseRaceFamilies(raceFamiliesText);
    const races = raceFileResults.map((text) => parseRace(text));

    // 04d2 policies: one EmpirePolicy per successfully-fetched policy file,
    // keyed by its policyFiles entry (see GameData.policiesByFile doc comment).
    const policiesByFile = new Map<string, EmpirePolicy>();
    for (let i = 0; i < policyFiles.length; i++) {
        const text = policyTexts[i];
        if (text === '') {
            continue;
        }
        policiesByFile.set(policyFiles[i], parseEmpirePolicy(text));
    }

    // 04d3 design templates: one file per sub-role in designTemplates/DEFAULT/.
    // The C# engine loads designTemplates/<race>/<subRole>.txt for every
    // BuiltObjectSubRole; the DEFAULT set is what ships with the game. A
    // missing file is tolerated — the C# LoadFromFile falls back to the
    // built-in standAlone specification when the file does not exist.
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

        // 04d1 data
        colonyNames: parseColonyNames(colonyNamesText),
        shipNames: parseShipNames(shipNamesText),
        agentNames: parseAgentNames(characterNamesText, raceFamilies),

        // 04d2 data (file-keyed; `policies` above is by race name)
        policiesByFile,

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
