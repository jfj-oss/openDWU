// Port of DistantWorlds.Types/TextResolver.cs (the GameText.txt tag → English text table) plus the
// string.Format half of the C# `string.Format(TextResolver.GetText(tag), args)` idiom.
//
// The sim does not localise (tasks/M4-plan.md §0: M4a returns keys, M9 localises): colonyTick.ts gameText()
// encodes `TextResolver.GetText(tag)` + string.Format args as "tag|arg0|arg1|…" (the tag is the English
// GameText.txt key). resolveGameText turns that encoding back into the text the C# sender would have built,
// for display (the message ticker, empireMessageFeed.ts). Headless: no DOM imports.

import { parseGameText } from './data/gameText';

let text = new Map<string, string>();
/**
 * A GameText.txt file is loaded (loadText). Kept apart from the table's size: a scenario overlay's addText on a table
 * whose base file never loaded (a failed fetch) must not make the table look loaded — its few add-on tags would then
 * hide that every base tag is missing, and every deferred message text would show as its raw "tag|arg|…" encoding.
 */
let baseLoaded = false;

/** TextResolver.cs Clear. */
export function clearText(): void {
    text = new Map();
    baseLoaded = false;
}

/**
 * TextResolver.cs LoadText(filename), from the file's content: Clear, then the line format of data/gameText.ts
 * parseGameText (its port of LoadText). The C# throws on a repeated tag; parseGameText keeps the first definition.
 */
export function loadText(content: string): void {
    clearText();
    text = parseGameText(content).text;
    baseLoaded = text.size > 0;
}

/**
 * Not a port: load a GameText.txt file under a table that has none yet (its first load failed), keeping the tags the
 * scenario overlays already added on top (addText overrides). A no-op once a GameText.txt file is loaded, and for an
 * HTML page (a web server's fallback answer for a missing file).
 */
export function loadBaseTextUnderAdded(content: string): void {
    if (baseLoaded || /^\uFEFF?\s*</.test(content)) return;
    const added = text;
    loadText(content);
    if (!baseLoaded) {
        text = added;
        return;
    }
    for (const [k, v] of added) text.set(k, v);
}

/**
 * Mod layer (tasks/MODLAYER-DESIGN.md): add GameText lines (same format) to the loaded table without clearing it; a
 * tag already present is overridden. Not a port (TextResolver has no merge).
 */
export function addText(content: string): void {
    for (const [k, v] of parseGameText(content).text) text.set(k, v);
}

/** True once a GameText.txt file has been loaded (loadGameData does it); add-on tags alone do not count. */
export function isTextLoaded(): boolean {
    return baseLoaded;
}

/** TextResolver.cs GetText(tag). */
export function getText(tag: string): string {
    const t = text.get(tag);
    return t !== undefined ? t : "KEY NOT FOUND: '" + tag + "'";
}

/** TextResolver.GetText when the tag exists, else null. */
export function tryGetText(tag: string): string | null {
    return text.get(tag) ?? null;
}

/**
 * .NET string.Format for the `{n}` items GameText.txt uses (plus `{{` / `}}` escapes and ignored `,align` /
 * `:format` parts). An index past the arguments (a FormatException in .NET) keeps the item text.
 */
export function formatNet(format: string, args: readonly unknown[]): string {
    return format.replace(/\{\{|\}\}|\{(\d+)(?:,[^:}]*)?(?::[^}]*)?\}/g, (m, idx: string | undefined) => {
        if (m === '{{') return '{';
        if (m === '}}') return '}';
        const i = Number(idx);
        return i < args.length ? String(args[i]) : m;
    });
}

/** Number of arguments a GameText template takes (highest `{n}` + 1). */
function argumentCount(template: string): number {
    let n = 0;
    for (const m of template.matchAll(/\{(\d+)[^}]*\}/g)) n = Math.max(n, Number(m[1]) + 1);
    return n;
}

