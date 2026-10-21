// Game Editor (openDWU, not the original's editor yet): barebones. Lists the player's colonies that have pirate
// facilities and removes them (and all pirate control there) through the journaled editorRemovePirateFacilities
// command, the same as the colony screen's "Editor: Remove Pirate Bases" button. Above it, "Spawn threat": one button per
// threat that can aim at one empire; it starts that threat now against the player (journaled editorSpawnThreat).

import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Habitat } from '../../sim/types';
import { PlanetaryFacilityType } from '../../sim/researchSystem';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { finishableGreatWorks } from '../../sim/scenario/threats/giantworks/editorFinish';
import { ensureThreatTexts, spawnableThreats } from '../../sim/scenario/threats/framework';
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
    const win = openOriginalWindow({ id: 'gameEditor', title: 'Game Editor (WIP)', width: 560, height: 720, onClose: () => { open = null; } });
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
        // Spawn threat: starts the threat now (works even when its add-on was off at game start). "Against your empire" ones aim at
        // you; "Galactic threats" start galaxy-wide, placed near you where they have a choice.
        const threats = spawnableThreats(empire.galaxy as Galaxy);
        let y = 10;
        for (const [group, heading] of [['empire', 'Spawn a threat against your empire:'], ['galactic', 'Spawn a galactic threat:']] as const) {
            line(heading, y);
            y += 28;
            // A "<key>-finished" entry is not a row of its own: it is the "Finish" button left of its Great Work's "Spawn".
            const finishOf = (key: string) => threats.find((x) => x.key === `${key}-finished`);
            for (const t of threats.filter((x) => x.group === group && !x.key.endsWith('-finished'))) {
                line(t.label, y + 4);
                const fin = finishOf(t.key);
                if (fin !== undefined) {
                    const fb = glassButton('Finish', {
                        disabled: fin.note !== null,
                        onClick: () => {
                            ensureThreatTexts(fin.key);
                            issuePlayerCommand(empire.galaxy as Galaxy, empire, 'editorSpawnThreat', [fin.key], render);
                        },
                    });
                    if (fin.note !== null) fb.title = fin.note;
                    win.body.appendChild(place(fb, 315, y, 110, 22));
                }
                if (t.note !== null) {
                    const n = document.createElement('div');
                    n.textContent = t.note;
                    n.style.cssText = 'color: rgb(120,120,120); font-size: 13px; white-space: nowrap;';
                    win.body.appendChild(place(n, 330, y + 4));
                } else {
                    const b = glassButton('Spawn', {
                        onClick: () => {
                            ensureThreatTexts(t.key); // this thread's text table, for any message shown here (the sim merges its own)
                            issuePlayerCommand(empire.galaxy as Galaxy, empire, 'editorSpawnThreat', [t.key], render);
                        },
                    });
                    win.body.appendChild(place(b, 430, y, 110, 22));
                }
                y += 26;
            }
            y += 10;
        }
        // Finish a Great Work under construction now (its normal completion: for the Beacon, the countdown to the first beam).
        const works = finishableGreatWorks(empire.galaxy as Galaxy);
        if (works.length > 0) {
            line('Finish a Great Work under construction:', y);
            y += 28;
            for (const w of works) {
                line(w.label, y + 4);
                const b = glassButton('Finish', { onClick: () => issuePlayerCommand(empire.galaxy as Galaxy, empire, 'editorFinishGreatWork', [w.id], render) });
                win.body.appendChild(place(b, 430, y, 110, 22));
                y += 26;
            }
            y += 10;
        }
        const top = y;
        line(colonies.length === 0 ? 'No pirate bases on your colonies.' : 'Your colonies with pirate facilities:', top);
        colonies.forEach((h, i) => {
            const y = top + 30 + i * 32;
            line(`${h.name}: ${pirateFacilities(h).join(', ')}`, y + 5);
            const b = glassButton('Remove', { onClick: () => issuePlayerCommand(empire.galaxy as Galaxy, empire, 'editorRemovePirateFacilities', [h], render) });
            win.body.appendChild(place(b, 430, y, 110, 24));
        });
        if (colonies.length > 1) {
            const all = glassButton('Remove from all colonies', {
                onClick: () => { for (const h of colonies) issuePlayerCommand(empire.galaxy as Galaxy, empire, 'editorRemovePirateFacilities', [h], render); },
            });
            win.body.appendChild(place(all, 12, top + 30 + colonies.length * 32 + 10, 220, 26));
        }
    };
    render();
}
