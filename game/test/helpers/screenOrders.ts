// Sim worker chunk 6 (docs/sim-worker.md §9): the orders the empire-management screens issue, with the screens' own
// argument shapes (and, where the screen has one, its own builder: the policy panel, the design editor's draft, the
// troop recruit options, the planner's targets), as a script both the in-thread game and the worker replica run
// (test/simWorkerScreens.test.ts); and the screens' read paths, run on a replica to show they write nothing.
import type { Galaxy } from '../../src/sim/galaxy';
import type { Empire } from '../../src/sim/empire';
import type { Design } from '../../src/sim/design';
import type { BuiltObject } from '../../src/sim/builtObject';
import type { Troop } from '../../src/sim/cargo';
import type { Character } from '../../src/sim/characters';
import { issuePlayerCommand } from '../../src/sim/player/playerCommands';
import type { PlayerOpArgs, PlayerOpName, PlayerOpResult } from '../../src/sim/player/playerOps';
import { ShipAction, ShipActionType, createShipAction } from '../../src/sim/player/shipAction';
import { BuiltObjectSubRole } from '../../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../../src/sim/data/designSpecifications';
import { ColonyPopulationPolicy, defaultEmpirePolicy } from '../../src/sim/data/policies';
import { findNewestCanBuild, getBuildableDesignsBySubRoles } from '../../src/sim/designGeneration';
import { resolveBuildableFacilities } from '../../src/sim/player/executeShipAction';
import { addComponent, designToolboxComponents, newDesignDraft, setDraftSubRole } from '../../src/sim/player/designEditor';
import { writeDesignFile } from '../../src/sim/player/designTools';
import { fleetDesignBook } from '../../src/sim/player/fleetTemplates';
import { constructionJobRows } from '../../src/sim/player/constructionBoard';
import { calculateCrashResearchProgramCost } from '../../src/sim/researchTick';
import { planetaryFacilityDefinitionsStatic } from '../../src/sim/construction/facilities';
import { BuiltObjectMissionType, COORD_UNSET_DOUBLE } from '../../src/sim/missions/mission';
import { empireShipGroups, type ShipGroup } from '../../src/sim/fleets/shipGroup';
import { isOrderableShip } from '../../src/sim/player/advisorBrief';
import { applyPolicyPanel, buildPolicyPanel, panelControls, policyAutomationChange, type ComboControl, type PolicyAutomationChange } from '../../src/ui/screens/empirePolicyModel';
import { recruitOptions, troopRows, troopFilterOptions, troopListAnnualMaintenance } from '../../src/ui/screens/troops';
import { expansionTargets, expansionRow, deficientResourceRows, plannerAvailableShips, plannerStatus, plannerStatusInput } from '../../src/ui/screens/expansionPlanner';
import { charterRows, charterButtonState } from '../../src/ui/screens/charters';
import { buildOrderAdvisorTargets, buildOrderRows } from '../../src/ui/screens/buildOrderModel';
import { buildQueueRows, fleetOrderRows } from '../../src/ui/screens/buildQueueModel';
import { fleetTemplateDesignGroups } from '../../src/ui/screens/fleetDesignsTab';
import { empireSummaryExtra, modLayerSummaryRows } from '../../src/ui/screens/empireSummary';
import { computeEconomyBreakdown } from '../../src/sim/economyBreakdown';
import { moneyPanelIncome } from '../../src/sim/treasury';
import { colonyGridRow, colonyAttitudeSummary } from '../../src/ui/screens/coloniesScreen';
import { generateBenefitDetail, resolveNodeDescription } from '../../src/ui/screens/researchBenefits';
import {
    builtObjectTabLabels,
    builtObjectTroopIconItems,
    componentWaitRows,
    constructionResourceShortageText,
    manufacturerRows,
    setFleetItems,
    shipTroopLoadout,
    shipTroopLoadoutOn,
    shipTroopLoadoutSpin,
    shipTroopLoadoutView,
    siteManufacturingQueue,
} from '../../src/ui/screens/builtObjectDataTabs';