/** The longest GameText tag that ends `s` and starts at its beginning or after a space / newline. */
function splitTrailingTag(s: string): { prefix: string; tag: string } | null {
    for (let i = 0; i < s.length; i++) {
        if (i > 0 && s[i - 1] !== ' ' && s[i - 1] !== '\n') continue;
        const tag = s.substring(i);
        if (text.has(tag)) return { prefix: s.substring(0, i), tag };
    }
    return null;
}

/**
 * `string.Format(TextResolver.GetText(tag), args)` evaluated now, for C# senders that splice formatted parts into a
 * larger text before sending it (e.g. Empire.3.cs DoResearchBreakthrough 2600-2640, which also cuts characters off the
 * joined result): the deferred gameText() encoding cannot nest (a part's `|` args would be read as the outer tag's
 * args). `lower` = `TextResolver.GetText(tag).ToLower(CultureInfo.InvariantCulture)` before the Format. Without a
 * loaded table (headless tests) or for an unknown tag it returns the gameText() encoding (lower-cased with `lower`).
 */
export function formatGameTextNow(tag: string, args: readonly unknown[] = [], lower = false): string {
    const t = tryGetText(tag);
    if (t === null) {
        const enc = args.length > 0 ? `${tag}|${args.map((a) => String(a)).join('|')}` : tag;
        return lower ? enc.toLowerCase() : enc;
    }
    return formatNet(lower ? t.toLowerCase() : t, args);
}

/**
 * Decode a sim text built by gameText() (`tag|arg0|arg1…`, possibly concatenated with literal text or with
 * further encoded texts, e.g. `A|x\n\nB|y`) into `string.Format(TextResolver.GetText(tag), args)`.
 * Each tag's template says how many `|` parts are its arguments; text after them (which is glued to the
 * last argument, split off at its first newline) may end in the next tag. Text without a known tag, or when no table is loaded, is returned
 * unchanged.
 */
export function resolveGameText(s: string): string {
    if (!isTextLoaded()) return s;
    const parts = s.split('|');
    if (parts.length === 1) {
        // A whole-text key. A template that takes arguments cannot be a deferred send without them: the text is an
        // already resolved one that happens to equal another key (e.g. "Pirate Offer Contact Empire" → "We can put you
        // in contact with another empire", itself the key of "… for {0} credits"), so it is not resolved twice.
        const t = tryGetText(s);
        return t !== null && argumentCount(t) === 0 ? t : s;
    }
    let out = '';
    let head = parts[0];
    let i = 1;
    for (;;) {
        const split = splitTrailingTag(head);
        if (split === null) return i === 1 ? s : out + [head, ...parts.slice(i)].join('|');
        const template = text.get(split.tag)!;
        const n = argumentCount(template);
        const args = parts.slice(i, i + n);
        i += args.length;
        if (i < parts.length && args.length > 0) {
            // More encoded text follows: the last argument part ends with the next tag.
            const next = splitTrailingTag(args[args.length - 1]);
            if (next === null) {
                // No further tag anywhere after this one: the sender passed more arguments than the template uses
                // (string.Format ignores the surplus, e.g. Empire.7.cs 3508 BuildFirstMiningStation's planet name).
                if (parts.slice(i).every((x) => splitTrailingTag(x) === null)) return out + split.prefix + formatNet(template, args);
                return out + split.prefix + formatNet(template, args) + '|' + parts.slice(i).join('|');
            }
            // Arguments are names / numbers (no newlines): a newline starts the literal text between the two.
            const nl = next.prefix.indexOf('\n');
            args[args.length - 1] = nl >= 0 ? next.prefix.substring(0, nl) : next.prefix;
            out += split.prefix + formatNet(template, args) + (nl >= 0 ? next.prefix.substring(nl) : '');
            head = next.tag;
            continue;
        }
        if (i < parts.length) {
            // A template without items sent with arguments (string.Format ignores them, e.g. Galaxy.9.cs 2349
            // GetText("GameEventAction Title UnlockTech") with the tech name): drop them when no tag follows.
            if (parts.slice(i).every((x) => splitTrailingTag(x) === null)) return out + split.prefix + formatNet(template, args);
            return out + split.prefix + formatNet(template, args) + '|' + parts.slice(i).join('|');
        }
        return out + split.prefix + formatNet(template, args);
    }
}
