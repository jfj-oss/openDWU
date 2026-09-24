// Port of Race.cs (top-of-file fields) + LoadFromFile (line 752). Pure
// parsing — no fs. Handles UTF-8 BOM, `'`-comment lines, and CRLF. Each
// non-comment line is "Key<whitespace>;Value" (first `;` splits key/value,
// per LoadFromFile's `text.IndexOf(";")`).

import { HabitatType, resolveColonyHabitatTypeByIndexDesertBeforeOcean } from '../types';

export interface Race {
    name: string;
    pictureIndex: number;
    raceFamily: number;
    reproductionRate: number;
    intelligence: number;
    aggression: number;
    caution: number;
    friendliness: number;
    loyalty: number;
    designsPictureFamilyIndex: number;
    designNamesIndex: number;
    shipMaintenanceSavings: number;
    troopMaintenanceSavings: number;
    resourceExtractionBonus: number;
    warWearinessAttenuation: number;
    satisfactionModifier: number;
    researchBonus: number;
    espionageBonus: number;
    tradeBonus: number;
    overallShipDesignFocus: number;
    techFocus1: number;
    techFocus2: number;
    nativePlanetType: number;
    /** Port of Race.cs LoadFromFile (line 1286): NativeHabitatType is the
     *  file's NativePlanetType index resolved to a HabitatType via
     *  Galaxy.ResolveColonyHabitatTypeByIndexDesertBeforeOcean. */
    nativeHabitatType: HabitatType;
    specialComponent: number;
    weaponsResearchProjectOrder: number[];
    energyResearchProjectOrder: number[];
    highTechResearchProjectOrder: number[];
    specialGovernment: number;
    preferredStartingGovernment: number;
    disallowedGovernments: number[];
    canChangeGovernment: boolean;
    expanding: boolean;
    canBePirate: boolean;
    canBeNormalEmpire: boolean;
    playable: boolean;
    homeSystemName: string;
    troopStrength: number;
    troopName: string;
    troopNameArmored: string;
    troopNamePlanetaryDefense: string;
    troopNameSpecialForces: string;
    defaultPrimaryColor: number;
    defaultSecondaryColor: number;
    defaultFlagDesign: number;
    /** Fields present in the file but not modeled above, keyed by raw field name. */
    extra: Record<string, string>;
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseIntField(raw: string | undefined, fallback = 0): number {
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = parseInt(raw.trim(), 10);
    return Number.isNaN(n) ? fallback : n;
}

function parseFloatField(raw: string | undefined, fallback = 0): number {
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = parseFloat(raw.trim());
    return Number.isNaN(n) ? fallback : n;
}

function parseBoolField(raw: string | undefined, fallback = false): boolean {
    if (raw === undefined || raw.trim() === '') return fallback;
    return raw.trim().toUpperCase() === 'Y';
}

// Port of Race.cs LoadFromFile: comma-separated int list fields, e.g.
// WeaponsResearchProjectOrder/EnergyResearchProjectOrder/
// HighTechResearchProjectOrder/DisallowedGovernments.
function parseIntList(raw: string | undefined): number[] {
    if (raw === undefined || raw.trim() === '') return [];
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
        .map((s) => parseInt(s, 10))
        .filter((n) => !Number.isNaN(n));
}

// Port of Race.cs LoadFromFile (line 752). `text` is the full content of a
// races/*.txt file (e.g. races/human.txt).
export function parseRace(text: string): Race {
    const fields = new Map<string, string>();
    const lines = stripBom(text).split(/\r\n|\r|\n/);
    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (trimmed === '' || trimmed.substring(0, 1) === "'") {
            continue;
        }
        const sepIndex = rawLine.indexOf(';');
        if (sepIndex < 0) {
            continue;
        }
        const key = rawLine.substring(0, sepIndex).trim();
        const value = rawLine.substring(sepIndex + 1).trim();
        if (key === '') continue;
        // Later occurrences of the same key (shouldn't normally happen)
        // overwrite earlier ones, matching the C# switch-per-line behavior.
        fields.set(key, value);
    }

