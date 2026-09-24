// Port of DistantWorlds.Types.Tutorial / TutorialItem (the tutorial step
// model) and Main.Part5.cs method_454 (tutorial file loading). Pure parsing
// — no fs/DOM; the browser fetches the file text via fetchData.ts.

import { fetchText } from './fetchData';

/** Port of DistantWorlds.Types.TutorialItem. The object-typed fields
 *  (HighlightObject, ZoomScrollObject, SelectionObject, ListSelection) and
 *  the bool flags are set by the original's tutorial-startup code after
 *  loading (it wires them to live game objects); the .txt files only carry
 *  Name/Title/Text, so those stay null/false here.
 *  TODO(tutorial): wire the Highlight / Zoom / OpenScreen / ScreenTabName
 *  fields to the recreation's HUD/camera once those panels exist —
 *  Main.Part5.cs method_455. */
export interface TutorialItem {
    name: string;
    title: string;
    /** Body lines joined with "\n" (method_454 appends `text + "\n"` per line). */
    text: string;
    highlightObject: unknown | null;
    highlightHabitatEmpire: boolean;
    highlightHabitatPopulationGraph: boolean;
    highlightHabitatDominantRace: boolean;
    highlightHabitatResources: boolean;
    highlightOpenEmpireNavigationToolPanel: boolean;
    zoomScrollObject: unknown | null;
    zoomLevel: number;
    selectionObject: unknown | null;
    openScreen: unknown | null;
    screenTabName: string;
    listSelection: unknown | null;
    /** C# public field (not set from the file). */
    highlightActionButtonNumber: number;
    /** C# public field (not set from the file). */
    unpauseGame: boolean;
    /** C# public field (not set from the file). */
    highlightEmpireNavigationToolPanelTitle: string;
}

function newTutorialItem(): TutorialItem {
    return {
        name: '',
        title: '',
        text: '',
        highlightObject: null,
        highlightHabitatEmpire: false,
        highlightHabitatPopulationGraph: false,
        highlightHabitatDominantRace: false,
        highlightHabitatResources: false,
        highlightOpenEmpireNavigationToolPanel: false,
        zoomScrollObject: null,
        zoomLevel: 0,
        selectionObject: null,
        openScreen: null,
        screenTabName: '',
        listSelection: null,
        highlightActionButtonNumber: 0,
        unpauseGame: false,
        highlightEmpireNavigationToolPanelTitle: '',
    };
}

/** Port of DistantWorlds.Types.Tutorial (Name/Index/Items + the step
 *  navigation properties/methods). */
export class Tutorial {
    name = '';
    index = 0;
    items: TutorialItem[] = [];

    get lastStep(): boolean {
        // Index == Count - 1
        return this.index === this.items.length - 1;
    }

    get finished(): boolean {
        // Index >= Count
        return this.index >= this.items.length;
    }

    get previousStep(): TutorialItem | null {
        // Count > 1 && 0 <= Index <= Count -> items[Index]
        if (this.items.length > 1 && this.index >= 0 && this.index <= this.items.length) {
            return this.items[this.index];
        }
        return null;
    }

    get currentStep(): TutorialItem | null {
        // Index < Count -> items[Index]
        if (this.index < this.items.length) {
            return this.items[this.index];
        }
        return null;
    }

    clearData(): void {
        this.items.length = 0;
    }

    next(): void {
        this.index++;
    }
}

/** Port of Main.Part5.cs method_454: parse a tutorial file's text into its
 *  step list. Steps are separated by a line whose trimmed content is `~`;
 *  each step starts with a Name line, then a Title line (skipped at EOF),
 *  then body lines appended as `text + "\n"`. Non-ApplicationException
 *  errors are wrapped as "Error at line N reading file X". */
