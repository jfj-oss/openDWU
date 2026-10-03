// The game-start Introduction panel (pnlIntroduction, "Welcome to Your Empire"): a port of Main.Part12.cs:2921-3118
// method_81 (layout + texts), Main.Part12.cs:3120 method_82 + Main.Part5.cs:449 btnIntroductionStart_Click (Start
// Playing) and the start-up trigger at Main.Part12.cs:4248-4258 (a new game that is not a tutorial — Start.2.cs:73
// main_0.bool_8 unless bool_7 — pauses once the main view has drawn and shows the panel).
//
// The panel: the player's flag and race portrait, empire name, "You are ruler of …" details, the victory condition
// targets, the playstyle introduction over the playstyle picture, "What You Should Do" and the Start Playing button.
// lblIntroductionConclusion ("Press F1 for help …") is built but stays hidden (method_81 sets Visible = false and nothing
// shows it), so it is not drawn here either.
//
// Deviations: Empire.Description (only the Game Editor sets it, Main.Part5.cs:4558 — not ported) is always empty, so
// the playstyle text always comes from the game type. Shown for games from the New Game wizard (main.ts); the dev
// autostart shows it with ?intro=1.

import './introductionPanel.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import { determineEmpireSystems } from '../../sim/forceStructure';
import { resolveStarDateDescription } from '../../sim/galaxyTime';
import { governmentName } from '../../sim/player/diplomatBrief';
import { formatNet, getText } from '../../sim/textResolver';
import type { VictoryConditions } from '../../sim/victory';
import { applyEmpireEmblem } from '../empireEmblem';
import { chromeImageUrl, el, glassButton, gradientPanel, openOriginalWindow, place, text, type OriginalWindow } from '../originalWindow';
import { empireFlagUrl } from '../selectionInfoView';
import { piratePortraitUrl } from './diplomacyRelationsView';
import { piratePlayStyleDescription } from './empireSummaryModel';

// ---------------------------------------------------------------------------------------------------------------------
// Texts (pure)
// ---------------------------------------------------------------------------------------------------------------------

/** What method_81 reads from the Game and the player empire. */
export interface IntroductionInput {
    empireName: string;
    /** PlayerEmpire.DominantRace.Name. */
    raceName: string;
    /** PlayerEmpire.GovernmentAttributes.Name. */
    governmentName: string;
    /** PlayerEmpire.Colonies.Count. */
    colonies: number;
    /** PlayerEmpire.DetermineEmpireSystems(PlayerEmpire).Count. */
    systems: number;
    /** PlayerEmpire.PirateEmpireBaseHabitat != null. */
    pirateFaction: boolean;
    /** Galaxy.ResolveDescription(PlayerEmpire.PiratePlayStyle). */
    piratePlayStyle: string;
    /** PlayerEmpire.Description (Game Editor only; '' otherwise). */
    description: string;
    /** Game.PlayAsAPirate. */
    playAsAPirate: boolean;
    /** Game.AgeOfShadows. */
    ageOfShadows: boolean;
    /** Game.GlobalVictoryConditions (null: a TS game started without them; read as nothing enabled). */
    conditions: VictoryConditions | null;
    /** Galaxy.ResolveStarDateDescription. */
    starDate: (starDate: number) => string;
    /** TextResolver.GetText. */
    text: (tag: string) => string;
}

/** The picture files method_81 picks (Main.Part12.cs:711-714 bitmap_106-109, images/ui/chrome). */
export type PlaystylePicture = 'playstyle_pirateshadows.png' | 'playstyle_normalshadows.png' | 'playstyle_pirateclassic.png' | 'playstyle_normalclassic.png';

export interface IntroductionTexts {
    title: string;
    empireName: string;
    empireDetails: string;
    victoryConditions: string;
    playstyleIntro: string;
    /** lblIntroductionWhatToDoPointsTitle.Visible. */
    whatToDoTitleVisible: boolean;
    whatToDoTitle: string;
    whatToDoPoints: string;
    /** pnlIntroductionBackground.BackgroundImage (drawn at 10 % alpha, method_376(…, 0.1f)). */
    background: PlaystylePicture;
    /** lblIntroductionConclusion.Text (never visible, see the file header). */
    conclusion: string;
    startButton: string;
}

