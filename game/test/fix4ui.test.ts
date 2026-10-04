// fix4ui: pure logic behind the UI fixes from the 2026-09-25 playtest.
import { describe, expect, it } from 'vitest';
import { topBarLayout, topBarScale } from '../src/ui/topBar';
import { findBinding } from '../src/ui/keyboard';
import { empireNamePlaceholder, flagShapeTileUrls, playableRacesSorted, STOCK_FLAG_SHAPE_COUNT, wizardRaceFiles } from '../src/ui/screens/newGameWizard';
import { DEFAULT_RACE_FILES } from '../src/sim/data/gameData';
import type { Race } from '../src/sim/data/races';
import {
    controlHint,
    CONTROL_HINTS,
    cycleEmptyText,
    cycleIdleShips,
    hudTransformOrigin,
    nextIdleBuiltObject,
    playPauseHint,
    selectionPanelMaxHeight,
    unavailableControlText,
    type IdleCycleEmpire,
} from '../src/ui/hud';
import { computeHudLayout, TOP_BAR_BUTTONS } from '../src/ui/hudLayout';
import type { BuiltObject } from '../src/sim/builtObject';
import type { ShipGroup } from '../src/sim/fleets/shipGroup';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { countLabel } from '../src/ui/plural';
import { formatComparisonValue } from '../src/ui/screens/empireComparison';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import type { Empire } from '../src/sim/empire';
import { savedHistoryLines } from '../src/ui/empireMessageFeed';
import { receivePlayerMessage } from '../src/sim/playerMessages';
import { defaultMessageOptions } from '../src/sim/messageRouting';
import { startStarDateForAge } from '../src/sim/galaxyTime';
import type { Galaxy } from '../src/sim/galaxy';

/** The ticker half of the player's message pipeline (sim/playerMessages.ts) at star date `starDate`. */
function recordTickerMessage(player: Empire, m: EmpireMessage, starDate: number): void {
    const galaxy = { age: 1, nowMs: starDate - startStarDateForAge(1), empires: [] } as unknown as Galaxy;
    receivePlayerMessage(galaxy, player, m, defaultMessageOptions());
}

describe('#5 Space toggles pause (Main.Part7.cs Main_KeyUp)', () => {
    it("maps KeyboardEvent.key ' ' to the Space binding", () => {
        expect(findBinding(' ', { ctrl: false, alt: false, shift: false })?.action).toBe('togglePause');
        expect(findBinding('Pause', { ctrl: false, alt: false, shift: false })?.action).toBe('togglePause');
    });
});

describe('#2 wizard race list (Start.cs 1318-1328)', () => {
    it('uses the races/ folder listing, else the stock 22 files', () => {
        expect(wizardRaceFiles(['a.txt', 'b.TXT', 'readme.md', 3])).toEqual(['a.txt', 'b.TXT']);
        expect(wizardRaceFiles(undefined)).toEqual([...DEFAULT_RACE_FILES]);
        expect(wizardRaceFiles([])).toEqual([...DEFAULT_RACE_FILES]);
        expect(DEFAULT_RACE_FILES).toHaveLength(22);
    });
    it('keeps playable races only, sorted by name (ResolvePlayableRaces + Sort)', () => {
        const r = (name: string, playable: boolean) => ({ name, playable }) as Race;
        expect(playableRacesSorted([r('Zenox', true), r('Shakturi', false), r('Ackdarian', true)]).map((x) => x.name))
            .toEqual(['Ackdarian', 'Zenox']);
    });
});

describe('#3 default empire name (Main.Part9.cs 2686 YourEmpireName = "")', () => {
    it('leaves the name to Empire.GenerateEmpireName and says so', () => {
        expect(empireNamePlaceholder('Dhayut')).toContain('Dhayut Empire');
        expect(empireNamePlaceholder('')).toBe('Generated at start');
    });
});

