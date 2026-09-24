// Port of the name-list loaders:
// - Galaxy.cs LoadColonyNames (colonyNames.txt)
// - Galaxy.cs LoadShipNames (shipNames.txt -> SubRoleNameSet)
// - Galaxy.cs LoadAgentNames (characterNames.txt, one first/last-name row per race family)
// - Galaxy.cs LoadDesignNames (designNames.txt, >= 14 design-name families)
// Pure parsing — no fs. Handles UTF-8 BOM and CRLF.

import type { RaceFamily } from './raceFamilies';

// Port of DistantWorlds.Types.BuiltObjectSubRole (BuiltObjectSubRole.cs).
// Member order is the exact C# declaration order (the enum is [Serializable]
// byte-backed, so numeric values matter for any code that reads/writes them).
export enum BuiltObjectSubRole {
    Undefined = 0,
    Escort,
    Frigate,
    Destroyer,
    Cruiser,
    CapitalShip,
    TroopTransport,
    Carrier,
    ResupplyShip,
    ExplorationShip,
    SmallFreighter,
    MediumFreighter,
    LargeFreighter,
    ColonyShip,
    PassengerShip,
    ConstructionShip,
    GasMiningShip,
    MiningShip,
    GasMiningStation,
    MiningStation,
    SmallSpacePort,
    MediumSpacePort,
    LargeSpacePort,
    ResortBase,
    GenericBase,
    EnergyResearchStation,
    WeaponsResearchStation,
    HighTechResearchStation,
    MonitoringStation,
    DefensiveBase,
}

// Enum.GetNames(typeof(BuiltObjectSubRole)): member names in declaration order.
const SUB_ROLE_NAMES: readonly string[] = Object.keys(BuiltObjectSubRole).filter(
    (k) => Number.isNaN(parseInt(k, 10))
);

// Port of DistantWorlds.Types.SubRoleNameList (SubRoleNameSet.cs)
export interface SubRoleNameList {
    subRole: BuiltObjectSubRole;
    names: string[];
}

// Port of DistantWorlds.Types.SubRoleNameSet (SubRoleNameSet.cs)
export interface SubRoleNameSet {
    subRoleNames: SubRoleNameList[];
    /** Port of SubRoleNameSet.GetNames: first matching list's names, or null. */
    getNames(subRole: BuiltObjectSubRole): string[] | null;
}

export function createSubRoleNameSet(): SubRoleNameSet {
    const subRoleNames: SubRoleNameList[] = [];
    return {
        subRoleNames,
        getNames(subRole: BuiltObjectSubRole): string[] | null {
            for (const entry of subRoleNames) {
                if (entry.subRole === subRole) {
                    return entry.names;
                }
            }
            return null;
        },
    };
}

/** One row of characterNames.txt: first names + last names for one race family. */
export interface AgentNames {
    raceFamilyId: number;
    firstNames: string[];
    lastNames: string[];
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Port of Galaxy.cs GetValidFileLine: skip blank lines and `'`-comment lines.
function* validLines(text: string): Generator<string> {
    for (const rawLine of stripBom(text).split(/\r\n|\r|\n/)) {
        const line = rawLine.trim();
        if (line === '' || line.substring(0, 1) === "'") {
            continue;
        }
        yield line;
    }
}

// Port of Galaxy.cs LoadColonyNames: each non-comment line is a comma-separated
// list of names; spaces are stripped from the whole line before splitting and
// empty tokens are dropped.
export function parseColonyNames(text: string): string[] {
    const names: string[] = [];
    for (const line of validLines(text)) {
        // Port of C# validFileLine.Replace(" ", ""): strip ALL spaces.
        const stripped = line.replace(/ /g, '');
        for (const part of stripped.split(',')) {
            if (part.trim() !== '') {
                names.push(part);
            }
        }
    }
    return names;
}

// Port of Galaxy.cs LoadShipNames: each non-comment line is "SubRole: name, name, ...".
// The sub-role token is matched case-insensitively against BuiltObjectSubRole member
// names; unrecognized sub-roles are skipped. A trailing single empty field yields an
// empty name list (faithfully ported quirk).
export function parseShipNames(text: string): SubRoleNameSet {
    const set = createSubRoleNameSet();
    for (const line of validLines(text)) {
        const colon = line.indexOf(':');
        let key = '';
        if (colon > 0) {
            key = line.substring(0, colon).trim();
        }
        if (key === '') {
            continue;
        }
        let subRole = BuiltObjectSubRole.Undefined;
        for (const name of SUB_ROLE_NAMES) {
            if (name.toLowerCase() === key.toLowerCase()) {
                subRole = BuiltObjectSubRole[name as keyof typeof BuiltObjectSubRole];
                break;
            }
        }
        if (subRole === BuiltObjectSubRole.Undefined) {
            continue;
        }
        let rest = '';
        if (line.length > colon) {
            rest = line.substring(colon + 1);
        }
        if (rest === '') {
            continue;
        }
        let parts = rest.split(',');
        if (parts.length === 1 && parts[0].trim() === '') {
            parts = [];
        }
        const names = parts.map((p) => p.trim());
        set.subRoleNames.push({ subRole, names });
    }
    return set;
}

// Port of Galaxy.cs LoadAgentNames: characterNames.txt holds two rows per race
// family (first names, then last names), in race-family order. The C# original
// throws when the file is missing; here the text is already loaded by the
// caller (gameData.ts / test helper).
export function parseAgentNames(text: string, raceFamilies: RaceFamily[]): AgentNames[] {
    const result: AgentNames[] = [];
    const lines = [...validLines(text)];
    for (let i = 0; i < raceFamilies.length; i++) {
        // Port of GetValidFileLine(...).Replace(" ", ""): strip ALL spaces.
        const firstRow = (lines[i * 2] ?? '').replace(/ /g, '');
        const lastRow = (lines[i * 2 + 1] ?? '').replace(/ /g, '');
        result.push({
            raceFamilyId: raceFamilies[i].raceFamilyId,
            firstNames: firstRow.split(',').filter((p) => p.trim() !== ''),
            lastNames: lastRow.split(',').filter((p) => p.trim() !== ''),
        });
    }
    return result;
}

// Port of Galaxy.cs LoadDesignNames: each non-comment, non-blank line that does
// not start with `'` is one design-name family (comma-separated, trimmed, empty
// tokens dropped). Throws when a line yields no names or fewer than 14 families
// were parsed (faithful to the original's post-parse check).
export function parseDesignNames(text: string): string[][] {
    const families: string[][] = [];
    let lineNum = 0;
    for (const rawLine of stripBom(text).split(/\r\n|\r|\n/)) {
        lineNum++;
        const line = rawLine.trim();
        if (line === '' || line.substring(0, 1) === "'") {
            continue;
        }
        const names: string[] = [];
        let start = 0;
        let idx = 0;
        while (idx >= 0) {
            idx = line.indexOf(',', start);
            const chunk = (idx < 0 ? line.substring(start) : line.substring(start, idx)).trim();
            if (chunk !== '') {
                names.push(chunk);
            }
            start = idx + 1;
        }
        if (names.length === 0) {
            throw new Error(`No design names at line ${lineNum}`);
        }
        families.push(names);
    }
    if (families.length < 14) {
        throw new Error('Must be at least 14 design name families in designs.txt');
    }
    return families;
}