// Port of governments.txt / governmentBiases.txt loaders:
// - GovernmentAttributesList.cs LoadFromFile (line 87)
// - GovernmentBiasList.cs LoadFromFile (line 27)
// Pure parsing — no fs. Handles UTF-8 BOM, `'`-comment lines, and CRLF.

export interface Government {
    governmentId: number;
    name: string;
    corruption: number;
    warWeariness: number;
    maintenanceCosts: number;
    approvalRating: number;
    populationGrowth: number;
    researchSpeed: number;
    troopRecruitment: number;
    tradeBonus: number;
    leaderReplacementLikeliness: number;
    leaderReplacementDisruptionLevel: number;
    leaderReplacementBoost: number;
    /** 0=NONE, 1=Colony Governors, 2=Fleet Admirals and Troop Generals, 3=Scientists */
    leaderReplacementCharacterPool: number;
    /** 0=replacement, 1=coup d'état, 2=election */
    leaderReplacementTypicalManner: number;
    stability: number;
    concernForOwnReputation: number;
    importanceOfOthersReputations: number;
    /** 0=NONE, 1=nationalize private sector */
    specialFunctionCode: number;
    /** 0=all empires, 1=race-specific, 2=ancient guardians, 3=shakturi */
    availability: number;
    empireNameAdjectives: string[];
    empireNameNouns: string[];
}

export interface GovernmentBiasRow {
    governmentId: number;
    biases: number[];
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function toFloat(raw: string): number {
    const n = parseFloat(raw.trim());
    return Number.isNaN(n) ? 0 : n;
}

function toInt(raw: string): number {
    const n = parseInt(raw.trim(), 10);
    return Number.isNaN(n) ? 0 : n;
}

// Port of GovernmentAttributesList.cs LoadFromFile (line 87): each
// non-comment line is 21 fixed comma-separated fields (GovernmentId, Name,
// then 19 numeric attributes), followed by exactly 5 "Empire Name Adjective"
// slots (empty slots allowed, e.g. ", , , ,"), followed by a
// comma-separated list of "Empire Name Noun"s.
//
// NOTE (faithfully ported quirk): the original noun-reading loop
// (lines ~520-537) only appends a noun when a *following* comma is found —
// so the very last noun on the line (the one after the final comma, with no
// trailing comma of its own) is silently dropped by the original engine.
// E.g. "...Sovereignty, Hegemony" only yields "Sovereignty"; "Hegemony" is
// lost. We reproduce that here rather than "fixing" it, per CLAUDE.md's
// instruction to port logic faithfully (same order of operations).
export function parseGovernments(text: string): Government[] {
    const governments: Government[] = [];
    const lines = stripBom(text).split(/\r\n|\r|\n/);
    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (trimmed === '' || trimmed.substring(0, 1) === "'") {
            continue;
        }
        const parts = rawLine.split(',');
        if (parts.length < 20) {
            continue;
        }
        const governmentId = toInt(parts[0]);
        const name = parts[1].trim();
        const corruption = toFloat(parts[2]);
        const warWeariness = toFloat(parts[3]);
        const maintenanceCosts = toFloat(parts[4]);
        const approvalRating = toFloat(parts[5]);
        const populationGrowth = toFloat(parts[6]);
        const researchSpeed = toFloat(parts[7]);
        const troopRecruitment = toFloat(parts[8]);
        const tradeBonus = toFloat(parts[9]);
        const leaderReplacementLikeliness = toFloat(parts[10]);
        const leaderReplacementDisruptionLevel = toFloat(parts[11]);
        const leaderReplacementBoost = toFloat(parts[12]);
        const leaderReplacementCharacterPool = toInt(parts[13]);
        const leaderReplacementTypicalManner = toInt(parts[14]);
        const stability = toFloat(parts[15]);
        const concernForOwnReputation = toFloat(parts[16]);
        const importanceOfOthersReputations = toFloat(parts[17]);
        const specialFunctionCode = toInt(parts[18]);
        const availability = toInt(parts[19]);

        // Next 5 fields (indices 20..24) are the empire name adjectives.
        const empireNameAdjectives: string[] = [];
        for (let i = 20; i < 25 && i < parts.length; i++) {
            const v = parts[i].trim();
            if (v !== '') empireNameAdjectives.push(v);
        }

        // Remaining fields (index 25+) are nouns, but per the ported quirk
        // above, the final trailing token (after the last comma) is dropped.
        const empireNameNouns: string[] = [];
        const rest = parts.slice(25);
        for (let i = 0; i < rest.length - 1; i++) {
            const v = rest[i].trim();
            if (v !== '') empireNameNouns.push(v);
        }

        governments.push({
            governmentId,
            name,
            corruption,
            warWeariness,
            maintenanceCosts,
            approvalRating,
            populationGrowth,
            researchSpeed,
            troopRecruitment,
            tradeBonus,
            leaderReplacementLikeliness,
            leaderReplacementDisruptionLevel,
            leaderReplacementBoost,
            leaderReplacementCharacterPool,
            leaderReplacementTypicalManner,
            stability,
            concernForOwnReputation,
            importanceOfOthersReputations,
            specialFunctionCode,
            availability,
            empireNameAdjectives,
            empireNameNouns,
        });
    }
    return governments;
}

