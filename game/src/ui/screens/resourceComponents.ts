// Resource Components window: a port of the original's pnlResourceComponents ScreenPanel ("Components that use X"),
// opened from a strategic resource's name in the Expansion Planner's resources grid (Main.Part4.cs 2945 method_541:
// a luxury resource opens its Galactopedia topic instead).
//
// Source: Main.Part4.cs 4042 method_552 (660 × 570, HeaderIcon the resource's picture): "Learn about X in the
// Galactopedia..." at (10, 10) (lnkResourceComponentsAboutResource_LinkClicked → method_456), ctlResourceComponents
// (10, 30) 623 × 463 bound to Galaxy.ResolveComponentsThatUseResource (ComponentListView.cs BindData, not summarized,
// no galaxy: Picture 30, Name 353 (a link), Category 80 (ResolveComponentCategoryAbbreviation, the description as the
// tooltip), Size 70, Tech 70 ("####K" of 1)). A name opens the Component Guide (method_554 → method_543): the source
// wires ctlResourceComponents.CellContentClick to method_554, whose handler (_Grid_CellContentClick) only passes
// clicks on column 1 (the hidden Amount column) — the decompiled control never fires it; here the name link does.
// Pure display: it writes nothing.

import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import { resolveComponentsThatUseResource, type ComponentDefinition } from '../../sim/componentStatic';
import { componentDefinitionsStatic } from '../../sim/designGeneration';
import { isLuxuryResource } from '../../sim/logistics/orders';
import { resolveComponentCategoryDescription } from '../../sim/player/designEditor';
import { resourceIconUrl } from '../hud';
import { OwGrid, el, linkLabel, openOriginalWindow, place, type OriginalWindow } from '../originalWindow';
import { componentCategoryAbbreviation, componentImageUrl } from './designPanelsModel';
import { openComponentGuide } from './designEditor';
import { openGalactopedia } from './galactopedia';
import { gt } from './researchBenefits';

export const RESOURCE_COMPONENTS_SIZE = { w: 660, h: 570 } as const;

/** ComponentListView's "####K" format of the Tech cell's constant 1 (BindData writes num = 1 for every row). */
export const TECH_CELL_TEXT = '1K';

export interface ResourceComponentRow {
    index: number;
    component: ComponentDefinition;
    name: string;
    category: string;
    categoryTitle: string;
    size: number;
}

/** method_552's grid rows: Galaxy.ResolveComponentsThatUseResource, as ComponentListView.BindData shows them. */
export function resourceComponentRows(galaxy: Galaxy, resourceId: number): ResourceComponentRow[] {
    return resolveComponentsThatUseResource(componentDefinitionsStatic(galaxy), resourceId).map((c, index) => ({
        index,
        component: c,
        name: c.name,
        category: componentCategoryAbbreviation(c.category),
        categoryTitle: resolveComponentCategoryDescription(c.category),
        size: c.size,
    }));
}

let open: OriginalWindow | null = null;

/**
 * Main.Part4.cs 2945 method_541 (a resource name in the Expansion Planner): a luxury resource opens its Galactopedia
 * topic (method_456), any other the Resource Components window (method_552).
 */
export function openResourceLink(galaxy: Galaxy, empire: Empire, resourceId: number): void {
    const def = galaxy.resourceSystem.byId.get(resourceId);
    if (def === undefined) return;
    if (isLuxuryResource(galaxy, resourceId)) openGalactopedia({ topic: def.name });
    else openResourceComponents(galaxy, empire, resourceId);
}

/** Main.Part4.cs 4042 method_552: the components that use a (non-luxury) resource. */
export function openResourceComponents(galaxy: Galaxy, empire: Empire, resourceId: number): void {
    const def = galaxy.resourceSystem.byId.get(resourceId);
    if (def === undefined || isLuxuryResource(galaxy, resourceId)) return;
    open?.close();
    const win = openOriginalWindow({
        id: 'resource-components',
        title: gt('Components that use RESOURCE', def.name),
        iconUrl: resourceIconUrl(def.pictureRef),
        width: RESOURCE_COMPONENTS_SIZE.w,
        height: RESOURCE_COMPONENTS_SIZE.h,
        onClose: () => {
            if (open === win) open = null;
        },
    });
    open = win;
    const body = win.body;
    // lnkResourceComponentsAboutResource (10, 10) → method_456(resource.Name).
    const lnk = linkLabel(`${gt('Learn about X in the Galactopedia', def.name)}...`, () => openGalactopedia({ topic: def.name }));
    body.appendChild(place(lnk, 10, 10));
    const grid = new OwGrid<ResourceComponentRow>({
        key: (r) => r.index,
        rowHeight: 20,
        columns: [
            {
                id: 'Picture', header: '', width: 30, align: 'center',
                render: (r, c) => {
                    const i = el('img', 'rc-picture');
                    i.src = componentImageUrl(r.component.pictureRef);
                    i.alt = '';
                    i.draggable = false;
                    i.style.width = '20px';
                    i.style.height = '20px';
                    i.style.objectFit = 'contain';
                    i.onerror = () => i.remove();
                    c.appendChild(i);
                },
            },
            { id: 'Name', header: gt('Name'), width: 353, sort: (r) => r.name, render: (r, c) => c.appendChild(linkLabel(r.name, () => openComponentGuide(galaxy, empire, r.component))) },
            { id: 'Category', header: gt('Category'), width: 80, sort: (r) => r.category, render: (r, c) => { c.textContent = r.category; c.title = r.categoryTitle; } },
            { id: 'Size', header: gt('Size'), width: 70, align: 'right', sort: (r) => r.size, render: (r, c) => { c.textContent = String(r.size); } },
            { id: 'TechPoints', header: gt('Tech'), width: 70, align: 'right', render: (_r, c) => { c.textContent = TECH_CELL_TEXT; } },
        ],
    });
    grid.setRows(resourceComponentRows(galaxy, resourceId));
    body.appendChild(place(grid.el, 10, 30, 623, 463));
}
