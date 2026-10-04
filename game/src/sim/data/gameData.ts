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
import { CustomizationSet, customizationFileUrl, normalizeCustomizationSetName } from './customization';

/** Race files shipped in the stock DW:U install (`races/`). */
export const DEFAULT_RACE_FILES: readonly string[] = [
    'ackdarian.txt', 'atuuk.txt', 'boskara.txt', 'dhayut.txt', 'gizurean.txt', 'haakonish.txt',
    'human.txt', 'ikkuro.txt', 'ketarov.txt', 'kiadian.txt', 'mechanoid.txt', 'mortalen.txt',
    'naxxilian.txt', 'quameno.txt', 'securan.txt', 'shakturi.txt', 'shandar.txt', 'sluken.txt',
    'teekan.txt', 'ugnari.txt', 'wekkarus.txt', 'zenox.txt',
];

import { DESIGN_SPECIFICATION_MISSING, designSpecificationFallbackFiles } from './designSpecifications';
import { parseCharacterFile, parseCharacterNames, type CharacterFileRow, type CharacterNames } from './characters';
import { loadText } from '../textResolver';
import { parseBaconSettings, readBaconSettingsComments, type BaconSettings } from './baconSettings';

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
    /**
     * BaconSettings.txt (BaconMain.cs 1101 ReadBaconSettings + 605-1062), parsed onto the C# defaults; a missing file
     * gives the defaults. Absent (hand-built GameData) = the defaults. Applied at game start (sim/baconInitialize.ts).
     */
    baconSettings?: BaconSettings;
    /** BaconSettings.txt's own comment above each key (by file key; readBaconSettingsComments): the Bacon Mod Settings
     *  window's descriptions. Absent with no file. */
    baconSettingsComments?: Record<string, string>;
    /**
     * Mod layer (tasks/MODLAYER-DESIGN.md): the raw text of the key;value files a scenario overlay may patch, keyed by
     * lower-cased install-relative path ("races/human.txt", "policy/human.txt", "policy/pirate/human.txt" — policies by
     * race name). Display/data only; nothing in the sim reads it.
     */
    sourceTexts?: Map<string, string>;
    /** The scenario overlay applied to this GameData (scenario/overlay.ts applyScenarioOverlay); absent = base game. */
    scenario?: import('../scenario/overlay').LoadedScenario;
}

