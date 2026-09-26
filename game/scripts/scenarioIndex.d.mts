export interface ScenarioIndexEntry {
    id: string;
    files: string[];
    [key: string]: unknown;
}
export function listScenarioFiles(dir: string, rel?: string): string[];
export function buildScenarioIndex(root: string): { scenarios: ScenarioIndexEntry[] };
