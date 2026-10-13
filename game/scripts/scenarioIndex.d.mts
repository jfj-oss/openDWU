export interface ScenarioIndexEntry {
    id: string;
    files: string[];
    [key: string]: unknown;
}
export function listScenarioFiles(dir: string, rel?: string): string[];
export const CLASSIC_ADDONS: string[];
export function editionAllowlist(edition: string | undefined): string[] | null;
export function buildScenarioIndex(root: string, allow?: readonly string[] | null): { scenarios: ScenarioIndexEntry[] };
