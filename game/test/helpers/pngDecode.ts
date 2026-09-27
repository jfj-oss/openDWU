// Minimal PNG decoder for tests (8-bit RGBA / RGB / grey+alpha / grey, non-interlaced): reads an ORIGINAL frame from the
// DW:U install to measure its palette / contrast (nothing is written or copied). Node only.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

export interface DecodedPng {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

/** public/assets/dwu (the install symlink); null when the install is not present. */
export function dwuAssetPath(rel: string): string | null {
    const p = resolve(__dirname, '../../public/assets/dwu', rel);
    return existsSync(p) ? p : null;
}

export function decodePng(file: string): DecodedPng {
    const buf = readFileSync(file);
    let off = 8;
    let width = 0;
    let height = 0;
    let colorType = 0;
    let bitDepth = 0;
    let interlace = 0;
    const idat: Buffer[] = [];
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const body = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            bitDepth = body[8];
            colorType = body[9];
            interlace = body[12];
        } else if (type === 'IDAT') idat.push(body);
        else if (type === 'IEND') break;
        off += 12 + len;
    }
    if (bitDepth !== 8 || interlace !== 0) throw new Error(`decodePng: unsupported ${file} (depth ${bitDepth}, interlace ${interlace})`);
    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0;
    if (channels === 0) throw new Error(`decodePng: colour type ${colorType} unsupported (${file})`);
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const out = new Uint8ClampedArray(width * height * 4);
    const prev = new Uint8Array(stride);
    const cur = new Uint8Array(stride);
    let p = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[p++];
        for (let x = 0; x < stride; x++) {
            const r = raw[p++];
            const a = x >= channels ? cur[x - channels] : 0;
            const b = prev[x];
            const c = x >= channels ? prev[x - channels] : 0;
            let v: number;
            switch (filter) {
                case 1:
                    v = r + a;
                    break;
                case 2:
                    v = r + b;
                    break;
                case 3:
                    v = r + ((a + b) >> 1);
                    break;
                case 4: {
                    const pp = a + b - c;
                    const pa = Math.abs(pp - a);
                    const pb = Math.abs(pp - b);
                    const pc = Math.abs(pp - c);
                    v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
                    break;
                }
                default:
                    v = r;
            }
            cur[x] = v & 255;
        }
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            const i = x * channels;
            if (channels === 4) {
                out[o] = cur[i];
                out[o + 1] = cur[i + 1];
                out[o + 2] = cur[i + 2];
                out[o + 3] = cur[i + 3];
            } else if (channels === 3) {
                out[o] = cur[i];
                out[o + 1] = cur[i + 1];
                out[o + 2] = cur[i + 2];
                out[o + 3] = 255;
            } else if (channels === 2) {
                out[o] = out[o + 1] = out[o + 2] = cur[i];
                out[o + 3] = cur[i + 1];
            } else {
                out[o] = out[o + 1] = out[o + 2] = cur[i];
                out[o + 3] = 255;
            }
        }
        prev.set(cur);
    }
    return { width, height, data: out };
}
