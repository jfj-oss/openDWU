// Usage: node scripts/colorprofile-verify.mjs [baseUrl] [--electron] [--all] [--browser-args="<switches>"] [--port=9334] [--socket=dwu-cp] [--json=out.json]
//
// Checks that original art decodes to its RAW sample values, colour profile ignored, as the original's GDI+
// `new Bitmap(path)` (DistantWorlds.Types/GraphicsHelper.cs LoadImageFromFilePath, no ICM) does — in every browser
// decode path the game uses. Reference: the file decoded in Node without any colour management (a small zlib PNG
// decoder below, the 24-bit BMP rows; JPEG through Python PIL, which never applies ICC by itself), cross-checked
// against PIL for every PNG. For each sample and path it prints max |diff| and the number of channel values off by
// more than 1 (premultiplication rounding is allowed ±1), plus the mean signed RGB shift (> 0 = brighter than raw):
//   served   — the bytes the page fetches carry no iCCP/gAMA/sRGB/cHRM/cICP chunk (PNG) or ICC APP2 segment (JPEG);
//   pixi     — AssetStore.loadFirst → Pixi Assets.load → GPU texels (scripts/colorprofile-probe.ts; dev server only);
//   pixi-img — new Image() → Texture.from → GPU texels (dev server only);
//   pixi-raw — AssetStore.loadRawImage (colorSpaceConversion 'none') → Texture.from → GPU texels (dev server only);
//   gl       — fetch → createImageBitmap(blob) (Pixi's own call) → WebGL texImage2D, premultiply on upload → readPixels
//              (no imports: also runs in the desktop shell);
//   canvas   — new Image() → 2D canvas drawImage → getImageData (canvas composites: message pictures, flags, galaxy map
//              layers, ship-art / centre-colour sampling);
//   img      — an <img> element on black, as composited on screen (page screenshot);
//   css      — a CSS background-image on black, as composited on screen (page screenshot).
// GPU and on-screen values are premultiplied (over black = premultiplied), so they are compared with the raw values
// premultiplied (round(c * a / 255)); canvas getImageData is un-premultiplied by the browser, so it is re-premultiplied
// before the comparison. Exit code 1 when any check fails.
//
// A display control first renders CSS-coloured ramps: when the output colour space is not sRGB (e.g. Electron on
// the kwin_wayland virtual output) every on-screen colour, CSS included, is transformed on the way to the screen. The
// img / css rows are then compared with a screenshot of the raw reference itself (putImageData into a 2D canvas,
// shown at the same place: same compositor, same output transform), so they still isolate the image decode.
// Known residual (desktop shell, hardware GPU rasterization): the two big JPEGs (main background, galaxy backdrop;
// neither carries a profile) differ on screen by up to 7 levels (mean +0.07) — Chromium's GPU JPEG raster path, not a
// colour profile; their gl / canvas decodes are exact and --browser-args=--disable-gpu-rasterization brings them to ±1.
//
// --all: also fetch EVERY .png/.jpg under the install's images/ through the page and require none to keep a colour
// chunk (bytes only).
//
// baseUrl: a running dev server (default http://localhost:5173/). --electron: instead run the desktop shell
// (desktop/main.cjs, needs `npm run build` first) on a private kwin_wayland --virtual compositor like
// scripts/desktop-check.mjs and check through dwu://app/ (served/gl/canvas/img/css; the Pixi module paths need Vite).
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opts = Object.fromEntries(
    process.argv
        .slice(2)
        .filter((a) => a.startsWith('--'))
        .map((a) => {
            const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
            return [m[1], m[2] ?? 'true'];
        }),
);
const ELECTRON = opts.electron === 'true';
// --browser-args="<flags>": extra Chromium / Electron switches (diagnostics, e.g. a feature toggle).
const BROWSER_ARGS = (opts['browser-args'] ?? '').split(' ').filter(Boolean);
const base = ELECTRON ? 'dwu://app/' : (pos[0] ?? 'http://localhost:5173/').replace(/\/?$/, '/');
const dwuDir = process.env.DWU_DIR ?? realpathSync(join(root, 'public/assets/dwu'));