export interface ScreenOrder {
    /** Tick (one FRAME_REAL_MS step each) the order is issued before. */
    tick: number;
    /** Screen and what it does (also the reply's key). */
    what: string;
    /** Ops this order issues (each must reach the command log). */
    ops: PlayerOpName[];
    /** Resolve targets on `g` (the in-thread game, or the replica) and issue; false when there was nothing to do. */
    issue: (g: Galaxy, p: Empire, onReply: (r: unknown) => void) => boolean;
}

function issue<K extends PlayerOpName>(g: Galaxy, p: Empire, op: K, args: PlayerOpArgs<K>, onReply?: (r: PlayerOpResult<K>) => void): true {
    issuePlayerCommand(g, p, op, args, onReply);
    return true;
}

const firstDesign = (p: Empire, subRole: BuiltObjectSubRole): Design | null => findNewestCanBuild(p.designs, subRole, p);
const ownShips = (p: Empire): BuiltObject[] => p.builtObjects.filter((b): b is BuiltObject => b != null && !b.hasBeenDestroyed && isOrderableShip(p, b));
const military = (p: Empire): BuiltObject[] => ownShips(p).filter((b) => b.role === BuiltObjectRole.Military);
const troopsOf = (p: Empire): Troop[] => (p.troops?.items ?? []).filter((t): t is Troop => t != null);
const fleets = (p: Empire): ShipGroup[] => empireShipGroups(p).filter((x): x is ShipGroup => x != null);

