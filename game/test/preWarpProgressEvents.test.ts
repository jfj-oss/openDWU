// The pre-warp progress events (Empire.7.cs 3426 CheckSendPreWarpProgressEventMessage, PreWarpProgressEventType.cs) and
// how they reach the player (Main.Part4.cs:487 method_523 → pnlEventMessage):
// - a pre-warp Shadows start leaves every flag open for the player (Galaxy.7.cs 5187-5202, Start.2.cs 1127-1142); a
//   started-era game or a pre-warp game without Shadows closes them, so nothing is sent;
// - each milestone, through its sim call site where one is practical (research breakthrough, first contact, the
//   pirate-raid review), sends exactly one GeneralDiscovery event with the GameText title and text, once only;
// - the UI presents each as the original does: the event panel with the event's picture, Close / Go to Event Location,
//   pausing (method_508), gated by the Game Options discovery settings (flag7); and the history records it;
// - in worker mode (?simWorker=1) the event and its subject (a new scientist, a component, a ship) reach the main
//   thread's recipient as replica objects.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { createGame, type CreateGameOptions, type Game } from '../src/sim/game';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { BuiltObject } from '../src/sim/builtObject';
import { Habitat } from '../src/sim/types';
import { Character } from '../src/sim/characters';
import { Creature, CreatureType } from '../src/sim/creature';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { DisasterEventType, EventMessageType } from '../src/sim/eventTypes';
import { EmpireActivity } from '../src/sim/pirates/empireActivity';
import { obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { flushPlayerCommands, pendingPlayerCommands } from '../src/sim/player/playerCommands';
import { commandLog } from '../src/sim/player/commandLog';
import { EmpireMessageType, empireMessageHistory, type EmpireMessage } from '../src/sim/messages';
import { ComponentType } from '../src/sim/data/components';
import { PreWarpProgressEventType, doEmpireEncounter, generateBuiltObjectFromDesign } from '../src/sim/exploration';
import { checkReviewSpecialPirateEvents, checkSendPreWarpProgressEventMessage, preWarpProgressEventOccurred } from '../src/sim/empireEvents';
import { doResearchBreakthrough } from '../src/sim/researchTick';
import { resolveGameText } from '../src/sim/textResolver';
import { defaultMessageOptions } from '../src/ui/messageRouting';
import { recordEventMessage, type QueuedEvent } from '../src/ui/messagePipeline';
import { EVENT_CHROME, eventGoToTarget, eventMessagePresentation, eventPopupShown } from '../src/ui/eventMessagePresentation';
import { presentEventMessage, type EventPanelSink } from '../src/ui/eventMessages';
import type { EventPopup, StoryEventPopup } from '../src/ui/messagePopups';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { ToWorker, WorkerEvent } from '../src/simworker/protocol';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { installWorkerMessageUi } from '../src/ui/workerMessages';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 180000);

/** The harness game started pre-warp (galaxy age 0, every empire at tech level 0). */
function preWarpOptions(gd: GameData, shadows: boolean): CreateGameOptions {
    const o = tickGameOptions(gd);
    const pre = (e: typeof o.player) => ({ ...e, age: 0, techLevel: 0 });
    return { ...o, galaxyAge: 0, player: pre(o.player), aiEmpires: o.aiEmpires.map(pre), storyShadowsEnabled: shadows };
}

const ALL_TYPES = [
    PreWarpProgressEventType.FirstContactPirateOrIndependent,
    PreWarpProgressEventType.FirstContactNormalEmpire,
    PreWarpProgressEventType.BuildFirstShip,
    PreWarpProgressEventType.BuildFirstSpaceport,
    PreWarpProgressEventType.BuildFirstMiningStation,
    PreWarpProgressEventType.BuildFirstResearchStation,
    PreWarpProgressEventType.DiscoverHyperspaceTech,
    PreWarpProgressEventType.DiscoverColonizationTech,
    PreWarpProgressEventType.FirstHyperjump,
    PreWarpProgressEventType.EncounterFirstKaltor,
    PreWarpProgressEventType.BuildFirstMilitaryShip,
    PreWarpProgressEventType.FirstPirateRaid,
];

/** Records what Empire.SendEventMessageToEmpire hands the player's IEventMessageRecipient. */
function recordEvents(player: Empire): QueuedEvent[] {
    const events: QueuedEvent[] = [];
    player.eventMessageRecipient = {
        receiveEventMessage(type: number, title: string, message: string, additionalData: unknown, location: unknown) {
            events.push({ type, title, message, additionalData, location });
        },
    };
    return events;
}

