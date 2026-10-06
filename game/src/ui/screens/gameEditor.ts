// Game Editor (openDWU, not the original's editor yet): barebones. Lists the player's colonies that have pirate
// facilities and removes them (and all pirate control there) through the journaled editorRemovePirateFacilities
// command, the same as the colony screen's "Editor: Remove Pirate Bases" button.

import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Habitat } from '../../sim/types';
import { PlanetaryFacilityType } from '../../sim/researchSystem';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { glassButton, openOriginalWindow, place, type OriginalWindow } from '../originalWindow';

const PIRATE = new Set([PlanetaryFacilityType.PirateBase, PlanetaryFacilityType.PirateFortress, PlanetaryFacilityType.PirateCriminalNetwork]);

function pirateFacilities(h: Habitat): string[] {
    return (h.facilities ?? []).filter((f) => f != null && PIRATE.has(f.type)).map((f) => (f.constructionProgress < 1 ? `${f.name} (${Math.round(f.constructionProgress * 100)}%)` : f.name));
}

let open: OriginalWindow | null = null;

export function toggleGameEditor(empire: Empire): void {
    if (open !== null && !open.closed) {
        open.close();
        open = null;
        return;
    }
    const win = openOriginalWindow({ id: 'gameEditor', title: 'Game Editor', width: 560, height: 420, onClose: () => { open = null; } });
    open = win;
    const render = (): void => {
        win.body.replaceChildren();
        const colonies = empire.colonies.filter((h): h is Habitat => h !== null && pirateFacilities(h).length > 0);
        const line = (txt: string, y: number): void => {
            const d = document.createElement('div');
            d.textContent = txt;
            d.style.cssText = 'color: rgb(170,170,170); font-size: 13px; white-space: nowrap;';
            win.body.appendChild(place(d, 12, y));
        };
        line(colonies.length === 0 ? 'No pirate bases on your colonies.' : 'Your colonies with pirate facilities:', 10);
        colonies.forEach((h, i) => {
            const y = 40 + i * 32;
            line(`${h.name}: ${pirateFacilities(h).join(', ')}`, y + 5);
            const b = glassButton('Remove', { onClick: () => issuePlayerCommand(empire.galaxy as Galaxy, empire, 'editorRemovePirateFacilities', [h], render) });
            win.body.appendChild(place(b, 430, y, 110, 24));
        });
        if (colonies.length > 1) {
            const all = glassButton('Remove from all colonies', {
                onClick: () => { for (const h of colonies) issuePlayerCommand(empire.galaxy as Galaxy, empire, 'editorRemovePirateFacilities', [h], render); },
            });
            win.body.appendChild(place(all, 12, 40 + colonies.length * 32 + 10, 220, 26));
        }
    };
    render();
}