export function parseTutorialItems(name: string, text: string): TutorialItem[] {
    const items: TutorialItem[] = [];
    let lineNo = 0;
    try {
        const lines = text.split(/\r\n|\r|\n/);
        let item: TutorialItem | null = null;
        let newStep = true;
        while (lineNo < lines.length) {
            // num++; string text = streamReader.ReadLine();
            lineNo++;
            const rawLine = lines[lineNo - 1];
            if (newStep) {
                if (item !== null) {
                    items.push(item);
                }
                item = newTutorialItem();
                item.name = rawLine.trim();
                // StreamReader.EndOfStream check before reading the Title line.
                if (lineNo < lines.length) {
                    lineNo++;
                    item.title = lines[lineNo - 1].trim();
                }
                newStep = false;
            } else if (rawLine.trim() === '~') {
                newStep = true;
            } else {
                item!.text = item!.text + rawLine + '\n';
            }
        }
        if (item !== null) {
            items.push(item);
        }
        return items;
    } catch (err) {
        throw new Error(`Error at line ${lineNo} reading file ${name}`);
    }
}

/** Fetch and parse one tutorial file. Mirrors method_454's path fallbacks
 *  (<name>, DE_<name>, FR_<name>, ES_<name>) through fetchText's candidate
 *  URLs; a missing file throws "Missing file: <name>". */
export async function loadTutorialFile(name: string): Promise<TutorialItem[]> {
    const candidates = ['', 'DE_', 'FR_', 'ES_'].map((prefix) => `/assets/dwu/Tutorial/${prefix}${name}`);
    let text: string;
    try {
        text = await fetchText(candidates);
    } catch {
        throw new Error(`Missing file: ${name}`);
    }
    return parseTutorialItems(name, text);
}

/** One entry of the main menu's Tutorials list. `file` is the tutorial
 *  file name under $DWU/Tutorial/ (e.g. "basic.txt"). Display names/order
 *  follow the original's tutorial menu (Start.1.cs pnlTutorials); the row's
 *  description line is filled in from the file's step titles at runtime via
 *  tutorialSummary. */
export interface TutorialEntry {
    file: string;
    displayName: string;
}

export const TUTORIALS: TutorialEntry[] = [
    { file: 'basic.txt', displayName: 'Basic' },
    { file: 'advanced.txt', displayName: 'Advanced' },
    { file: 'ShipsAndMissions.txt', displayName: 'Ships and Missions' },
    { file: 'ResearchDesign.txt', displayName: 'Research and Design' },
    { file: 'FleetsTroops.txt', displayName: 'Fleets and Troops' },
    { file: 'FindingYourWayAround.txt', displayName: 'Finding Your Way Around' },
    { file: 'DealingWithPirates.txt', displayName: 'Dealing With Pirates' },
    { file: 'PlayAsPirate.txt', displayName: 'Play As Pirate' },
    { file: 'PreWarpEmpire.txt', displayName: 'Pre-Warp Empire' },
    { file: 'EmpireAndColonies.txt', displayName: 'Empire and Colonies' },
    { file: 'ExpansionDiplomacy.txt', displayName: 'Expansion and Diplomacy' },
];

/** Build a one-line summary of a tutorial file from its steps: the distinct
 *  step titles in order (empty titles and exact repeats skipped), joined
 *  with " · ". Cut at the last whole title that fits in maxLength; when
 *  titles were dropped, append " · …". */
export function tutorialSummary(items: TutorialItem[], maxLength = 140): string {
    const titles: string[] = [];
    for (const item of items) {
        const t = item.title;
        if (t === '' || titles.includes(t)) continue;
        titles.push(t);
    }
    const parts: string[] = [];
    let len = 0;
    for (let i = 0; i < titles.length; i++) {
        const partLen = (i > 0 ? ' · '.length : 0) + titles[i].length;
        if (len + partLen > maxLength) break;
        parts.push(titles[i]);
        len += partLen;
    }
    if (parts.length < titles.length) {
        return `${parts.join(' · ')} · …`;
    }
    return parts.join(' · ');
}