function ship(galaxy: Galaxy, empire: Empire, subRole: BuiltObjectSubRole, name: string): BuiltObject {
    const design = empire.designs.find((d) => d.subRole === subRole);
    if (design === undefined) throw new Error(`no ${BuiltObjectSubRole[subRole]} design`);
    const capital = empire.capital!;
    return generateBuiltObjectFromDesign(galaxy, empire, design, name, true, capital.xpos + 500, capital.ypos + 500);
}

/** The one event `fn` sends (and nothing more), resolved to the text the player reads. */
function oneEvent(events: QueuedEvent[], fn: () => void): QueuedEvent & { titleText: string; text: string } {
    const before = events.length;
    fn();
    expect(events.length - before, 'exactly one event').toBe(1);
    const e = events[events.length - 1];
    expect(e.type).toBe(EventMessageType.GeneralDiscovery);
    return { ...e, titleText: resolveGameText(e.title), text: resolveGameText(e.message) };
}

function noEvent(events: QueuedEvent[], fn: () => void): void {
    const before = events.length;
    fn();
    expect(events.length - before, 'no event the second time').toBe(0);
}

describe('pre-warp progress events: the start flags (Galaxy.7.cs 5187, Start.2.cs 1127)', () => {
    it('a pre-warp Shadows start leaves every event open for the player; other starts close them all', () => {
        const g = createGame(preWarpOptions(gameData, true)).galaxy;
        const player = g.playerEmpire!;
        for (const t of ALL_TYPES) expect(preWarpProgressEventOccurred(player, t), PreWarpProgressEventType[t]).toBe(false);

        // GenerateEmpire: `techLevel > 0 || !EnableStoryEventsShadows` sets all 13.
        const noShadows = createGame(preWarpOptions(gameData, false)).galaxy;
        const p2 = noShadows.playerEmpire!;
        const ev2 = recordEvents(p2);
        for (const t of ALL_TYPES) expect(preWarpProgressEventOccurred(p2, t)).toBe(true);
        const s2 = ship(noShadows, p2, BuiltObjectSubRole.ExplorationShip, 'Explorer');
        expect(checkSendPreWarpProgressEventMessage(noShadows, p2, PreWarpProgressEventType.BuildFirstShip, s2)).toBe(false);

        const started = createGame({ ...tickGameOptions(gameData), storyShadowsEnabled: true }).galaxy;
        const p3 = started.playerEmpire!;
        const ev3 = recordEvents(p3);
        for (const t of ALL_TYPES) expect(preWarpProgressEventOccurred(p3, t)).toBe(true);
        expect(checkSendPreWarpProgressEventMessage(started, p3, PreWarpProgressEventType.BuildFirstShip, p3.builtObjects[0] ?? s2)).toBe(false);
        expect([...ev2, ...ev3]).toEqual([]);
    }, 300000);
});

