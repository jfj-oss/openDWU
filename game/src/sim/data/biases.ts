// Port of raceBiases.txt / raceFamilyBiases.txt loaders:
// - Galaxy.cs LoadRaceBiases (~1967-2030) + RaceBiasList.cs LoadBiases (line 28)
// - Galaxy.3.cs InitializeRaceFamilyBiases (~2114-2126) + RaceFamilyBiasList
// Pure parsing — no fs. Handles UTF-8 BOM, `'`-comment lines, and CRLF.
//
// Both files share the same row format: "index, Name, v0, v1, ..., vN" where
// each row is the named race's (or race family's) bias towards every race
// (or race family) in index order, producing a square matrix.

export interface BiasMatrix {
    /** Row order as read from the file (should be 0..N-1, sequential). */
    names: string[];
    /** matrix[i][j] = bias of row i's race/family towards column j's. */
    matrix: number[][];
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(n, max));
}

// Shared row parser for both raceBiases.txt and raceFamilyBiases.txt: each
// non-comment line is "id, name, v0, v1, ..., vN". `clampMin`/`clampMax`
// mirror the per-file clamping (raceBiases: -50..50 per Galaxy.cs ~2029;
// raceFamilyBiases/governmentBiases: -30..30 per GovernmentBiasList.cs line 66).
function parseBiasFile(text: string, clampMin: number, clampMax: number): BiasMatrix {
    const names: string[] = [];
    const matrix: number[][] = [];
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
        const id = parseInt(parts[0].trim(), 10);
        if (Number.isNaN(id)) {
            continue;
        }
        const name = parts[1].trim();
        const values = parts.slice(2).map((v) => {
            const n = parseInt(v.trim(), 10);
            return clamp(Number.isNaN(n) ? 0 : n, clampMin, clampMax);
        });
        names[id] = name;
        matrix[id] = values;
    }
    return { names, matrix };
}

// Port of Galaxy.cs LoadRaceBiases (~1967-2030) + RaceBiasList.cs LoadBiases
// (line 28): bias values are clamped to [-50, 50] (Galaxy.cs ~2029).
export function parseRaceBiases(text: string): BiasMatrix {
    return parseBiasFile(text, -50, 50);
}

// Port of Galaxy.3.cs InitializeRaceFamilyBiases (~2114-2126), loading via
// RaceFamilyBiasList.LoadFromFile. Values clamped to [-50, 50] as documented
// in raceFamilyBiases.txt's header comment.
export function parseRaceFamilyBiases(text: string): BiasMatrix {
    return parseBiasFile(text, -50, 50);
}
