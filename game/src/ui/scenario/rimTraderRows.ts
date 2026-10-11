// Scenario 19a "rim trader" (tasks/19a-rim-trader.md §8): pure rows for the diplomacy screen's "Trade terms" block, the
// empires-list tag and the habitat resource marker. Not a port (scenario UI). Texts from the scenario GameText.
import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import { scenarioFlag, scenarioText } from '../../sim/scenario';
import { DiplomaticRelationType } from '../../sim/diplomacy';
import type { BuiltObject } from '../../sim/builtObject';
import { portRimUnits, treasureState } from '../../sim/scenario/rimTrade/treasureFleet';
import { RIM_MIN_RADIUS, rareGoodIds, rimGoodIds, rimParam, rimTraderEmpire, rimTraderPort, rimTraderStanding } from '../../sim/scenario/rimTrade/common';

export interface RimGoodRow {
    resourceId: number;
    name: string;
    /** Resource PictureRef (the stock resource icon index). */
    pictureRef: number;
    /** The stock resource icon (as hud.ts resourceIconUrl). */
    iconUrl: string;
}

export interface RimTraderTermsRows {
    title: string;
    trader: string;
    port: string;
    wanted: RimGoodRow[];
    offered: RimGoodRow[];
    /** credit × rate − debit. */
    standing: number;
    threshold: number;
    open: boolean;
    met: boolean;
    lines: { label: string; value: string }[];
    where: string;
    noWar: string;
    treaties: string;
    /** The treasure-fleet stop the player can request: its space port holding the most rim goods (null: none). */
    treasureStop: { port: BuiltObject; label: string; requested: boolean } | null;
}

function goodRows(galaxy: Galaxy, ids: number[]): RimGoodRow[] {
    return ids.map((id) => {
        const r = galaxy.resourceSystem.byId.get(id);
        const pictureRef = r?.pictureRef ?? -1;
        return { resourceId: id, name: r?.name ?? String(id), pictureRef, iconUrl: `/assets/dwu/images/ui/resources/Resource_${pictureRef}.bmp` };
    });
}

/**
 * What obtainDiplomaticRelation(self, empire) would answer, without its write (docs/sim-worker.md §9 chunk 7): the
 * relation self holds, else the fresh NotMet one Obtain would add (no supply of restricted resources); the stand-in
 * None relation Obtain builds without storing it (no / independent / pirate / own empire; it supplies them). A row is a read: it must
 * not add records to the graph (in-thread they would never be journaled; on a sim-worker replica the worker never sees
 * them).
 */
export function peekDiplomaticRelation(self: Empire, empire: Empire | null): { type: DiplomaticRelationType; supplyRestrictedResources: boolean } {
    const none = { type: DiplomaticRelationType.None, supplyRestrictedResources: true };
    if (empire == null || empire === self.galaxy.independentEmpire || empire.pirateEmpireBaseHabitat !== null || self.pirateEmpireBaseHabitat !== null || empire === self) return none;
    if (self.diplomaticRelations == null) return none;
    return self.diplomaticRelations.byEmpire(empire) ?? { type: DiplomaticRelationType.NotMet, supplyRestrictedResources: false };
}

/** True when `empire` is the Concord and the scenario's rim-trader rules are on. */
export function isRimTraderShown(galaxy: Galaxy, empire: Empire | null): boolean {
    return empire !== null && scenarioFlag(galaxy, 'rimTrader') && empire === rimTraderEmpire(galaxy);
}

/** The trade terms the Concord offers `viewer` (null when the rim trader is not in play or `viewer` is the Concord). */
export function rimTraderTermsRows(galaxy: Galaxy, viewer: Empire): RimTraderTermsRows | null {
    if (!scenarioFlag(galaxy, 'rimTrader')) return null;
    const r = rimTraderEmpire(galaxy);
    if (r === null || viewer === r) return null;
    const rel = peekDiplomaticRelation(r, viewer);
    const standing = Math.round(rimTraderStanding(galaxy, viewer.empireId));
    const threshold = rimParam(galaxy, 'rimTraderGrantThreshold');
    const open = rel.supplyRestrictedResources;
    const port = rimTraderPort(galaxy);
    const wanted = goodRows(galaxy, rimGoodIds(galaxy));
    const offered = goodRows(galaxy, rareGoodIds(galaxy));
    return {
        title: scenarioText('Scenario RimTrade Trade Terms'),
        trader: r.name,
        port: port?.name ?? '',
        wanted,
        offered,
        standing,
        threshold,
        open,
        met: rel.type !== DiplomaticRelationType.NotMet,
        lines: [
            { label: scenarioText('Scenario RimTrade Wanted'), value: wanted.map((w) => w.name).join(', ') },
            { label: scenarioText('Scenario RimTrade Offered'), value: offered.map((w) => w.name).join(', ') },
            { label: scenarioText('Scenario RimTrade Port'), value: port?.name ?? '' },
            { label: scenarioText('Scenario RimTrade Standing', r.name, standing, threshold).replace(/:.*$/, ''), value: `${standing.toLocaleString('en-US')} / ${threshold.toLocaleString('en-US')}` },
            { label: scenarioText('Scenario RimTrade Access'), value: open ? scenarioText('Scenario RimTrade Access Open') : scenarioText('Scenario RimTrade Access Shut') },
        ],
        where: scenarioText('Scenario RimTrade Where', Math.round(RIM_MIN_RADIUS * 100)),
        noWar: scenarioText('Scenario RimTrade No War', r.name),
        treaties: scenarioText('Scenario RimTrade Treaty Refused', r.name),
        treasureStop: treasureStopRow(galaxy, viewer),
    };
}

/** The empires-list tag for the Concord row ('' for every other empire). */
export function rimTraderTag(galaxy: Galaxy, empire: Empire | null): string {
    return isRimTraderShown(galaxy, empire) ? scenarioText('Scenario RimTrade Tag') : '';
}

/** Habitat resource rows: the "(rim good)" marker for rim goods while the rim trader is in play ('' otherwise). */
export function rimGoodMarker(galaxy: Galaxy, resourceId: number): string {
    if (!scenarioFlag(galaxy, 'rimTrader') || rimTraderEmpire(galaxy) === null) return '';
    return rimGoodIds(galaxy).includes(resourceId) ? scenarioText('Scenario RimTrade Rim Good') : '';
}

/** The player's request row: its space port holding the most rim goods, and whether a stop there is already asked. Pure. */
export function treasureStopRow(galaxy: Galaxy, viewer: Empire): { port: BuiltObject; label: string; requested: boolean } | null {
    if (galaxy.scenario === null || !('rimTreasure' in galaxy.scenario.state)) return null;
    let best: BuiltObject | null = null;
    let units = -1;
    for (const p of viewer.spacePorts ?? []) {
        if (p === null || p.hasBeenDestroyed || !p.isSpacePort) continue;
        const u = portRimUnits(galaxy, p, viewer);
        if (u > units || (u === units && best !== null && p.builtObjectID < best.builtObjectID)) {
            best = p;
            units = u;
        }
    }
    if (best === null) return null;
    const req = (treasureState(galaxy).requests ?? []).find((q) => q.empireId === viewer.empireId);
    const requested = req !== undefined && req.port === best;
    return { port: best, label: scenarioText(requested ? 'Scenario RimTrade Stop Requested' : 'Scenario RimTrade Request Stop', best.name, String(Math.round(units))), requested };
}