describe('pre-warp progress events: each milestone, once (Empire.7.cs 3426)', () => {
    let game: Game;
    let g: Galaxy;
    let player: Empire;
    let events: QueuedEvent[];
    const shown: QueuedEvent[] = [];

    beforeAll(() => {
        game = createGame(preWarpOptions(gameData, true));
        g = game.galaxy;
        player = g.playerEmpire!;
        events = recordEvents(player);
    });

    function check(type: PreWarpProgressEventType, subject: unknown, other: Empire | null = null): void {
        noEvent(events, () => expect(checkSendPreWarpProgressEventMessage(g, player, type, subject, other)).toBe(false));
        expect(preWarpProgressEventOccurred(player, type)).toBe(true);
    }

    it('BuildFirstShip (ConstructionQueue.cs 961): "Star Ship Constructed", the ship as subject', () => {
        const s = ship(g, player, BuiltObjectSubRole.ExplorationShip, 'Pathfinder');
        const e = oneEvent(events, () => expect(checkSendPreWarpProgressEventMessage(g, player, PreWarpProgressEventType.BuildFirstShip, s)).toBe(true));
        expect(e.titleText).toBe('Star Ship Constructed');
        expect(e.text).toContain('We have constructed our first star ship, the Pathfinder!');
        expect(e.additionalData).toBe(s);
        expect(e.location).toBe(s);
        shown.push(e);
        check(PreWarpProgressEventType.BuildFirstShip, ship(g, player, BuiltObjectSubRole.ExplorationShip, 'Second'));
    });

    it('BuildFirstMilitaryShip (ConstructionQueue.cs 959): "Military Ship Constructed"', () => {
        const s = ship(g, player, BuiltObjectSubRole.Escort, 'Guardian');
        const e = oneEvent(events, () => checkSendPreWarpProgressEventMessage(g, player, PreWarpProgressEventType.BuildFirstMilitaryShip, s));
        expect(e.titleText).toBe('Military Ship Constructed');
        expect(e.text).toContain('We have constructed our first military ship, the Guardian!');
        shown.push(e);
        check(PreWarpProgressEventType.BuildFirstMilitaryShip, s);
    });

    it('BuildFirstSpaceport (ConstructionQueue.cs 952): "Spaceport Constructed", +0.25 economy efficiency', () => {
        const s = ship(g, player, BuiltObjectSubRole.SmallSpacePort, 'Sol Spaceport');
        const eff = player.economyEfficiency;
        const e = oneEvent(events, () => checkSendPreWarpProgressEventMessage(g, player, PreWarpProgressEventType.BuildFirstSpaceport, s));
        expect(e.titleText).toBe('Spaceport Constructed');
        expect(e.text).toContain('We have constructed a spaceport.');
        expect(player.economyEfficiency).toBeCloseTo(eff + 0.25, 12);
        shown.push(e);
        check(PreWarpProgressEventType.BuildFirstSpaceport, s);
        expect(player.economyEfficiency).toBeCloseTo(eff + 0.25, 12);
    });

    it('BuildFirstMiningStation (ConstructionQueue.cs 942): "Mining Station Constructed", its planet named', () => {
        const s = ship(g, player, BuiltObjectSubRole.MiningStation, 'Xylothar Mining Station');
        s.parentHabitat = player.capital;
        const eff = player.economyEfficiency;
        const e = oneEvent(events, () => checkSendPreWarpProgressEventMessage(g, player, PreWarpProgressEventType.BuildFirstMiningStation, s));
        expect(e.titleText).toBe('Mining Station Constructed');
        expect(e.text).toContain('The construction of our first mining station');
        expect(e.text).toContain('Building Xylothar Mining Station has galvanized the resolve of our population'); // the surplus planet-name argument is dropped
        expect(e.text).not.toContain('|');
        expect(player.economyEfficiency).toBeCloseTo(eff + 0.25, 12);
        shown.push(e);
        check(PreWarpProgressEventType.BuildFirstMiningStation, s);
    });

    it('BuildFirstResearchStation (ConstructionQueue.cs 947): a new scientist or +0.15 efficiency (Next(0, 2))', () => {
        const s = ship(g, player, BuiltObjectSubRole.EnergyResearchStation, 'Lab One');
        const draws = g.rnd.drawCount;
        const e = oneEvent(events, () => checkSendPreWarpProgressEventMessage(g, player, PreWarpProgressEventType.BuildFirstResearchStation, s));
        expect(g.rnd.drawCount).toBeGreaterThan(draws);
        expect(e.titleText).toBe('Research Station Constructed');
        expect(e.text).toContain('Constructing a research station gives a huge boost to our research efforts');
        if (e.additionalData instanceof Character) expect(e.text).toContain(e.additionalData.name);
        else expect(e.additionalData).toBe(s);
        shown.push(e);
        check(PreWarpProgressEventType.BuildFirstResearchStation, s);
    });

    it('DiscoverHyperspaceTech (Empire.3.cs 2586, through DoResearchBreakthrough): "Hyperspace Technology Discovered"', () => {
        const node = player.research!.techTree.find((n) => n.def.specialFunctionCode === 2)!;
        const e = oneEvent(events, () => doResearchBreakthrough(g, player, node, true, true));
        expect(e.titleText).toBe('Hyperspace Technology Discovered');
        if (e.additionalData instanceof Character) {
            expect(e.text).toContain('We have discovered hyperspace technology');
            expect(e.text).toContain(e.additionalData.name);
        } else {
            expect(e.text).toContain('we have developed our first primitive hyperdrive!');
            expect((e.additionalData as { type: ComponentType }).type).toBe(ComponentType.HyperDrive);
        }
        shown.push(e);
        check(PreWarpProgressEventType.DiscoverHyperspaceTech, node);
    });

    it('DiscoverColonizationTech (Empire.3.cs 2593): the stock initial colonization project has no component, so no popup', () => {
        // research.txt 220 "Marshy Swamp Colonization" (Special Function Code 4) unlocks an ability only: Empire.7.cs
        // 3644-3654 then sends nothing and adds no efficiency, but closes the event (as in 1.9.5).
        const node = player.research!.techTree.find((n) => n.def.specialFunctionCode === 4)!;
        expect(node.def.components).toEqual([]);
        const eff = player.economyEfficiency;
        const before = events.length;
        doResearchBreakthrough(g, player, node, true, true);
        expect(events.slice(before).filter((x) => x.title.startsWith('PreWarpProgressEvent'))).toEqual([]);
        expect(preWarpProgressEventOccurred(player, PreWarpProgressEventType.DiscoverColonizationTech)).toBe(true);
        expect(player.economyEfficiency).toBe(eff);
    });

    it('DiscoverColonizationTech with a component project (a mod): the Component as subject, +0.5 efficiency', () => {
        const g2 = createGame(preWarpOptions(gameData, true)).galaxy;
        const p2 = g2.playerEmpire!;
        const ev2 = recordEvents(p2);
        // research.txt 219 "Colonization" (the colonization module, component 102) as the colonization project.
        const node = p2.research!.techTree.find((n) => n.def.components.some((id) => g2.researchStatic!.componentsById.get(id)?.type === ComponentType.HabitationColonization))!;
        const eff = p2.economyEfficiency;
        const e = oneEvent(ev2, () => expect(checkSendPreWarpProgressEventMessage(g2, p2, PreWarpProgressEventType.DiscoverColonizationTech, node)).toBe(true));
        expect(e.titleText).toBe('Colonization Technology Discovered');
        const component = e.additionalData as { name: string; type: ComponentType; componentId: number };
        expect(component.type).toBe(ComponentType.HabitationColonization);
        expect(component).toBe(g2.researchStatic!.componentsById.get(component.componentId)); // the Component itself
        expect(e.text).toContain(`With the development of the ${component.name}, we have acquired all of the technology necessary to colonize new worlds!`);
        expect(p2.economyEfficiency).toBeCloseTo(eff + 0.5, 12);
        noEvent(ev2, () => expect(checkSendPreWarpProgressEventMessage(g2, p2, PreWarpProgressEventType.DiscoverColonizationTech, node)).toBe(false));
        shown.push(e);
    });

    it('FirstHyperjump (BuiltObject.2.cs 3094): "Hyperjump!", the ship named', () => {
        const s = player.builtObjects.find((b) => b.name === 'Pathfinder')!;
        const e = oneEvent(events, () => checkSendPreWarpProgressEventMessage(g, player, PreWarpProgressEventType.FirstHyperjump, s));
        expect(e.titleText).toBe('Hyperjump!');
        expect(e.text).toContain('One of our ships, the Pathfinder, has engaged its hyperdrive');
        shown.push(e);
        check(PreWarpProgressEventType.FirstHyperjump, s);
    });

    it('EncounterFirstKaltor (Galaxy.7.cs 3032 / 3111): "Giant Kaltor Encountered", the nearest world named', () => {
        const kaltor = g.generateCreatureAtHabitat(CreatureType.Kaltor, player.capital!, false)!;
        expect(kaltor).toBeInstanceOf(Creature);
        const e = oneEvent(events, () => checkSendPreWarpProgressEventMessage(g, player, PreWarpProgressEventType.EncounterFirstKaltor, kaltor));
        expect(e.titleText).toBe('Giant Kaltor Encountered');
        expect(e.text).toContain('We have encountered a Giant Kaltor space monster near');
        expect(e.additionalData).toBe(kaltor);
        shown.push(e);
        check(PreWarpProgressEventType.EncounterFirstKaltor, kaltor);
    });

    it('FirstContactPirateOrIndependent (Galaxy.7.cs 3961, DoEmpireEncounter): "Lone Trader"; pirates send nothing', () => {
        const pirate = g.pirateEmpires[0];
        const at = player.builtObjects.find((b) => b.name === 'Pathfinder')!;
        // A pirate contact goes through DoSingleEmpireEncounter, then the event — which only the independents' raise.
        const before = events.length;
        doEmpireEncounter(g, player, pirate, at);
        expect(events.slice(before).filter((x) => x.title.startsWith('PreWarpProgressEvent'))).toEqual([]);
        expect(preWarpProgressEventOccurred(player, PreWarpProgressEventType.FirstContactPirateOrIndependent)).toBe(false);
        // The independent trader (here met at our own ship: the "NoShip" text, no subject).
        const e = oneEvent(events, () => doEmpireEncounter(g, player, g.independentEmpire, at));
        expect(e.titleText).toBe('Lone Trader');
        expect(e.text).toContain('We have encountered a lone star ship in our system.');
        expect(e.additionalData).toBe(null);
        expect(e.location).toBe(at);
        shown.push(e);
        noEvent(events, () => doEmpireEncounter(g, player, g.independentEmpire, at));
    });

    it('FirstPirateRaid (Empire.7.cs 3408 CheckReviewSpecialPirateEvents → "avoid"; BuiltObject.1.cs 2749 the raid)', () => {
        player.pirateExtortionOfferMade = true;
        const e = oneEvent(events, () => checkReviewSpecialPirateEvents(g, player));
        expect(e.titleText).toBe('Pirate Raiders!');
        expect(e.text).toContain(`We have avoided a pirate raid on our homeworld ${player.capital!.name}!`);
        expect(e.additionalData).toBe(player.capital);
        shown.push(e);
        noEvent(events, () => checkReviewSpecialPirateEvents(g, player));
        check(PreWarpProgressEventType.FirstPirateRaid, player.capital, g.pirateEmpires[0]);
    });

    // GameText "PreWarpProgressEvent Message FirstContactNormalEmpire" has a {2} that Empire.7.cs 3728 never passes (the C#
    // string.Format would throw); 1.9.5 never raises the event, so the TS keeps the port and its text as they are.
    it('FirstContactNormalEmpire (no 1.9.5 call site): "First Contact", once', () => {
        const ai = g.empires.find((x) => x !== player && x.pirateEmpireBaseHabitat === null && x !== g.independentEmpire)!;
        const e = oneEvent(events, () => checkSendPreWarpProgressEventMessage(g, player, PreWarpProgressEventType.FirstContactNormalEmpire, ai));
        expect(e.titleText).toBe('First Contact');
        expect(e.text).toContain(ai.name);
        check(PreWarpProgressEventType.FirstContactNormalEmpire, ai);
    });

    it('no text leaks: every title and message resolves fully', () => {
        for (const e of events.filter((x) => x.title.startsWith('PreWarpProgressEvent') && !x.title.includes('FirstContactNormalEmpire'))) {
            const t = resolveGameText(e.title);
            const m = resolveGameText(e.message);
            expect(t).not.toContain('PreWarpProgressEvent');
            expect(m).not.toContain('PreWarpProgressEvent');
            expect(m).not.toMatch(/\{\d\}/);
            expect(m).not.toContain('|');
        }
    });

    it('the UI shows each one on the event panel with its picture, Close / Go to, pausing (Main.Part4.cs:887 / 508)', () => {
        const opened: EventPopup[] = [];
        const stories: StoryEventPopup[] = [];
        const panels: EventPanelSink = { showEvent: (p) => opened.push(p), showStory: (p) => stories.push(p) };
        const opts = { player, galaxy: g, onGoTo: () => {} };
        for (const e of shown) expect(presentEventMessage(e, opts, panels)).toBe('event');
        expect(stories).toEqual([]);
        expect(opened.length).toBe(shown.length);
        for (let i = 0; i < shown.length; i++) {
            const e = shown[i];
            const p = opened[i];
            expect(resolveGameText(p.title)).toBe(resolveGameText(e.title));
            expect(resolveGameText(p.text)).toBe(resolveGameText(e.message));
            expect(p.forcePause).toBe(true);
            expect(p.actions).toBeUndefined(); // Close (+ Go to Event Location), not a choice
            const d = e.additionalData;
            const pic = p.picture;
            if (d instanceof BuiltObject) expect(pic).toEqual({ kind: 'ship', builtObject: d });
            else if (d instanceof Habitat) expect(pic).toEqual({ kind: 'habitat', habitat: d });
            else if (d instanceof Character) expect(pic).toEqual({ kind: 'character', character: d });
            else if (d instanceof Creature) expect(pic).toMatchObject({ kind: 'creature', type: CreatureType.Kaltor, url: '/assets/dwu/images/units/creatures/kaltor/Kaltor_00000.png', rotate: 90 });
            else if (d === null) expect(pic).toBe(null);
            else {
                // A component: the first hyperdrive / colonization module get warpjump_large.png / colonization_large.png.
                const c = d as { type: ComponentType };
                expect(pic).toEqual({ kind: 'url', url: c.type === ComponentType.HyperDrive ? EVENT_CHROME.warpJump : EVENT_CHROME.colonization });
            }
            // Go to Event Location when the location is a ship / base / planet / creature / character.
            expect(typeof p.onGoTo === 'function').toBe(eventGoToTarget(e.location) !== null);
        }
        // The pre-warp events are located: the ship, the planet, the scientist (at the capital / station), the Kaltor.
        expect(opened.filter((p) => p.onGoTo != null).length).toBeGreaterThanOrEqual(shown.length - 1);
    });

    it('flag7: the discovery settings gate the panel (level 1: DiscoveryActionRuin 3 / 4 hide it; abandoned-ship setting for ships)', () => {
        const e = shown.find((x) => x.additionalData instanceof Habitat)!;
        const p = eventMessagePresentation(e.type, e.additionalData, e.location, player, g);
        expect(p.level).toBe(1);
        const save = [player.discoveryActionRuin, player.discoveryActionAbandonedShipBase];
        try {
            for (const [v, want] of [[0, true], [1, true], [2, true], [3, false], [4, false]] as const) {
                player.discoveryActionRuin = v;
                expect(eventPopupShown(p, e.additionalData, player, false), `DiscoveryActionRuin ${v}`).toBe(want);
            }
            player.discoveryActionRuin = 0;
            expect(eventPopupShown(p, e.additionalData, player, true)).toBe(false); // SuppressAllPopups
            const s = shown.find((x) => x.additionalData instanceof BuiltObject)!;
            const ps = eventMessagePresentation(s.type, s.additionalData, s.location, player, g);
            player.discoveryActionAbandonedShipBase = 2;
            expect(eventPopupShown(ps, s.additionalData, player, false)).toBe(false);
            player.discoveryActionAbandonedShipBase = 0;
            expect(eventPopupShown(ps, s.additionalData, player, false)).toBe(true);
        } finally {
            [player.discoveryActionRuin, player.discoveryActionAbandonedShipBase] = save;
        }
    });

    it('the history records each with the method_523 message type (Exploration*, popup suppressed)', () => {
        const before = empireMessageHistory(player)?.length ?? 0;
        for (const e of shown) recordEventMessage(player, e, defaultMessageOptions());
        const added = (empireMessageHistory(player) ?? []).slice(before);
        // Messages land in Empire.Messages first; the history is filled as they are processed — check the queue too.
        const all: EmpireMessage[] = [...added, ...(player.messages as (EmpireMessage | null)[]).filter((m): m is EmpireMessage => m != null)];
        for (const e of shown) {
            const want = e.additionalData instanceof BuiltObject ? EmpireMessageType.ExplorationBuiltObject : e.additionalData instanceof Habitat ? EmpireMessageType.ExplorationHabitat : EmpireMessageType.ExplorationRuins;
            const m = all.find((x) => x.title === e.title && x.description === e.message);
            expect(m, resolveGameText(e.title)).toBeDefined();
            expect(m!.messageType).toBe(want);
            expect(m!.supressPopup).toBe(true);
        }
    });
});