// Port of GovernmentBiasList.cs LoadFromFile (line 27): each non-comment
// line is "governmentId, name, v0, v1, ..., vN" (N = government count - 1),
// bias values clamped to [-30, 30] (line 66).
export function parseGovernmentBiases(text: string): GovernmentBiasRow[] {
    const rows: GovernmentBiasRow[] = [];
    const lines = stripBom(text).split(/\r\n|\r|\n/);
    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (trimmed === '' || trimmed.substring(0, 1) === "'") {
            continue;
        }
        const parts = trimmed.split(',');
        if (parts.length < 3) {
            continue;
        }
        const governmentId = toInt(parts[0]);
        const biases = parts.slice(2).map((v) => {
            const n = parseInt(v.trim(), 10);
            return Math.max(-30, Math.min(Number.isNaN(n) ? 0 : n, 30));
        });
        rows.push({ governmentId, biases });
    }
    return rows;
}

/** The race fields Empire.ResolveDefaultAllowableGovernmentTypes reads (Race.SpecialGovernmentId /
 *  DisallowedGovernmentIds / Name). */
export interface GovernmentRaceFields {
    name: string;
    specialGovernment: number;
    disallowedGovernments: readonly number[];
}

// Port of Empire.cs ResolveDefaultAllowableGovernmentTypes(Race, bool) (4053) over a given GovernmentsStatic list:
// every Availability-0 government plus the race's SpecialGovernmentId (Availability 1 / 2 / 3), less the race's
// DisallowedGovernmentIds, in GovernmentsStatic order. Empire.resolveDefaultAllowableGovernmentTypes and the new-game
// wizard's government combos (Start.1.cs 4227 IdyEbrKpy3, StartingEmpiresListView.cs _Grid_CellValueChanged) share it.
export function resolveDefaultAllowableGovernmentTypes(governments: readonly (Government | null)[], dominantRace: GovernmentRaceFields | null, forceIncludeSpecialTypesIfRaceAllows = false): number[] {
    const list: number[] = [];
    for (let i = 0; i < governments.length; i++) {
        const governmentAttributes = governments[i];
        if (governmentAttributes == null) {
            continue;
        }
        let flag = true;
        if (dominantRace !== null && dominantRace.disallowedGovernments.includes(governmentAttributes.governmentId)) {
            flag = false;
        }
        if (!flag) {
            continue;
        }
        switch (governmentAttributes.availability) {
            case 0:
                list.push(governmentAttributes.governmentId);
                break;
            case 1:
                if (dominantRace !== null && dominantRace.specialGovernment === governmentAttributes.governmentId) {
                    list.push(governmentAttributes.governmentId);
                }
                break;
            case 2:
                if (dominantRace !== null && (forceIncludeSpecialTypesIfRaceAllows || dominantRace.name === 'Mechanoid') && dominantRace.specialGovernment === governmentAttributes.governmentId) {
                    list.push(governmentAttributes.governmentId);
                } else if (dominantRace !== null && dominantRace.specialGovernment === governmentAttributes.governmentId) {
                    list.push(governmentAttributes.governmentId);
                }
                break;
            case 3:
                if (dominantRace !== null && (forceIncludeSpecialTypesIfRaceAllows || dominantRace.name === 'Shakturi') && dominantRace.specialGovernment === governmentAttributes.governmentId) {
                    list.push(governmentAttributes.governmentId);
                } else if (dominantRace !== null && dominantRace.specialGovernment === governmentAttributes.governmentId) {
                    list.push(governmentAttributes.governmentId);
                }
                break;
        }
    }
    return list;
}