/** .NET ToString("#0") of a double: rounded half away from zero, no decimals. */
function format0(v: number): string {
    const r = Math.sign(v) * Math.round(Math.abs(v));
    return String(r === 0 ? 0 : r);
}

/** .NET ToString("0%"): the value × 100, rounded half away from zero, then "%". */
function percent0(v: number): string {
    return `${format0(v * 100)}%`;
}

/** Port of Main.Part12.cs:2921-3115 method_81's texts, statement order. */
export function introductionTexts(i: IntroductionInput): IntroductionTexts {
    const t = i.text;
    let playstyleIntro: string;
    let whatToDoTitleVisible: boolean;
    let whatToDoPoints: string;
    let background: PlaystylePicture;
    if (i.description !== '') {
        playstyleIntro = i.description;
        whatToDoTitleVisible = false;
        whatToDoPoints = '';
        background = i.pirateFaction ? 'playstyle_pirateclassic.png' : 'playstyle_normalclassic.png';
    } else {
        whatToDoTitleVisible = true;
        if (i.playAsAPirate) {
            if (i.ageOfShadows) {
                playstyleIntro = t('Game Type Intro Pirate Shadows');
                whatToDoPoints = t('Game WhatToDo Pirate Shadows');
                background = 'playstyle_pirateshadows.png';
            } else {
                playstyleIntro = t('Game Type Intro Pirate Classic');
                whatToDoPoints = t('Game WhatToDo Pirate Classic');
                background = 'playstyle_pirateclassic.png';
            }
        } else if (i.ageOfShadows) {
            playstyleIntro = t('Game Type Intro Normal Shadows');
            whatToDoPoints = t('Game WhatToDo Normal Shadows');
            background = 'playstyle_normalshadows.png';
        } else {
            playstyleIntro = t('Game Type Intro Normal Classic');
            whatToDoPoints = t('Game WhatToDo Normal Classic');
            background = 'playstyle_normalclassic.png';
        }
    }

    // text2: the race name made plural ("s" unless it already ends in one).
    let text2 = i.raceName;
    if (!text2.toLowerCase().endsWith('s')) text2 += 's';
    const empireDetails = !i.pirateFaction
        ? formatNet(t('You are ruler of'), [text2, i.governmentName, String(i.colonies), String(i.systems)])
        : formatNet(t('You are ruler of PIRATE'), [text2, i.piratePlayStyle]);

    // The victory condition targets. Null conditions: nothing enabled, threshold 100 % (the VictoryConditions default).
    const c = i.conditions;
    let victory = formatNet(t('Game Intro Victory'), [percent0(c?.victoryThresholdPercentage ?? 1.0)]);
    let text3 = '';
    if (c !== null) {
        if (c.enableRaceSpecificVictoryConditions) {
            if (!i.pirateFaction) text3 += ' - ' + formatNet(t('Game Intro Victory Race'), [i.raceName]) + '\n';
            else text3 += ' - ' + formatNet(t('Game Intro Victory Pirate'), [i.piratePlayStyle]) + '\n';
        }
        if (c.economy) text3 += ' - ' + formatNet(t('Game Intro Victory Economy'), [format0(c.economyPercent)]) + '\n';
        if (c.population) text3 += ' - ' + formatNet(t('Game Intro Victory Population'), [format0(c.populationPercent)]) + '\n';
        if (c.territory) text3 += ' - ' + formatNet(t('Game Intro Victory Territory'), [format0(c.territoryPercent)]) + '\n';
        if (c.timeLimit) {
            text3 += formatNet(t('Game Intro Victory Time Limit'), [i.starDate(c.timeLimitDate)]) + '\n';
            text3 += '    (' + t('Winner is the empire with the greatest strategic value at this time') + ')\n';
        }
        if (c.startDate > 0) text3 += formatNet(t('To win - Start Date'), [i.starDate(c.startDate)]) + '\n';
    }
    if (text3 === '') text3 = t('SANDBOX MODE');
    victory = victory + '\n' + text3;

    return {
        title: t('Welcome to Your Empire'),
        empireName: i.empireName,
        empireDetails,
        victoryConditions: victory,
        playstyleIntro,
        whatToDoTitleVisible,
        whatToDoTitle: t('What You Should Do') + ':',
        whatToDoPoints,
        background,
        conclusion: t('Introduction Conclusion'),
        startButton: t('Start Playing'),
    };
}

