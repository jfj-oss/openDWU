// @slow — soak: a 600 s seed-1 harness run with every story line on (test:slow tier).
// textkeys: no raw GameText key reaches the player. Every text the UI shows — empire messages (ticker, history,
// conversations, message popups' title/text), advisor suggestions (title + text), Galactic NewsNet broadcasts and
// event pop-ups (SendEventMessageToEmpire title/message) — is rendered the way the UI renders it (resolveGameText /
// formatEmpireMessage / advisorSuggestionTitle) and must not still hold a GameText key, a `|`-encoded gameText()
// fragment, an unfilled `{n}` item, a key placeholder word (EMPIRE, SHIPTYPE, …) or a PascalCase data key
// (StoryClue3). Offenders are printed with the sender site (the first stack frame outside messages.ts / events.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { createGame } from '../src/sim/game';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { EmpireMessageType, type EmpireMessage } from '../src/sim/messages';
import { resolveGameText, tryGetText } from '../src/sim/textResolver';
import { formatEmpireMessage } from '../src/ui/empireMessageFeed';
import { advisorSuggestionTitle } from '../src/sim/player/advisorSuggestions';
import { parseGameText } from '../src/sim/data/gameText';

let gameData: GameData;
let placeholderWords: Set<string>;
let gameTexts: Set<string>;

beforeAll(async () => {
    gameData = await loadGameDataFs();
    // All-caps words of GameText keys that no text uses: the keys' placeholders (EMPIRE, SHIPTYPE, PLANETTYPE, …).
    const lines = readFileSync(resolve(__dirname, '../public/assets/dwu/GameText.txt'), 'utf8').split(/\r?\n/);
    const inKeys = new Set<string>();
    const inTexts = new Set<string>();
    for (const line of lines) {
        if (line.startsWith("'") || !line.includes(';')) continue;
        const i = line.indexOf(';');
        for (const w of line.substring(0, i).match(/\b[A-Z]{3,}\b/g) ?? []) inKeys.add(w);
        for (const w of line.substring(i + 1).match(/\b[A-Z]{3,}\b/g) ?? []) inTexts.add(w);
    }
    placeholderWords = new Set([...inKeys].filter((w) => !inTexts.has(w)));
    gameTexts = new Set(parseGameText(lines.join('\n')).text.values());
}, 180000);

/** Why `text` (as shown) still holds an unresolved GameText key, or null. */
export function textLeak(text: string, placeholders: ReadonlySet<string>): string | null {
    if (text.includes('KEY NOT FOUND')) return 'KEY NOT FOUND';
    if (text.includes('|')) return '|-encoded fragment';
    const item = text.match(/\{\d+[^}]*\}/);
    if (item !== null) return `unfilled ${item[0]}`;
    const pascal = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]*)+\d+\b/);
    if (pascal !== null) return `PascalCase key ${pascal[0]}`;
    for (const w of text.match(/\b[A-Z]{3,}\b/g) ?? []) if (placeholders.has(w)) return `key placeholder ${w}`;
    // A whole token (the text, a line of it, or the part after "<sender> says: ") that is itself a key with other text
    // (and not also the resolved text of another key, e.g. "We can put you in contact with another empire").
    const tokens = new Set<string>([text.trim(), ...text.split(/\r?\n/).map((s) => s.trim())]);
    const says = text.indexOf(': ');
    if (says >= 0) tokens.add(text.substring(says + 2).trim());
    for (const tok of tokens) {
        if (tok === '') continue;
        const t = tryGetText(tok);
        if (t !== null && t !== tok && !gameTexts.has(tok)) return `GameText key "${tok}"`;
    }
    return null;
}

interface Shown {
    what: string;
    text: string;
    site: string;
}

function senderSite(): string {
    const frames = (new Error().stack ?? '').split('\n').slice(2);
    const f = frames.find((l) => l.includes('/src/') && !/\/src\/sim\/messages\.ts|sendEventMessageToEmpire|textKeyLeaks/.test(l));
    return (f ?? frames[0] ?? '?').trim().replace(/^at /, '').replace(/\(.*\/game\//, '(');
}

describe('textkeys: no raw GameText key in a player-visible text (600 s, story events on)', () => {
    it('every empire message, advisor suggestion, news broadcast and event popup is resolved', () => {
        const game = createGame({ ...tickGameOptions(gameData), storyReturnOfTheShakturiEnabled: true, storyDistantWorldsEnabled: true, storyShadowsEnabled: true });
        const galaxy = game.galaxy;
        const shown: Shown[] = [];
        const sites = new Map<EmpireMessage, string>();
        const received: Array<[Empire, EmpireMessage]> = [];
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = 40;
        const empires = [...new Set([...galaxy.empires, ...galaxy.pirateEmpires])].filter((e): e is Empire => e != null);
        for (const e of empires) {
            e.messageRecipient = {
                receiveMessage: (m) => {
                    sites.set(m, senderSite());
                    received.push([e, m]);
                },
            };
            e.eventMessageRecipient = {
                receiveEventMessage: (_t, title, message) => {
                    const site = senderSite();
                    shown.push({ what: `event title (${e.name})`, text: resolveGameText(title), site });
                    shown.push({ what: `event text (${e.name})`, text: resolveGameText(message), site });
                },
            };
        }
        try {
            runGameSeconds(game, 600);
        } finally {
            Error.stackTraceLimit = limit;
            for (const e of empires) {
                e.messageRecipient = null;
                e.eventMessageRecipient = null;
            }
        }
        const all: Array<[Empire, EmpireMessage]> = [...received];
        for (const e of empires) for (const m of [...(e.messages as EmpireMessage[]), ...(e.messageHistory as EmpireMessage[])]) if (m != null) all.push([e, m]);
        const seen = new Set<EmpireMessage>();
        {
            for (const [e, m] of all) {
                if (seen.has(m)) continue;
                seen.add(m);
                const site = sites.get(m) ?? '?';
                const kind = EmpireMessageType[m.messageType];
                if (m.messageType === EmpireMessageType.AdvisorSuggestion) {
                    shown.push({ what: `advisor title ${kind}`, text: resolveGameText(advisorSuggestionTitle(galaxy, e, m)), site });
                }
                // Ticker / history line (formatEmpireMessage), conversation / popup text and popup title.
                const line = formatEmpireMessage(m, e);
                if (line !== null) shown.push({ what: `ticker ${kind}`, text: line, site });
                shown.push({ what: `text ${kind}`, text: resolveGameText(m.description), site });
                if (m.title !== '') shown.push({ what: `title ${kind}`, text: resolveGameText(m.title), site });
                if (m.hint !== '') shown.push({ what: `hint ${kind}`, text: resolveGameText(m.hint), site });
            }
        }
        const offenders = new Map<string, string>();
        for (const s of shown) {
            const why = textLeak(s.text, placeholderWords);
            if (why === null) continue;
            const key = `${s.site} | ${s.what.replace(/\(.*\)/, '')} | ${why}`;
            if (!offenders.has(key)) offenders.set(key, s.text);
        }
        for (const [k, t] of offenders) console.log(`TEXTKEY LEAK ${k}\n    ${JSON.stringify(t)}`);
        console.log(`textkeys: ${seen.size} messages, ${shown.length} texts checked, ${offenders.size} offender sites`);
        expect(shown.length).toBeGreaterThan(100);
        expect([...offenders.keys()]).toEqual([]);
    }, 2400000);
});
