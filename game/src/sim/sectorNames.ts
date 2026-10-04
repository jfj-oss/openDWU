// Sector names (a leaf module: sim, render and UI all name sectors the same way).

/**
 * Galaxy.7.cs 1510 ResolveSectorDescription's column letter `(char)(sector.X + 65)` (also GalaxyMap.cs 506, MainView.2.cs
 * 4092 / 5186). The C# never has more than 15 columns; a custom size past 26 continues spreadsheet-style (AA, AB, …, AZ,
 * BA, …), so columns 0..25 are exactly the C# letter.
 */
export function sectorColumnName(x: number): string {
    if (x < 26) return String.fromCharCode(x + 65);
    let n = x;
    let out = '';
    while (n >= 0) {
        out = String.fromCharCode((n % 26) + 65) + out;
        n = Math.trunc(n / 26) - 1;
    }
    return out;
}

/**
 * The inverse of sectorColumnName for a sector name's leading letters ("C4" → 2, "AB12" → 27): the C# reads one letter,
 * `t[0] - 65` (Start.cs method_49 proximity "Sector X"); more letters only occur past column Z. -1 without a letter.
 */
export function parseSectorColumn(name: string): { column: number; rest: string } {
    let i = 0;
    while (i < name.length && name.charCodeAt(i) >= 65 && name.charCodeAt(i) <= 90) i++;
    if (i === 0) return { column: name.length > 0 ? name.charCodeAt(0) - 65 : -1, rest: name.substring(1) };
    if (i === 1) return { column: name.charCodeAt(0) - 65, rest: name.substring(1) };
    let n = 0;
    for (let k = 0; k < i; k++) n = n * 26 + (name.charCodeAt(k) - 64);
    return { column: n - 1, rest: name.substring(i) };
}
