// Port of plagues.txt loader: PlagueList.cs LoadFromFile (line 53).
// Pure parsing — no fs. Handles UTF-8 BOM, `'`-comment lines, and CRLF.

export interface Plague {
    plagueId: number;
    name: string;
    pictureRef: number;
    mortalityRate: number;
    infectionChance: number;
    duration: number;
    naturalOccurrenceLevel: number;
    canCompletelyEliminatePopulation: boolean;
    exceptionRaceName: string;
    exceptionMortalityRate: number;
    exceptionInfectionChance: number;
    exceptionDuration: number;
    specialFunctionCode: number;
    description: string;
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseYesNo(value: string): boolean {
    return value.trim().toUpperCase() === 'Y';
}

// Port of PlagueList.cs LoadFromFile (line 53).
export function parsePlagues(text: string): Plague[] {
    const plagues: Plague[] = [];
    const lines = stripBom(text).split(/\r\n|\r|\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line === '' || line.substring(0, 1) === "'") {
            continue;
        }

        const parts = line.split(',').map((p) => p.trim());
        if (parts.length < 13) {
            continue;
        }

        const plagueId = parseInt(parts[0], 10);
        const name = parts[1];
        const pictureRef = parseInt(parts[2], 10);
        const mortalityRate = parseFloat(parts[3]);
        const infectionChance = parseInt(parts[4], 10);
        const duration = parseFloat(parts[5]); // C# Length is a float
        const naturalOccurrenceLevel = parseInt(parts[6], 10);
        const canCompletelyEliminatePopulation = parseYesNo(parts[7]);
        const exceptionRaceName = parts[8];
        const exceptionMortalityRate = parseFloat(parts[9]);
        const exceptionInfectionChance = parseInt(parts[10], 10);
        const exceptionDuration = parseFloat(parts[11]); // C# ExceptionLength is a float
        const specialFunctionCode = parseInt(parts[12], 10);
        // Port: C# reads Description as the raw remainder of the line after
        // SpecialFunctionCode's comma (a single Trim), so the space after
        // commas inside the description survives (split/join would drop it).
        let descriptionComma = -1;
        for (let i = 0; i < 13; i++) {
            descriptionComma = line.indexOf(',', descriptionComma + 1);
            if (descriptionComma < 0) {
                break;
            }
        }
        if (descriptionComma < 0) {
            continue;
        }
        const description = line.slice(descriptionComma + 1).trim();

        if (
            Number.isNaN(plagueId) ||
            Number.isNaN(pictureRef) ||
            Number.isNaN(mortalityRate) ||
            Number.isNaN(infectionChance) ||
            Number.isNaN(duration) ||
            Number.isNaN(naturalOccurrenceLevel) ||
            Number.isNaN(exceptionMortalityRate) ||
            Number.isNaN(exceptionInfectionChance) ||
            Number.isNaN(exceptionDuration) ||
            Number.isNaN(specialFunctionCode)
        ) {
            continue;
        }

        plagues.push({
            plagueId,
            name,
            pictureRef,
            mortalityRate,
            infectionChance,
            duration,
            naturalOccurrenceLevel,
            canCompletelyEliminatePopulation,
            exceptionRaceName,
            exceptionMortalityRate,
            exceptionInfectionChance,
            exceptionDuration,
            specialFunctionCode,
            description,
        });
    }

    return plagues;
}
