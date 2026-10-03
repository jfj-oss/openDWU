// Colony row helpers shared by the Colonies screen (coloniesScreen.ts), the Empire Summary, the Expansion Planner
// and the Troops screen: the approval mood thresholds (ItemListPanel.cs 895-898), the "0,K" money format, the
// per-colony sim metrics and the mod layer's scenario extras (19d2 shortage marker, approval breakdown).
// The Colonies window itself is coloniesScreen.ts (a port of the original pnlColonyInfo); `colonyRows` is the
// compact population-ordered row model kept for the scenario tests.

import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Habitat } from '../../sim/types';
import { habitatDevelopmentLevel } from '../../sim/developmentLevel';
import { empireApprovalRating } from '../../sim/taxes';
import { habitatAnnualRevenue } from '../../sim/forceStructure';
import { formatPopulation } from '../hud';
import { colonyShortageMarker, crisesApprovalBreakdown } from '../../sim/scenario/emergent/crisesCore';
import { colonyLedgerLines } from '../internalSecurityView'; // [security]

/** One displayed row of the panel. Pure so the row logic is testable without
 * a DOM (jsdom is not configured). */
export interface ColonyRow {
    habitat: Habitat;
    name: string;
    /** Population formatted via hud.formatPopulation ('1.2B' / '350M' / ...). */
    population: string;
    isCapital: boolean;
    /** DevelopmentLevel as '${Math.trunc(d)}%' (ItemListPanel.cs 897), or '—'. */
    development: string;
    /** Approval-mood icon (happy/neutral/sad/angry, ItemListPanel.cs 895-898); null = no icon. */
    approval: ApprovalMood | null;
    /** GDP (Habitat.AnnualRevenue) via formatThousandsK, or '—'. */
    gdp: string;
    tax: string;
    troops: string;
    /** Mod layer (19d2): the shortage marker's tooltip (lost luxuries / open crisis), or null (no marker). */
    shortage: string | null;
    /** Mod layer: scenario approval terms as tooltip lines ('Shortages -6.0'), or null. */
    approvalBreakdown: string | null;
}

/** Scenario extras for one colony row (19d2 shortage marker + approval breakdown). */
export interface ColonyScenarioInfo {
    shortage: string | null;
    approvalBreakdown: { label: string; value: number }[];
}

/** The scenario extras of a colony, or null with no scenario. Pure. */
export function colonyScenarioInfo(galaxy: Galaxy, h: Habitat): ColonyScenarioInfo | null {
    if (galaxy.scenario === null) return null;
    // 19m: with internal security on, the tooltip lists every stability-ledger cause.
    return { shortage: colonyShortageMarker(galaxy, h), approvalBreakdown: colonyLedgerLines(galaxy, h) ?? crisesApprovalBreakdown(galaxy, h) };
}

/** The four approval icons drawn by ItemListPanel.cs 895-898
 * (Main.Part12.cs 621-625: images/ui/chrome/happy|neutral|sad|angry.png). */
export type ApprovalMood = 'happy' | 'neutral' | 'sad' | 'angry';

/** Port of the ItemListPanel.cs 895-898 thresholds: > 15 happy, > 0 neutral,
 * > -15 sad, else angry. */
export function approvalMood(rating: number): ApprovalMood {
    if (rating > 15.0) return 'happy';
    if (rating > 0.0) return 'neutral';
    if (!(rating > -15.0)) return 'angry';
    return 'sad';
}

/** C# .ToString("0,K"): divide by 1000, round, append a literal 'K'
 * (1234567 -> '1235K', 0 -> '0K'). */
export function formatThousandsK(v: number): string {
    return `${Math.round(v / 1000)}K`;
}

/** Per-colony metrics read from the sim (task 13b). */
export interface ColonyMetrics {
    development: number;
    approval: number;
    revenue: number;
}

/** Impure wrapper around the three sim getters for one colony:
 * DevelopmentLevel (developmentLevel.ts), EmpireApprovalRating (taxes.ts) and
 * AnnualRevenue (forceStructure.ts). Some sim paths still throw TODO(port),
 * so any exception — or a non-finite value — yields null. */
export function colonyMetrics(galaxy: Galaxy, h: Habitat): ColonyMetrics | null {
    try {
        const development = habitatDevelopmentLevel(h);
        const approval = empireApprovalRating(galaxy, h);
        const revenue = habitatAnnualRevenue(galaxy, h);
        if (!Number.isFinite(development) || !Number.isFinite(approval) || !Number.isFinite(revenue)) {
            return null;
        }
        return { development, approval, revenue };
    } catch {
        return null;
    }
}

/** Rows for the panel: the empire's colonies sorted by population descending
 * (a missing population counts as 0), ties broken by name. With a `metrics`
 * callback the development/approval/GDP columns are filled in; without it
 * they show '—' / null. */
export function colonyRows(
    empire: Empire,
    metrics?: (h: Habitat) => ColonyMetrics | null,
    scenario?: (h: Habitat) => ColonyScenarioInfo | null,
): ColonyRow[] {
    return [...empire.colonies]
        .sort((a, b) => {
            const pa = a.population?.totalAmount ?? 0;
            const pb = b.population?.totalAmount ?? 0;
            if (pa !== pb) return pb - pa;
            return a.name.localeCompare(b.name);
        })
        .map((h) => {
            const m = metrics ? metrics(h) : null;
            const s = scenario ? scenario(h) : null;
            return {
                habitat: h,
                name: h.name,
                population: formatPopulation(h.population?.totalAmount ?? 0),
                isCapital: empire.capital === h,
                development: m ? `${Math.trunc(m.development)}%` : '—',
                approval: m ? approvalMood(m.approval) : null,
                gdp: m ? formatThousandsK(m.revenue) : '—',
                tax: `${Math.round((h.taxRate ?? 0) * 100)}%`,
                troops: String(h.troops?.count ?? 0),
                shortage: s?.shortage ?? null,
                approvalBreakdown: s !== null && s.approvalBreakdown.length > 0 ? s.approvalBreakdown.map((l) => `${l.label} ${l.value.toFixed(1)}`).join('\n') : null,
            };
        });
}
