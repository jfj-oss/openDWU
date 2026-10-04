import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { stripColorProfile, isProfiledImagePath, PNG_COLOR_CHUNKS } from '../desktop/colorProfile.cjs';
import { dwuAssetsMiddleware } from '../vite.config';

// Original art is served without its embedded colour profile (desktop/colorProfile.cjs), by the dev server's
// /assets/dwu/ middleware (vite.config.ts dwuAssetsMiddleware) and the Electron dwu:// handler, so the browser decodes
// raw sample values like the original's GDI+ `new Bitmap(path)`. Synthetic files only (no original art in tests);
// scripts/colorprofile-verify.mjs checks real art pixel by pixel in the browser.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function ihdr(w: number, h: number): Buffer {
    const d = Buffer.alloc(13);
    d.writeUInt32BE(w, 0);
    d.writeUInt32BE(h, 4);
    d[8] = 8; // bit depth
    d[9] = 6; // RGBA
    return chunk('IHDR', d);
}
const IDAT = chunk('IDAT', deflateSync(Buffer.from([0, 10, 20, 30, 40])));
const IEND = chunk('IEND');
const u32 = (v: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(v);
    return b;
};

/** A 1x1 PNG with every colour chunk the install uses (Photoshop layout: cHRM + iCCP before IDAT) plus non-colour ones. */
function profiledPng(): { file: Buffer; plain: Buffer } {
    const pHYs = chunk('pHYs', Buffer.from([0, 0, 11, 19, 0, 0, 11, 19, 1]));
    const tEXt = chunk('tEXt', Buffer.from('Software\0test', 'latin1'));
    const colour = [
        chunk('gAMA', u32(57596)),
        chunk('cHRM', Buffer.alloc(32, 1)),
        chunk('sRGB', Buffer.from([0])),
        chunk('iCCP', Buffer.concat([Buffer.from('Photoshop ICC profile\0\0', 'latin1'), deflateSync(Buffer.alloc(64, 7))])),
        chunk('cICP', Buffer.from([1, 13, 0, 1])),
    ];
    return {
        file: Buffer.concat([SIG, ihdr(1, 1), colour[0], colour[1], pHYs, colour[2], colour[3], colour[4], tEXt, IDAT, IEND]),
        plain: Buffer.concat([SIG, ihdr(1, 1), pHYs, tEXt, IDAT, IEND]),
    };
}

function segment(marker: number, payload: Buffer): Buffer {
    const head = Buffer.from([0xff, marker, 0, 0]);
    head.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([head, payload]);
}
/** A JPEG skeleton: SOI, APP0 JFIF, APP2 ICC_PROFILE (2 parts), APP2 MPF (kept), DQT, SOS + "entropy data", EOI. */
function profiledJpeg(): { file: Buffer; plain: Buffer } {
    const soi = Buffer.from([0xff, 0xd8]);
    const app0 = segment(0xe0, Buffer.from('JFIF\0\x01\x02\0\0\x01\0\x01\0\0', 'latin1'));
    const icc1 = segment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0\x01\x02', 'latin1'), Buffer.alloc(40, 3)]));
    const icc2 = segment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0\x02\x02', 'latin1'), Buffer.alloc(20, 4)]));
    const mpf = segment(0xe2, Buffer.from('MPF\0abcd', 'latin1'));
    const dqt = segment(0xdb, Buffer.alloc(65, 1));
    // Entropy-coded data may contain anything, including bytes that look like an APP2 ICC header.
    const scan = Buffer.concat([segment(0xda, Buffer.alloc(10, 0)), Buffer.from([0x12, 0xff, 0x00, 0xff, 0xe2, 0x00, 0x10]), Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([0xff, 0xd9])]);
    return {
        file: Buffer.concat([soi, app0, icc1, Buffer.from([0xff]), icc2, mpf, dqt, scan]), // (one 0xFF fill byte before icc2)
        plain: Buffer.concat([soi, app0, Buffer.from([0xff]), mpf, dqt, scan]),
    };
}

describe('stripColorProfile (PNG)', () => {
    it('drops iCCP / sRGB / gAMA / cHRM / cICP and keeps every other chunk byte for byte', () => {
        const { file, plain } = profiledPng();
        expect(stripColorProfile(file).equals(plain)).toBe(true);
    });

    it('returns the same buffer when there is nothing to drop (no copy)', () => {
        const { plain } = profiledPng();
        expect(stripColorProfile(plain)).toBe(plain);
    });

    it('keeps data after IEND verbatim', () => {
        const { file, plain } = profiledPng();
        const trailer = Buffer.from('trailing bytes');
        expect(stripColorProfile(Buffer.concat([file, trailer])).equals(Buffer.concat([plain, trailer]))).toBe(true);
    });

    it('leaves a truncated / malformed PNG unchanged', () => {
        const { file } = profiledPng();
        const truncated = file.subarray(0, 60);
        expect(stripColorProfile(truncated)).toBe(truncated);
        const bad = Buffer.from(file);
        bad.writeUInt32BE(0x7fffffff, 8 + 25); // first chunk after IHDR claims a huge length
        expect(stripColorProfile(bad)).toBe(bad);
    });

    it('lists the HDR metadata chunks with the colour chunks', () => {
        for (const t of ['iCCP', 'sRGB', 'gAMA', 'cHRM', 'cICP', 'mDCV', 'cLLI']) expect(PNG_COLOR_CHUNKS.has(t)).toBe(true);
        for (const t of ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'pHYs', 'tEXt', 'bKGD']) expect(PNG_COLOR_CHUNKS.has(t)).toBe(false);
    });
});

