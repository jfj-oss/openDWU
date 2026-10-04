// Battle reports — the UI half of an Improvement inspired by Distant Worlds 2 (NOT in DW:U). The sim records the reports
// (sim/battleReports/battleReports.ts, a side table: the game itself in-thread, the replica's copy in worker mode); this
// module only reads them:
// - registers the "Battle reports" improvement (Game Options → Improvements, ui/improvements.ts; default on);
// - a 1 s poll of the report serial (one number compare while nothing new): each new report becomes a ticker line and a
//   message stub "Battle report: <system>" that open the report window (screens/battleReport.ts). Skirmishes do not
//   notify. Reports that existed when the game view started (a loaded game) are not announced again.
// Switched off: no notification and no Battle Reports tab; the sim keeps recording (deterministic, outside the digest,
// a scan a game second), so switching it back on shows the reports of the fights in between.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { battleReportState, type BattleReport } from '../sim/battleReports/battleReports';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { isImprovementEnabled, registerImprovement } from './improvements';
import { pushHudMessage, rgbCss } from './hud';
import { pushBattleReportStub } from './messageStubList';
import { closeBattleReport, openBattleReport, setBattleReportGoTo } from './screens/battleReport';
import { battleListTitle, battleReportTitle, RESULT_LABELS } from './screens/battleReportModel';

export const BATTLE_REPORTS_IMPROVEMENT = 'battleReports';

registerImprovement({
    id: BATTLE_REPORTS_IMPROVEMENT,
    label: 'Battle reports',
    description: 'After a fight involving your forces: a summary of the sides, forces, losses and result (Galactic History → Battle Reports).',
    default: true,
});

export function battleReportsOn(): boolean {
    return isImprovementEnabled(BATTLE_REPORTS_IMPROVEMENT);
}

/** The reports a notifier has not announced yet (non-skirmish, id above `seenId`), oldest first. */
export function unseenReports(galaxy: Galaxy, seenId: number): BattleReport[] {
    const st = battleReportState(galaxy);
    if (st === undefined) return [];
    return st.reports.filter((r) => r.id > seenId).sort((a, b) => a.id - b.id);
}

/** The highest report id so far (skirmishes included: their ids are never announced). */
export function latestReportId(galaxy: Galaxy): number {
    const st = battleReportState(galaxy);
    if (st === undefined) return 0;
    let n = 0;
    for (const r of st.reports) n = Math.max(n, r.id);
    for (const r of st.skirmishes) n = Math.max(n, r.id);
    return n;
}

export interface BattleReportNotifierOptions {
    galaxy: Galaxy;
    player: Empire;
    goTo: (x: number, y: number) => void;
}

let installed: { timer: ReturnType<typeof setInterval> } | null = null;

/** Announce one report: the ticker line and the stub (both open the window). */
export function announceBattleReport(galaxy: Galaxy, r: BattleReport): void {
    void galaxy;
    const open = (): boolean => {
        openBattleReport(r);
        return true;
    };
    const line = `${battleReportTitle(r)} — ${RESULT_LABELS[r.result]}`;
    pushHudMessage(line, resolveStarDateDescription(r.endStarDate), open);
    const enemy = r.sides.find((s) => s.camp === 'enemy') ?? null;
    pushBattleReportStub({ battleReport: r.id }, battleReportTitle(r), battleListTitle(r), r.endStarDate, enemy !== null ? rgbCss(enemy.color) : null, () => void open());
}

/** Start the poll for the game view (main.ts); replaces a previous one. */
export function installBattleReportNotifier(opts: BattleReportNotifierOptions): void {
    removeBattleReportNotifier();
    setBattleReportGoTo(opts.goTo);
    let seen = latestReportId(opts.galaxy);
    let serial = battleReportState(opts.galaxy)?.serial ?? 0;
    const timer = setInterval(() => {
        const st = battleReportState(opts.galaxy);
        if (st === undefined || st.serial === serial) return;
        serial = st.serial;
        const fresh = unseenReports(opts.galaxy, seen);
        seen = Math.max(seen, latestReportId(opts.galaxy));
        if (!battleReportsOn()) return;
        for (const r of fresh) announceBattleReport(opts.galaxy, r);
    }, 1000);
    installed = { timer };
}

export function removeBattleReportNotifier(): void {
    if (installed !== null) clearInterval(installed.timer);
    installed = null;
    setBattleReportGoTo(null);
    closeBattleReport();
}
