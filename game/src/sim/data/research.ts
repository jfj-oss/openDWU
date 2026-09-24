// Port of research.txt loader: ResearchNodeDefinitionList.cs LoadFromFile (line 44) + Galaxy.3.cs ~4640-4700.
// Pure parsing — no fs. Handles UTF-8 BOM, `'`-comment lines, and CRLF.

export interface ComponentImprovement {
    componentId: number;
    techLevel: number;
    value1: number;
    value2: number;
    value3: number;
    value4: number;
    value5: number;
    value6: number;
    value7: number;
}

export interface ResearchAbility {
    name: string;
    type: number; // 0=Ship Boarding, 1=Colonize New Planet Type, etc.
    level: number;
    value: number;
    relatedObjectIndex: number;
}

export interface PlagueChange {
    plagueId: number;
    description: string;
    mortalityRate: number;
    infectionChance: number;
    duration: number;
    exceptionMortalityRate: number;
    exceptionInfectionChance: number;
    exceptionDuration: number;
}

export interface ResearchParent {
    parentProjectId: number;
    isRequired: boolean;
}

export interface ResearchNode {
    projectId: number;
    name: string;
    techLevel: number;
    row: number;
    industry: number;
    category: number;
    specialFunctionCode: number;
    baseCostMultiplierOverride: number;