describe('#4 flag shapes (Galaxy.4.cs LoadFlagShapes)', () => {
    it('one tile per *.png of images/ui/flagshapes, in listing order', () => {
        expect(flagShapeTileUrls(['flag00.png', 'flag01.png', 'flag0.wmf'])).toEqual([
            '/assets/dwu/images/ui/flagshapes/flag00.png',
            '/assets/dwu/images/ui/flagshapes/flag01.png',
        ]);
    });
    it('falls back to the stock 41 shapes flag00..flag40', () => {
        const urls = flagShapeTileUrls(undefined);
        expect(STOCK_FLAG_SHAPE_COUNT).toBe(41);
        expect(urls).toHaveLength(41);
        expect(urls[0]).toMatch(/flag00\.png$/);
        expect(urls[40]).toMatch(/flag40\.png$/);
    });
});

describe('#11 control hints (Main.Part10.cs method_206)', () => {
    it('every top-bar control has a human hint, never its control name', () => {
        for (const name of TOP_BAR_BUTTONS) {
            const hint = controlHint(name);
            expect(hint, name).not.toBe('');
            expect(hint).not.toContain(name);
        }
        expect(CONTROL_HINTS.tbtnColonies).toBe('Open Colonies screen (F2)');
        expect(playPauseHint(false)).toBe('Pause the game (Pause or Spacebar)');
        expect(playPauseHint(true)).toBe('Resume the game');
    });
    it('toasts name the screen, not the control', () => {
        expect(unavailableControlText('btnEmpirePolicy')).toBe('Empire Policy screen — not yet available');
        expect(unavailableControlText('btnGameEditor')).toBe('Game Editor — not yet available');
        expect(unavailableControlText('tbtnTroops')).toBe('Troops screen — not yet available');
        expect(unavailableControlText('btnNoSuchThing')).toBe('This screen — not yet available');
    });
});

describe('#13 idle ship cycler (Main.Part7.cs btnCycleIdleShips_Click / method_349 / method_350)', () => {
    const bo = (name: string, over: Partial<Record<string, unknown>> = {}): BuiltObject =>
        ({ name, shipGroup: null, mission: null, role: BuiltObjectRole.Military, builtAt: null, isAutoControlled: false, ...over }) as unknown as BuiltObject;
    const sg = (name: string, mission: unknown = null): ShipGroup => ({ name, mission }) as unknown as ShipGroup;

    it('an idle ship: no fleet, no mission, not a base, built, not automated', () => {
        const idle = bo('idle');
        const list = [
            bo('fleeted', { shipGroup: {} }),
            bo('busy', { mission: { type: BuiltObjectMissionType.Explore } }),
            bo('base', { role: BuiltObjectRole.Base }),
            bo('building', { builtAt: {} }),
            bo('auto', { isAutoControlled: true }),
            null,
            idle,
        ];
        expect(nextIdleBuiltObject({ builtObjects: list, shipGroups: [] }, -1, 1)).toBe(idle);
        expect(nextIdleBuiltObject({ builtObjects: list.slice(0, 5), shipGroups: [] }, -1, 1)).toBeNull();
        // Undefined mission type counts as idle.
        const undef = bo('undef', { mission: { type: BuiltObjectMissionType.Undefined } });
        expect(nextIdleBuiltObject({ builtObjects: [undef], shipGroups: [] }, -1, 1)).toBe(undef);
    });

    it('cycles ships, then idle fleets, then wraps; Shift goes fleets-first backwards', () => {
        const a = bo('a');
        const b = bo('b');
        const g1 = sg('g1');
        const gBusy = sg('busy', { type: BuiltObjectMissionType.Attack });
        const empire: IdleCycleEmpire = { builtObjects: [a, bo('x', { isAutoControlled: true }), b], shipGroups: [gBusy, g1] };
        let st = cycleIdleShips(empire, { builtObject: null, shipGroup: null }, 1);
        expect(st.builtObject).toBe(a);
        st = cycleIdleShips(empire, st, 1);
        expect(st.builtObject).toBe(b);
        st = cycleIdleShips(empire, st, 1);
        expect(st.shipGroup).toBe(g1);
        st = cycleIdleShips(empire, st, 1);
        expect(st.builtObject).toBe(a);
        // Backwards from nothing: fleets first (Main.Part4.cs btnCycleIdleShipsBack_Click).
        st = cycleIdleShips(empire, { builtObject: null, shipGroup: null }, -1);
        expect(st.shipGroup).toBe(g1);
        st = cycleIdleShips(empire, st, -1);
        expect(st.builtObject).toBe(b);
    });

    it('nothing idle → empty state and a toast text, no empire message', () => {
        const st = cycleIdleShips({ builtObjects: [bo('auto', { isAutoControlled: true })], shipGroups: [] }, { builtObject: null, shipGroup: null }, 1);
        expect(st).toEqual({ builtObject: null, shipGroup: null });
        expect(cycleEmptyText('idleShips')).toBe('No idle ships to cycle');
    });
});

