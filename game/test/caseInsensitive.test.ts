import { describe, expect, it } from 'vitest';
import { resolveCaseInsensitive } from '../vite.config';

// Unit tests for the pure segment resolver used by the dev server's
// case-insensitive /assets/dwu/ middleware (task 05d). The directory
// listings are injected so no filesystem is touched. Importing vite.config
// only runs its top-level `here` computation — no Vite server starts.

/** Fake tree: root -> ui -> chrome with mixed-case file names. */
const TREE: Record<string, string[]> = {
    '/install': ['images'],
    '/install/images': ['ui', 'environment'],
    '/install/images/ui': ['chrome'],
    '/install/images/ui/chrome': [
        'ShipsAndBasesButton.png',
        'coloniesButton.png',
        'cycleFleets.png',
    ],
    '/install/images/environment': ['planets'],
    '/install/images/environment/planets': ['ocean'],
};

/** readdir that throws on unknown directories, like fs.readdirSync. */
function fakeReaddir(dir: string): string[] {
    const list = TREE[dir];
    if (!list) throw new Error(`ENOENT: ${dir}`);
    return list;
}

/** isDirectory for the fake tree (directories are keys of TREE). */
function fakeIsDirectory(abs: string): boolean {
    return abs in TREE;
}

describe('resolveCaseInsensitive', () => {
    it('resolves an exact-case path', () => {
        expect(resolveCaseInsensitive('/install', 'images/ui/chrome/coloniesButton.png', fakeReaddir, fakeIsDirectory))
            .toBe('/install/images/ui/chrome/coloniesButton.png');
    });

    it('resolves a wrong-case file name against the parent listing', () => {
        // The original's code references shipsAndBasesButton.png but the file
        // is ShipsAndBasesButton.png — the reported broken HUD icon.
        expect(resolveCaseInsensitive('/install', 'images/ui/chrome/shipsAndBasesButton.png', fakeReaddir, fakeIsDirectory))
            .toBe('/install/images/ui/chrome/ShipsAndBasesButton.png');
    });

    it('resolves wrong case in intermediate segments too', () => {
        expect(resolveCaseInsensitive('/install', 'IMAGES/UI/Chrome/cyclefleets.png', fakeReaddir, fakeIsDirectory))
            .toBe('/install/images/ui/chrome/cycleFleets.png');
    });

    it('returns null when the file does not exist (any case)', () => {
        expect(resolveCaseInsensitive('/install', 'images/ui/chrome/nope.png', fakeReaddir, fakeIsDirectory)).toBeNull();
    });

    it('returns null when an intermediate directory does not exist', () => {
        expect(resolveCaseInsensitive('/install', 'images/ui/nothere/x.png', fakeReaddir, fakeIsDirectory)).toBeNull();
    });

    it('rejects .. and . segments', () => {
        expect(resolveCaseInsensitive('/install', '../etc/passwd', fakeReaddir, fakeIsDirectory)).toBeNull();
        expect(resolveCaseInsensitive('/install', 'images/../images/ui/chrome/coloniesButton.png', fakeReaddir, fakeIsDirectory)).toBeNull();
        expect(resolveCaseInsensitive('/install', './images/ui/chrome/coloniesButton.png', fakeReaddir, fakeIsDirectory)).toBeNull();
    });

    it('returns null for an empty relative path', () => {
        expect(resolveCaseInsensitive('/install', '', fakeReaddir, fakeIsDirectory)).toBeNull();
    });

    it('returns null when the resolved entry is a directory', () => {
        expect(resolveCaseInsensitive('/install', 'images/ui/chrome', fakeReaddir, fakeIsDirectory)).toBeNull();
    });
});