// Representative original art: [label, path under the install's images/] (chunk notes from the 1.9.5 install).
const SAMPLES = [
    ['ship (iCCP sRGB)', 'units/ships/family0/MIL3D.png'],
    ['ship (untagged)', 'units/ships/family0/MIL1A.png'],
    ['planet (iCCP sRGB)', 'environment/planets/frozengasgiant/FrozenGas-Ar01.png'],
    ['planet (cHRM only)', 'environment/planets/barrenrock/Barren-0001.png'],
    ['star (iCCP sRGB)', 'environment/stars/blackhole/BlkHole-0001.png'],
    ['asteroid (iCCP sRGB)', 'environment/asteroids/ice/AstIce-0001.png'],
    ['map-star flare (grey iCCP Dot Gain 20%)', 'environment/mapstars/flares/StarFlare128_color030.png'],
    ['nebula (grey iCCP Dot Gain 20%)', 'environment/nebulae/NebulaArray16_02.png'],
    ['shading overlay (gAMA 0.576 + grey iCCP)', 'environment/overlays/shadow/shading.png'],
    ['effect: explosion (iCCP sRGB)', 'effects/explosions/Expl01c/Expl01c0001.png'],
    ['effect: weapon (sRGB+gAMA+cHRM)', 'effects/weapons/hyperdeny_0.png'],
    ['effect: thruster (gAMA 0)', 'effects/enginethrusters/0.png'],
    ['creature (interlaced)', 'units/creatures/silvermist/SilverMist_00000.png'],
    ['facility (RGB, iCCP + gAMA)', 'environment/planetaryfacilities/facility_10.png'],
    ['chrome button (sRGB+gAMA+cHRM)', 'ui/chrome/coloniesButton.png'],
    ['chrome (gAMA 1/2.2)', 'ui/chrome/agent.png'],
    ['chrome panel frame (iCCP sRGB)', 'ui/chrome/panelframe.png'],
    ['portrait (RGB, iCCP sRGB)', 'units/races/race_22.png'],
    ['portrait (untagged)', 'units/races/race_0.png'],
    ['pirate portrait (iCCP sRGB)', 'units/races/pirates/raider.png'],
    ['flag shape (gAMA 0)', 'ui/flagshapes/flag01.png'],
    ['event picture (cHRM only)', 'ui/events/earthquake.png'],
    ['event picture (JPEG named .png, ICC APP2)', 'ui/events/blizzard.png'],
    ['resource icon (BMP)', 'ui/resources/Resource_0.bmp'],
    ['main background (JPEG)', 'ui/chrome/MainBackground.jpg'],
    ['galaxy backdrop (JPEG, 2000 px)', 'environment/galaxybackdrops/galaxy_backdrop.jpg'],
    ['planet map (1024 px, sRGB + gAMA)', 'environment/planetmaps/ocean1.png'],
];

// ---------------------------------------------------------------------------------------------------------------
// Raw reference decoders (no colour management)
// ---------------------------------------------------------------------------------------------------------------