/** `fetchText` with at most `max` calls pending at once. */
function limitConcurrency(fetchText: FetchText, max: number): FetchText {
    let inFlight = 0;
    const waiting: Array<() => void> = [];
    return async (candidates) => {
        if (inFlight >= max) await new Promise<void>((resolve) => waiting.push(resolve));
        inFlight++;
        try {
            return await fetchText(candidates);
        } finally {
            inFlight--;
            waiting.shift()?.();
        }
    };
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
 * The C# File.Exists for an install-relative data file, answered from public/asset-manifest.json (the browser cannot
 * probe for a file without requesting it, and a missing file is a 404). Windows paths are case-insensitive, so the
 * folder key and the file name match case-insensitively. Returns the on-disk relative path when the manifest lists the
 * file, null when it lists the folder without the file (the C# File.Exists is false: do not request it), and undefined
 * when the manifest does not cover the folder (no manifest, an older manifest, or a customization set is active — its
 * folders are not in the manifest): then the caller requests the file and treats a failure as missing.
 */
export function manifestFileLookup(manifest: AssetManifest | null, relPath: string, customizationSet?: string): string | null | undefined {
    if (manifest === null) return undefined;
    if (customizationSet && customizationSet.trim() !== '' && customizationSet.trim().toLowerCase() !== 'default') return undefined;
    const slash = relPath.lastIndexOf('/');
    if (slash < 0) return undefined;
    const folder = relPath.slice(0, slash).toLowerCase();
    const file = relPath.slice(slash + 1).toLowerCase();
    for (const key of Object.keys(manifest)) {
        if (key.toLowerCase() !== folder) continue;
        const hit = manifest[key].find((name) => name.toLowerCase() === file);
        return hit === undefined ? null : `${key}/${hit}`;
    }
    return undefined;
}

/**
 * Load all game data from remote URLs via fetch.
 * @param fetchText Browser fetch wrapper that tries multiple candidate URLs
 * @param customizationSet The active customization set (theme): its CustomizationSet index (the original's per-file
 *   File.Exists / Directory.Exists rules below are answered from it), or a bare folder name (legacy: every file is
 *   requested customized-first, then the base copy). Absent / "" / "default" = the stock game.
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
    customizationSet?: string | CustomizationSet,
    raceFileNames?: string[],
    designTemplateFiles?: string[],
    policyFileNames?: string[]
): Promise<GameData> {
    // Import path resolution here to avoid circular dependencies
    const { resolveDataUrl: resolveDataUrlRaw } = await import('./paths');
    // A theme given by its index: every customized file is probed in it (File.Exists), the base copy is used otherwise.
    const theme = customizationSet instanceof CustomizationSet ? customizationSet : null;
    const setName = theme !== null ? "" : normalizeCustomizationSetName(customizationSet as string | undefined);
    // Galaxy.3.cs Initialize* / Galaxy.4.cs Load*: Customization\<set>\<file> when File.Exists, else <install>\<file>.
    const resolveDataUrl = (file: string, set?: string): string[] => {
        if (theme === null) return resolveDataUrlRaw(file, set);
        const custom = theme.fileUrl(file);
        return custom !== null ? [custom] : resolveDataUrlRaw(file);
    };
    customizationSet = setName;
    // A theme can bring dozens of extra races, each with ~60 design-template probes: keep the requests in flight
    // bounded (a browser refuses thousands at once, net::ERR_INSUFFICIENT_RESOURCES). Same files, same results.
    if (theme !== null) fetchText = limitConcurrency(fetchText, 24);

    // The manifest is only needed to fill in defaults for parameters the
    // caller did not supply explicitly; skip the fetch entirely when every
    // relevant list was passed in (keeps the fs-backed test helper, which
    // always supplies all three, from touching /asset-manifest.json).
    const needManifest = raceFileNames === undefined || designTemplateFiles === undefined || policyFileNames === undefined;
    const manifest = needManifest ? await fetchManifest(fetchText) : null;
    // File.Exists stand-in (see manifestFileLookup); undefined = unknown, request the file.
    // With a theme index: the theme's copy (its URL resolves through resolveDataUrl) else the base manifest's answer.
    const exists = (relPath: string): string | null | undefined =>
        theme !== null && theme.fileExists(relPath) ? relPath : manifestFileLookup(manifest, relPath, customizationSet as string);

    // Default: the manifest's races/ listing when available, else the 22
    // race files of the stock DW:U install.
    // Galaxy.4.cs LoadRaces (1176): Customization\<set>\races\ when that folder exists — it then REPLACES the stock
    // races\ folder (every *.txt in it, Directory.GetFiles order), else <install>\races\.
    const themeRaces = theme !== null && theme.dirExists('races');
    const raceFiles = themeRaces ? theme!.listFiles('races', '.txt') : (raceFileNames ?? manifest?.races ?? [...DEFAULT_RACE_FILES]);
    const raceFileUrls = (fileName: string): string[] =>
        themeRaces ? [theme!.listedFileUrl('races', fileName)] : resolveDataUrl(`races/${fileName}`, customizationSet as string);

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
        baconSettingsText,
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
        // Galaxy.4.cs LoadColonyNames (234) / LoadShipNames (280): with a set active ONLY Customization\<set>\<file> is
        // read (no fallback to the stock file): a theme without one has no colony / ship names.
        theme !== null ? (theme.fileUrl('colonyNames.txt') === null ? Promise.resolve('') : fetchText([theme.fileUrl('colonyNames.txt')!]).catch(() => '')) : fetchText(resolveDataUrl('colonyNames.txt', customizationSet)).catch(() => ''),
        theme !== null ? (theme.fileUrl('shipNames.txt') === null ? Promise.resolve('') : fetchText([theme.fileUrl('shipNames.txt')!]).catch(() => '')) : fetchText(resolveDataUrl('shipNames.txt', customizationSet)).catch(() => ''),
        fetchText(resolveDataUrl('characterNames.txt', customizationSet)),
        fetchText(resolveDataUrl('designNames.txt', customizationSet)),

        // 04d2 policy files: every entry of policyFiles, each tolerated missing.
        Promise.all(
            policyFiles.map((fileName) => fetchText(resolveDataUrl(`Policy/${fileName}`, customizationSet)).catch(() => ''))
        ),

        // Individual race files
        Promise.all(raceFiles.map((fileName) => fetchText(raceFileUrls(fileName)))),

        // Start.cs 885-899: TextResolver.LoadText(GameText.txt), the customization set's copy replacing the
        // stock one when present (LoadText clears first). Display text only; a missing file leaves tags unresolved.
        fetchText(resolveDataUrl('GameText.txt', customizationSet)).catch(() => ''),

        // BaconMain.cs 1107: new StreamReader("BaconSettings.txt") — relative to the working directory (the install
        // root), never a customization set; FileNotFoundException → empty dictionary → every setting at its default.
        fetchText(resolveDataUrlRaw('BaconSettings.txt')).catch(() => null),
    ]);
    if (gameTextText !== '') loadText(gameTextText);

    // Parse races from individual files
    const raceFamilies = parseRaceFamilies(raceFamiliesText);
    const races = raceFileResults.map((text) => parseRace(text));
    const sourceTexts = new Map<string, string>();
    raceFiles.forEach((file, i) => sourceTexts.set(`races/${file}`.toLowerCase(), raceFileResults[i]));

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
    // Port of Galaxy.4.cs LoadEmpirePolicy (1696) file lookup, prefetched per race: File.Exists(Policy\[pirate\]<name>.txt)
    // else the default policy. A file already fetched above (policyFiles, keyed like "pirate/Human.txt") is parsed from
    // that text instead of being requested again (a fresh EmpirePolicy per map, as the C# loads one per call).
    const policyTextByFile = new Map<string, string>();
    for (let i = 0; i < policyFiles.length; i++) {
        if (policyTexts[i] !== '') policyTextByFile.set(policyFiles[i].toLowerCase(), policyTexts[i]);
    }
    const policies = new Map<string, EmpirePolicy>();
    const piratePolicies = new Map<string, EmpirePolicy>();
    await Promise.all(
        races.flatMap((r) =>
            ([[policies, '', 'Policy/'], [piratePolicies, 'pirate/', 'Policy/pirate/']] as const).map(async ([map, sub, dir]) => {
                const known = policyTextByFile.get(`${sub}${r.name}.txt`.toLowerCase());
                if (known !== undefined) {
                    map.set(r.name, parseEmpirePolicy(known));
                    sourceTexts.set(`policy/${sub}${r.name}.txt`.toLowerCase(), known);
                    return;
                }
                const found = exists(`${dir}${r.name}.txt`);
                if (found === null) return; // File.Exists false → default policy
                try {
                    const text = await fetchText(resolveDataUrl(found ?? `${dir}${r.name}.txt`, customizationSet));
                    map.set(r.name, parseEmpirePolicy(text));
                    sourceTexts.set(`policy/${sub}${r.name}.txt`.toLowerCase(), text);
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
    // With a theme index, DesignSpecification.cs 197-214 exactly: non-pirate = Customization\<set>\designTemplates\<race>\
    // <sub>.txt when it exists, else the stock race file; pirate = the set's pirate\ file, else the stock pirate\ file,
    // else the STOCK race file (never the set's non-pirate one). Each canonical key below then holds that resolution;
    // a pirate key whose three candidates are all missing is marked DESIGN_SPECIFICATION_MISSING so the lookup does
    // not fall through to the set's non-pirate file.
    const themeTemplateText = async (rel: string): Promise<string | null> => {
        const url = theme!.fileUrl(rel);
        if (url === null) return null;
        try {
            const text = await fetchText([url]);
            return isMissingResponse(text) ? null : text;
        } catch {
            return null;
        }
    };
    // The manifest lists every stock designTemplates\<race>\ folder: a race folder it lacks does not exist.
    const manifestHasTemplates = manifest !== null && Object.keys(manifest).some((k) => k.toLowerCase().startsWith('designtemplates/'));
    const baseTemplateText = async (rel: string): Promise<string | null> => {
        const found = manifestFileLookup(manifest, rel);
        if (found === null || (found === undefined && manifestHasTemplates)) return null;
        try {
            const text = await fetchText(resolveDataUrlRaw(found ?? rel));
            return isMissingResponse(text) ? null : text;
        } catch {
            return null;
        }
    };
    if (theme !== null) {
        const baseCache = new Map<string, Promise<string | null>>();
        const base = (rel: string): Promise<string | null> => {
            let p = baseCache.get(rel);
            if (p === undefined) baseCache.set(rel, (p = baseTemplateText(rel)));
            return p;
        };
        await Promise.all(
            [...designSpecificationFiles].map(async (file) => {
                const m = /^designTemplates\/([^/]+)\/(pirate\/)?([^/]+)$/.exec(file);
                if (m === null) return;
                const raceFile = `designTemplates/${m[1]}/${m[3]}`;
                if (m[2] === undefined) {
                    const text = (await themeTemplateText(raceFile)) ?? (await base(raceFile));
                    if (text !== null) designSpecificationTexts.set(file, text);
                } else {
                    const text = (await themeTemplateText(file)) ?? (await base(file)) ?? (await base(raceFile));
                    designSpecificationTexts.set(file, text ?? DESIGN_SPECIFICATION_MISSING);
                }
            }),
        );
    } else await Promise.all(
        [...designSpecificationFiles].map(async (file) => {
            // DesignSpecification.cs 206-216: File.Exists picks the pirate / race file; a missing one is never opened.
            const found = exists(file);
            if (found === null) return;
            try {
                const text = await fetchText(resolveDataUrl(found ?? file, customizationSet));
                if (!isMissingResponse(text)) designSpecificationTexts.set(file, text);
            } catch {
                // missing file → absent; loadDesignSpecification falls back.
            }
        }),
    );

    // Galaxy.4.cs LoadDesignNames (designNames.txt).
    // (designNames.txt / characterNames.txt were fetched above; parse the same text rather than requesting it again.)
    let designNames: string[][] | undefined;
    try {
        designNames = parseDesignNames(designNamesText);
    } catch {
        designNames = undefined;
    }

    // Galaxy.4.cs LoadAgentNames (characterNames.txt, RaceFamilies.Count sections) and
    // SetRaceStartupCharacters → LoadCharacters (characters\<race.Name>.txt; Windows paths are
    // case-insensitive, the shipped files are lower-case).
    let characterNames: CharacterNames | undefined;
    try {
        characterNames = parseCharacterNames(characterNamesText, raceFamilies.length);
    } catch {
        characterNames = undefined;
    }
    const characterFiles = new Map<string, CharacterFileRow[]>();
    await Promise.all(
        races.map(async (r) => {
            const file = `characters/${r.name}.txt`;
            // Galaxy.4.cs 1236 LoadCharacters: File.Exists(characters\<race.Name>.txt) (case-insensitive); a missing file
            // gives an empty list without being opened. The manifest names the on-disk file, requested once.
            const found = exists(file);
            if (found === null) return;
            let text: string;
            try {
                text = await fetchText(
                    found !== undefined
                        ? resolveDataUrl(found, customizationSet)
                        : [...resolveDataUrl(file, customizationSet), ...resolveDataUrl(`characters/${r.name.toLowerCase()}.txt`, customizationSet)],
                );
            } catch {
                return; // missing file → no race starting characters
            }
            if (isMissingResponse(text)) return;
            characterFiles.set(r.name, parseCharacterFile(text, file));
        }),
    );

    return {
        baconSettings: parseBaconSettings(baconSettingsText === null || isMissingResponse(baconSettingsText) ? null : baconSettingsText),
        baconSettingsComments: readBaconSettingsComments(baconSettingsText === null || isMissingResponse(baconSettingsText) ? null : baconSettingsText),
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

        sourceTexts,
    };
}

// Case-insensitive match of a sub-role file name against BuiltObjectSubRole
// member names (the same matching parseShipNames uses for shipNames.txt keys).
export function resolveBuiltObjectSubRole(name: string): BuiltObjectSubRole {
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
