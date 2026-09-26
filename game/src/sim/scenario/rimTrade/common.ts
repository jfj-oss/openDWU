// Scenario package 19a "rim trader" — shared lookups and the AI rules the base sim calls behind `scenarioFlag(galaxy,
// 'rimTrader')` (tasks/19a-rim-trader.md §4). Not a port. Nothing here draws galaxy.rnd. 19c (chartered companies)
// shares the rimTrade scenario folder and reuses these lookups.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { determineSpacePortAtHabitat } from '../../logistics/colonySupply';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { EmpireMessageType } from '../../messages';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';

export const RIM_RACE = 'Oranthi';
export const RIM_GOODS = ['Voidstone', 'Rimfrost Lichen', 'Umbral Gas'] as const;
export const RARE_GOODS = ['Oranthi Porcelain', 'Moonsilk', 'Starleaf Tea'] as const;
/** The manifest's resourcePlacement inner radius for rim goods (UI hint). */
export const RIM_MIN_RADIUS = 0.72;

/** Manifest defaults (scenario.json) — the fallbacks of scenarioParam. */
export const RIM_PARAM_DEFAULTS = {
    rimTraderMaxColonies: 4,
    rimTraderExchangeRate: 1.0,
    rimTraderGrantThreshold: 1500,
    rimTraderImportQuota: 400,
    rimTraderConsumption: 200,
    rimTraderLedgerDecay: 0.5,
    rimTraderStartStock: 300,
} as const;

export function rimParam(galaxy: Galaxy, name: keyof typeof RIM_PARAM_DEFAULTS): number {
    return scenarioParam(galaxy, name, RIM_PARAM_DEFAULTS[name]);
}

/** One partner's ledger row: value of rim goods it sold the Concord, value of rare goods it bought. */
export interface RimLedgerEntry {
    credit: number;
    debit: number;
}

/** Saved state (`scenarioState(galaxy, 'rimTrade')`): plain data and graph references only. */
export interface RimTradeState {
    /** The Concord's empireId (-1 = none: scenario inert). */
    empireId: number;
    capital: Habitat | null;
    /** By partner empireId. */
    ledger: Record<number, RimLedgerEntry>;
    /** Empires sent the terms message. */
    informed: number[];
    /** Empires that ever got access (NewsNet sent once each). */
    metIds: number[];
    /** Run statistics (contracts seen by the listener). */
    stats: { rimBuys: number; rimUnits: number; rimValue: number; rareSales: number; rareUnits: number; rareValue: number };
}

export function rimTradeState(galaxy: Galaxy): RimTradeState {
    return scenarioState<RimTradeState>(galaxy, 'rimTrade', () => ({
        empireId: -1,
        capital: null,
        ledger: {},
        informed: [],
        metIds: [],
        stats: { rimBuys: 0, rimUnits: 0, rimValue: 0, rareSales: 0, rareUnits: 0, rareValue: 0 },
    }));
}

const idCache = new WeakMap<Galaxy, { rim: number[]; rare: number[] }>();

function resolveIds(galaxy: Galaxy): { rim: number[]; rare: number[] } {
    let c = idCache.get(galaxy);
    if (c === undefined) {
        const byName = (n: string): number => galaxy.resourceSystem.resources.find((r) => r.name === n)?.resourceId ?? -1;
        c = { rim: RIM_GOODS.map(byName).filter((i) => i >= 0), rare: RARE_GOODS.map(byName).filter((i) => i >= 0) };
        idCache.set(galaxy, c);
    }
    return c;
}

/** Resource ids of the rim goods present in this galaxy's data. */
export function rimGoodIds(galaxy: Galaxy): number[] {
    return resolveIds(galaxy).rim;
}

/** Resource ids of the Concord's rare goods present in this galaxy's data. */
export function rareGoodIds(galaxy: Galaxy): number[] {
    return resolveIds(galaxy).rare;
}

export function resourceName(galaxy: Galaxy, id: number): string {
    return galaxy.resourceSystem.byId.get(id)?.name ?? String(id);
}

/** The Concord (null with no rimTrade state, an eliminated Concord, or none placed). */
export function rimTraderEmpire(galaxy: Galaxy): Empire | null {
    if (galaxy.scenario === null || !('rimTrade' in galaxy.scenario.state)) return null;
    const id = rimTradeState(galaxy).empireId;
    if (id < 0) return null;
    const e = galaxy.empires.find((x) => x !== null && x.empireId === id) ?? null;
    return e !== null && e.active ? e : null;
}

/** The Concord when the AI runs it (a player who picks the Oranthi plays them normally: rules R1–R7 are AI rules). */
export function isRimTraderAI(galaxy: Galaxy, e: Empire | null): boolean {
    return e !== null && e === rimTraderEmpire(galaxy) && e !== galaxy.playerEmpire;
}

/** The Concord's single trading port: the space port at its capital, else the capital habitat (step 5). */
export function rimTraderPort(galaxy: Galaxy): BuiltObject | Habitat | null {
    const r = rimTraderEmpire(galaxy);
    const capital = r?.capital ?? (galaxy.scenario !== null && 'rimTrade' in galaxy.scenario.state ? rimTradeState(galaxy).capital : null);
    if (capital === null) return null;
    const port = determineSpacePortAtHabitat(capital);
    return port !== null && port.isSpacePort ? port : capital;
}