/** 8-bit PNG (colour types 0/2/3/4/6, tRNS, Adam7) → straight RGBA. Colour chunks are ignored by construction. */
function decodePng(buf) {
    let o = 8;
    let w = 0, h = 0, depth = 0, ct = 0, il = 0, plte = null, trns = null;
    const idat = [];
    while (o < buf.length) {
        const len = buf.readUInt32BE(o);
        const type = buf.toString('latin1', o + 4, o + 8);
        const d = buf.subarray(o + 8, o + 8 + len);
        if (type === 'IHDR') {
            w = d.readUInt32BE(0);
            h = d.readUInt32BE(4);
            depth = d[8];
            ct = d[9];
            il = d[12];
        } else if (type === 'PLTE') plte = d;
        else if (type === 'tRNS') trns = d;
        else if (type === 'IDAT') idat.push(d);
        else if (type === 'IEND') break;
        o += 12 + len;
    }
    if (depth !== 8) throw new Error(`bit depth ${depth} not supported`);
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
    const raw = inflateSync(Buffer.concat(idat));
    const out = new Uint8Array(w * h * 4);
    const put = (x, y, s, i) => {
        const p = (y * w + x) * 4;
        let r, g, b, a = 255;
        if (ct === 0) {
            r = g = b = s[i];
            if (trns && trns.readUInt16BE(0) === s[i]) a = 0;
        } else if (ct === 2) {
            r = s[i]; g = s[i + 1]; b = s[i + 2];
            if (trns && trns.readUInt16BE(0) === r && trns.readUInt16BE(2) === g && trns.readUInt16BE(4) === b) a = 0;
        } else if (ct === 3) {
            const k = s[i];
            r = plte[k * 3]; g = plte[k * 3 + 1]; b = plte[k * 3 + 2];
            if (trns && k < trns.length) a = trns[k];
        } else if (ct === 4) {
            r = g = b = s[i];
            a = s[i + 1];
        } else {
            r = s[i]; g = s[i + 1]; b = s[i + 2]; a = s[i + 3];
        }
        out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = a;
    };
    // One (sub)image: unfilter its scanlines and place pixel (i, j) at (x0 + i * dx, y0 + j * dy).
    let off = 0;
    const pass = (pw, ph, x0, y0, dx, dy) => {
        if (pw === 0 || ph === 0) return;
        const stride = pw * ch;
        let prev = new Uint8Array(stride);
        for (let j = 0; j < ph; j++) {
            const f = raw[off];
            const line = Uint8Array.from(raw.subarray(off + 1, off + 1 + stride));
            off += 1 + stride;
            for (let i = 0; i < stride; i++) {
                const a = i >= ch ? line[i - ch] : 0;
                const b = prev[i];
                const c = i >= ch ? prev[i - ch] : 0;
                let v = 0;
                if (f === 1) v = a;
                else if (f === 2) v = b;
                else if (f === 3) v = (a + b) >> 1;
                else if (f === 4) {
                    const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
                    v = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                } else if (f !== 0) throw new Error(`bad filter ${f}`);
                line[i] = (line[i] + v) & 255;
            }
            for (let i = 0; i < pw; i++) put(x0 + i * dx, y0 + j * dy, line, i * ch);
            prev = line;
        }
    };
    if (il === 0) pass(w, h, 0, 0, 1, 1);
    else {
        for (const [x0, y0, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]) {
            pass(Math.ceil((w - x0) / dx), Math.ceil((h - y0) / dy), x0, y0, dx, dy);
        }
    }
    return { w, h, rgba: out };
}

/** 24-bit BI_RGB BMP (bottom-up) → RGBA. */
function decodeBmp(buf) {
    const dataOff = buf.readUInt32LE(10);
    const w = buf.readInt32LE(18);
    const hs = buf.readInt32LE(22);
    const bpp = buf.readUInt16LE(28);
    if (bpp !== 24 || buf.readUInt32LE(30) !== 0) throw new Error(`BMP ${bpp} bpp not supported`);
    const h = Math.abs(hs);
    const stride = (w * 3 + 3) & ~3;
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        const row = dataOff + (hs > 0 ? h - 1 - y : y) * stride;
        for (let x = 0; x < w; x++) {
            const s = row + x * 3, p = (y * w + x) * 4;
            out[p] = buf[s + 2]; out[p + 1] = buf[s + 1]; out[p + 2] = buf[s]; out[p + 3] = 255;
        }
    }
    return { w, h, rgba: out };
}

/** PIL decode (no ImageCms: embedded profiles and gAMA are never applied) → RGBA. */
function decodePil(file) {
    const py = 'import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]); im.load(); im=im.convert("RGBA")\n' +
        'sys.stdout.write("%d %d\\n" % im.size); sys.stdout.flush(); sys.stdout.buffer.write(im.tobytes())';
    const out = execFileSync('python3', ['-c', py, file], { maxBuffer: 1 << 28 });
    const nl = out.indexOf(10);
    const [w, h] = out.toString('latin1', 0, nl).split(' ').map(Number);
    return { w, h, rgba: new Uint8Array(out.subarray(nl + 1)) };
}

function referenceDecode(file) {
    const buf = readFileSync(file);
    const isPng = buf.readUInt32BE(0) === 0x89504e47;
    const isBmp = buf[0] === 0x42 && buf[1] === 0x4d;
    let ref, pilCheck = 'n/a';
    if (isPng) {
        ref = decodePng(buf);
        try {
            const pil = decodePil(file);
            pilCheck = pil.w === ref.w && pil.h === ref.h && Buffer.compare(Buffer.from(pil.rgba), Buffer.from(ref.rgba)) === 0 ? 'identical' : 'DIFFERS';
        } catch (e) {
            pilCheck = `PIL failed: ${e.message.split('\n')[0]}`;
        }
    } else if (isBmp) ref = decodeBmp(buf);
    else ref = decodePil(file); // JPEG
    return { ...ref, kind: isPng ? 'png' : isBmp ? 'bmp' : 'jpeg', pilCheck };
}