describe('#17 UI scale: the top strip scales as one', () => {
    it('every top element is its original rect times one factor', () => {
        const k = topBarScale(1920, 1080, 1.25);
        const virt = topBarLayout(1920 / k);
        const layout = computeHudLayout(1920, 1080, 1.25);
        for (const name of ['lstMessages', ...TOP_BAR_BUTTONS]) {
            expect(layout[name].x, name).toBeCloseTo(virt[name].x * k);
            expect(layout[name].y, name).toBeCloseTo(virt[name].y * k);
            expect(hudTransformOrigin(name, layout[name], 1920)).toBe('0 0');
        }
    });
});

describe('#10 selection panel height cap', () => {
    it('keeps the scaled panel below the top-left bar', () => {
        expect(selectionPanelMaxHeight(1080, 10, 1)).toBe(1000);
        expect(selectionPanelMaxHeight(1080, 10, 1.25)).toBe(800);
        expect(selectionPanelMaxHeight(1080, 10, 1.25) * 1.25 + 10).toBeLessThanOrEqual(1080 - 70);
        expect(selectionPanelMaxHeight(100, 10, 1)).toBe(120);
    });
});

describe('#19 plurals', () => {
    it('singular for exactly one', () => {
        expect(countLabel(1, 'moon')).toBe('1 moon');
        expect(countLabel(0, 'moon')).toBe('0 moons');
        expect(countLabel(2, 'colony', 'colonies')).toBe('2 colonies');
        expect(formatComparisonValue('territory', 1)).toBe('1 colony');
        expect(formatComparisonValue('territory', 7)).toBe('7 colonies');
    });
});

describe('#15 message history after load (Main.Part9.cs ReceiveMessageInternal, Empire.MessageHistory)', () => {
    const msg = (type: EmpireMessageType, text: string, starDate = 0): EmpireMessage => {
        const m = new EmpireMessage(null, type, null);
        m.description = text;
        m.starDate = starDate;
        return m;
    };

    it('stamps the date and adds non-Informational messages once', () => {
        const history: EmpireMessage[] = [];
        const player = { name: 'Us', messages: [], messageHistory: history } as unknown as Empire;
        const built = msg(EmpireMessageType.ShipBaseCompleted, 'Frigate built');
        recordTickerMessage(player, built, 1234);
        recordTickerMessage(player, built, 1234);
        recordTickerMessage(player, msg(EmpireMessageType.Informational, 'fyi'), 1235);
        expect(built.starDate).toBe(1234);
        expect(history).toEqual([built]);
    });

    it('records through the sim addHistoryMessage (Empire.cs 4697): no duplicates, Informational skipped', () => {
        const player = { name: 'Us', messages: [], messageHistory: [] } as unknown as Empire;
        const m = msg(EmpireMessageType.NewColony, 'Colony founded');
        recordTickerMessage(player, m, 5);
        recordTickerMessage(player, m, 6);
        recordTickerMessage(player, msg(EmpireMessageType.Informational, 'info'), 7);
        expect((player as unknown as { messageHistory: EmpireMessage[] }).messageHistory).toEqual([m]);
        expect(m.starDate).toBe(6);
    });

    it('rebuilds ticker lines from the saved history, oldest first', () => {
        const player = {
            name: 'Us',
            messages: [],
            messageHistory: [msg(EmpireMessageType.NewColony, 'second', 20), msg(EmpireMessageType.ShipBaseCompleted, 'first', 10)],
        } as unknown as Empire;
        expect(savedHistoryLines(player)).toEqual([
            { text: 'first', starDate: 10 },
            { text: 'second', starDate: 20 },
        ]);
        expect(savedHistoryLines({ name: 'Old save', messages: [] } as unknown as Empire)).toEqual([]);
    });
});