describe('pre-warp progress events in worker mode (ui/workerMessages.ts)', () => {
    it('the events and their subjects reach the main-thread recipient as replica objects, and present the same', () => {
        const game = createGame(preWarpOptions(gameData, true));
        const time = new GalaxyTime();
        time.paused = false;
        let t = 0;
        const now = (): number => (t += 0.001);
        const host = new SimHost(game, time, {} as StartGameOptions, { now, playerMessages: true });
        const snap = structuredClone(host.snapshot());
        const toHost = (m: ToWorker): void => {
            const c = structuredClone(m);
            if (c.type === 'command') host.command(c);
            else if (c.type === 'clock') host.clock(c);
            else if (c.type === 'uiOp') host.uiOp(c);
        };
        let ui: ReturnType<typeof installWorkerMessageUi> | null = null;
        const client = new SimClientCore(gameData, snap, { post: toHost, now, onEvent: (e: WorkerEvent, resolve) => void ui?.onEvent(e, resolve) });
        const uiTime = new GalaxyTime();
        uiTime.bindGalaxy(client.galaxy);
        uiTime.paused = false;
        ui = installWorkerMessageUi({ player: client.game.playerEmpire, galaxy: client.galaxy, time: uiTime, post: (op, args) => client.postUiOp(op, args), optionsPollMs: 0 });
        // The main thread's recipient (eventMessages.ts installs one on the replica player; here a recorder).
        const replicaPlayer = client.game.playerEmpire;
        const received: QueuedEvent[] = [];
        Object.defineProperty(replicaPlayer, 'eventMessageRecipient', {
            value: { receiveEventMessage: (type: number, title: string, message: string, additionalData: unknown, location: unknown) => received.push({ type, title, message, additionalData, location }) },
            writable: true,
            configurable: true,
            enumerable: false,
        });
        const tick = (): void => {
            client.syncClock(uiTime);
            const m = host.tick(FRAME_REAL_MS);
            if (m !== null) client.receive(structuredClone(m));
            client.frame(uiTime);
        };
        const g = game.galaxy;
        const player = g.playerEmpire!;
        for (let i = 0; i < 5; i++) tick();
        const s = ship(g, player, BuiltObjectSubRole.ExplorationShip, 'Pathfinder');
        checkSendPreWarpProgressEventMessage(g, player, PreWarpProgressEventType.BuildFirstShip, s);
        doResearchBreakthrough(g, player, player.research!.techTree.find((n) => n.def.specialFunctionCode === 2)!, true, true);
        for (let i = 0; i < 5; i++) tick();

        const prewarp = received.filter((e) => e.title.startsWith('PreWarpProgressEvent'));
        expect(prewarp.map((e) => resolveGameText(e.title))).toEqual(['Star Ship Constructed', 'Hyperspace Technology Discovered']);
        expect(prewarp.every((e) => e.type === EventMessageType.GeneralDiscovery)).toBe(true);
        // The ship is the replica's.
        const rs = prewarp[0].additionalData;
        expect(rs).toBeInstanceOf(BuiltObject);
        expect(rs).not.toBe(s);
        expect((rs as BuiltObject).name).toBe('Pathfinder');
        expect(client.replica.decoder.idOf(rs as object)).toBeGreaterThanOrEqual(0);
        // A new scientist (born this frame) or the hyperdrive component.
        const hyper = prewarp[1].additionalData;
        if (hyper instanceof Character) expect(client.replica.decoder.idOf(hyper)).toBeGreaterThanOrEqual(0);
        else expect((hyper as { type: ComponentType }).type).toBe(ComponentType.HyperDrive);
        // The main side presents them as in-thread.
        const opened: EventPopup[] = [];
        const panels: EventPanelSink = { showEvent: (p) => opened.push(p), showStory: () => {} };
        for (const e of prewarp) expect(presentEventMessage(e, { player: replicaPlayer, galaxy: client.galaxy, onGoTo: () => {} }, panels)).toBe('event');
        expect(opened[0].picture).toEqual({ kind: 'ship', builtObject: rs });
        if (hyper instanceof Character) expect(opened[1].picture).toEqual({ kind: 'character', character: hyper });
        else expect(opened[1].picture).toEqual({ kind: 'url', url: EVENT_CHROME.warpJump });
        ui.dispose();
        client.dispose();
        host.dispose();
    }, 300000);
});