/** Standing S(p) = credit × exchange rate − debit (step 6). */
export function rimTraderStanding(galaxy: Galaxy, empireId: number): number {
    const row = rimTradeState(galaxy).ledger[empireId];
    if (row === undefined) return 0;
    return row.credit * rimParam(galaxy, 'rimTraderExchangeRate') - row.debit;
}

/** R3 (step 7): the Concord's restricted-trade decision toward `other` (replaces the stock strategy test). */
export function rimTraderAllowsRestrictedTrade(galaxy: Galaxy, r: Empire, other: Empire | null): boolean {
    if (other === null || other === r || other === galaxy.independentEmpire || other.pirateEmpireBaseHabitat !== null) return false;
    const rel = obtainDiplomaticRelation(r, other);
    if (rel.type === DiplomaticRelationType.NotMet || rel.type === DiplomaticRelationType.War || rel.type === DiplomaticRelationType.TradeSanctions) return false;
    const s = rimTraderStanding(galaxy, other.empireId);
    return rel.supplyRestrictedResources ? s >= 0 : s >= rimParam(galaxy, 'rimTraderGrantThreshold');
}

/** R3 messages: called by reviewRestrictedResourceTrading right after the Concord flips access for `other`. */
export function rimTraderAccessChanged(galaxy: Galaxy, r: Empire, other: Empire | null, open: boolean): void {
    if (other === null) return;
    const port = rimTraderPort(galaxy);
    const portName = port !== null ? port.name : '';
    if (open) {
        const rare = rareGoodIds(galaxy).map((id) => resourceName(galaxy, id)).join(', ');
        scenarioMessage(galaxy, other, scenarioText('Scenario RimTrade Terms Title'), scenarioText('Scenario RimTrade Access Opened', r.name, portName, rare), { type: EmpireMessageType.GeneralGoodEvent, sender: r, subject: port });
        const st = rimTradeState(galaxy);
        if (!st.metIds.includes(other.empireId)) {
            st.metIds.push(other.empireId);
            scenarioNews(galaxy, r, scenarioText('Scenario RimTrade News Opened', r.name, portName, other.name), undefined, port);
        }
    } else {
        const rim = rimGoodIds(galaxy).map((id) => resourceName(galaxy, id)).join(', ');
        scenarioMessage(galaxy, other, scenarioText('Scenario RimTrade Terms Title'), scenarioText('Scenario RimTrade Access Closed', r.name, rim), { type: EmpireMessageType.GeneralBadEvent, sender: r, subject: port });
    }
}

/** R1 (step 9): the Concord AI never declares war. 19c extends this. */
export function scenarioWarBlocked(galaxy: Galaxy, self: Empire, target: Empire | null): boolean {
    void target;
    return scenarioFlag(galaxy, 'rimTrader') && isRimTraderAI(galaxy, self);
}

/** R2 (step 8): the Concord AI stops colonizing at the cap. */
export function rimTraderColonyCapReached(galaxy: Galaxy, empire: Empire): boolean {
    return isRimTraderAI(galaxy, empire) && empire.colonies.length >= rimParam(galaxy, 'rimTraderMaxColonies');
}

/** R7 (step 10): treaty types the Concord refuses. */
export function rimTraderRefusesTreatyType(type: DiplomaticRelationType): boolean {
    return type === DiplomaticRelationType.MutualDefensePact || type === DiplomaticRelationType.Protectorate || type === DiplomaticRelationType.SubjugatedDominion;
}

/**
 * R7 (b): an AI proposal to the Concord of MDP / Protectorate / Subjugation is refused (the caller removes it the stock
 * way); the proposer gets the refusal text. True when refused.
 */
export function rimTraderRefusesProposal(galaxy: Galaxy, self: Empire, proposer: Empire, type: DiplomaticRelationType): boolean {
    if (!isRimTraderAI(galaxy, self) || !rimTraderRefusesTreatyType(type)) return false;
    scenarioMessage(galaxy, proposer, scenarioText('Scenario RimTrade Terms Title'), scenarioText('Scenario RimTrade Treaty Refused', self.name), { type: EmpireMessageType.GeneralNeutralEvent, sender: self });
    return true;
}

/** R6 (step 11): with the single-port flag, the only Concord object foreign traders may use (undefined = no rule). */
export function rimTraderOnlyTradingPost(galaxy: Galaxy, other: Empire): BuiltObject | Habitat | null | undefined {
    if (!scenarioFlag(galaxy, 'rimTraderSinglePort') || !scenarioFlag(galaxy, 'rimTrader') || other !== rimTraderEmpire(galaxy)) return undefined;
    return rimTraderPort(galaxy);
}

/**
 * R4 (step 12c): the Concord's rim-good import orders at its port are filled only by empires that can earn standing —
 * not by the Concord itself (its own rim mining stations are nearer than any foreign post, so it would buy from itself
 * and never trade), not by independents or pirates.
 */
export function rimTraderImportBlocked(galaxy: Galaxy, order: { requestingBuiltObject: BuiltObject | null; requestingColony: Habitat | null; commodityResource: { resourceId: number } | null }, seller: Empire | null): boolean {
    if (!scenarioFlag(galaxy, 'rimTrader') || order.commodityResource === null) return false;
    const r = rimTraderEmpire(galaxy);
    if (r === null || !rimGoodIds(galaxy).includes(order.commodityResource.resourceId)) return false;
    const port = rimTraderPort(galaxy);
    if (port === null || (order.requestingBuiltObject !== port && order.requestingColony !== port)) return false;
    return seller === null || seller === r || seller === galaxy.independentEmpire || seller.pirateEmpireBaseHabitat !== null;
}
