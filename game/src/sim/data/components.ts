// Port of components.txt loader: ComponentDefinitionList.cs LoadFromFile (line 73).
// Pure parsing — no fs. Handles UTF-8 BOM, `'`-comment lines, and CRLF.

export interface ComponentResourceRequirement {
    resourceId: number;
    amount: number;
}

export interface Component {
    componentId: number;
    name: string;
    pictureRef: number;
    specialImageIndex: number;
    soundEffectFilename: string;
    type: number; // ComponentType enum
    value1: number;
    value2: number;
    value3: number;
    value4: number;
    value5: number;
    value6: number;
    value7: number;
    resourceRequirements: ComponentResourceRequirement[];
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Port of ComponentDefinitionList.cs LoadFromFile (line 73).
export function parseComponents(text: string): Component[] {
    const components: Component[] = [];
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

        const componentId = parseInt(parts[0], 10);
        const name = parts[1];
        const pictureRef = parseInt(parts[2], 10);
        const specialImageIndex = parseInt(parts[3], 10);
        const soundEffectFilename = parts[4];
        const type = parseInt(parts[5], 10);
        const value1 = parseInt(parts[6], 10);
        const value2 = parseInt(parts[7], 10);
        const value3 = parseInt(parts[8], 10);
        const value4 = parseInt(parts[9], 10);
        const value5 = parseInt(parts[10], 10);
        const value6 = parseInt(parts[11], 10);
        const value7 = parseInt(parts[12], 10);

        if (
            Number.isNaN(componentId) ||
            Number.isNaN(pictureRef) ||
            Number.isNaN(specialImageIndex) ||
            Number.isNaN(type) ||
            Number.isNaN(value1) ||
            Number.isNaN(value2) ||
            Number.isNaN(value3) ||
            Number.isNaN(value4) ||
            Number.isNaN(value5) ||
            Number.isNaN(value6) ||
            Number.isNaN(value7)
        ) {
            continue;
        }

        // Parse resource requirements: pairs of (resourceId, amount)
        // Resource requirements start at index 15 (after 7 values + 2 extra fields at indices 13-14)
        const resourceRequirements: ComponentResourceRequirement[] = [];
        for (let i = 15; i + 1 < parts.length; i += 2) {
            const resourceId = parseInt(parts[i], 10);
            const amount = parseInt(parts[i + 1], 10);
            if (!Number.isNaN(resourceId) && !Number.isNaN(amount)) {
                resourceRequirements.push({ resourceId, amount });
            }
        }

        components.push({
            componentId,
            name,
            pictureRef,
            specialImageIndex,
            soundEffectFilename,
            type,
            value1,
            value2,
            value3,
            value4,
            value5,
            value6,
            value7,
            resourceRequirements,
        });
    }

    return components;
}
