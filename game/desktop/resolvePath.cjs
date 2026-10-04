// Case-insensitive, traversal-safe resolution of a URL path inside a root folder, for the dwu:// protocol handler
// (desktop/main.cjs). The original game runs on Windows (case-insensitive), so data references like
// images/Environment/... must resolve on case-sensitive Linux/macOS too. Each '/'-separated URL segment is matched
// against the real directory listing (cached per directory: lowercased name -> actual entry name).
//
// Platform notes: `pathImpl` is node:path (path.win32 on Windows: backslashes, drive letters, UNC roots); URL segments
// are always '/'-separated. A segment must equal an existing entry name (ignoring case), so it can never contain a
// separator, a drive letter or '..' — those are also rejected up front, and the joined result must stay inside the
// root. Injectable `readdir` / `pathImpl` keep this unit-testable with Windows paths on any OS (test/desktopShell.test.ts).
'use strict';
const fs = require('node:fs');
const nodePath = require('node:path');

/**
 * @param {{ readdir?: (dir: string) => string[], pathImpl?: typeof import('node:path') }} [opts]
 * @returns {{ resolveInsideRoot(root: string, rel: string): string | null, clearCache(): void }}
 */
function createResolver(opts = {}) {
    const readdir = opts.readdir ?? ((dir) => fs.readdirSync(dir));
    const p = opts.pathImpl ?? nodePath;
    const cache = new Map(); // absolute dir -> Map(lowerName -> entryName)

    function listing(dir) {
        let map = cache.get(dir);
        if (!map) {
            map = new Map();
            try {
                for (const entry of readdir(dir)) {
                    const key = entry.toLowerCase();
                    // Two entries differing only in case (possible on Linux): keep the first, like a lookup would.
                    if (!map.has(key)) map.set(key, entry);
                }
            } catch {
                // unreadable / missing dir: keep empty map
            }
            cache.set(dir, map);
        }
        return map;
    }

    /**
     * Resolve `rel` (URL path segments from the root, percent-encoded or not) case-insensitively. Returns the resolved
     * absolute path, or null if any segment is missing or invalid, or the result escapes the root.
     */
    function resolveInsideRoot(root, rel) {
        let current = root;
        for (const rawSeg of rel.split('/')) {
            let seg;
            try {
                seg = decodeURIComponent(rawSeg);
            } catch {
                return null; // malformed percent-encoding
            }
            if (seg === '' || seg === '.') continue;
            if (seg === '..') return null; // never allow escaping the root
            // A separator, drive / stream colon or NUL inside one segment never names a single entry.
            if (seg.includes('/') || seg.includes('\\') || seg.includes(':') || seg.includes('\0')) return null;
            const actual = listing(current).get(seg.toLowerCase());
            if (actual === undefined) return null;
            current = p.join(current, actual);
        }
        // Final guard: the resolved path must stay inside the root. Windows paths compare case-insensitively.
        const norm = (x) => (p.sep === '\\' ? x.toLowerCase() : x);
        const resolved = p.resolve(current);
        const resolvedRoot = p.resolve(root);
        const rootWithSep = resolvedRoot.endsWith(p.sep) ? resolvedRoot : resolvedRoot + p.sep;
        if (norm(resolved) !== norm(resolvedRoot) && !norm(resolved).startsWith(norm(rootWithSep))) return null;
        return resolved;
    }

    return { resolveInsideRoot, clearCache: () => cache.clear() };
}

module.exports = { createResolver };
