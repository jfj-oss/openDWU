// Scenario messages and news (tasks/MODLAYER-DESIGN.md §4). Not a port: thin wrappers over the ported message path
// (messages.ts sendEmpireMessage), so scenario texts reach the ticker / message history like the game's own. No Rnd.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { EmpireMessage, EmpireMessageType, sendEmpireMessage } from '../messages';
import { galaxyStarDate } from '../tick/simTime';
import { tryGetText } from '../textResolver';
import { gameText } from '../colonyTick';

export interface ScenarioMessageOptions {
    /** Message type (default GeneralNeutralEvent; GeneralGoodEvent / GeneralBadEvent / GeneralWarning colour the ticker). */
    type?: EmpireMessageType;
    /** Subject (a Habitat / BuiltObject / Empire / point) — the UI's "go to" target. */
    subject?: unknown;
    /** Sender (default null: the galaxy). */
    sender?: Empire | null;
}

/**
 * Scenario text: a GameText tag (the scenario's GameText.txt additions) if one exists, else the literal. `{n}` items are
 * filled from `args` (.NET string.Format style).
 */
export function scenarioText(tag: string, ...args: unknown[]): string {
    const template = tryGetText(tag) ?? tag;
    return template.replace(/\{(\d+)\}/g, (m, i: string) => (Number(i) < args.length ? String(args[Number(i)]) : m));
}

/** Sends one message to `recipient`. */
export function scenarioMessage(galaxy: Galaxy, recipient: Empire, title: string, description: string, opts: ScenarioMessageOptions = {}): EmpireMessage {
    const m = new EmpireMessage(opts.sender ?? null, opts.type ?? EmpireMessageType.GeneralNeutralEvent, opts.subject ?? null);
    m.title = title;
    m.description = description;
    m.starDate = galaxyStarDate(galaxy);
    sendEmpireMessage(m, recipient);
    return m;
}

/**
 * A Galactic NewsNet broadcast: one GalacticNewsNet message to every active empire and pirate faction that passes
 * `filter` (default: all). `source` names the reporting empire in the title, like SendNewsBroadcastCore ("NewsNet: X").
 * Returns the recipients.
 */
export function scenarioNews(galaxy: Galaxy, source: Empire | null, description: string, filter: (e: Empire) => boolean = () => true, subject: unknown = null): Empire[] {
    // As SendNewsBroadcastCore (events.ts): gameText('Galactic NewsNet').ToUpper().
    const newsNet = gameText('Galactic NewsNet').toUpperCase();
    const title = source !== null ? `${newsNet}: ${source.name}` : newsNet;
    const sent: Empire[] = [];
    for (const e of [...galaxy.empires, ...galaxy.pirateEmpires]) {
        if (e === null || !e.active || !filter(e)) continue;
        const m = new EmpireMessage(source, EmpireMessageType.GalacticNewsNet, subject);
        m.title = title;
        m.description = source !== null ? `${title} - ${description}` : `${newsNet}: ${description}`;
        m.starDate = galaxyStarDate(galaxy);
        sendEmpireMessage(m, e);
        sent.push(e);
    }
    return sent;
}
