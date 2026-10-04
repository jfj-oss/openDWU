// Types of desktop/themeIndex.cjs (for vite.config.ts and the tests).
declare const themeIndex: {
    listThemes(dwuRoot: string): string[];
    buildThemeIndex(dwuRoot: string, set: string): { set: string; files: string[]; dirs: string[] } | null;
    THEME_FOLDERS: string[];
    windowsOrdinal(a: string, b: string): number;
};
export = themeIndex;