    components: number[]; // Component IDs
    componentImprovements: ComponentImprovement[];
    fighters: number[]; // Fighter IDs
    facilityId: number | null;
    abilities: ResearchAbility[];
    plagueChange: PlagueChange | null;
    allowedRaces: string[];
    parents: ResearchParent[];
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseYesNo(value: string): boolean {
    return value.trim().toUpperCase() === 'Y';
}

// Parse semicolon-separated key-value line (e.g. "PROJECT ;0, Wave Weapons, 2, 1, 0, 19, 0, 0.0,")
function parseDataLine(line: string): string[] {
    const parts = line.split(';');
    if (parts.length < 2) {
        return [];
    }
    const dataStr = parts[1].trim();
    return dataStr.split(',').map((p) => p.trim());
}

// Port of ResearchNodeDefinitionList.cs LoadFromFile (line 44) and Galaxy.3.cs ~4640-4700.
export function parseResearch(text: string): ResearchNode[] {
    const nodes: ResearchNode[] = [];
    const lines = stripBom(text).split(/\r\n|\r|\n/);

    let currentNode: Partial<ResearchNode> | null = null;
    let i = 0;

    while (i < lines.length) {
        const rawLine = lines[i].trim();
        i++;

        if (rawLine === '' || rawLine.substring(0, 1) === "'") {
            continue;
        }

        const lineParts = rawLine.split(';');
        if (lineParts.length < 2) {
            continue;
        }

        const lineType = lineParts[0].trim().toUpperCase();
        const dataStr = lineParts[1].trim();
        const dataParts = dataStr.split(',').map((p) => p.trim());

        switch (lineType) {
            case 'PROJECT': {
                // Save previous node if exists
                if (currentNode && currentNode.projectId !== undefined) {
                    nodes.push({
                        projectId: currentNode.projectId!,
                        name: currentNode.name || '',
                        techLevel: currentNode.techLevel || 0,
                        row: currentNode.row || 0,
                        industry: currentNode.industry || 0,
                        category: currentNode.category || 0,
                        specialFunctionCode: currentNode.specialFunctionCode || 0,
                        baseCostMultiplierOverride: currentNode.baseCostMultiplierOverride || 0,
                        components: currentNode.components || [],
                        componentImprovements: currentNode.componentImprovements || [],
                        fighters: currentNode.fighters || [],
                        facilityId: currentNode.facilityId ?? null,
                        abilities: currentNode.abilities || [],
                        plagueChange: currentNode.plagueChange ?? null,
                        allowedRaces: currentNode.allowedRaces || [],
                        parents: currentNode.parents || [],
                    });
                }

                // Start new node
                const projectId = parseInt(dataParts[0], 10);
                const name = dataParts[1];
                const techLevel = parseInt(dataParts[2], 10);
                const row = parseInt(dataParts[3], 10);
                const industry = parseInt(dataParts[4], 10);
                const category = parseInt(dataParts[5], 10);
                const specialFunctionCode = parseInt(dataParts[6], 10);
                const baseCostMultiplierOverride = parseFloat(dataParts[7]);

                if (!Number.isNaN(projectId)) {
                    currentNode = {
                        projectId,
                        name,
                        techLevel: Number.isNaN(techLevel) ? 0 : techLevel,
                        row: Number.isNaN(row) ? 0 : row,
                        industry: Number.isNaN(industry) ? 0 : industry,
                        category: Number.isNaN(category) ? 0 : category,
                        specialFunctionCode: Number.isNaN(specialFunctionCode) ? 0 : specialFunctionCode,
                        baseCostMultiplierOverride: Number.isNaN(baseCostMultiplierOverride) ? 0 : baseCostMultiplierOverride,
                        components: [],
                        componentImprovements: [],
                        fighters: [],
                        facilityId: null,
                        abilities: [],
                        plagueChange: null,
                        allowedRaces: [],
                        parents: [],
                    };
                }
                break;
            }

            case 'COMPONENTS': {
                if (currentNode) {
                    currentNode.components = dataParts
                        .map((p) => parseInt(p, 10))
                        .filter((n) => !Number.isNaN(n));
                }
                break;
            }

            case 'COMPONENT IMPROVEMENTS': {
                if (currentNode) {
                    if (dataParts.length >= 9) {
                        const componentId = parseInt(dataParts[0], 10);
                        const techLevel = parseInt(dataParts[1], 10);
                        const value1 = parseInt(dataParts[2], 10);
                        const value2 = parseInt(dataParts[3], 10);
                        const value3 = parseInt(dataParts[4], 10);
                        const value4 = parseInt(dataParts[5], 10);
                        const value5 = parseInt(dataParts[6], 10);
                        const value6 = parseInt(dataParts[7], 10);
                        const value7 = parseInt(dataParts[8], 10);

                        if (!Number.isNaN(componentId)) {
                            if (!currentNode.componentImprovements) {
                                currentNode.componentImprovements = [];
                            }
                            currentNode.componentImprovements.push({
                                componentId,
                                techLevel: Number.isNaN(techLevel) ? 0 : techLevel,
                                value1: Number.isNaN(value1) ? 0 : value1,
                                value2: Number.isNaN(value2) ? 0 : value2,
                                value3: Number.isNaN(value3) ? 0 : value3,
                                value4: Number.isNaN(value4) ? 0 : value4,
                                value5: Number.isNaN(value5) ? 0 : value5,
                                value6: Number.isNaN(value6) ? 0 : value6,
                                value7: Number.isNaN(value7) ? 0 : value7,
                            });
                        }
                    }
                }
                break;
            }

            case 'FIGHTERS': {
                if (currentNode) {
                    currentNode.fighters = dataParts
                        .map((p) => parseInt(p, 10))
                        .filter((n) => !Number.isNaN(n));
                }
                break;
            }

            case 'FACILITY': {
                if (currentNode) {
                    const facilityId = parseInt(dataParts[0], 10);
                    if (!Number.isNaN(facilityId)) {
                        currentNode.facilityId = facilityId;
                    }
                }
                break;
            }

            case 'ABILITIES': {
                if (currentNode) {
                    if (dataParts.length >= 5) {
                        const name = dataParts[0];
                        const type = parseInt(dataParts[1], 10);
                        const level = parseInt(dataParts[2], 10);
                        const value = parseInt(dataParts[3], 10);
                        const relatedObjectIndex = parseInt(dataParts[4], 10);

                        if (!Number.isNaN(type)) {
                            if (!currentNode.abilities) {
                                currentNode.abilities = [];
                            }
                            currentNode.abilities.push({
                                name,
                                type,
                                level: Number.isNaN(level) ? 0 : level,
                                value: Number.isNaN(value) ? 0 : value,
                                relatedObjectIndex: Number.isNaN(relatedObjectIndex) ? 0 : relatedObjectIndex,
                            });
                        }
                    }
                }
                break;
            }

            case 'PLAGUE CHANGE': {
                if (currentNode && dataParts.length >= 8) {
                    const plagueId = parseInt(dataParts[0], 10);
                    const description = dataParts[1];
                    const mortalityRate = parseInt(dataParts[2], 10);
                    const infectionChance = parseInt(dataParts[3], 10);
                    const duration = parseInt(dataParts[4], 10);
                    const exceptionMortalityRate = parseInt(dataParts[5], 10);
                    const exceptionInfectionChance = parseInt(dataParts[6], 10);
                    const exceptionDuration = parseInt(dataParts[7], 10);

                    if (!Number.isNaN(plagueId)) {
                        currentNode.plagueChange = {
                            plagueId,
                            description,
                            mortalityRate: Number.isNaN(mortalityRate) ? 0 : mortalityRate,
                            infectionChance: Number.isNaN(infectionChance) ? 0 : infectionChance,
                            duration: Number.isNaN(duration) ? 0 : duration,
                            exceptionMortalityRate: Number.isNaN(exceptionMortalityRate) ? 0 : exceptionMortalityRate,
                            exceptionInfectionChance: Number.isNaN(exceptionInfectionChance) ? 0 : exceptionInfectionChance,
                            exceptionDuration: Number.isNaN(exceptionDuration) ? 0 : exceptionDuration,
                        };
                    }
                }
                break;
            }

            case 'ALLOWED RACES': {
                if (currentNode) {
                    currentNode.allowedRaces = dataParts.filter((p) => p.length > 0);
                }
                break;
            }

            case 'PARENTS': {
                if (currentNode) {
                    currentNode.parents = [];
                    for (let j = 0; j + 1 < dataParts.length; j += 2) {
                        const parentProjectId = parseInt(dataParts[j], 10);
                        const isRequired = parseYesNo(dataParts[j + 1]);
                        if (!Number.isNaN(parentProjectId)) {
                            currentNode.parents.push({
                                parentProjectId,
                                isRequired,
                            });
                        }
                    }
                }
                break;
            }
        }
    }

    // Don't forget the last node
    if (currentNode && currentNode.projectId !== undefined) {
        nodes.push({
            projectId: currentNode.projectId!,
            name: currentNode.name || '',
            techLevel: currentNode.techLevel || 0,
            row: currentNode.row || 0,
            industry: currentNode.industry || 0,
            category: currentNode.category || 0,
            specialFunctionCode: currentNode.specialFunctionCode || 0,
            baseCostMultiplierOverride: currentNode.baseCostMultiplierOverride || 0,
            components: currentNode.components || [],
            componentImprovements: currentNode.componentImprovements || [],
            fighters: currentNode.fighters || [],
            facilityId: currentNode.facilityId ?? null,
            abilities: currentNode.abilities || [],
            plagueChange: currentNode.plagueChange ?? null,
            allowedRaces: currentNode.allowedRaces || [],
            parents: currentNode.parents || [],
        });
    }

    return nodes;
}
