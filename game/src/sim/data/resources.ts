// Port of resources.txt loader: ResourceSystem.cs LoadFromFile (line 260).
// Pure parsing — no fs. Handles UTF-8 BOM, `'`-comment lines, and CRLF.

export interface ResourceDistribution {
    type: number; // 0=Planet/Moon, 1=Asteroid, 2=GasCloud
    subType: number;
    prevalence: number;
    abundanceMin: number;
    abundanceMax: number;
}

export interface Resource {
    resourceId: number;
    name: string;
    pictureRef: number;
    basePrice: number;
    type: number; // 0=Mineral, 1=Gas, 2=Luxury
    superLuxuryBonusAmount: number;
    isFuel: boolean;
    isImportantPreWarpResource: boolean;
    colonyGrowthResourceLevel: number;
    colonyManufacturingLevel: number;
    distributions: ResourceDistribution[];
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseYesNo(value: string): boolean {
    return value.trim().toUpperCase() === 'Y';
}

// Port of ResourceSystem.cs LoadFromFile (line 260) and ResourceDefinition parsing.
export function parseResources(text: string): Resource[] {
    const resources: Resource[] = [];
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

        const resourceId = parseInt(parts[0], 10);
        const name = parts[1];
        const pictureRef = parseInt(parts[2], 10);
        const basePrice = parseFloat(parts[3]);
        const type = parseInt(parts[4], 10);
        const superLuxuryBonusAmount = parseInt(parts[5], 10);
        const isFuel = parseYesNo(parts[6]);
        const isImportantPreWarpResource = parseYesNo(parts[7]);
        const colonyGrowthResourceLevel = parseFloat(parts[8]);
        const colonyManufacturingLevel = parseFloat(parts[9]);

        if (
            Number.isNaN(resourceId) ||
            Number.isNaN(pictureRef) ||
            Number.isNaN(basePrice) ||
            Number.isNaN(type) ||
            Number.isNaN(superLuxuryBonusAmount) ||
            Number.isNaN(colonyGrowthResourceLevel) ||
            Number.isNaN(colonyManufacturingLevel)
        ) {
            continue;
        }

        const distributions: ResourceDistribution[] = [];
        let distIndex = 10;
        while (distIndex + 4 < parts.length) {
            const distType = parseInt(parts[distIndex], 10);
            const distSubType = parseInt(parts[distIndex + 1], 10);
            const prevalence = parseFloat(parts[distIndex + 2]);
            const abundanceMin = parseFloat(parts[distIndex + 3]);
            const abundanceMax = parseFloat(parts[distIndex + 4]);

            if (
                !Number.isNaN(distType) &&
                !Number.isNaN(distSubType) &&
                !Number.isNaN(prevalence) &&
                !Number.isNaN(abundanceMin) &&
                !Number.isNaN(abundanceMax)
            ) {
                distributions.push({
                    type: distType,
                    subType: distSubType,
                    prevalence,
                    abundanceMin,
                    abundanceMax,
                });
            }

            distIndex += 5;
        }

        resources.push({
            resourceId,
            name,
            pictureRef,
            basePrice,
            type,
            superLuxuryBonusAmount,
            isFuel,
            isImportantPreWarpResource,
            colonyGrowthResourceLevel,
            colonyManufacturingLevel,
            distributions,
        });
    }

    return resources;
}
