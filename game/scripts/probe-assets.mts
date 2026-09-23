// Probe every per-habitat art URL the Main View will request, against the
// running dev server, and report 404s. Mirrors src/main.ts boot + assets.ts
// folder mappings (duplicated here so the probe doesn't import pixi).
import { readFileSync } from 'node:fs';
import { generateGalaxy } from '../src/sim/galaxy';
import { parseSystemNames } from '../src/sim/data';
import { GalaxyShape, HabitatCategoryType, HabitatType } from '../src/sim/types';

const text = readFileSync('public/assets/dwu/systemNames.txt', 'utf8');
const names = parseSystemNames(text);
const g = generateGalaxy({ seed: 1, shape: GalaxyShape.Spiral, starCount: 700, sectorWidth: 4, sectorHeight: 4, systemNames: names });

const STAR_MAP_FOLDERS: Record<string, string> = {
    [HabitatType.MainSequence]: 'mainsequence',
    [HabitatType.RedGiant]: 'redgiant',
    [HabitatType.SuperGiant]: 'supergiant',
    [HabitatType.WhiteDwarf]: 'whitedwarf',
    [HabitatType.Neutron]: 'neutron',
    [HabitatType.BlackHole]: 'blackhole',
    [HabitatType.SuperNova]: 'flares',
};
const PLANET_FOLDERS: Record<string, string[]> = {
    [HabitatType.Volcanic]: ['volcanic'],
    [HabitatType.Desert]: ['desert'],
    [HabitatType.MarshySwamp]: ['marshy', 'swamp'],
    [HabitatType.Continental]: ['continental'],
    [HabitatType.Ocean]: ['ocean'],
    [HabitatType.BarrenRock]: ['barren_rock', 'barrenrock'],
    [HabitatType.Ice]: ['ice'],
    [HabitatType.GasGiant]: ['gas_giant', 'gasgiant'],
    [HabitatType.FrozenGasGiant]: ['frozen_gas_giant', 'frozengasgiant'],
};
const CLOUD_FOLDERS: Record<string, string> = {
    [HabitatType.Hydrogen]: 'hydrogen',
    [HabitatType.Helium]: 'helium',
    [HabitatType.Argon]: 'argon',
    [HabitatType.Ammonia]: 'ammonia',
    [HabitatType.CarbonDioxide]: 'carbon_dioxide',
    [HabitatType.Chlorine]: 'chlorine',
    [HabitatType.Oxygen]: 'oxygen',
    [HabitatType.NitrogenOxygen]: 'nitrogen_oxygen',
};
const IMG = '/assets/dwu/images';

const urls = new Set<string>([`${IMG}/environment/galaxybackdrops/galaxy_backdrop.jpg`]);
const all = [...g.systems.flatMap((s) => [s.systemStar, ...s.habitats]), ...g.habitats];
for (const h of all) {
    const mf = STAR_MAP_FOLDERS[h.type] ?? 'mainsequence';
    if (h.category === HabitatCategoryType.Star) {
        urls.add(`${IMG}/environment/mapstars/${mf}/${h.pictureRef}.png`);
        urls.add(`${IMG}/environment/stars/${mf}/${h.pictureRef}.png`);
        if (h.type === HabitatType.BlackHole) urls.add(`${IMG}/environment/stars/blackhole/${h.pictureRef}.png`);
    } else if (h.category === HabitatCategoryType.Planet) {
        for (const f of PLANET_FOLDERS[h.type] ?? ['ocean']) {
            urls.add(`${IMG}/environment/planets/${f}/${h.pictureRef}.png`);
            urls.add(`${IMG}/environment/planets/${f}/planet_${h.pictureRef}.png`);
        }
    } else if (h.category === HabitatCategoryType.GasCloud) {
        urls.add(`${IMG}/environment/nebulae/${CLOUD_FOLDERS[h.type] ?? 'hydrogen'}/${h.pictureRef}.png`);
    } else if (h.category === HabitatCategoryType.Asteroid) {
        urls.add(`${IMG}/environment/asteroids/${h.pictureRef}.png`);
    }
}

const base = 'http://localhost:5173';
const missing: string[] = [];
for (const u of [...urls].sort()) {
    const r = await fetch(base + u, { method: 'GET' });
    if (!r.ok) missing.push(`${u} -> ${r.status}`);
}
console.log(`checked ${urls.size} urls`);
if (missing.length === 0) {
    console.log('all present');
} else {
    for (const m of missing) console.log('MISSING', m);
}