const ORDERS: Omit<ScreenOrder, 'tick'>[] = [
    // --- Colonies ------------------------------------------------------------------------------------------------
    { what: 'colonies: rename', ops: ['renameColony'], issue: (g, p, r) => issue(g, p, 'renameColony', [p.colonies[0], 'Screen Prime'], r) },
    {
        what: 'colonies: tax up (automation off first)',
        ops: ['setEmpireControl', 'shipAction'],
        issue: (g, p, r) => {
            const h = p.colonies[0];
            issue(g, p, 'setEmpireControl', ['controlColonyTaxRates', false]);
            return issue(g, p, 'shipAction', [h, createShipAction(ShipActionType.ColonyTaxUp1, h), false], r);
        },
    },
    {
        what: 'colonies: population policy',
        ops: ['setColonyPopulationPolicy'],
        issue: (g, p, r) => issue(g, p, 'setColonyPopulationPolicy', [p.colonies[0], false, ColonyPopulationPolicy.Resettle], r),
    },
    {
        what: 'colonies: build facility',
        ops: ['shipAction'],
        issue: (g, p, r) => {
            const h = p.colonies[0];
            // The first buildable one (none yet this early: then the first definition, which the executor refuses).
            const def = resolveBuildableFacilities(g, h)[0] ?? planetaryFacilityDefinitionsStatic(g)[0];
            if (def === undefined) return false;
            return issue(g, p, 'shipAction', [h, createShipAction(ShipActionType.BuildPlanetaryFacility, def), false], r);
        },
    },
    // --- Troops ---------------------------------------------------------------------------------------------------
    {
        what: 'troops: recruit (the screen\'s template troop by value)',
        ops: ['shipAction'],
        issue: (g, p, r) => {
            const o = recruitOptions(g, p, p.colonies[0])[0];
            if (o === undefined) return false;
            return issue(g, p, 'shipAction', [p.colonies[0], o.action, false], r);
        },
    },
    {
        what: 'troops: rename',
        ops: ['renameTroop'],
        issue: (g, p, r) => {
            const t = troopsOf(p)[0];
            return t === undefined ? false : issue(g, p, 'renameTroop', [t, 'Screen Guard'], r);
        },
    },
    {
        what: 'diplomacy: restricted-resource trading',
        ops: ['setSupplyRestrictedResources'],
        issue: (g, p, r) => {
            const o = g.empires.find((e) => e !== p && e.active && e.pirateEmpireBaseHabitat === null && e !== g.independentEmpire);
            return o === undefined ? false : issue(g, p, 'setSupplyRestrictedResources', [o, true], r);
        },
    },
    {
        what: 'diplomacy: alliance name',
        ops: ['setAllianceName'],
        issue: (g, p, r) => {
            const o = g.empires.find((e) => e !== p && e.active && e.pirateEmpireBaseHabitat === null && e !== g.independentEmpire);
            return o === undefined ? false : issue(g, p, 'setAllianceName', [o, 'Screen Accord'], r);
        },
    },
    {
        what: 'characters: rename',
        ops: ['renameCharacter'],
        issue: (g, p, r) => {
            const c = ((p.characters ?? []) as (Character | null)[]).find((x): x is Character => x != null);
            return c === undefined ? false : issue(g, p, 'renameCharacter', [c, 'Screen Envoy'], r);
        },
    },
    {
        what: 'troops: garrison',
        ops: ['garrisonTroops'],
        issue: (g, p, r) => {
            const list = troopsOf(p).slice(0, 2);
            return list.length === 0 ? false : issue(g, p, 'garrisonTroops', [list, true], r);
        },
    },
    // --- Designs + Design Editor ----------------------------------------------------------------------------------
    {
        what: 'designs: save a copy (DesignDraft by value)',
        ops: ['saveDesign'],
        issue: (g, p, r) => {
            const src = firstDesign(p, BuiltObjectSubRole.Escort) ?? p.designs[0];
            if (src === undefined) return false;
            const draft = newDesignDraft(g, p, { kind: 'copy', design: src });
            draft.design.name = 'Screen Copy';
            return issue(g, p, 'saveDesign', [draft], r);
        },
    },
    {
        what: 'designs: save a new design built in the editor',
        ops: ['saveDesign'],
        issue: (g, p, r) => {
            const draft = newDesignDraft(g, p, { kind: 'blank' });
            setDraftSubRole(p, draft, BuiltObjectSubRole.Escort);
            for (const c of designToolboxComponents(p).slice(0, 6)) addComponent(p, draft, c, 1);
            draft.design.name = 'Screen Blank';
            return issue(g, p, 'saveDesign', [draft], r);
        },
    },
    {
        what: 'designs: obsolete / auto-retrofit / sub-role upgrade',
        ops: ['toggleDesignObsolete', 'toggleDesignAutoRetrofit', 'setDesignSubRoleUpgrade'],
        issue: (g, p, r) => {
            const d = p.designs.find((x) => x.name === 'Screen Copy');
            if (d === undefined) return false;
            issue(g, p, 'toggleDesignObsolete', [d]);
            issue(g, p, 'toggleDesignAutoRetrofit', [d]);
            return issue(g, p, 'setDesignSubRoleUpgrade', [d.subRole, false], r);
        },
    },
    {
        what: 'designs: load a design file',
        ops: ['loadDesignFile'],
        issue: (g, p, r) => {
            const d = p.designs.find((x) => x.name === 'Screen Copy');
            return d === undefined ? false : issue(g, p, 'loadDesignFile', [writeDesignFile([d])], r);
        },
    },
    {
        what: 'designs: delete',
        ops: ['deleteDesign'],
        issue: (g, p, r) => {
            const d = p.designs.filter((x) => x.name === 'Screen Copy');
            return d.length === 0 ? false : issue(g, p, 'deleteDesign', [d], r);
        },
    },
    // --- Build Order / Construction Yards / Build Queue -----------------------------------------------------------
    {
        what: 'build order: buy ships',
        ops: ['buildNewShips'],
        issue: (g, p, r) => {
            const d = firstDesign(p, BuiltObjectSubRole.Escort) ?? firstDesign(p, BuiltObjectSubRole.ConstructionShip);
            return d === null ? false : issue(g, p, 'buildNewShips', [[d], [2]], r);
        },
    },
    {
        what: 'construction yards: purchase at the capital',
        ops: ['yardPurchase'],
        issue: (g, p, r) => {
            const d = getBuildableDesignsBySubRoles(p.designs, [BuiltObjectSubRole.Escort, BuiltObjectSubRole.ConstructionShip], p, p.capital)[0];
            return d === undefined || p.capital === null ? false : issue(g, p, 'yardPurchase', [d, p.capital], r);
        },
    },
    {
        what: 'expansion planner: construction job at a resource target',
        ops: ['constructionJobAdd'],
        issue: (g, p, r) => {
            const t = expansionTargets('resourcesgalaxy', g, p, { includeLowQuality: true, includeAsteroids: true })[0];
            const d = firstDesign(p, BuiltObjectSubRole.MiningStation) ?? firstDesign(p, BuiltObjectSubRole.GasMiningStation);
            return t === undefined || d === null ? false : issue(g, p, 'constructionJobAdd', [d, t.habitat, COORD_UNSET_DOUBLE, COORD_UNSET_DOUBLE], r);
        },
    },
    {
        what: 'build queue: construction job move up / cancel',
        ops: ['constructionJobMoveUp', 'constructionJobCancel'],
        issue: (g, p, r) => {
            const rows = constructionJobRows(g, p);
            if (rows.length === 0) return false;
            issue(g, p, 'constructionJobMoveUp', [rows[rows.length - 1].id]);
            return issue(g, p, 'constructionJobCancel', [rows[0].id], r);
        },
    },
    // --- Ships & Bases --------------------------------------------------------------------------------------------
    {
        what: 'ships: rename',
        ops: ['renameShip'],
        issue: (g, p, r) => {
            const b = ownShips(p)[0];
            return b === undefined ? false : issue(g, p, 'renameShip', [b, 'Screen Runner'], r);
        },
    },
    {
        what: 'ships: form a fleet',
        ops: ['setShipsFleet'],
        issue: (g, p, r) => {
            const ships = military(p).filter((b) => b.shipGroup === null).slice(0, 3);
            return ships.length === 0 ? false : issue(g, p, 'setShipsFleet', [ships, 'new'], r);
        },
    },
    {
        what: 'ships: retrofit stance + retrofit',
        ops: ['setShipRetrofitStance', 'retrofitShips'],
        issue: (g, p, r) => {
            const ships = military(p).slice(0, 2);
            if (ships.length === 0) return false;
            issue(g, p, 'setShipRetrofitStance', [ships, false]);
            return issue(g, p, 'retrofitShips', [ships, null], r);
        },
    },
    {
        what: 'ships: troop loadout (Troops tab, method_179)',
        ops: ['setShipTroopLoadout'],
        issue: (g, p, r) => {
            const b = ownShips(p).find((s) => s.role !== BuiltObjectRole.Base);
            if (b === undefined) return false;
            // chkUseTroopLoadouts ticked, a spinner step, then unticked (the screen's own builders).
            const on = shipTroopLoadoutOn(b.troopCapacity);
            issue(g, p, 'setShipTroopLoadout', [b, on]);
            const step = shipTroopLoadoutSpin(on, 'infantry', Math.max(0, on.infantry - 1), b.troopCapacity);
            if (step !== null) issue(g, p, 'setShipTroopLoadout', [b, step]);
            return issue(g, p, 'setShipTroopLoadout', [b, null], r);
        },
    },
    {
        what: 'ships: automate (shipAction with an undefined menu point)',
        ops: ['shipAction'],
        issue: (g, p, r) => {
            const b = ownShips(p)[1] ?? ownShips(p)[0];
            return b === undefined ? false : issue(g, p, 'shipAction', [b, ShipAction.forAction(ShipActionType.AutomateShip, b), false, undefined], r);
        },
    },
    // --- Fleets + Fleet Designs -----------------------------------------------------------------------------------
    {
        what: 'fleets: rename, home colony, loadout, repair',
        ops: ['renameFleet', 'setFleetHomeColony', 'setFleetTroopLoadout', 'fleetRepairAndRefuel'],
        issue: (g, p, r) => {
            const sg = fleets(p)[0];
            if (sg === undefined) return false;
            issue(g, p, 'renameFleet', [sg, 'Screen Fleet']);
            issue(g, p, 'setFleetHomeColony', [sg, p.colonies[0]]);
            issue(g, p, 'setFleetTroopLoadout', [sg, { infantry: 60, armored: 20, artillery: 20, specialForces: 0 }]);
            return issue(g, p, 'fleetRepairAndRefuel', [sg], r);
        },
    },
    {
        what: 'fleets: patrol order (ShipAction on a fleet)',
        ops: ['shipAction'],
        issue: (g, p, r) => {
            const sg = fleets(p)[0];
            return sg === undefined ? false : issue(g, p, 'shipAction', [sg, ShipAction.forMission(BuiltObjectMissionType.Patrol, p.colonies[0]), false], r);
        },
    },
    { what: 'fleet designs: create a template', ops: ['fleetTemplateCreate'], issue: (g, p, r) => issue(g, p, 'fleetTemplateCreate', ['Screen Template'], r) },
    {
        what: 'fleet designs: set an entry, build missing',
        ops: ['fleetTemplateSetEntry', 'fleetTemplateBuild'],
        issue: (g, p, r) => {
            const t = fleetDesignBook(p).templates[0];
            const d = firstDesign(p, BuiltObjectSubRole.Escort);
            if (t === undefined || d === null) return false;
            issue(g, p, 'fleetTemplateSetEntry', [t.id, d, 2]);
            return issue(g, p, 'fleetTemplateBuild', [t.id, 'missing', null, p.colonies[0], true], r);
        },
    },
    // --- Research -------------------------------------------------------------------------------------------------
    {
        what: 'research: queue, reorder, dequeue',
        ops: ['queueResearch', 'moveResearch', 'dequeueResearch'],
        issue: (g, p, r) => {
            const nodes = p.research.techTree.filter((n) => !n.isResearched && p.research.canResearchNode(n));
            if (nodes.length < 2) return false;
            issue(g, p, 'queueResearch', [nodes[0]]);
            issue(g, p, 'queueResearch', [nodes[1]]);
            issue(g, p, 'moveResearch', [nodes[1], 0]);
            return issue(g, p, 'dequeueResearch', [nodes[1]], r);
        },
    },
    {
        what: 'research: crash program',
        ops: ['crashResearch'],
        issue: (g, p, r) => {
            const head = p.research.techTree.find((n) => !n.isResearched && p.research.canResearchNode(n));
            return head === undefined ? false : issue(g, p, 'crashResearch', [head, calculateCrashResearchProgramCost(p, head)], r);
        },
    },
    // --- Empire Policy / Game Options -----------------------------------------------------------------------------
    {
        what: 'empire policy: panel apply (automation combos as setEmpireControl, then setPolicy by value)',
        ops: ['setEmpireControl', 'setPolicy'],
        issue: (g, p, r) => {
            const ctx = { facilities: planetaryFacilityDefinitionsStatic(g) };
            const controls = panelControls(buildPolicyPanel(p, p.policy ?? defaultEmpirePolicy(), ctx));
            (controls.get('AutomationResearch') as ComboControl).index = 0;
            (controls.get('TradePriority') as ComboControl).index = 3;
            const changes: PolicyAutomationChange[] = [];
            const before = p.controlResearch;
            const policy = applyPolicyPanel(p, p.pirateEmpireBaseHabitat !== null, controls, ctx, (field, value) => {
                const c = policyAutomationChange(p, field, value);
                if (c !== null) changes.push(c);
            });
            // The screen's apply never writes the empire itself.
            if (p.controlResearch !== before) throw new Error('applyPolicyPanel wrote the empire');
            for (const c of changes) issue(g, p, 'setEmpireControl', [c.field, c.value]);
            return issue(g, p, 'setPolicy', [policy], r);
        },
    },
    // --- Expansion Planner ----------------------------------------------------------------------------------------
    {
        what: 'expansion planner: send a ship to a target',
        ops: ['shipAction'],
        issue: (g, p, r) => {
            const t = expansionTargets('resourcesgalaxy', g, p, { includeLowQuality: true, includeAsteroids: true })[1];
            const ship = plannerAvailableShips(g, p, 'resourcesgalaxy', null)[0] ?? ownShips(p).find((b) => b.subRole === BuiltObjectSubRole.ConstructionShip);
            const d = firstDesign(p, BuiltObjectSubRole.MiningStation);
            if (t === undefined || ship === undefined || d === null) return false;
            return issue(g, p, 'shipAction', [ship, ShipAction.forMissionAt(BuiltObjectMissionType.Build, t.habitat, { x: 0, y: 0 }, d), false], r);
        },
    },
    // --- Empire Summary -------------------------------------------------------------------------------------------
    { what: 'empire summary: rename', ops: ['empireRename'], issue: (g, p, r) => issue(g, p, 'empireRename', ['Screen Empire'], r) },
];

