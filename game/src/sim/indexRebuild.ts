// Port of Galaxy.5.cs 3197 RebuildIndexes (and its four parts, 3205-3300): the habitat, system, galaxy-location and
// built-object index grids rebuilt from the objects' own positions. The C# runs it once the new galaxy is set up
// (Start.2.cs 118 in method_78, after GenerateGalaxy) and on every load (Start.cs 1846 / 1921, Main.Part7.cs 3987).
// Note the habitat rule differs from generation: Galaxy.4.cs 2323-2333 files every habitat of a system under its
// star's cell, RebuildHabitatIndexes files each habitat under its own cell (ResolveIndex(habitat.Xpos, habitat.Ypos)).

import type { Galaxy } from './galaxy';
import type { GalaxyLocation } from './galaxyLocation';

// Galaxy.5.cs 3197 RebuildIndexes.
export function rebuildIndexes(galaxy: Galaxy): void {
    galaxy.initIndexGrids();
    // 3282 RebuildHabitatIndexes: Habitats in list order, skipping destroyed ones.
    for (const habitat of galaxy.habitats) {
        if (habitat != null && !habitat.hasBeenDestroyed) {
            const gi = galaxy.resolveIndex(habitat.xpos, habitat.ypos);
            galaxy.habitatIndexGrid[gi.x][gi.y].push(habitat);
        }
    }
    // 3260 RebuildSystemIndexes: by the system star's position.
    for (const systemInfo of galaxy.systems) {
        if (systemInfo != null && systemInfo.systemStar != null) {
            const gi = galaxy.resolveIndex(systemInfo.systemStar.xpos, systemInfo.systemStar.ypos);
            galaxy.systemsIndexGrid[gi.x][gi.y].push(systemInfo);
        }
    }
    // 3227 RebuildGalaxyLocationIndexes: every cell the location's rectangle touches (ResolveIndex corners).
    const grid: GalaxyLocation[][][] = [];
    for (let i = 0; i < galaxy.indexMaxX; i++) grid.push(Array.from({ length: galaxy.indexMaxY }, () => []));
    for (const galaxyLocation of galaxy.galaxyLocations) {
        if (galaxyLocation == null) continue;
        const a = galaxy.resolveIndex(galaxyLocation.xpos, galaxyLocation.ypos);
        const b = galaxy.resolveIndex(galaxyLocation.xpos + galaxyLocation.width, galaxyLocation.ypos + galaxyLocation.height);
        for (let l = a.x; l <= b.x; l++) {
            for (let m = a.y; m <= b.y; m++) {
                if (!grid[l][m].includes(galaxyLocation)) grid[l][m].push(galaxyLocation);
            }
        }
    }
    (galaxy as unknown as { galaxyLocationIndex: GalaxyLocation[][][] }).galaxyLocationIndex = grid;
    // 3205 RebuildBuiltObjectIndexes: BuiltObjects in list order, skipping destroyed ones.
    for (const builtObject of galaxy.builtObjects) {
        if (builtObject != null && !builtObject.hasBeenDestroyed) {
            const gi = galaxy.resolveIndex(builtObject.xpos, builtObject.ypos);
            galaxy.builtObjectIndexGrid[gi.x][gi.y].push(builtObject);
        }
    }
}
