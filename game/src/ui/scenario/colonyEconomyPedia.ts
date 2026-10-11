// Colony Economy add-on: Galactopedia entries (docs/ECONOMY.md §6) for every designation, private facility and refined
// good, under an "Add-ons: Colony Economy" root. Generated pages (no help file); our own icons. DOM only.

import { EncyclopediaCategory, type EncyclopediaItem } from '../../sim/data/gameText';
import { DESIGNATIONS, DESIGNATION_NAMES, DESIGNATION_SUMMARY, FACILITY_DEFS, REFINERY_FACILITIES, facilityDef, isFacilityId, type Designation } from '../../sim/scenario/colonyEconomy/common';
import { GOODS } from '../../sim/scenario/colonyEconomy/refinement';
import { ComponentCategoryType } from '../../sim/data/policies';
import { resourceIconPath } from '../resourceIcons';
import { econDesignationIconUrl, econFacilityIconUrl, econTopicId } from './colonyEconomyInfo';

const PREFIX = 'econ:';
const ROOT_FILE = `${PREFIX}root`;

/** The add-on's encyclopedia items (one root, then designations, facilities and goods). */
export function econGalactopediaItems(): EncyclopediaItem[] {
    const make = (id: string, title: string, filename: string, root: boolean): EncyclopediaItem => ({ id, title, filename, category: EncyclopediaCategory.AddOns, isCategoryRoot: root, relatedItems: [] });
    const root = make('econ-root', 'Add-ons: Colony Economy', ROOT_FILE, true);
    const desig = DESIGNATIONS.map((d) => make(econTopicId('desig', d), `Designation: ${DESIGNATION_NAMES[d]}`, `${PREFIX}desig:${d}`, false));
    const facs = FACILITY_DEFS.map((f) => make(econTopicId('fac', f.id), f.name, `${PREFIX}fac:${f.id}`, false));
    const goods = GOODS.map((g) => make(econTopicId('good', g.key), `${g.name} (refined good)`, `${PREFIX}good:${g.key}`, false));
    const chain = make('econ-chain', 'Refined goods and tech levels', `${PREFIX}chain`, false);
    const all = [root, chain, ...desig, ...facs, ...goods];
    root.relatedItems = [chain, ...desig];
    for (const d of desig) d.relatedItems = facs.filter((f) => facilityDef(f.filename.slice(PREFIX.length + 4) as never).designation === Number(d.filename.split(':')[2]));
    for (const f of facs) {
        const def = facilityDef(f.filename.slice(PREFIX.length + 4) as never);
        f.relatedItems = [desig[DESIGNATIONS.indexOf(def.designation)], ...goods.filter((g) => GOODS.find((x) => `${PREFIX}good:${x.key}` === g.filename)?.facility === def.id)];
    }
    for (const g of goods) {
        const good = GOODS.find((x) => `${PREFIX}good:${x.key}` === g.filename)!;
        g.relatedItems = [chain, ...facs.filter((f) => f.filename === `${PREFIX}fac:${good.facility}`)];
    }
    chain.relatedItems = goods;
    return all;
}

function p(text: string): HTMLElement {
    const e = document.createElement('p');
    e.textContent = text;
    return e;
}
function head(icon: string, lines: string[]): HTMLElement {
    const box = document.createElement('div');
    box.className = 'gp-summary';
    const img = document.createElement('img');
    img.src = icon;
    img.width = 48;
    img.height = 48;
    img.style.float = 'left';
    img.style.marginRight = '10px';
    img.style.imageRendering = 'auto';
    box.appendChild(img);
    for (const l of lines) box.appendChild(p(l));
    const clear = document.createElement('div');
    clear.style.clear = 'both';
    box.appendChild(clear);
    return box;
}
const CAT_NAMES: Partial<Record<ComponentCategoryType, string>> = Object.fromEntries(
    Object.entries(ComponentCategoryType)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => [v, k.replace(/([a-z])([A-Z])/g, '$1 $2')]),
);

/** The generated page for an add-on entry (null: not one of ours). */
export function econGalactopediaPage(filename: string): HTMLElement | null {
    if (!filename.startsWith(PREFIX)) return null;
    const wrap = document.createElement('div');
    wrap.className = 'gp-page';
    const key = filename.slice(PREFIX.length);
    if (key === 'root') {
        wrap.appendChild(p('The Colony Economy add-on gives colonies a designation and lets the private sector spend its surplus on private facilities. Refineries turn raw resources into refined goods that shipyards need for components of tech level 3 and up.'));
        wrap.appendChild(p('Designations: Industrial, Trade Hub, Resort World, Mining Hub, Core World and Frontier / Garrison, each with seven facilities. A Mining Hub or Core World has one extra slot only a refinery may use.'));
    } else if (key === 'chain') {
        wrap.appendChild(p('A component\'s tech level is the level of the research project that unlocks it. Tech 0-2: no goods. Tech 3: one unit of its good (missing goods slow the build to ×0.7). Tech 4: one unit (×0.6). Tech 5-6: two units, and weapons, shields and sensors one Electronics more; the build waits at the yard until they arrive. Tech 7+: three units (four for reactors, hyperdrives and weapons, which also need one Exotics) and one Precision Components; the build waits.'));
        wrap.appendChild(p('A design needs the sum over its components; bases need half. Pirates and independents need none. Before any of an empire\'s components needs goods, yards holding refined goods build up to 15% faster and ships cost 5% less; a refinery earns +5% colony income until its good is needed.'));
        wrap.appendChild(p('The treasury can commission a refinery (the "Fund" button on the Economy tab): it pays what the private sector cannot, and the refinery stays private-owned.'));
    } else if (key.startsWith('desig:')) {
        const d = Number(key.slice(6)) as Designation;
        wrap.appendChild(head(econDesignationIconUrl(d), [DESIGNATION_SUMMARY[d]]));
        wrap.appendChild(p(`Facilities: ${FACILITY_DEFS.filter((f) => f.designation === d).map((f) => f.name).join(', ')}.`));
    } else if (key.startsWith('fac:')) {
        const id = key.slice(4);
        if (!isFacilityId(id)) return wrap;
        const def = facilityDef(id);
        const lines = [
            def.effect,
            `Designation: ${DESIGNATION_NAMES[def.designation]}.`,
            `Base price ${Math.round(def.cost / 1000)}k (× 1 + population / 4 bn, at most ×4), built in ${def.buildDays} days, upkeep ${Math.round(def.upkeepShare * 100)}% of the price a year (private money).`,
        ];
        if (REFINERY_FACILITIES.has(id)) lines.push('A refinery: it may use the Mining Hub / Core World extra slot, and the treasury can commission it.');
        wrap.appendChild(head(econFacilityIconUrl(id), lines));
    } else if (key.startsWith('good:')) {
        const g = GOODS.find((x) => x.key === key.slice(5));
        if (g === undefined) return wrap;
        const used = g.categories.length > 0 ? g.categories.map((c) => CAT_NAMES[c] ?? String(c)).join(', ') : 'every component of tech level 7 and up';
        wrap.appendChild(head(resourceIconPath(g.pictureRef), [`Made by the ${facilityDef(g.facility).name} (${DESIGNATION_NAMES[facilityDef(g.facility).designation]}) from ${g.inputs.join(', ')}.`, `Needed by: ${used}.`, `Base price ${g.basePrice}.`]));
    }
    return wrap;
}
