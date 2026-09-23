// Find a star with planets for the system-zoom screenshot (mirrors src/main.ts boot).
import { readFileSync } from 'node:fs';
import { generateGalaxy } from '../src/sim/galaxy';
import { parseSystemNames } from '../src/sim/data';
import { GalaxyShape, HabitatCategoryType, HabitatType } from '../src/sim/types';

const text = readFileSync('public/assets/dwu/systemNames.txt', 'utf8');
// Mirror src/main.ts loadSystemNames exactly (name list drives the RNG).
const names = parseSystemNames(text);
const g = generateGalaxy({ seed: 1, shape: GalaxyShape.Spiral, starCount: 700, sectorWidth: 4, sectorHeight: 4, systemNames: names });
console.log('sizeX', g.sizeX, 'sizeY', g.sizeY, 'sectorSize', g.sectorSize, 'systems', g.systems.length);
const cands = [];
for (const s of g.systems) {
    const planets = s.habitats.filter((h) => h.category === HabitatCategoryType.Planet);
    const moons = s.habitats.filter((h) => h.category === HabitatCategoryType.Moon);
    const star = s.systemStar;
    if (star.type === HabitatType.MainSequence && planets.length >= 3 && moons.length >= 1) {
        const maxOrbit = Math.max(...planets.map((p) => p.orbitDistance));
        cands.push({ name: star.name, x: star.xpos, y: star.ypos, planets: planets.length, moons: moons.length, maxOrbit, starDia: star.diameter });
    }
}
cands.sort((a, b) => b.planets - a.planets);
for (const c of cands.slice(0, 8)) console.log(JSON.stringify(c));