/** The script: one order every few ticks. */
export function screenOrders(): ScreenOrder[] {
    return ORDERS.map((o, i) => ({ ...o, tick: 5 + i * 6 }));
}

/**
 * Run the screens' read paths on (`g`, `p`) — the models the screens render from and the sim queries they call — for
 * every colony / target / tech; returns what ran.
 */
export function screenReads(g: Galaxy, p: Empire): string[] {
    const ran: string[] = [];
    const run = (what: string, f: () => unknown): void => {
        f();
        ran.push(what);
    };
    for (const h of p.colonies) {
        if (h == null) continue;
        run(`colony row ${h.name}`, () => colonyGridRow(g, h));
        run(`colony attitude ${h.name}`, () => colonyAttitudeSummary(g, h));
        run(`recruit options ${h.name}`, () => recruitOptions(g, p, h));
        run(`buildable facilities ${h.name}`, () => resolveBuildableFacilities(g, h));
        run(`charter button ${h.name}`, () => charterButtonState(g, p, h));
    }
    // Ships and Bases / Construction Yards data tabs (builtObjectDataTabs.ts).
    run('set fleet items', () => setFleetItems(p));
    for (const b of ownShips(p).slice(0, 40)) {
        run(`ship tabs ${b.name}`, () => {
            builtObjectTroopIconItems(b);
            shipTroopLoadoutView(b, shipTroopLoadout(b));
            constructionResourceShortageText(g, b);
            const mq = siteManufacturingQueue(b, p);
            manufacturerRows(mq?.manufacturers ?? null, () => null);
            componentWaitRows(mq?.componentWaitQueue ?? null);
            builtObjectTabLabels(b);
        });
    }
    for (const h of p.colonies) if (h != null) run(`colony troop icons ${h.name}`, () => builtObjectTroopIconItems(h));
    run('troop rows', () => troopRows(troopsOf(p)));
    run('troop filters', () => troopFilterOptions(p));
    run('troop maintenance', () => troopListAnnualMaintenance(troopsOf(p), p));
    run('build order rows', () => buildOrderRows(p, g, new Map(), buildOrderAdvisorTargets(g, p)));
    run('money panel', () => moneyPanelIncome(g, p));
    run('build queue rows', () => buildQueueRows(g, p));
    run('fleet orders', () => fleetOrderRows(p));
    run('construction jobs', () => constructionJobRows(g, p));
    run('fleet template groups', () => fleetTemplateDesignGroups(p));
    run('economy breakdown', () => computeEconomyBreakdown(g, p));
    run('summary extra', () => empireSummaryExtra(p));
    run('mod-layer summary', () => modLayerSummaryRows(g, p));
    run('charters', () => charterRows(g, p));
    for (const mode of ['colonies', 'resourcesyou', 'resourcesgalaxy', 'resourcessupply'] as const) {
        run(`expansion ${mode}`, () => {
            const targets = expansionTargets(mode, g, p, { includeLowQuality: true, includeAsteroids: true });
            for (const t of targets.slice(0, 40)) {
                expansionRow(g, p, t, mode === 'colonies');
                plannerStatus(plannerStatusInput(g, p, t.habitat, mode === 'colonies'));
                plannerAvailableShips(g, p, mode, t.habitat);
            }
        });
    }
    run('deficient resources', () => deficientResourceRows(g, p));
    for (const n of p.research.techTree.slice(0, 200)) run(`tech ${n.def.name}`, () => [resolveNodeDescription(g, p.research, n), generateBenefitDetail(g, p, p.research, n)]);
    void defaultEmpirePolicy;
    return ran;
}
