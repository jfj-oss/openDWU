// Shared command script for the command-log determinism tests (commandReplay.test.ts soak, commandLog.test.ts):
// a scripted player issuing commands through the queue at given sim times.
import type { Galaxy } from '../../src/sim/galaxy';
import type { Empire } from '../../src/sim/empire';
import type { Game } from '../../src/sim/game';
import type { Habitat } from '../../src/sim/types';
import { GalaxyTime } from '../../src/sim/galaxyTime';
import { stateDigest } from '../../src/sim/tick/digest';
import { nextFrameMs, runSimFrame, schedulerState } from '../../src/sim/tick/scheduler';
import { serializeGame } from '../../src/sim/save/gameSave';
import { flushPlayerCommands, issuePlayerCommand, noteSimSpeed } from '../../src/sim/player/playerCommands';
import { ShipActionType, createMissionShipActionAt, createShipAction } from '../../src/sim/player/shipAction';
import { isOrderableShip } from '../../src/sim/player/advisorBrief';
import { listProposals } from '../../src/sim/player/diplomacyProposals';
import { BuiltObjectMissionType } from '../../src/sim/missions/mission';
import { BuiltObjectRole } from '../../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../../src/sim/builtObjectTypes';
import { findNewestCanBuild } from '../../src/sim/designGeneration';
import { ShipGroup, empireShipGroups } from '../../src/sim/fleets/shipGroup';
import type { StartGameOptions } from '../../src/sim/startGameOptions';

/** A command script on a time scale: `scale` 1 = the 600 s soak (steps at 5 … 400 s), 0.1 = a 60 s run. */
export interface CommandScript {
    steps: Step[];
    /** The frames' game speed (a sim input, journaled as 'clock' entries): 2× between 100 s and 160 s (× scale). */
    speedAt: (ms: number) => number;
}

export function commandScript(scale: number): CommandScript {
    const t = (ms: number): number => Math.round(ms * scale);
    return {
        steps: STEPS.map((s) => ({ ...s, atMs: t(s.atMs) })),
        speedAt: (ms) => (ms >= t(100_000) && ms < t(160_000) ? 2 : 1),
    };
}

/** Everything a digest compares: the state digest and the whole save (incl. the command log). */
export function fullDigest(game: Game): { digest: string; save: string } {
    const time = new GalaxyTime();
    time.bindGalaxy(game.galaxy);
    return { digest: stateDigest(game.galaxy), save: serializeGame(game, time, {} as StartGameOptions) };
}

function farHabitat(g: Galaxy, from: { xpos: number; ypos: number }, rank: number): Habitat {
    const list = g.habitats.filter((h) => h.parent !== null).slice();
    list.sort((a, b) => Math.hypot(a.xpos - from.xpos, a.ypos - from.ypos) - Math.hypot(b.xpos - from.xpos, b.ypos - from.ypos) || a.habitatIndex - b.habitatIndex);
    return list[Math.min(rank, list.length - 1)];
}

function moveOrder(g: Galaxy, target: Habitat) {
    return createMissionShipActionAt(BuiltObjectMissionType.Move, target, Math.trunc(target.xpos), Math.trunc(target.ypos));
}

/** The fleet the scripted 'create a fleet' order made, per galaxy (the empire may form fleets of its own too). */
export const createdFleets = new WeakMap<Galaxy, ShipGroup>();

export interface Step {
    atMs: number;
    what: string;
    issue: (g: Galaxy, p: Empire) => void;
}