/** The IntroductionInput of a live game (main thread; in worker mode the replica galaxy). */
export function introductionInputFor(galaxy: Galaxy, player: Empire, game: { playAsAPirate: boolean; ageOfShadows: boolean }): IntroductionInput {
    return {
        empireName: player.name,
        raceName: player.dominantRace?.name ?? '',
        governmentName: governmentName(player),
        colonies: player.colonies.length,
        systems: determineEmpireSystems(galaxy, player).length,
        pirateFaction: player.pirateEmpireBaseHabitat !== null,
        piratePlayStyle: piratePlayStyleDescription(player.piratePlayStyle),
        description: '', // TODO(port): Empire.Description — set only by the Game Editor (Main.Part5.cs:4558)
        playAsAPirate: game.playAsAPirate,
        ageOfShadows: game.ageOfShadows,
        conditions: galaxy.globalVictoryConditions,
        starDate: (d) => resolveStarDateDescription(d),
        text: getText,
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------------------

/** GenerateFont sizes (Main.Part12.cs:1521-1534): font_1, font_2, font_6, font_7, and the Start button's 22.67 bold. */
const F1 = 22.67;
const F2 = 18.67;
const F6 = 16.67;
const F7 = 16.67;

/** pnlIntroduction.Size (method_81). */
const PANEL_W = 800;
const PANEL_H = 665;
/** The BorderPanel's 3 px border: a headerless window's body starts inside it (originalWindow.ts). */
const BORDER = 3;

export interface IntroductionPanelOptions {
    galaxy: Galaxy;
    player: Empire;
    playAsAPirate: boolean;
    ageOfShadows: boolean;
    /** The game clock: method_81's caller pauses a running game, Start Playing resumes it (method_82 → method_155). */
    clock: { paused: boolean };
    /** After Start Playing (WuVtIlwpRt: focus back to the main view). */
    onStart?: () => void;
}

let open: OriginalWindow | null = null;

/** pnlIntroduction.Visible. */
export function isIntroductionPanelOpen(): boolean {
    return open !== null && !open.closed;
}

/** Close the panel without starting (e.g. leaving the game). */
export function closeIntroductionPanel(): void {
    open?.close();
    open = null;
}

/** Main.Part12.cs:4248-4258 + method_81: pause and show the Introduction panel. */
export function openIntroductionPanel(o: IntroductionPanelOptions): OriginalWindow {
    closeIntroductionPanel();
    // 4250-4254: if (TimeState == Running) method_154 (pause).
    if (!o.clock.paused) o.clock.paused = true;
    const tx = introductionTexts(introductionInputFor(o.galaxy, o.player, o));
    const win = openOriginalWindow({
        id: 'introduction',
        title: '',
        width: PANEL_W,
        height: PANEL_H,
        headerless: true,
        escapeCloses: false,
        noAutoPause: true,
        onClose: () => {
            if (open === win) open = null;
        },
    });
    open = win;
    const body = win.body;
    body.classList.add('intro-body');
    // Children of pnlIntroduction are placed in its client area; the body starts inside the border.
    const at = <T extends HTMLElement>(e: T, x: number, y: number, w?: number, h?: number): T => place(e, x - BORDER, y - BORDER, w, h);

    // lblIntroductionTitle: font_1, white, centred at y 10 ((Width - MeasureString) / 2).
    const title = text(tx.title, { size: F1, bold: true, color: 'rgb(255, 255, 255)', shadow: false, className: 'intro-title' });
    body.appendChild(at(title, 0, 10, PANEL_W));

    // pnlIntroductionBackground (10, 45) 780 × 565: GradientPanel (39, 40, 44) / (22, 21, 26) / (51, 54, 61), border
    // (67, 67, 77) width 2, Curvature 20 on all corners; BackgroundImage = the playstyle picture at 10 % alpha, stretched.
    const bg = gradientPanel({ corners: { tl: true, tr: true, br: true, bl: true }, radius: 20, className: 'intro-background' });
    body.appendChild(at(bg, 10, 45, 780, 565));
    const pic = el('img', 'intro-background-image');
    pic.src = chromeImageUrl(tx.background);
    pic.alt = '';
    pic.draggable = false;
    pic.addEventListener('error', () => (pic.style.visibility = 'hidden'));
    bg.appendChild(pic);

    // picIntroductionRace (40, 15) 280 × 200: the large flag at (0, 65) 150 × 90 under the dominant race image at
    // (80, 0) 200 × 200 (RaceImageCache.GetEmpireDominantRaceImage: a pirate faction's playstyle portrait).
    const race = place(el('div', 'intro-race'), 40, 15, 280, 200);
    const flag = el('img', 'intro-flag');
    flag.alt = '';
    flag.draggable = false;
    void empireFlagUrl(o.galaxy, o.player).then((url) => (flag.src = url));
    race.appendChild(place(flag, 0, 65, 150, 90));
    const portrait = el('img', 'intro-portrait');
    portrait.alt = '';
    portrait.draggable = false;
    portrait.addEventListener('error', () => (portrait.style.visibility = 'hidden'));
    if (o.player.pirateEmpireBaseHabitat !== null) portrait.src = piratePortraitUrl(o.player.piratePlayStyle);
    else applyEmpireEmblem(portrait, o.galaxy, o.player, 'portrait');
    race.appendChild(place(portrait, 80, 0, 200, 200));
    bg.appendChild(race);

    // lblIntroductionEmpireName (350, 20) font_2; lblIntroductionEmpireDetails (355, 42) font_6; both white.
    bg.appendChild(place(text(tx.empireName, { size: F2, bold: true, color: 'rgb(255, 255, 255)', shadow: false, className: 'intro-label' }), 350, 20));
    bg.appendChild(place(text(tx.empireDetails, { size: F6, color: 'rgb(255, 255, 255)', shadow: false, wrapWidth: 410, className: 'intro-label' }), 355, 42));
    // lblIntroductionVictoryConditions (350, 100), MaximumSize 420 × 115, font_6, (160, 160, 255).
    const victory = text(tx.victoryConditions, { size: F6, color: 'rgb(160, 160, 255)', shadow: false, wrapWidth: 420, className: 'intro-label intro-victory' });
    bg.appendChild(place(victory, 350, 100));

    // picIntroductionPlaystyle (130, 225) 520 × 210; lblIntroductionPlaystyleIntro font_7, white, MiddleCenter,
    // MaximumSize 520 × 210, vertically centred in the picture ((Height - label height) / 2).
    const playstyle = place(el('div', 'intro-playstyle'), 130, 225, 520, 210);
    playstyle.appendChild(text(tx.playstyleIntro, { size: F7, bold: true, color: 'rgb(255, 255, 255)', shadow: false, wrapWidth: 520, className: 'intro-label intro-playstyle-text' }));
    bg.appendChild(playstyle);

    // lblIntroductionWhatToDoPointsTitle (10, 415) font_7; lblIntroductionWhatToDoPoints (20, 435) 740 × 100 font_6.
    if (tx.whatToDoTitleVisible) bg.appendChild(place(text(tx.whatToDoTitle, { size: F7, bold: true, color: 'rgb(255, 255, 255)', shadow: false, className: 'intro-label' }), 10, 415));
    const points = text(tx.whatToDoPoints, { size: F6, color: 'rgb(255, 255, 255)', shadow: false, wrapWidth: 740, className: 'intro-label intro-points' });
    bg.appendChild(place(points, 20, 435, 740, 100));

    // btnIntroductionStart (280, 620) 240 × 35, 22.67 px bold: "Start Playing".
    const start = glassButton(tx.startButton, {
        size: F1,
        className: 'intro-start',
        onClick: () => {
            // Main.Part5.cs:449 btnIntroductionStart_Click → method_82: resume (method_155), hide the panel.
            o.clock.paused = false;
            win.close();
            o.onStart?.();
        },
    });
    body.appendChild(at(start, 280, 620, 240, 35));
    start.focus();
    return win;
}
