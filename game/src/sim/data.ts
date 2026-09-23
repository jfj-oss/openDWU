// Loaders/parsers for original DW:U data files served from /assets/dwu/.
// No Node/DOM APIs here — pure string parsing (see CLAUDE.md: src/sim has
// no platform-specific code; the caller fetches the text over HTTP/fs and
// passes it in).

// Port of Galaxy.4.cs LoadSystemNames (parsing only; file I/O is the
// caller's responsibility). Lines starting with `'` (after trim) are
// comments/blank and are skipped; otherwise each line is a comma-separated
// list of names (with a trailing comma), trimmed, empties dropped.
export function parseSystemNames(text: string): string[] {
    const names: string[] = [];
    const lines = text.split(/\r\n|\r|\n/);
    for (const rawLine of lines) {
        const trimmedLine = rawLine.trim();
        if (trimmedLine === '' || trimmedLine.substring(0, 1) === "'") {
            continue;
        }
        for (const part of rawLine.split(',')) {
            const name = part.trim();
            if (name !== '') {
                names.push(name);
            }
        }
    }
    return names;
}
