// Parsers for the character data files (pure text → tokens; no Rnd, no game objects).
//
// - characterNames.txt: Galaxy.4.cs LoadAgentNames (374) + GetValidFileLine (364).
//   One two-line section (first names, last names) per race family, read with
//   GetValidFileLine and split with `.Replace(" ", "").Split(',')` (a trailing comma
//   therefore yields a trailing "" name, as in C#).
// - characters/<race>.txt: the line tokenizer of Galaxy.4.cs LoadCharactersCompleteFilePath
//   (1250). Each non-comment line is split at the first 15 commas (text.IndexOf(",", num6));
//   the 16th token is the rest of the line (text.Substring(num6)). Tokens are trimmed
//   (C# string.Trim). Interpretation of the tokens (int.Parse, (byte) casts,
//   Enum.IsDefined, "?"/"-" markers, Character construction with AddSkill/AddTrait)
//   is done by loadCharactersCompleteFilePath in src/sim/characters.ts, which needs
//   the Character class.

/** StreamReader.ReadLine splitting (\r\n, \n or \r; no trailing empty line), BOM stripped. */
function readLines(text: string): string[] {
    const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const lines = t.split(/\r\n|\n|\r/);
    if (lines.length > 0 && lines[lines.length - 1] === '' && /(\r\n|\n|\r)$/.test(t)) lines.pop();
    if (t === '') return [];
    return lines;
}

/** Parsed characterNames.txt (Galaxy._AgentFirstNames / _AgentLastNames, indexed by race family id). */
export interface CharacterNames {
    firstNames: string[][];
    lastNames: string[][];
}

/**
 * Port of Galaxy.4.cs LoadAgentNames (374): for (i = 0; i < RaceFamilies.Count; i++) two
 * GetValidFileLine reads, each `.Replace(" ", "").Split(',')`.
 */
export function parseCharacterNames(text: string, raceFamilyCount: number): CharacterNames {
    const lines = readLines(text);
    let pos = 0;
    const endOfStream = () => pos >= lines.length;
    // Galaxy.4.cs GetValidFileLine (364).
    const getValidFileLine = (): string => {
        let t = '';
        while (!endOfStream() && (t === '' || t.trim() === '' || t.trim().substring(0, 1) === "'")) {
            t = lines[pos++];
        }
        return t;
    };
    const firstNames: string[][] = [];
    const lastNames: string[][] = [];
    for (let i = 0; i < raceFamilyCount; i++) {
        const item = getValidFileLine().split(' ').join('').split(',');
        const item2 = getValidFileLine().split(' ').join('').split(',');
        firstNames.push(item);
        lastNames.push(item2);
    }
    return { firstNames, lastNames };
}

/** One tokenized character line (16 trimmed tokens) with its 1-based line number. */
export interface CharacterFileRow {
    /** C# `num` (line counter, 1-based) — used in the ApplicationException messages. */
    lineNumber: number;
    /** Appearance order, Name, Role, Picture filename, Race name, Skill type/level x4, Trait x3. */
    tokens: string[];
}

const TOKEN_ERRORS = [
    'Appearance Order', 'Name', 'Role', 'Picture Filename', 'Race Name',
    'Skill Type 1', 'Skill Level 1', 'Skill Type 2', 'Skill Level 2',
    'Skill Type 3', 'Skill Level 3', 'Skill Type 4', 'Skill Level 4',
    'Trait Type 1', 'Trait Type 2',
];

/**
 * Tokenizer part of Galaxy.4.cs LoadCharactersCompleteFilePath (1250-1560): the line loop,
 * the comment / blank-line filter and the 15 IndexOf(",") splits (throwing the same
 * "Could not read X at line N of file F" ApplicationException when a comma is missing).
 */
export function parseCharacterFile(text: string, filePath: string): CharacterFileRow[] {
    const rows: CharacterFileRow[] = [];
    const lines = readLines(text);
    let num = 0;
    for (const line of lines) {
        num++;
        if (line !== '' && line.trim() !== '' && line.trim().substring(0, 1) !== "'") {
            const tokens: string[] = [];
            let num6 = 0;
            for (let k = 0; k < 15; k++) {
                const num7 = line.indexOf(',', num6);
                if (num7 < 0) throw new Error('Could not read ' + TOKEN_ERRORS[k] + ' at line ' + num + ' of file ' + filePath);
                tokens.push(line.substring(num6, num7).trim());
                num6 = num7 + 1;
            }
            tokens.push(line.substring(num6).trim());
            rows.push({ lineNumber: num, tokens });
        }
    }
    return rows;
}
