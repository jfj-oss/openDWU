// Add-on activity counter for scripts/soak-exp.mjs (exp-soak measurement only; not committed).
// Wraps the empire-message tap: every EmpireMessage sent through sendEmpireMessage (game messages, scenario messages,
// NewsNet broadcasts) is counted by type and by title key, then passed on to the event log's own tap unchanged, so the
// simulation is untouched. Writes report.activity into the run's JSON (and <out>/activity.json after each chunk).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outArg = process.argv.indexOf('--out');
const outDir = outArg >= 0 ? resolve(process.argv[outArg + 1]) : null;
const YEAR_MS = 600_000; // galaxy time: 360 days of 1667 ms per game year (soak.mjs: YEAR_S 600)

const activity = { total: 0, byType: {}, byKey: {}, byYear: {}, yearsSeen: 0 };

function bump(map, key) { map[key] = (map[key] ?? 0) + 1; }

export function start(ctx) {
    const messages = ctx.load('messages');
    const eventLog = ctx.load('eventLog');
    return Promise.all([messages, eventLog]).then(([msgs, log]) => {
        const typeNames = msgs.EmpireMessageType;
        msgs.setEmpireMessageTap((m, recipient) => {
            activity.total++;
            bump(activity.byType, typeNames[m.messageType] ?? String(m.messageType));
            const raw = (m.title && m.title !== '' ? m.title : m.description) || '';
            bump(activity.byKey, raw.split('|')[0].slice(0, 80));
            bump(activity.byYear, String(Math.floor(ctx.g.nowMs / YEAR_MS)));
            log.tapEmpireMessage(m, recipient);
        });
        ctx.report.activity = activity;
    });
}

export function chunk(ctx) {
    ctx.report.activity = activity;
    activity.yearsSeen = Math.floor(ctx.g.nowMs / YEAR_MS);
    if (outDir) writeFileSync(resolve(outDir, 'activity.json'), JSON.stringify(activity, null, 1));
}
