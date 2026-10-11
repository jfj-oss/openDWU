// Vitest global setup (vite.config.ts test.globalSetup): removes the run's own module-copy folder from the temp dir at
// the end. Vitest's root fetcher copies large transformed modules to <tmpdir>/<random id>/ssr/ for the forks pool and,
// unlike each project's folder (TestProject.clearTmpDir), never deletes it: one leftover folder per run otherwise.
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { TestProject } from 'vitest/node';

export default function setup(project: TestProject): () => Promise<void> {
    return async () => {
        const dir = (project.vitest as unknown as { _tmpDir?: unknown })._tmpDir;
        // Only a folder directly under the temp dir (the internal field's shape could change between Vitest versions).
        if (typeof dir === 'string' && dir.startsWith(tmpdir()) && dir.length > tmpdir().length + 1) await rm(dir, { recursive: true, force: true });
    };
}
