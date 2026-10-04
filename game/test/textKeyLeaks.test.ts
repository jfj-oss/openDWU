// @slow — soak: a 600 s seed-1 harness run with every story line on (test:slow tier).
// textkeys: no raw GameText key reaches the player. Every text the UI shows — empire messages (ticker, history,
// conversations, message popups' title/text), advisor suggestions (title + text), Galactic NewsNet broadcasts and
// event pop-ups (SendEventMessageToEmpire title/message) — is rendered the way the UI renders it (resolveGameText /
// formatEmpireMessage / advisorSuggestionTitle) and must not still hold a GameText key, a `|`-encoded gameText()
// fragment, an unfilled `{n}` item, a key placeholder word (EMPIRE, SHIPTYPE, …), a PascalCase data key
// (StoryClue3, EmpireAbilityBonusEspionage) or a raw double's float tail (0.010000000000000002) where the C# formats
// the number (test/helpers/textLeak.ts; the fast textKeyLeaksNumbers.test.ts generates the number-formatting texts
// directly). Offenders are printed with the sender site (the first stack frame outside messages.ts / events.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { loadTextLeakContext, textLeak, type TextLeakContext } from './helpers/textLeak';
import { createGame } from '../src/sim/game';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { EmpireMessageType, type EmpireMessage } from '../src/sim/messages';
import { resolveGameText } from '../src/sim/textResolver';
import { formatEmpireMessage } from '../src/ui/empireMessageFeed';
import { advisorSuggestionTitle } from '../src/sim/player/advisorSuggestions';

let gameData: GameData;
let leakContext: TextLeakContext;

beforeAll(async () => {
    gameData = await loadGameDataFs();
    leakContext = loadTextLeakContext();
}, 180000);

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
            const why = textLeak(s.text, leakContext);
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
