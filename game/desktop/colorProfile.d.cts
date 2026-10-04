// Types for desktop/colorProfile.cjs (shared by vite.config.ts, desktop/main.cjs and the tests).
/// <reference types="node" />
export declare const PNG_COLOR_CHUNKS: ReadonlySet<string>;
export declare function stripColorProfile(buf: Buffer): Buffer;
export declare function isProfiledImagePath(p: string): boolean;