describe('the other event panels (Main.Part4.cs:487 method_523)', () => {
    it('encounters and decision events get the two choice buttons; Investigate issues the player command', () => {
        const game = createGame(preWarpOptions(gameData, true));
        const g = game.galaxy;
        const player = g.playerEmpire!;
        const opened: EventPopup[] = [];
        const stories: StoryEventPopup[] = [];
        const panels: EventPanelSink = { showEvent: (p) => opened.push(p), showStory: (p) => stories.push(p) };
        const opts = { player, galaxy: g, onGoTo: () => {} };

        // EncounterBuiltObject (509-528 → method_511): the ship picture, Investigate Ship / Leave the Ship alone.
        const wreck = ship(g, player, BuiltObjectSubRole.ExplorationShip, 'Derelict');
        expect(presentEventMessage({ type: EventMessageType.EncounterBuiltObject, title: 'Abandoned Ship Encountered', message: 'x', additionalData: wreck, location: wreck }, opts, panels)).toBe('choice');
        const enc = opened.at(-1)!;
        expect(enc.picture).toEqual({ kind: 'ship', builtObject: wreck });
        expect(enc.actions!.map((a) => a.label)).toEqual([resolveGameText('Investigate Ship'), resolveGameText('Leave the Ship alone')]);
        expect(enc.extraButtonH).toBe(0);
        expect(enc.forcePause).toBe(true);
        expect(pendingPlayerCommands(g)).toBe(0);
        enc.actions![0].onClick();
        expect(pendingPlayerCommands(g)).toBe(1);
        flushPlayerCommands(g);
        expect((commandLog(g) as readonly { op: string }[]).at(-1)!.op).toBe('investigateEncounteredBuiltObject');
        // Leave alone changes nothing.
        enc.actions![1].onClick();
        expect(pendingPlayerCommands(g)).toBe(0);

        // EncounterRuins (531-554 → method_510).
        const ruinWorld = g.habitats.find((h) => h.ruin !== null)!;
        expect(presentEventMessage({ type: EventMessageType.EncounterRuins, title: 'Ruins', message: 'x', additionalData: ruinWorld, location: ruinWorld }, opts, panels)).toBe('choice');
        expect(opened.at(-1)!.picture).toEqual({ kind: 'url', url: `/assets/dwu/images/environment/ruins/ruin_${ruinWorld.ruin!.pictureRef}.png` });
        expect(opened.at(-1)!.actions!.map((a) => a.label)).toEqual([resolveGameText('Investigate Ruins'), resolveGameText('Leave the Ruins alone')]);

        // UncoverPirateAttackFundingAnotherEmpire (1474-1478 → method_509, int_64 = 30): the pirate flag, warn / keep.
        const [ai1, ai2] = g.empires.filter((x) => x !== player && x.pirateEmpireBaseHabitat === null && x !== g.independentEmpire);
        const activity = Object.assign(Object.create(EmpireActivity.prototype) as EmpireActivity, { requestingEmpire: ai1, targetEmpire: ai2 });
        expect(presentEventMessage({ type: EventMessageType.UncoverPirateAttackFundingAnotherEmpire, title: 't', message: 'm', additionalData: activity, location: null }, opts, panels)).toBe('choice');
        const warn = opened.at(-1)!;
        expect(warn.picture).toEqual({ kind: 'url', url: EVENT_CHROME.pirateFlag });
        expect(warn.extraButtonH).toBe(30);
        expect(warn.actions!.map((a) => a.label)).toEqual([resolveGameText('Warn target empire about this secret deal'), resolveGameText('Keep this information to ourselves')]);
        const evalBefore = obtainEmpireEvaluation(g, ai2, player).incidentEvaluationRaw;
        warn.actions![0].onClick();
        flushPlayerCommands(g);
        expect((commandLog(g) as readonly { op: string }[]).at(-1)!.op).toBe('warnTargetOfPirateAttackFunding');
        expect(obtainEmpireEvaluation(g, ai2, player).incidentEvaluationRaw).toBeGreaterThan(evalBefore);

        // OriginsDiscovery / StoryClue (751-771 → method_571): the full-view story panel over storyEvent.jpg.
        expect(presentEventMessage({ type: EventMessageType.StoryClue, title: 'Clue', message: 'Text', additionalData: ruinWorld, location: ruinWorld }, opts, panels)).toBe('story');
        expect(stories.at(-1)!.picture).toEqual({ kind: 'url', url: EVENT_CHROME.storyEvent });

        // The method_508 pictures of a few others.
        const pres = (type: EventMessageType, d: unknown, loc: unknown = null) => eventMessagePresentation(type, d, loc, player, g);
        expect(pres(EventMessageType.DisasterEvent, DisasterEventType.Earthquake).picture).toEqual({ kind: 'url', url: '/assets/dwu/images/ui/events/earthquake.png' });
        expect(pres(EventMessageType.DisasterEvent, DisasterEventType.EconomicCrisis).picture).toEqual({ kind: 'url', url: '/assets/dwu/images/ui/events/economiccrisis.png' });
        expect(pres(EventMessageType.TreasureFound, null)).toMatchObject({ panel: 'event', picture: { kind: 'url', url: EVENT_CHROME.money }, level: 1 });
        expect(pres(EventMessageType.PirateAmbush, null).picture).toEqual({ kind: 'url', url: EVENT_CHROME.pirateFlag });
        expect(pres(EventMessageType.BuiltObjectExplodes, null).picture).toEqual({ kind: 'url', url: '/assets/dwu/images/ui/messages/underAttack.png' });
        expect(pres(EventMessageType.CharacterEvent, player.leader).picture).toEqual(player.leader !== null ? { kind: 'character', character: player.leader } : null);
        expect(pres(EventMessageType.NewEmpireEmerges, null)).toEqual({ panel: 'event', picture: null, level: 3 });
        const res = g.resources[0];
        expect(pres(EventMessageType.ResourceAppearance, res.resourceId, player.capital).picture).toEqual({ kind: 'pair', left: { kind: 'habitat', habitat: player.capital }, right: { kind: 'url', url: `/assets/dwu/images/ui/resources/Resource_${res.pictureRef}.bmp` } });
        expect(pres(EventMessageType.CreatureOutbreak, null).picture).toMatchObject({ kind: 'creature', type: CreatureType.Kaltor, rotate: 0 });
        // Go to Event Location: a point goes to its nearest system.
        expect(eventGoToTarget({ x: 10, y: 20 })).toEqual({ kind: 'point', x: 10, y: 20 });
        expect(eventGoToTarget(null)).toBe(null);
    }, 300000);
});