describe('stripColorProfile (JPEG)', () => {
    it('drops the APP2 ICC_PROFILE segments only, before the scan; the scan data is untouched', () => {
        const { file, plain } = profiledJpeg();
        expect(stripColorProfile(file).equals(plain)).toBe(true);
    });

    it('returns a JPEG without a profile as is', () => {
        const { plain } = profiledJpeg();
        expect(stripColorProfile(plain)).toBe(plain);
    });

    it('leaves a truncated JPEG unchanged', () => {
        const { file } = profiledJpeg();
        const truncated = file.subarray(0, 30);
        expect(stripColorProfile(truncated)).toBe(truncated);
    });

    it('sniffs the content, not the name: other bytes pass through', () => {
        const bmp = Buffer.from('BM\0\0\0\0', 'latin1');
        expect(stripColorProfile(bmp)).toBe(bmp);
        expect(stripColorProfile(Buffer.alloc(0)).length).toBe(0);
    });
});

describe('isProfiledImagePath', () => {
    it('covers .png / .jpg / .jpeg in any case and nothing else', () => {
        for (const p of ['a/b.png', 'a/b.PNG', 'x.jpg', 'x.JPEG', 'blizzard.png']) expect(isProfiledImagePath(p)).toBe(true);
        for (const p of ['races.txt', 'Resource_0.bmp', 'font.ttf', 'a.png.txt', 'pngfile']) expect(isProfiledImagePath(p)).toBe(false);
    });
});

describe('dev server /assets/dwu/ middleware', () => {
    let root: string;
    let server: Server;
    let base: string;
    const png = profiledPng();
    const jpeg = profiledJpeg();

    beforeAll(async () => {
        root = mkdtempSync(path.join(tmpdir(), 'dwu-colorprofile-'));
        mkdirSync(path.join(root, 'images', 'ui', 'Chrome'), { recursive: true });
        writeFileSync(path.join(root, 'images', 'ui', 'Chrome', 'Button.png'), png.file);
        writeFileSync(path.join(root, 'images', 'ui', 'Chrome', 'jpegInDisguise.png'), jpeg.file);
        writeFileSync(path.join(root, 'images', 'ui', 'Chrome', 'back.JPG'), jpeg.file);
        writeFileSync(path.join(root, 'races.txt'), 'data');
        const mw = dwuAssetsMiddleware(root);
        server = createServer((req, res) =>
            mw(req, res, () => {
                res.statusCode = 299; // "next()": left to Vite's own static serving
                res.end('next');
            }),
        );
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
        const addr = server.address();
        base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/assets/dwu/`;
    });

    afterAll(async () => {
        await new Promise<void>((r) => server.close(() => r()));
        rmSync(root, { recursive: true, force: true });
    });

    it('serves exact-path PNGs stripped, with length, type and caching headers', async () => {
        const r = await fetch(`${base}images/ui/Chrome/Button.png`);
        expect(r.status).toBe(200);
        expect(r.headers.get('content-type')).toBe('image/png');
        expect(r.headers.get('cache-control')).toBe('no-cache');
        expect(Number(r.headers.get('content-length'))).toBe(png.plain.length);
        expect(Buffer.from(await r.arrayBuffer()).equals(png.plain)).toBe(true);
        const etag = r.headers.get('etag')!;
        expect(etag).toMatch(/-raw"$/);
        const again = await fetch(`${base}images/ui/Chrome/Button.png`, { headers: { 'If-None-Match': etag } });
        expect(again.status).toBe(304);
    });

    it('serves wrong-case paths case-insensitively, stripped', async () => {
        const r = await fetch(`${base}images/UI/chrome/button.PNG?v=1`);
        expect(r.status).toBe(200);
        expect(Buffer.from(await r.arrayBuffer()).equals(png.plain)).toBe(true);
    });

    it('strips JPEGs, also one named .png', async () => {
        for (const p of ['images/ui/Chrome/jpegInDisguise.png', 'images/ui/Chrome/back.JPG']) {
            const r = await fetch(base + p);
            expect(r.status).toBe(200);
            expect(Buffer.from(await r.arrayBuffer()).equals(jpeg.plain)).toBe(true);
        }
        expect((await fetch(`${base}images/ui/Chrome/back.JPG`)).headers.get('content-type')).toBe('image/jpeg');
    });

    it('answers HEAD without a body', async () => {
        const r = await fetch(`${base}images/ui/Chrome/Button.png`, { method: 'HEAD' });
        expect(r.status).toBe(200);
        expect(Number(r.headers.get('content-length'))).toBe(png.plain.length);
        expect((await r.arrayBuffer()).byteLength).toBe(0);
    });

    it('leaves data files, missing files and traversal to the next handler', async () => {
        expect((await fetch(`${base}races.txt`)).status).toBe(299);
        expect((await fetch(`${base}images/ui/Chrome/missing.png`)).status).toBe(299);
        expect((await fetch(`${base}images/..%2F..%2F..%2Fetc%2Fpasswd`)).status).toBe(299);
        expect((await fetch(`${base}images/ui/Chrome`)).status).toBe(299);
    });

    it('streams a wrong-case data file itself (Vite would not find it)', async () => {
        const r = await fetch(`${base}RACES.TXT`);
        expect(r.status).toBe(200);
        expect(await r.text()).toBe('data');
    });
});
