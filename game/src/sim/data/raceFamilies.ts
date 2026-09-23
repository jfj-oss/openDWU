// Port of raceFamilies.txt loader: RaceFamilyList.cs LoadFromFile (line 57).
// Pure parsing — no fs. Handles UTF-8 BOM, `'`-comment lines, and CRLF.

export interface RaceFamily {
    /** RaceFamilyId: unique numeric id (0-based, expected sequential 0-29). */
    raceFamilyId: number;
    name: string;
    /** SpecialFunctionCode: 0=NOTHING, 1=Shakturi Likes, 2=Shakturi Hates. */
    specialFunctionCode: number;
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Port of RaceFamilyList.cs LoadFromFile (line 57): each non-comment,
// non-blank line is "id, name, specialFunctionCode".
export function parseRaceFamilies(text: string): RaceFamily[] {
    const families: RaceFamily[] = [];
    const lines = stripBom(text).split(/\r\n|\r|\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line === '' || line.substring(0, 1) === "'") {
            continue;
        }
        const parts = line.split(',');
        if (parts.length < 3) {
            continue;
        }
        const raceFamilyId = parseInt(parts[0].trim(), 10);
        const name = parts[1].trim();
        const specialFunctionCode = parseInt(parts[2].trim(), 10);
        if (Number.isNaN(raceFamilyId) || Number.isNaN(specialFunctionCode)) {
            continue;
        }
        families.push({ raceFamilyId, name, specialFunctionCode });
    }
    return families;
}