/** The scripted player: each step resolves its targets on the live game when it is issued. */
const STEPS: Step[] = [
    {
        atMs: 5_000,
        what: 'move a ship',
        issue: (g, p) => {
            const ship = p.builtObjects.find((b) => isOrderableShip(p, b) && b.role !== BuiltObjectRole.Military)!;
            issuePlayerCommand(g, p, 'rightClickOrder', [ship, moveOrder(g, farHabitat(g, ship, 20)), { ctrl: false, alt: false }, 1]);
        },
    },
    {
        atMs: 10_000,
        what: 'create a fleet',
        issue: (g, p) => {
            const ships = p.builtObjects.filter((b) => isOrderableShip(p, b) && b.role === BuiltObjectRole.Military && b.shipGroup === null);
            issuePlayerCommand(g, p, 'shipAction', [ships, createShipAction(ShipActionType.CreateNewFleet, null), false], (r) => {
                if (r.select instanceof ShipGroup) createdFleets.set(g, r.select);
            });
        },
    },
    {
        atMs: 20_000,
        what: 'purchase ships',
        issue: (g, p) => {
            const design = findNewestCanBuild(p.designs, BuiltObjectSubRole.Escort, p) ?? findNewestCanBuild(p.designs, BuiltObjectSubRole.ConstructionShip, p);
            issuePlayerCommand(g, p, 'buildNewShips', [[design], [2]]);
        },
    },
    {
        atMs: 30_000,
        what: 'treaty proposal',
        issue: (g, p) => {
            for (const other of g.empires) {
                if (other === p) continue;
                const options = listProposals(g, p, other);
                const o = options.find((x) => x.enabled && x.menu === 'TREATY_PROPOSAL') ?? options.find((x) => x.enabled);
                if (o !== undefined) {
                    issuePlayerCommand(g, p, 'submitProposal', [other, o.id]);
                    return;
                }
            }
            issuePlayerCommand(g, p, 'submitProposal', [g.empires.find((x) => x !== p)!, 'TREATY_PROPOSAL']);
        },
    },
    {
        atMs: 40_000,
        what: 'tax change',
        issue: (g, p) => {
            issuePlayerCommand(g, p, 'automationOff', ['Colony Tax Rates']);
            issuePlayerCommand(g, p, 'shipAction', [p.capital!, createShipAction(ShipActionType.ColonyTaxUp5, null), false]);
        },
    },
    {
        atMs: 50_000,
        what: 'policy change',
        issue: (g, p) => {
            issuePlayerCommand(g, p, 'setPolicy', [{ ...p.policy!, researchPriority: 1.5, tradeWithOtherEmpires: !p.policy!.tradeWithOtherEmpires }]);
        },
    },
    {
        atMs: 330_000,
        what: 'fleet move after the save',
        issue: (g, p) => {
            const fleet = empireShipGroups(p).find((x) => x !== null) as ShipGroup;
            issuePlayerCommand(g, p, 'rightClickOrder', [fleet, moveOrder(g, farHabitat(g, p.capital!, 40)), { ctrl: false, alt: false }, 1]);
        },
    },
    {
        atMs: 400_000,
        what: 'research queue + automation after the save',
        issue: (g, p) => {
            const node = p.research.techTree.find((n) => !n.isResearched && p.research.canResearchNode(n) && !(p.research.researchQueueFor(0)?.includes(n) ?? false));
            if (node !== undefined) issuePlayerCommand(g, p, 'queueResearch', [node]);
            issuePlayerCommand(g, p, 'setEmpireControl', ['controlColonization', 0]);
        },
    },
];

/** Headless scripted run: before each frame, issue the steps due, then step one frame (which applies them first). */
export function runScripted(script: CommandScript, game: Game, untilMs: number): void {
    const g = game.galaxy;
    const p = game.playerEmpire;
    const state = schedulerState(g);
    while (g.nowMs < untilMs) {
        for (const s of script.steps) if (s.atMs <= g.nowMs && !issued.has(key(g, s))) issueStep(g, p, s);
        const speed = script.speedAt(g.nowMs);
        noteSimSpeed(g, speed);
        runSimFrame(g, nextFrameMs(state, speed));
    }
    flushPlayerCommands(g);
}

// Steps issued per run id (a loaded copy continues the original's script under the same id).
const issued = new Set<string>();
const runIds = new WeakMap<Galaxy, string>();
export function setRunId(g: Galaxy, id: string): void {
    runIds.set(g, id);
}
function key(g: Galaxy, s: Step): string {
    return `${runIds.get(g)}:${s.atMs}`;
}
/** The script's steps due at the galaxy's time and not issued yet in this run. */
export function dueSteps(script: CommandScript, g: Galaxy): Step[] {
    return script.steps.filter((s) => s.atMs <= g.nowMs && !issued.has(key(g, s)));
}
export function issueStep(g: Galaxy, p: Empire, s: Step): void {
    issued.add(key(g, s));
    s.issue(g, p);
}

