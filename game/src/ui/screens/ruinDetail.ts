// Ruin Detail window: a port of the original's pnlRuinDetail ScreenPanel ("Ruin Summary"), opened by the Colonies
// screen's Show Ruin Details button (Main.Part4.cs 4033 btnColonyShowRuin_Click) and by a click on a ruin in the
// selection panel's InfoPanel (Main.Part4.cs 3581, the Ruin hotspot of InfoPanel.cs 4093 / 4263).
//
// Source: Main.Part4.cs 3978 method_550 (360 × 500): picRuinDetailImage 320 × 160 (Zoom) centred at y 10 from the
// ruin picture (images/environment/ruins/ruin_N.png, bitmap_2); lblRuinDetailName (font_2) centred at y 190;
// lblRuinDetailAbilities (font_6, MaximumSize 320 × 200, Galaxy.GenerateRuinAbilitiesSummary) centred at y 225;
// lblRuinDetailDescription (font_6) at (10, 225 + abilities height + 15), the ruin's description only when the player
// has encountered it and it is a research-unlock ruin or has no benefit left for the player. Labels (170, 170, 170).
// Pure display: it writes nothing.

import './ruinDetail.css';
import type { Galaxy } from '../../sim/galaxy';
import type { Ruin } from '../../sim/ruins';
import { RuinType } from '../../sim/ruins';
import { checkRuinsHaveBenefit, generateRuinAbilitiesSummary } from '../../sim/exploration';
import { COLORS, FONT, el, openOriginalWindow, place, type OriginalWindow } from '../originalWindow';
import { ruinImageUrl } from '../eventMessagePresentation';
import { gt } from './researchBenefits';

export const RUIN_DETAIL_SIZE = { w: 360, h: 500 } as const;

/** method_550's description text: the description, only once encountered and when it is a research-unlock ruin or has
 *  no benefit left for the player; empty otherwise. */
export function ruinDetailDescription(galaxy: Galaxy, ruin: Ruin): string {
    if (ruin.playerEmpireEncountered && ruin.type === RuinType.UnlockResearchProject) return ruin.description ?? '';
    if (ruin.playerEmpireEncountered && !checkRuinsHaveBenefit(galaxy, ruin, galaxy.playerEmpire)) return ruin.description ?? '';
    return '';
}

let open: OriginalWindow | null = null;

/** Main.Part4.cs 3978 method_550: show the ruin's details (one window; a second call replaces it). */
export function openRuinDetail(galaxy: Galaxy, ruin: Ruin | null): void {
    open?.close();
    const win = openOriginalWindow({
        id: 'ruin-detail',
        title: gt('Ruin Summary'),
        width: RUIN_DETAIL_SIZE.w,
        height: RUIN_DETAIL_SIZE.h,
        onClose: () => {
            if (open === win) open = null;
        },
    });
    open = win;
    if (ruin === null) return;
    const body = win.body;
    const W = RUIN_DETAIL_SIZE.w - 15;
    // picRuinDetailImage: 320 × 160 at ((Width - 15 - 320) / 2, 10), SizeMode Zoom.
    const pic = el('img', 'rd-picture');
    pic.src = ruinImageUrl(ruin.pictureRef);
    pic.alt = '';
    pic.draggable = false;
    pic.onerror = () => (pic.style.visibility = 'hidden');
    body.appendChild(place(pic, Math.trunc((W - 320) / 2), 10, 320, 160));
    // lblRuinDetailName (font_2) centred at y 190.
    const name = el('div', 'rd-name', ruin.name);
    name.style.fontSize = `${FONT.header}px`;
    name.style.color = COLORS.label;
    body.appendChild(place(name, 0, 190, W));
    // lblRuinDetailAbilities (font_6, MaximumSize 320 × 200) centred at y 225; the description 15 px below it at x 10.
    const column = el('div', 'rd-column');
    body.appendChild(place(column, 0, 225, W, RUIN_DETAIL_SIZE.h - 225 - 80));
    const abilities = el('div', 'rd-abilities', generateRuinAbilitiesSummary(galaxy, ruin));
    abilities.style.fontSize = `${FONT.large}px`;
    abilities.style.color = COLORS.label;
    column.appendChild(abilities);
    const description = el('div', 'rd-description', ruinDetailDescription(galaxy, ruin));
    description.style.fontSize = `${FONT.large}px`;
    description.style.color = COLORS.label;
    column.appendChild(description);
}

/** Close the Ruin Detail window (no-op when closed). */
export function closeRuinDetail(): void {
    open?.close();
}