const premul = (c, a) => Math.round((c * a) / 255);

/** Top-left w × h of an RGBA image. */
function crop(img, w, h) {
    if (w === img.w && h === img.h) return img;
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) out.set(img.rgba.subarray(y * img.w * 4, (y * img.w + w) * 4), y * w * 4);
    return { w, h, rgba: out };
}

/**
 * Compare `got` (RGBA, w × h) with the reference. mode 'premul': got is premultiplied; 'canvas': got is the
 * browser's un-premultiplied getImageData (re-premultiplied here); 'screen': got is RGB over black (alpha ignored).
 */
function compare(ref, got, gw, gh, mode) {
    if (gw !== ref.w || gh !== ref.h) return { error: `size ${gw}x${gh} != ${ref.w}x${ref.h}` };
    let max = 0, over1 = 0, sum = 0, n = 0;
    const r = ref.rgba;
    for (let p = 0; p < r.length; p += 4) {
        const a = r[p + 3];
        for (let c = 0; c < 4; c++) {
            if (c === 3 && mode === 'screen') continue;
            const want = c === 3 ? a : premul(r[p + c], a);
            let have = got[p + c];
            if (mode === 'canvas' && c < 3) have = premul(have, got[p + 3]);
            const d = have - want;
            if (Math.abs(d) > max) max = Math.abs(d);
            if (Math.abs(d) > 1) over1++;
            if (c < 3 && a > 0) {
                sum += d;
                n++;
            }
        }
    }
    return { max, over1, meanShift: n ? sum / n : 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Page-side probes (plain functions, no imports: they run under dwu:// as well)
// ---------------------------------------------------------------------------------------------------------------

const PAGE_HELPERS = () => {
    const toB64 = (px) => {
        let s = '';
        for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
        return btoa(s);
    };
    const loadImg = (url) =>
        new Promise((res, rej) => {
            const el = new Image();
            el.onload = () => res(el);
            el.onerror = () => rej(new Error(`image load failed: ${url}`));
            el.src = url;
        });
    window.__cp = {
        /** Colour chunks / segments left in the bytes the page receives. */
        async served(url) {
            const b = new Uint8Array(await (await fetch(url)).arrayBuffer());
            const found = [];
            if (b[0] === 0x89 && b[1] === 0x50) {
                let o = 8;
                while (o + 8 <= b.length) {
                    const len = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
                    const t = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
                    if (['iCCP', 'gAMA', 'sRGB', 'cHRM', 'cICP', 'mDCV', 'cLLI', 'mDCv', 'cLLi'].includes(t)) found.push(t);
                    if (t === 'IEND') break;
                    o += 12 + len;
                }
            } else if (b[0] === 0xff && b[1] === 0xd8) {
                let o = 2;
                while (o + 4 <= b.length && b[o] === 0xff) {
                    const m = b[o + 1];
                    if (m === 0xda || m === 0xd9) break;
                    const len = (b[o + 2] << 8) | b[o + 3];
                    if (m === 0xe2 && String.fromCharCode(...b.subarray(o + 4, o + 15)) === 'ICC_PROFILE') found.push('APP2 ICC_PROFILE');
                    o += 2 + len;
                }
            }
            return { bytes: b.length, found };
        },
        /** Pixi's decode call + a premultiply-on-upload WebGL texture, read back through a framebuffer. */
        async gl(url) {
            const bmp = await createImageBitmap(await (await fetch(url)).blob());
            const c = document.createElement('canvas');
            const gl = c.getContext('webgl2', { premultipliedAlpha: true });
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
            const fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
            const px = new Uint8Array(bmp.width * bmp.height * 4);
            gl.readPixels(0, 0, bmp.width, bmp.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
            gl.getExtension('WEBGL_lose_context')?.loseContext();
            return { w: bmp.width, h: bmp.height, b64: toB64(px) };
        },
        async canvas(url) {
            const img = await loadImg(url);
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            return { w: c.width, h: c.height, b64: toB64(ctx.getImageData(0, 0, c.width, c.height).data) };
        },
        /** Display control: 256 x 3 CSS-coloured pixels (red, green, blue ramps 0..255) at (0, 0), on black. */
        async ramp() {
            document.documentElement.style.background = '#000';
            document.body.innerHTML = '';
            document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
            for (let c = 0; c < 3; c++) {
                for (let v = 0; v < 256; v++) {
                    const el = document.createElement('div');
                    const rgb = [0, 0, 0];
                    rgb[c] = v;
                    el.style.cssText = `position:absolute;left:${v}px;top:${c}px;width:1px;height:1px;background:rgb(${rgb.join(',')})`;
                    document.body.appendChild(el);
                }
            }
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        },
        /** Show raw straight-alpha RGBA (base64) at (0, 0), 1:1, in a 2D canvas on black. */
        async showRef(b64, w, h) {
            document.body.innerHTML = '';
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            c.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;display:block`;
            const bytes = Uint8ClampedArray.from(atob(b64), (ch) => ch.charCodeAt(0));
            c.getContext('2d').putImageData(new ImageData(bytes, w, h), 0, 0);
            document.body.appendChild(c);
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        },
        /** Show the image at (0, 0), 1:1, on black: as an <img> or as a CSS background. Resolves to its size. */
        async show(url, kind) {
            document.documentElement.style.background = '#000';
            document.body.innerHTML = '';
            document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
            const img = await loadImg(url);
            const w = img.naturalWidth, h = img.naturalHeight;
            let el;
            if (kind === 'img') {
                el = img;
            } else {
                el = document.createElement('div');
                el.style.backgroundImage = `url("${url}")`;
                el.style.backgroundRepeat = 'no-repeat';
                el.style.backgroundSize = `${w}px ${h}px`;
            }
            el.style.cssText += `;position:absolute;left:0;top:0;width:${w}px;height:${h}px;display:block;image-rendering:pixelated`;
            document.body.appendChild(el);
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            return { w, h };
        },
    };
};

// ---------------------------------------------------------------------------------------------------------------
// Electron (desktop shell) on a private kwin_wayland --virtual, like scripts/desktop-check.mjs
// ---------------------------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, what) {
    const t0 = Date.now();
    for (;;) {
        try {
            const v = await fn();
            if (v) return v;
        } catch {
            // not yet
        }
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
        await sleep(200);
    }
}
function stop(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    const done = new Promise((r) => child.once('exit', r));
    try {
        process.kill(child.pid, 'SIGTERM');
    } catch {
        return Promise.resolve();
    }
    const t = setTimeout(() => {
        try {
            process.kill(child.pid, 'SIGKILL');
        } catch {
            // gone
        }
    }, 5000);
    return done.then(() => clearTimeout(t));
}

async function openElectron() {
    if (!existsSync(join(root, 'dist/index.html'))) throw new Error('dist/ missing: run `npm run build` first');
    const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
    const socket = opts.socket ?? 'dwu-cp';
    const cdpPort = +(opts.port ?? 9334);
    const env = { ...process.env, XDG_RUNTIME_DIR: runtimeDir };
    delete env.WAYLAND_DISPLAY;
    delete env.DISPLAY;
    const kwin = spawn('kwin_wayland', ['--virtual', '--socket', socket, '--width', '2048', '--height', '2048'], { env, stdio: 'ignore' });
    await waitFor(() => existsSync(join(runtimeDir, socket)) || kwin.exitCode !== null, 15000, 'kwin socket');
    const userDataDir = mkdtempSync(join(os.tmpdir(), 'dwu-colorprofile-'));
    const app = spawn(
        join(root, 'node_modules/.bin/electron'),
        [
            join(root, 'desktop/main.cjs'),
            '--ozone-platform=wayland',
            `--remote-debugging-port=${cdpPort}`,
            `--user-data-dir=${userDataDir}`,
            ...BROWSER_ARGS,
        ],
        { env: { ...env, WAYLAND_DISPLAY: socket, DWU_DIR: dwuDir }, stdio: 'ignore' },
    );
    await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok, 30000, 'CDP');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] ?? (await ctx.waitForEvent('page', { timeout: 15000 }));
    return {
        page,
        close: async () => {
            await browser.close().catch(() => {});
            await stop(app);
            await stop(kwin);
            rmSync(userDataDir, { recursive: true, force: true });
        },
    };
}

async function openChromium() {
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...BROWSER_ARGS],
    });
    const page = await browser.newPage({ viewport: { width: 2048, height: 2048 }, deviceScaleFactor: 1 });
    return { page, close: () => browser.close() };
}

// ---------------------------------------------------------------------------------------------------------------

const session = ELECTRON ? await openElectron() : await openChromium();
const { page } = session;
const logs = [];
page.on('console', (m) => {
    // (The browser's own /favicon.ico probe of the JSON page 404s: not ours.)
    if (m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico')) logs.push(`[console.error] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => {
    if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`);
});
let failed = false;
const results = [];
let displayControl = null;
let allServed = null;
try {
    if (ELECTRON) await page.setViewportSize({ width: 2048, height: 2048 }).catch(() => {});
    // A same-origin document with no game boot: the asset manifest (served by Vite / dist/ in the desktop shell).
    await page.goto(`${base}asset-manifest.json`);
    await page.evaluate(PAGE_HELPERS);
    const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const probeReady = ELECTRON
        ? false
        : await page.evaluate(async () => {
              window.__cpPixi = await import('/scripts/colorprofile-probe.ts');
              return true;
          });
    const decode = (b64) => new Uint8Array(Buffer.from(b64, 'base64'));
    if (opts.all === 'true') {
        const files = [];
        const walk = (d) => {
            for (const e of readdirSync(d, { withFileTypes: true })) {
                const p = join(d, e.name);
                if (e.isDirectory()) walk(p);
                else if (/\.(png|jpe?g)$/i.test(e.name)) files.push(relative(dwuDir, p).split('/').map(encodeURIComponent).join('/'));
            }
        };
        walk(join(dwuDir, 'images'));
        const sweep = await page.evaluate(
            async ([b, list]) => {
                const bad = [];
                let i = 0;
                await Promise.all(
                    Array.from({ length: 8 }, async () => {
                        while (i < list.length) {
                            const f = list[i++];
                            try {
                                const r = await window.__cp.served(b + f);
                                if (r.found.length) bad.push(`${f}: ${r.found.join(',')}`);
                            } catch (e) {
                                bad.push(`${f}: ${e.message}`);
                            }
                        }
                    }),
                );
                return bad;
            },
            [`${base}assets/dwu/`, files],
        );
        allServed = { n: files.length, bad: sweep };
    }
    // Display control: how the page's own CSS colours come out on screen. Anything but identity is the output
    // colour space (the screen's profile), applied to all content alike — then the img / css rows below carry that
    // transform too, so they are compared with the on-screen raw reference (showRef) instead of the raw values.
    await page.evaluate(() => window.__cp.ramp());
    {
        const shot = decodePng(await page.screenshot({ clip: { x: 0, y: 0, width: 256, height: 3 } }));
        let max = 0;
        for (let c = 0; c < 3; c++) for (let v = 0; v < 256; v++) max = Math.max(max, Math.abs(shot.rgba[(c * 256 + v) * 4 + c] - v));
        displayControl = { max, identity: max <= 1 };
    }
    for (const [label, rel] of SAMPLES) {
        const file = join(dwuDir, 'images', rel);
        const url = `${base}assets/dwu/images/${rel}`;
        const ref = referenceDecode(file);
        const row = { label, rel, kind: ref.kind, size: `${ref.w}x${ref.h}`, pil: ref.pilCheck, checks: {} };
        const served = await page.evaluate((u) => window.__cp.served(u), url);
        row.checks.served = { ok: served.found.length === 0, note: served.found.length ? `still has ${served.found.join(',')}` : `clean (${served.bytes} B)` };
        const paths = [];
        if (probeReady && ref.kind !== 'bmp') {
            // Pixi's Assets loader only takes .png/.jpg/... URLs (the BMP icons are DOM/canvas-only in the game).
            for (const mode of ['assets', 'img', 'raw']) paths.push([mode === 'assets' ? 'pixi' : `pixi-${mode}`, () => page.evaluate(([u, m]) => window.__cpPixi.pixiPixels(u, m), [url, mode]), 'premul']);
        }
        if (ref.kind !== 'bmp') paths.push(['gl', () => page.evaluate((u) => window.__cp.gl(u), url), 'premul']);
        paths.push(['canvas', () => page.evaluate((u) => window.__cp.canvas(u), url), 'canvas']);
        // On-screen reference when the screen is not sRGB: the raw RGBA through a canvas on black. (Not pre-flattened:
        // with a non-sRGB output Chromium converts each layer before blending it, so the reference must carry the
        // same alpha.)
        // Only what fits in the viewport is on screen (the desktop window is 1600 x 900): compare that part.
        const cw = Math.min(ref.w, viewport.w);
        const chh = Math.min(ref.h, viewport.h);
        if (cw < ref.w || chh < ref.h) row.size += ` (on screen: top-left ${cw}x${chh})`;
        let screenRef = crop(ref, cw, chh);
        if (!displayControl.identity) {
            await page.evaluate(([b, w, h]) => window.__cp.showRef(b, w, h), [Buffer.from(ref.rgba).toString('base64'), ref.w, ref.h]);
            const shot = decodePng(await page.screenshot({ clip: { x: 0, y: 0, width: cw, height: chh } }));
            // Already composited over black: an opaque reference for compare() (premultiplying by 255 is a no-op).
            for (let p = 3; p < shot.rgba.length; p += 4) shot.rgba[p] = 255;
            screenRef = { w: shot.w, h: shot.h, rgba: shot.rgba };
        }
        for (const kind of ['img', 'css']) {
            paths.push([
                kind,
                async () => {
                    await page.evaluate(([u, k]) => window.__cp.show(u, k), [url, kind]);
                    const png = await page.screenshot({ clip: { x: 0, y: 0, width: cw, height: chh } });
                    const shot = decodePng(png);
                    return { w: shot.w, h: shot.h, raw: shot.rgba, ref: screenRef };
                },
                'screen',
            ]);
        }
        for (const [name, run, mode] of paths) {
            let res;
            try {
                const out = await run();
                if (out.error) res = { error: out.error };
                else res = compare(out.ref ?? ref, out.raw ?? decode(out.b64), out.w, out.h, mode);
            } catch (e) {
                res = { error: e.message.split('\n')[0] };
            }
            res.ok = res.error === undefined && res.max <= 1;
            row.checks[name] = res;
        }
        if (ref.pilCheck === 'DIFFERS') row.checks.pil = { ok: false, note: 'Node PNG decoder and PIL disagree' };
        results.push(row);
    }
} finally {
    await session.close();
}

const fmt = (c) => (c.error ? `ERR ${c.error}` : c.note ?? `max ${c.max} >1:${c.over1} shift ${c.meanShift >= 0 ? '+' : ''}${c.meanShift.toFixed(2)}`);
console.log(`colour-profile check via ${base} (${ELECTRON ? 'Electron desktop shell' : 'Chromium + Vite dev server'})`);
for (const r of results) {
    const bad = Object.entries(r.checks).filter(([, c]) => !c.ok);
    if (bad.length) failed = true;
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${r.label} — ${r.rel} [${r.kind} ${r.size}, Node vs PIL: ${r.pil}]`);
    for (const [k, c] of Object.entries(r.checks)) console.log(`       ${c.ok ? ' ' : '!'} ${k.padEnd(9)} ${fmt(c)}`);
}
console.log(
    displayControl?.identity
        ? 'display control: CSS colours reach the screen unchanged (img / css rows are exact on-screen checks)'
        : `display control: CSS colours change by up to ${displayControl?.max} levels on screen (output colour space is not sRGB): img / css compared with the raw reference shown on the same screen`,
);
if (allServed) {
    console.log(`all art served: ${allServed.n} files under images/, ${allServed.bad.length} still carrying colour chunks${allServed.bad.length ? `: ${allServed.bad.slice(0, 10).join('; ')}` : ''}`);
    if (allServed.bad.length) failed = true;
}
for (const l of logs) console.log(l);
const nPaths = results.reduce((s, r) => s + Object.keys(r.checks).length, 0);
const nBad = results.reduce((s, r) => s + Object.values(r.checks).filter((c) => !c.ok).length, 0);
console.log(`${results.length} images, ${nPaths} checks, ${nBad} failed`);
if (opts.json) writeFileSync(opts.json, JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
