// Shared check for test/textKeyLeaks*.test.ts: does a player-visible text (as the UI shows it) still hold an unresolved
// GameText key, a `|`-encoded gameText() fragment, an unfilled `{n}` item, a key placeholder word, a PascalCase data
// key, or a raw double with a float tail (0.010000000000000002) where the C# formats the number?
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseGameText } from '../../src/sim/data/gameText';
import { tryGetText } from '../../src/sim/textResolver';

export interface TextLeakContext {
    /** All-caps words of GameText keys that no text uses: the keys' placeholders (EMPIRE, SHIPTYPE, PLANETTYPE, …). */
    placeholders: ReadonlySet<string>;
    /** Every resolved GameText text (a token equal to one is not a leaked key). */
    gameTexts: ReadonlySet<string>;
}

/** Builds the context from public/assets/dwu/GameText.txt. */
export function loadTextLeakContext(): TextLeakContext {
    const lines = readFileSync(resolve(__dirname, '../../public/assets/dwu/GameText.txt'), 'utf8').split(/\r?\n/);
    const inKeys = new Set<string>();
    const inTexts = new Set<string>();
    for (const line of lines) {
        if (line.startsWith("'") || !line.includes(';')) continue;
        const i = line.indexOf(';');
        for (const w of line.substring(0, i).match(/\b[A-Z]{3,}\b/g) ?? []) inKeys.add(w);
        for (const w of line.substring(i + 1).match(/\b[A-Z]{3,}\b/g) ?? []) inTexts.add(w);
    }
    return {
        placeholders: new Set([...inKeys].filter((w) => !inTexts.has(w))),
        gameTexts: new Set(parseGameText(lines.join('\n')).text.values()),
    };
}

/**
 * A number printed from a raw double instead of the C#'s ToString("0") / ("0%") / ("0.0") …: six or more decimals
 * (0.010000000000000002, 12.345678901), which no GameText format the sim ports produces.
 */
export const FLOAT_TAIL = /\d\.\d{6,}/;

/** Why `text` (as shown) still holds an unresolved GameText key or a raw float, or null. */
export function textLeak(text: string, ctx: TextLeakContext): string | null {
    if (text.includes('KEY NOT FOUND')) return 'KEY NOT FOUND';
    if (text.includes('|')) return '|-encoded fragment';
    const item = text.match(/\{\d+[^}]*\}/);
    if (item !== null) return `unfilled ${item[0]}`;
    const pascal = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]*)+\d+\b/);
    if (pascal !== null) return `PascalCase key ${pascal[0]}`;
    // A code-made key (EmpireAbilityBonusEspionage): three or more capitalised humps in one word.
    const camel = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+){2,}\b/);
    if (camel !== null) return `PascalCase key ${camel[0]}`;
    const tail = text.match(FLOAT_TAIL);
    if (tail !== null) return `raw float ${tail[0]}`;
    for (const w of text.match(/\b[A-Z]{3,}\b/g) ?? []) if (ctx.placeholders.has(w)) return `key placeholder ${w}`;
    // A whole token (the text, a line of it, or the part after "<sender> says: ") that is itself a key with other text
    // (and not also the resolved text of another key, e.g. "We can put you in contact with another empire").
    const tokens = new Set<string>([text.trim(), ...text.split(/\r?\n/).map((s) => s.trim())]);
    const says = text.indexOf(': ');
    if (says >= 0) tokens.add(text.substring(says + 2).trim());
    for (const tok of tokens) {
        if (tok === '') continue;
        const t = tryGetText(tok);
        if (t !== null && t !== tok && !ctx.gameTexts.has(tok)) return `GameText key "${tok}"`;
    }
    return null;
}
