// Port of facilities.txt loader: PlanetaryFacilityDefinitionList.cs LoadFromFile (line 33).
// Pure parsing — no fs. Handles UTF-8 BOM, `'`-comment lines, and CRLF.

export interface Facility {
    facilityId: number;
    name: string;
    type: number; // 0-16: TroopTrainingCenter through PirateCriminalNetwork
    wonderType: number; // 0-12: NONE, EmpirePopulationGrowth, etc. (only relevant when type=8)
    pictureRef: number;
    buildCost: number;
    maintenanceCost: number;
    value1: number;
    value2: number;
    value3: number;
    description: string;
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Port of PlanetaryFacilityDefinitionList.cs LoadFromFile (line 33).
export function parseFacilities(text: string): Facility[] {
    const facilities: Facility[] = [];
    const lines = stripBom(text).split(/\r\n|\r|\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line === '' || line.substring(0, 1) === "'") {
            continue;
        }

        const parts = line.split(',').map((p) => p.trim());
        if (parts.length < 10) {
            continue;
        }

        const facilityId = parseInt(parts[0], 10);
        const name = parts[1];
        const type = parseInt(parts[2], 10);
        const wonderType = parseInt(parts[3], 10);
        const pictureRef = parseInt(parts[4], 10);
        const buildCost = parseFloat(parts[5]);
        const maintenanceCost = parseFloat(parts[6]);
        const value1 = parseInt(parts[7], 10);
        const value2 = parseInt(parts[8], 10);
        const value3 = parseInt(parts[9], 10);
        // Port: C# reads Description as the raw remainder of the line after
        // Value3's comma (a single Trim), so the space after commas inside the
        // description survives (split/join would drop it).
        let descriptionComma = -1;
        for (let i = 0; i < 10; i++) {
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
            Number.isNaN(facilityId) ||
            Number.isNaN(type) ||
            Number.isNaN(wonderType) ||
            Number.isNaN(pictureRef) ||
            Number.isNaN(buildCost) ||
            Number.isNaN(maintenanceCost) ||
            Number.isNaN(value1) ||
            Number.isNaN(value2) ||
            Number.isNaN(value3)
        ) {
            continue;
        }

        facilities.push({
            facilityId,
            name,
            type,
            wonderType,
            pictureRef,
            buildCost,
            maintenanceCost,
            value1,
            value2,
            value3,
            description,
        });
    }

    return facilities;
}
