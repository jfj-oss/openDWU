// Port of Galaxy.4.cs LoadDesignNames (Galaxy.4.cs:3371-3435).
//
// The source file (designNames.txt) is a plain-text list of "families" of
// design-name prefixes: one family per non-comment line, each a
// comma-separated list of names. A family is indexed by
// Race.DesignNamesIndex (see races.ts `designNamesIndex`) and used by
// Empire.GetNewProperDesignName (designNames.ts in src/sim) to pick escort/
// frigate/destroyer/cruiser/capital-ship/troop-transport name prefixes.
//
// C# parsing rules (Galaxy.4.cs:3391-3419), reproduced exactly:
//  - Read line by line.
//  - A line that is null/empty, or whose trimmed form is empty, or whose
//    trimmed form starts with "'" (a comment), is skipped entirely (does not
//    even count toward a family).
//  - Otherwise the line is split on "," (via repeated IndexOf, matching
//    String.Split behavior for a single-char separator with no special
//    options): each token is trimmed, and empty tokens after trimming are
//    dropped (`if (!string.IsNullOrEmpty(empty)) list.Add(empty)`).
//  - If a non-comment line yields zero names after that filtering, the C#
//    loader throws ("No design names at line N"); this port throws too, to
//    surface a malformed asset the same way.
//  - The C# loader also throws if fewer than 14 families were loaded
//    overall ("Must be at least 14 design name families"). This port
//    reproduces that check as well.
//
// GameData wiring note: this parser is intentionally NOT wired into
// gameData.ts (out of scope for this task / avoids touching a file other
// agents are editing concurrently). Suggested wiring for whoever adds it:
// add a `designNames: string[][]` field to GameData, populated by
// `parseDesignNames(await fetchText('assets/dwu/designNames.txt'))`
// (mirrors how the C# loads "<path>\\designNames.txt"). The asset itself
// (public/assets/dwu/designNames.txt) does not exist in this repo yet and
// needs to be added from the original game's designNames.txt.
export function parseDesignNames(text: string): string[][] {
    const families: string[][] = [];
    const lines = text.split(/\r\n|\r|\n/);
    let lineNumber = 0;
    for (const rawLine of lines) {
        lineNumber++;
        const trimmed = rawLine == null ? '' : rawLine.trim();
        if (rawLine == null || rawLine.length === 0 || trimmed === '' || trimmed.substring(0, 1) === "'") {
            continue;
        }
        const names: string[] = [];
        let pos = 0;
        let commaIndex = 0;
        while (commaIndex >= 0) {
            commaIndex = rawLine.indexOf(',', pos);
            const token = (commaIndex < 0 ? rawLine.substring(pos) : rawLine.substring(pos, commaIndex)).trim();
            if (token !== '') {
                names.push(token);
            }
            pos = commaIndex + 1;
        }
        if (names.length === 0) {
            throw new Error(`No design names at line ${lineNumber}`);
        }
        families.push(names);
    }
    if (families.length < 14) {
        throw new Error('Must be at least 14 design name families in designNames.txt');
    }
    return families;
}