    const knownKeys = new Set([
        'Name', 'PictureIndex', 'RaceFamily', 'ReproductionRate', 'Intelligence',
        'Aggression', 'Caution', 'Friendliness', 'Loyalty', 'DesignsPictureFamilyIndex',
        'DesignNamesIndex', 'ShipMaintenanceSavings', 'TroopMaintenanceSavings',
        'ResourceExtractionBonus', 'WarWearinessAttenuation', 'SatisfactionModifier',
        'ResearchBonus', 'EspionageBonus', 'TradeBonus', 'OverallShipDesignFocus',
        'TechFocus1', 'TechFocus2', 'NativePlanetType', 'SpecialComponent',
        'WeaponsResearchProjectOrder', 'EnergyResearchProjectOrder',
        'HighTechResearchProjectOrder', 'SpecialGovernment', 'PreferredStartingGovernment',
        'DisallowedGovernments', 'CanChangeGovernment', 'Expanding', 'CanBePirate',
        'CanBeNormalEmpire', 'Playable', 'HomeSystemName', 'TroopStrength', 'TroopName',
        'TroopNameArmored', 'TroopNamePlanetaryDefense', 'TroopNameSpecialForces',
        'DefaultPrimaryColor', 'DefaultSecondaryColor', 'DefaultFlagDesign',
    ]);
    const extra: Record<string, string> = {};
    for (const [key, value] of fields) {
        if (!knownKeys.has(key)) {
            extra[key] = value;
        }
    }

    return {
        name: fields.get('Name') ?? '',
        pictureIndex: parseIntField(fields.get('PictureIndex')),
        raceFamily: parseIntField(fields.get('RaceFamily')),
        reproductionRate: parseFloatField(fields.get('ReproductionRate'), 1.0),
        intelligence: parseIntField(fields.get('Intelligence'), 100),
        aggression: parseIntField(fields.get('Aggression'), 100),
        caution: parseIntField(fields.get('Caution'), 100),
        friendliness: parseIntField(fields.get('Friendliness'), 100),
        loyalty: parseIntField(fields.get('Loyalty'), 100),
        designsPictureFamilyIndex: parseIntField(fields.get('DesignsPictureFamilyIndex')),
        designNamesIndex: parseIntField(fields.get('DesignNamesIndex')),
        shipMaintenanceSavings: parseFloatField(fields.get('ShipMaintenanceSavings')),
        troopMaintenanceSavings: parseFloatField(fields.get('TroopMaintenanceSavings')),
        resourceExtractionBonus: parseFloatField(fields.get('ResourceExtractionBonus')),
        warWearinessAttenuation: parseFloatField(fields.get('WarWearinessAttenuation')),
        satisfactionModifier: parseFloatField(fields.get('SatisfactionModifier')),
        researchBonus: parseFloatField(fields.get('ResearchBonus')),
        espionageBonus: parseFloatField(fields.get('EspionageBonus')),
        tradeBonus: parseFloatField(fields.get('TradeBonus')),
        overallShipDesignFocus: parseIntField(fields.get('OverallShipDesignFocus')),
        techFocus1: parseIntField(fields.get('TechFocus1')),
        techFocus2: parseIntField(fields.get('TechFocus2')),
        nativePlanetType: parseIntField(fields.get('NativePlanetType')),
        // Port of Race.cs LoadFromFile (line 1286): NativeHabitatType =
        // Galaxy.ResolveColonyHabitatTypeByIndexDesertBeforeOcean(NativePlanetType).
        nativeHabitatType: resolveColonyHabitatTypeByIndexDesertBeforeOcean(parseIntField(fields.get('NativePlanetType'))),
        specialComponent: parseIntField(fields.get('SpecialComponent'), -1),
        weaponsResearchProjectOrder: parseIntList(fields.get('WeaponsResearchProjectOrder')),
        energyResearchProjectOrder: parseIntList(fields.get('EnergyResearchProjectOrder')),
        highTechResearchProjectOrder: parseIntList(fields.get('HighTechResearchProjectOrder')),
        specialGovernment: parseIntField(fields.get('SpecialGovernment'), -1),
        preferredStartingGovernment: parseIntField(fields.get('PreferredStartingGovernment'), -1),
        disallowedGovernments: parseIntList(fields.get('DisallowedGovernments')),
        canChangeGovernment: parseBoolField(fields.get('CanChangeGovernment'), true),
        expanding: parseBoolField(fields.get('Expanding'), true),
        canBePirate: parseBoolField(fields.get('CanBePirate'), true),
        canBeNormalEmpire: parseBoolField(fields.get('CanBeNormalEmpire'), true),
        playable: parseBoolField(fields.get('Playable'), true),
        homeSystemName: fields.get('HomeSystemName') ?? '',
        troopStrength: parseIntField(fields.get('TroopStrength'), 100),
        troopName: fields.get('TroopName') ?? '',
        troopNameArmored: fields.get('TroopNameArmored') ?? '',
        troopNamePlanetaryDefense: fields.get('TroopNamePlanetaryDefense') ?? '',
        troopNameSpecialForces: fields.get('TroopNameSpecialForces') ?? '',
        defaultPrimaryColor: parseIntField(fields.get('DefaultPrimaryColor')),
        defaultSecondaryColor: parseIntField(fields.get('DefaultSecondaryColor')),
        defaultFlagDesign: parseIntField(fields.get('DefaultFlagDesign')),
        extra,
    };
}
