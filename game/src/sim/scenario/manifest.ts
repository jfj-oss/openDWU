// Scenario manifest (scenarios/<id>/scenario.json) — see tasks/MODLAYER-DESIGN.md §1. Pure parsing, no I/O.
// Not a port: the mod layer sits beside the faithful sim.

/** A boolean switch the wizard shows as a checkbox; read in the sim with scenarioFlag(galaxy, name). */
export interface ScenarioFlagDef {
    name: string;
    label: string;
    description?: string;
    default: boolean;
}

/** A numeric knob the wizard shows as a number box; read with scenarioParam(galaxy, name, fallback). */
export interface ScenarioParamDef {
    name: string;
    label: string;
    description?: string;
    default: number;
    min?: number;
    max?: number;
}

/** Home-system placement rule: capitals of `race` are searched in the ring minRadius..maxRadius (fractions of sizeX / 2). */
export interface ScenarioHomePlacementRule {
    race: string;
    minRadius: number;
    maxRadius: number;
}

/** Resource placement rule: `resource` only rolls on habitats whose distance-from-centre fraction is in the ring. */
export interface ScenarioResourcePlacementRule {
    resource: string;
    minRadius: number;
    maxRadius: number;
}

export interface ScenarioManifest {
    id: string;
    name: string;
    description: string;
    flags: ScenarioFlagDef[];
    params: ScenarioParamDef[];
    homePlacement: ScenarioHomePlacementRule[];
    resourcePlacement: ScenarioResourcePlacementRule[];
    /** Overlay files relative to the scenario folder (filled by the index generator / fs loader). */
    files: string[];
    /** Scenario ids whose overlays are applied first (their flags / params / rules merged in; this one wins on a name). */
    include: string[];
}

/** /assets/scenarios/index.json. */
export interface ScenarioIndex {
    scenarios: ScenarioManifest[];
}

function str(v: unknown, what: string): string {
    if (typeof v !== 'string' || v.trim() === '') throw new Error(`scenario manifest: ${what} must be a non-empty string`);
    return v;
}

function num(v: unknown, what: string): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`scenario manifest: ${what} must be a number`);
    return v;
}

function arr(v: unknown, what: string): unknown[] {
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new Error(`scenario manifest: ${what} must be an array`);
    return v;
}

function ring(o: Record<string, unknown>, what: string): { minRadius: number; maxRadius: number } {
    const minRadius = num(o.minRadius ?? 0, `${what}.minRadius`);
    const maxRadius = num(o.maxRadius ?? 1.5, `${what}.maxRadius`);
    if (minRadius < 0 || maxRadius < minRadius) throw new Error(`scenario manifest: ${what} needs 0 <= minRadius <= maxRadius`);
    return { minRadius, maxRadius };
}

/** Validates a parsed scenario.json (object or JSON text) and fills the optional lists. Throws on a malformed manifest. */
export function parseScenarioManifest(input: unknown): ScenarioManifest {
    const raw = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
    if (raw === null || typeof raw !== 'object') throw new Error('scenario manifest: not an object');
    const o = raw as Record<string, unknown>;
    const id = str(o.id, 'id');
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`scenario manifest: id "${id}" may only use letters, digits, - and _`);
    const names = new Set<string>();
    const unique = (name: string, what: string): string => {
        if (names.has(name)) throw new Error(`scenario manifest: duplicate ${what} "${name}"`);
        names.add(name);
        return name;
    };
    const flags = arr(o.flags, 'flags').map((f, i): ScenarioFlagDef => {
        const r = f as Record<string, unknown>;
        return {
            name: unique(str(r.name, `flags[${i}].name`), 'flag/param'),
            label: typeof r.label === 'string' ? r.label : String(r.name),
            description: typeof r.description === 'string' ? r.description : undefined,
            default: r.default === true,
        };
    });
    const params = arr(o.params, 'params').map((p, i): ScenarioParamDef => {
        const r = p as Record<string, unknown>;
        return {
            name: unique(str(r.name, `params[${i}].name`), 'flag/param'),
            label: typeof r.label === 'string' ? r.label : String(r.name),
            description: typeof r.description === 'string' ? r.description : undefined,
            default: num(r.default, `params[${i}].default`),
            min: r.min === undefined ? undefined : num(r.min, `params[${i}].min`),
            max: r.max === undefined ? undefined : num(r.max, `params[${i}].max`),
        };
    });
    const homePlacement = arr(o.homePlacement, 'homePlacement').map((h, i) => {
        const r = h as Record<string, unknown>;
        return { race: str(r.race, `homePlacement[${i}].race`), ...ring(r, `homePlacement[${i}]`) };
    });
    const resourcePlacement = arr(o.resourcePlacement, 'resourcePlacement').map((h, i) => {
        const r = h as Record<string, unknown>;
        return { resource: str(r.resource, `resourcePlacement[${i}].resource`), ...ring(r, `resourcePlacement[${i}]`) };
    });
    const files = arr(o.files, 'files').map((f, i) => str(f, `files[${i}]`));
    const include = arr(o.include, 'include').map((f, i) => str(f, `include[${i}]`));
    if (include.includes(id)) throw new Error(`scenario manifest: ${id} includes itself`);
    return {
        id,
        name: typeof o.name === 'string' && o.name.trim() !== '' ? o.name : id,
        description: typeof o.description === 'string' ? o.description : '',
        flags,
        params,
        homePlacement,
        resourcePlacement,
        files,
        include,
    };
}

/** An empty manifest (tests, the empty overlay). */
export function emptyScenarioManifest(id = 'empty'): ScenarioManifest {
    return parseScenarioManifest({ id });
}

/** The manifest a scenario with includes runs with: included flags / params / rules merged in (the outer one wins). */
export function mergeScenarioManifests(main: ScenarioManifest, included: readonly ScenarioManifest[]): ScenarioManifest {
    const out: ScenarioManifest = { ...main, flags: [...main.flags], params: [...main.params], homePlacement: [], resourcePlacement: [] };
    for (const m of included) {
        for (const f of m.flags) if (!out.flags.some((x) => x.name === f.name)) out.flags.push(f);
        for (const p of m.params) if (!out.params.some((x) => x.name === p.name)) out.params.push(p);
        out.homePlacement.push(...m.homePlacement);
        out.resourcePlacement.push(...m.resourcePlacement);
    }
    out.homePlacement.push(...main.homePlacement);
    out.resourcePlacement.push(...main.resourcePlacement);
    return out;
}
