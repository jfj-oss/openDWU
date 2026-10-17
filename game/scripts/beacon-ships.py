#!/usr/bin/env python3
"""The Beacon's art (Giantworks add-on, the Beacon wonder): the Reclaimers' warships, the two Watchers and the finished
Beacon, built from the Mass Effect 4 Mod's Reaper ship set. Offline build step; the outputs are committed under
public/art/beacon/ (src/render/threatArt.ts beaconArtUrl draws them; src/render/beaconFx.ts animates them), plus the
table src/render/beaconArtData.ts (each frame's breathing period and light layer, the Watcher's moving parts),
written by this script.

    python3 -I scripts/beacon-ships.py [--dwu <DW:U install>] [--out public/art/beacon]
        [--data src/render/beaconArtData.ts] [--preview <dir>] [--only escort,watcher]

Credits: the Beacon faction's ships are built from the Mass Effect 4 Mod for DW:U (original Mass Effect Mod by
Kalthaniell + Team for Legends, modified for Shadows by dostillevi, for Universe by Demonius, compiled and assembled
(ME4) by Tyrador, using some of the Prothean Cycle mod's assets), used with the user's decision (2026-10-17).

NEEDS THE MOD INSTALLED: it reads the Reaper set, <DW:U>/Customization/Mass Effect 4 Mod/images/units/ships/family15/
(or the same set as family20 in Customization/MassEffect mod 1.00/shipImages/), default --dwu public/assets/dwu (the
symlink npm run import-assets makes). Python 3 with numpy and Pillow only. Deterministic.

- The Watchers are the mod's carrier.png exactly: its own pixels, at its native scale, centred on a padded canvas; the
  only pixels touched are the ones the frame rules demand (none of opaque black or a marker colour in that sprite; the
  four balance pixels). For their opening (when sighted) the reference is cut into its body, its two horns, its six
  legs and three flank plates a side (watcher-parts.png); under the flank plates the open body (watcher-body.png)
  shows a ribbed cavity lit from inside, painted in the reference's own palette; closed, the frame is the reference.
- The warships and the Beacon are composites: pieces cut from the set's frames (cut edges bevelled), transformed,
  mirrored and meshed into new ships, each with a contact shadow on what is below; every piece but the reference's is
  graded to the reference's palette (its hull luminance matched to the carrier's, its colour to the carrier's neutral
  gunmetal per luminance band, a trace of its own hue kept), its cyan lights to the carrier's cyan.
- The light: each frame bakes its lines at rest; <file>-fx.png holds their swell (beaconFx.ts breathes it) and a soft
  halo. No eyes (the user's call): the set's orange lamps (its eyes and cores) are graded into the hull, and the small
  light in the reference's head keeps its pixels but takes no part in the swell.
- Frames: square, the content box centred on the frame centre (four near-transparent balance pixels: the game turns a
  frame about its content box's centre), no pixel in either marker colour (no thrusters: they glide), no opaque black.
"""
import argparse
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
F32 = np.float32
LUM = np.array([0.299, 0.587, 0.114], F32)
MOD_DIRS = [
    os.path.join('Customization', 'Mass Effect 4 Mod', 'images', 'units', 'ships', 'family15'),
    os.path.join('Customization', 'MassEffect mod 1.00', 'shipImages', 'family20'),
]
BREATH = {'escort': 5.0, 'frigate': 5.4, 'destroyer': 5.8, 'cruiser': 6.4, 'capitalship': 7.4, 'carrier': 7.0,
          'trooptransport': 6.0, 'construction': 5.6, 'beacon': 9.0, 'watcher': 8.5}


# ---------------------------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------------------------

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def box_blur(v, r, axis):
    if r < 1:
        return v
    k = 2 * r + 1
    pad = [(0, 0)] * v.ndim
    pad[axis] = (r + 1, r)
    p = np.pad(v, pad, mode='constant')
    c = np.cumsum(p, axis=axis, dtype=np.float64)
    n = v.shape[axis]
    return ((np.take(c, np.arange(k, k + n), axis=axis) - np.take(c, np.arange(0, n), axis=axis)) / k).astype(F32)


def gblur(v, sigma):
    """Gaussian-ish blur (three box passes per axis), zero outside."""
    if sigma <= 0.3:
        return v.astype(F32)
    r = max(1, int(round(math.sqrt(12 * sigma * sigma / 3 + 1) / 2)))
    out = v.astype(F32)
    for _ in range(3):
        out = box_blur(out, r, 0)
        out = box_blur(out, r, 1)
    return out


def shift(v, dy, dx):
    out = np.zeros_like(v)
    h, w = v.shape[:2]
    ys0, ys1 = max(0, dy), min(h, h + dy)
    xs0, xs1 = max(0, dx), min(w, w + dx)
    if ys1 > ys0 and xs1 > xs0:
        out[ys0:ys1, xs0:xs1] = v[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
    return out


def mod_dir(dwu):
    for d in MOD_DIRS:
        p = os.path.join(dwu, d)
        if os.path.exists(os.path.join(p, 'carrier.png')):
            return p
    raise SystemExit('beacon-ships.py: the Mass Effect 4 Mod (or MassEffect mod 1.00) is not installed under %s' % dwu)


def rgba_f(img):
    return np.asarray(img.convert('RGBA')).astype(F32) / 255


# ---------------------------------------------------------------------------------------------------------------
# The reference's palette (the carrier)
# ---------------------------------------------------------------------------------------------------------------

def glow_mask(rgba):
    """The light-line pixels (0..1): the set's cyan, and its few orange lamps."""
    r, g, b, a = (rgba[..., i] for i in range(4))
    cyan = smoothstep(0.08, 0.22, b - r) * smoothstep(0.02, 0.12, g - r) * smoothstep(0.28, 0.45, b)
    orange = smoothstep(0.12, 0.3, r - g) * smoothstep(0.35, 0.55, r) * smoothstep(0.15, 0.3, r - b)
    return (np.maximum(cyan, orange) * (a > 0.3)).astype(F32), cyan.astype(F32), orange.astype(F32)


class Palette:
    """The carrier's hull: its luminance distribution and median colour per luminance band; its cyan per brightness."""

    def __init__(self, ref):
        g, cyan, _ = glow_mask(ref)
        rgb, a = ref[..., :3], ref[..., 3]
        hull = (a > 0.99) & (g < 0.05)
        L = rgb @ LUM
        self.q = np.linspace(0, 1, 101)
        self.lq = np.quantile(L[hull], self.q).astype(F32)
        xs, cols = [], []
        for lo in np.arange(0, 1, 1 / 16):
            m = hull & (L >= lo) & (L < lo + 1 / 16)
            if m.sum() >= 20:
                xs.append(float(np.median(L[m])))
                cols.append(np.median(rgb[m], 0))
        self.rx = np.array([0.0] + xs + [1.0], F32)
        self.rc = np.array([[0.0, 0.0, 0.0]] + cols + [cols[-1] * (1.0 / max(xs[-1], 1e-3))], F32)
        cm = (cyan > 0.6) & (a > 0.9)
        v = rgb[cm].max(1)
        cxs, ccols = [], []
        for lo in np.arange(0, 1, 1 / 10):
            m = (v >= lo) & (v < lo + 0.1)
            if m.sum() >= 4:
                cxs.append(float(np.median(v[m])))
                ccols.append(np.median(rgb[cm][m], 0))
        self.cx = np.array([0.0] + cxs + [1.0], F32)
        self.cc = np.array([[0.0, 0.0, 0.0]] + ccols + [[0.75, 0.95, 1.0]], F32)

    def hull(self, L):
        out = np.empty(L.shape + (3,), F32)
        for c in range(3):
            out[..., c] = np.interp(L, self.rx, self.rc[:, c])
        return out

    def light(self, v):
        out = np.empty(v.shape + (3,), F32)
        for c in range(3):
            out[..., c] = np.interp(v, self.cx, self.cc[:, c])
        return out

    def grade(self, rgba, match=0.85, hue=0.2):
        """A piece in the reference's palette: its hull luminance histogram-matched to the carrier's (by `match`), its
        colour the carrier's per band with `hue` of its own chroma kept; its cyan lights in the carrier's cyan, its orange
        lamps (eyes, cores) graded into the hull."""
        _, cyan, orange = glow_mask(rgba)
        g = (cyan * (rgba[..., 3] > 0.3)).astype(F32)
        rgb, a = rgba[..., :3], rgba[..., 3]
        L = rgb @ LUM
        hull = (a > 0.5) & (g < 0.05)
        L = np.where(orange > 0.05, L * (1 - 0.55 * orange), L)
        if hull.sum() > 50:
            mine = np.quantile(L[hull], self.q)
            mine = np.maximum.accumulate(mine + np.arange(len(mine)) * 1e-6)
            Lm = np.interp(L, mine, self.lq)
            L2 = L * (1 - match) + Lm * match
        else:
            L2 = L
        chroma = rgb - L[..., None]
        out = self.hull(L2) + chroma * hue
        lit = self.light(rgb.max(-1))
        out = out * (1 - g[..., None]) + lit * g[..., None]
        res = np.concatenate([np.clip(out, 0, 1), a[..., None]], -1).astype(F32)
        return res, g


# ---------------------------------------------------------------------------------------------------------------
# Pieces and the canvas
# ---------------------------------------------------------------------------------------------------------------

class Piece:
    """A straight-alpha float RGBA image with its light mask (0..1)."""

    def __init__(self, rgba, glow):
        self.rgba = rgba.astype(F32)
        self.glow = glow.astype(F32)

    @property
    def h(self):
        return self.rgba.shape[0]

    @property
    def w(self):
        return self.rgba.shape[1]


class Kit:
    """The set's frames, graded to the reference's palette (the carrier itself untouched), and cuts from them."""

    def __init__(self, dwu):
        self.dir = mod_dir(dwu)
        self.ref = rgba_f(Image.open(os.path.join(self.dir, 'carrier.png')))
        self.pal = Palette(self.ref)
        self.cache = {}

    def raw(self, name):
        return rgba_f(Image.open(os.path.join(self.dir, name + '.png')))

    def frame(self, name, match=0.85):
        key = (name, match)
        if key not in self.cache:
            src = self.raw(name)
            if name == 'carrier':
                g, _, _ = glow_mask(src)
                self.cache[key] = Piece(src, g)
            else:
                rgba, g = self.pal.grade(src, match=match)
                self.cache[key] = Piece(rgba, g)
        return self.cache[key]

    def cut(self, name, box=None, poly=None, keep=None, bevel=True, match=0.85, feather=0.6):
        """A piece of frame `name`: the box (x0, y0, x1, y1) and / or a polygon (frame px), or a mask function
        keep(X, Y) -> 0..1; where the cut runs through the hull a bevel (a lit lip, a dark seam) so it reads as a plate
        edge. Returns the piece cropped to `box` (or to the frame)."""
        f = self.frame(name, match)
        h, w = f.h, f.w
        m = np.ones((h, w), F32)
        if poly is not None:
            k = 4
            im = Image.new('L', (w * k, h * k), 0)
            ImageDraw.Draw(im).polygon([(x * k, y * k) for (x, y) in poly], fill=255)
            m = np.asarray(im.resize((w, h), Image.BOX)).astype(F32) / 255
        if keep is not None:
            Y, X = np.mgrid[0:h, 0:w].astype(F32) + 0.5
            m = m * keep(X, Y).astype(F32)
        if feather > 0:
            m = np.clip(gblur(m, feather) * 1.0 + (m - gblur(m, feather)) * 0.0, 0, 1) * (m > 0.02) + m * 0
            m = np.clip(m, 0, 1)
        rgba = f.rgba.copy()
        a0 = rgba[..., 3]
        a = a0 * m
        if bevel:
            cut_edge = (m < 0.98) & (a0 > 0.5)
            inside = (m > 0.5) & (a0 > 0.5)
            ring = gblur(cut_edge.astype(F32), 1.0) * inside
            rgba[..., :3] = rgba[..., :3] * (1 - 0.45 * np.clip(ring * 2.5, 0, 1))[..., None]
        rgba[..., 3] = a
        glow = f.glow * m
        if box is not None:
            x0, y0, x1, y1 = box
            rgba = rgba[y0:y1, x0:x1]
            glow = glow[y0:y1, x0:x1]
        return Piece(rgba, glow)


def transform(p, scale=1.0, rot=0.0, flip=False):
    """Premultiplied (rgb·a, a, glow·a) planes of a piece, flipped, scaled and rotated (deg, counter-clockwise on
    screen) about its centre; exact (no resampling) when scale is 1 and rot 0."""
    rgba, g = p.rgba, p.glow
    if flip:
        rgba, g = rgba[:, ::-1], g[:, ::-1]
    a = rgba[..., 3]
    planes = [rgba[..., 0] * a, rgba[..., 1] * a, rgba[..., 2] * a, a, g * a]
    if scale == 1.0 and rot % 360 == 0:
        return [np.ascontiguousarray(q) for q in planes]
    out = []
    nw, nh = max(1, int(round(p.w * scale))), max(1, int(round(p.h * scale)))
    for q in planes:
        im = Image.fromarray(q.astype(F32), 'F')
        if scale != 1.0:
            im = im.resize((nw, nh), Image.LANCZOS if scale < 1 else Image.BICUBIC)
        if rot % 360:
            im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
        out.append(np.clip(np.asarray(im).astype(F32), 0, None))
    out[3] = np.clip(out[3], 0, 1)
    for k in (0, 1, 2, 4):
        out[k] = np.minimum(out[k], out[3])
    return out


class Canvas:
    """A square frame being assembled (output px, origin at its centre): premultiplied colour, alpha, light."""

    def __init__(self, S):
        self.S = S
        self.rgb = np.zeros((S, S, 3), F32)
        self.a = np.zeros((S, S), F32)
        self.g = np.zeros((S, S), F32)

    def place(self, p, cx, cy, scale=1.0, rot=0.0, flip=False, shadow=0.45, under=False, mirror=False, anchor=None):
        """Lay piece `p` with its centre (or `anchor`, piece px) at (cx, cy); `mirror`: also flipped at -cx (rot
        mirrored); `under`: beneath what is there; a soft contact shadow toward the lower right."""
        for m in ([False, True] if mirror else [False]):
            fl = flip != m
            x = -cx if m else cx
            r = -rot if m else rot
            planes = transform(p, scale, r, fl)
            ph, pw = planes[3].shape
            if anchor is None:
                ax, ay = pw / 2, ph / 2
            else:
                axp, ayp = anchor
                if fl:
                    axp = p.w - axp
                # the anchor through the transform (about the piece centre)
                dx, dy = (axp - p.w / 2) * scale, (ayp - p.h / 2) * scale
                th = math.radians(r)
                ax = pw / 2 + dx * math.cos(th) + dy * math.sin(th)
                ay = ph / 2 - dx * math.sin(th) + dy * math.cos(th)
            x0 = int(round(self.S / 2 + x - ax))
            y0 = int(round(self.S / 2 + cy - ay))
            self.over(planes, x0, y0, shadow, under)

    def line(self, pal, pts, width=2.0, dash=(7.0, 3.0), phase=0.0, mirror=False, glow=1.0):
        """A light line in the reference's style (as on the carrier): a thin dashed cyan line sunk in a dark groove,
        along the polyline `pts` (canvas coords); `mirror`: also at -x. Only on the hull (where it is opaque)."""
        S = self.S
        for m in ([False, True] if mirror else [False]):
            P = [(-x if m else x, y) for (x, y) in pts]
            xs = [x for x, _ in P]
            ys = [y for _, y in P]
            x0, x1 = int(max(0, S / 2 + min(xs) - 6)), int(min(S, S / 2 + max(xs) + 7))
            y0, y1 = int(max(0, S / 2 + min(ys) - 6)), int(min(S, S / 2 + max(ys) + 7))
            if x1 <= x0 or y1 <= y0:
                continue
            Y, X = np.mgrid[y0:y1, x0:x1].astype(F32) + 0.5 - S / 2
            best = np.full(X.shape, 1e9, F32)
            sv = np.zeros(X.shape, F32)
            acc = 0.0
            for i in range(len(P) - 1):
                ax, ay = P[i]
                bx, by = P[i + 1]
                dx, dy = bx - ax, by - ay
                l2 = dx * dx + dy * dy
                if l2 < 1e-6:
                    continue
                t = np.clip(((X - ax) * dx + (Y - ay) * dy) / l2, 0, 1)
                dd = np.hypot(X - ax - t * dx, Y - ay - t * dy)
                mm = dd < best
                best = np.where(mm, dd, best)
                sv = np.where(mm, acc + t * math.sqrt(l2), sv)
                acc += math.sqrt(l2)
            per = dash[0] + dash[1]
            f = (sv + phase) % per
            on = smoothstep(0.0, 0.8, f) * (1 - smoothstep(dash[0] - 0.8, dash[0], f))
            ends = smoothstep(0.0, 1.5, sv) * smoothstep(0.0, 1.5, acc - sv)
            core = np.clip(width * 0.5 + 0.5 - best, 0, 1) * on * ends
            groove = np.clip(width * 0.5 + 1.6 - best, 0, 1) * ends
            sl = (slice(y0, y1), slice(x0, x1))
            a = self.a[sl]
            hull = smoothstep(0.55, 0.9, a)
            self.rgb[sl] *= (1 - 0.5 * groove * hull)[..., None]
            col = pal.light(np.clip(0.55 + 0.4 * core, 0, 1)) * glow
            k = (core * hull)[..., None]
            self.rgb[sl] = self.rgb[sl] * (1 - k) + col * a[..., None] * k
            self.g[sl] = np.maximum(self.g[sl], core * hull * a * glow)

    def over(self, planes, x0, y0, shadow, under):
        S = self.S
        ph, pw = planes[3].shape
        sx0, sy0 = max(0, -x0), max(0, -y0)
        dx0, dy0 = max(0, x0), max(0, y0)
        dx1, dy1 = min(S, x0 + pw), min(S, y0 + ph)
        if dx1 <= dx0 or dy1 <= dy0:
            return
        sl = (slice(dy0, dy1), slice(dx0, dx1))
        cut = lambda q: q[sy0:sy0 + dy1 - dy0, sx0:sx0 + dx1 - dx0]
        prgb = np.stack([cut(planes[0]), cut(planes[1]), cut(planes[2])], -1)
        pa, pg = cut(planes[3]), cut(planes[4])
        if under:
            inv = 1 - self.a[sl]
            self.rgb[sl] = self.rgb[sl] + prgb * inv[..., None]
            self.g[sl] = self.g[sl] + pg * inv
            self.a[sl] = self.a[sl] + pa * inv
            return
        if shadow > 0:
            full = np.zeros((S, S), F32)
            full[sl] = pa
            sh = gblur(shift(full, 3, 2), 2.2) * shadow * (1 - full)
            self.rgb *= (1 - sh)[..., None]
            self.g *= (1 - sh)
        inv = 1 - pa
        self.rgb[sl] = prgb + self.rgb[sl] * inv[..., None]
        self.g[sl] = pg + self.g[sl] * inv
        self.a[sl] = pa + self.a[sl] * inv


# ---------------------------------------------------------------------------------------------------------------
# Frames: the rules, the light layer
# ---------------------------------------------------------------------------------------------------------------

def fix_markers(img):
    """No pixel in a marker colour (pure blue / pure yellow), no opaque black. Returns the count of pixels touched."""
    r, g, b, a = (img[..., i].astype(np.int32) for i in range(4))
    vis = a > 0
    blue = vis & (r == 0) & (g == 0) & (b == 255)
    yel = vis & (r == 255) & (g == 255) & (b == 0)
    img[blue, 2] = 254
    img[yel, 1] = 254
    black = (a == 255) & (r == 0) & (g == 0) & (b == 0)
    img[black, 0] = 2
    img[black, 1] = 2
    img[black, 2] = 3
    return int(blue.sum() + yel.sum() + black.sum())


def balance(img):
    """Centre the content's bounding box on the frame centre with up to four all-but-transparent pixels (alpha 1)."""
    S = img.shape[0]
    ys, xs = np.nonzero(img[..., 3] > 0)
    c = S // 2
    m = max(c - xs.min(), xs.max() - c, c - ys.min(), ys.max() - c)
    m = min(m, c - 1)
    n = 0
    for (y, x) in ((c, c - m), (c, c + m), (c - m, c), (c + m, c)):
        if img[y, x, 3] == 0:
            img[y, x] = (6, 7, 10, 1)
            n += 1
    return img, n


def to_u8(rgb, a):
    out = np.zeros(rgb.shape[:2] + (4,), np.uint8)
    out[..., :3] = np.round(np.clip(rgb, 0, 1) * 255)
    out[..., 3] = np.round(np.clip(a, 0, 1) * 255)
    out[out[..., 3] == 0] = 0
    return out


def light_layer(rgba, glow, pal, strength=0.75):
    """The swell of a frame's lights (additive, float RGB): the lines themselves brighter, and a soft halo round them."""
    a = rgba[..., 3]
    g = glow * a
    lines = pal.light(np.clip(0.6 + 0.4 * g, 0, 1)) * (g * strength)[..., None]
    halo = pal.light(np.full(g.shape, 0.85, F32)) * (np.clip(gblur(g, 2.2) * 1.8, 0, 1) * 0.45)[..., None]
    return np.clip(lines + halo, 0, 1).astype(F32)


def finish(cv, pal, margin=10):
    """The frame (uint8 RGBA, the rules applied: re-framed as the smallest square round its content with `margin` px
    all round, the content box centred) and its light layer."""
    a = np.clip(cv.a, 0, 1)
    rgb = cv.rgb / np.maximum(a, 1e-4)[..., None]
    img = to_u8(rgb, a)
    g = np.clip(cv.g / np.maximum(a, 1e-4), 0, 1) * (a > 0.02)
    ys, xs = np.nonzero(img[..., 3] > 0)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    S = int(max(x1 - x0, y1 - y0)) + 2 * margin
    S += S % 2
    ox, oy = (S - (x1 - x0)) // 2, (S - (y1 - y0)) // 2
    out = np.zeros((S, S, 4), np.uint8)
    out[oy:oy + y1 - y0, ox:ox + x1 - x0] = img[y0:y1, x0:x1]
    go = np.zeros((S, S), F32)
    go[oy:oy + y1 - y0, ox:ox + x1 - x0] = g[y0:y1, x0:x1]
    fix_markers(out)
    out, _ = balance(out)
    fx = light_layer(out.astype(F32) / 255, go, pal)
    return out, fx, go


# ---------------------------------------------------------------------------------------------------------------
# The Watchers: the reference exactly, cut into its moving parts
# ---------------------------------------------------------------------------------------------------------------

WATCHER_S = 540
# The body's edges in the leg zone (sprite rows, px from the centre column), read off the reference: where a row's
# run reaches further out it is a leg's root or tip
ENV_ROWS = [56, 86, 118, 132, 160, 168, 178, 186]
ENV_L = [39, 36, 35, 32.5, 38, 40, 41.5, 46.5]
ENV_R = [37, 35, 36, 31, 38.5, 40.5, 44, 51.5]
LEG_ZONE = (56, 186)          # sprite rows
LEG_CUTS = ((96, 112), (136, 154))
ABDOMEN = (194, 290, 338)     # the flank plates' bounds (sprite rows): two plates a side
QB = 0.58                     # the flank plates: beyond this fraction of the body's half width


def body_profile(m):
    """Per row the body's edges (px from the centre column): the run of the mask through the centre column (gaps of up
    to 2 px bridged); in the leg zone the thorax's own edge (ENV) unless the row's run is no wider than it."""
    h, w = m.shape
    ys, xs = np.nonzero(m > 127)
    cxs = (xs.min() + xs.max() + 1) / 2
    c = int(cxs)
    pl = np.full(h, np.nan, F32)
    pr = np.full(h, np.nan, F32)
    for y in range(h):
        row = m[y] > 127
        if not row.any():
            continue
        r2 = row.copy()
        for g in (1, 2):
            r2 = r2 | (np.roll(row, g) & np.roll(row, -g))
            r2 = r2 | (np.roll(row, -g) & np.roll(row, g + 1))
        if not r2[c]:
            continue
        a = c
        while a > 0 and r2[a - 1]:
            a -= 1
        b = c
        while b < w - 1 and r2[b + 1]:
            b += 1
        pl[y], pr[y] = a - cxs, b + 1 - cxs
    rows = np.nonzero(np.isfinite(pl))[0]
    yb0, yb1 = int(rows.min()), int(rows.max())
    for y in range(LEG_ZONE[1] + 1, h):
        xs_ = np.nonzero(m[y] > 127)[0]
        if len(xs_):
            pl[y], pr[y] = xs_.min() - cxs, xs_.max() + 1 - cxs
    for y in range(LEG_ZONE[0], LEG_ZONE[1] + 1):
        el, er = float(np.interp(y, ENV_ROWS, ENV_L)), float(np.interp(y, ENV_ROWS, ENV_R))
        pl[y] = pl[y] if np.isfinite(pl[y]) and -pl[y] <= el + 2.5 else -el
        pr[y] = pr[y] if np.isfinite(pr[y]) and pr[y] <= er + 2.5 else er
    for y in range(yb0, yb1 + 1):
        if not np.isfinite(pl[y]):
            pl[y], pr[y] = pl[y - 1], pr[y - 1]
    return cxs, pl - 1.0, pr + 1.0, yb0, yb1


def build_watcher(kit):
    """The closed Watcher (the reference), its open body (the reference less its moving parts, the cavity under the
    flank plates) and the parts (horns, legs, flank plates) with their hinges, swings and delays."""
    ref = kit.ref
    h0, w0 = ref.shape[:2]
    a8 = np.round(ref[..., 3] * 255)
    cxs, pl, pr, yb0, yb1 = body_profile(a8)
    S = WATCHER_S
    ys, xs = np.nonzero(a8 > 0)
    # the reference on the canvas: integer offset, its content box centred (no resampling)
    ox = int(round(S / 2 - (xs.min() + xs.max() + 1) / 2))
    oy = int(round(S / 2 - (ys.min() + ys.max() + 1) / 2))
    to_c = lambda x, y: (x + ox - S / 2, y + oy - S / 2)       # sprite px -> canvas coords (origin at the centre)
    X = (np.arange(w0) + 0.5)[None, :] - cxs
    Yr = np.arange(h0)[:, None]
    body = np.zeros((h0, w0), bool)
    for y in range(yb0, yb1 + 1):
        body[y] = (X[0] >= pl[y]) & (X[0] <= pr[y])
    rest = (a8 > 0) & ~body
    g_ref, _, _ = glow_mask(ref)
    # regions: per side the horn (above the body) and three legs, banded at the rows with the least leg
    lab = np.zeros((h0, w0), np.int32)
    regions = []
    n = 0
    for side in (-1, 1):
        sidem = (X * side > 0) & np.ones((h0, 1), bool)
        cnt = ((a8 > 90) & ~body & sidem).sum(1)
        cuts = [yb0] + [lo + int(np.argmin(cnt[lo:hi + 1])) for (lo, hi) in LEG_CUTS] + [LEG_ZONE[1] + 8]
        n += 1
        lab[rest & sidem & (Yr < yb0)] = n
        regions.append(dict(id=n, side=side, kind='horn', y=float(yb0)))
        for i in range(3):
            n += 1
            lab[rest & sidem & (Yr >= cuts[i]) & (Yr < cuts[i + 1])] = n
            regions.append(dict(id=n, side=side, kind='leg', y=float((cuts[i] + cuts[i + 1]) / 2)))
    stray = rest & (lab == 0)
    # stray outline pixels outside every band join the body (they stay put)
    body = body | stray
    # the flank plates: beyond QB of the half width, between the ABDOMEN rows, each side
    half = np.where(X >= 0, np.maximum(pr[:, None], 1), np.maximum(-pl[:, None], 1))
    q = np.abs(X) / half
    flank = body & (q > QB) & (Yr >= ABDOMEN[0]) & (Yr < ABDOMEN[-1])
    parts = []
    for rg in regions:
        m = (lab == rg['id'])
        if m.sum() == 0:
            continue
        # the hinge: where it meets the body (a horn: its foot)
        nb = gblur((body & ~flank).astype(F32), 1.5) > 0.05
        root = m & nb
        ry, rx = np.nonzero(root if root.any() else m)
        if rg['kind'] == 'leg':
            top = ry <= np.percentile(ry, 45)
            hx, hy = float(np.median(rx[top]) + 0.5), float(np.median(ry[top]) + 0.5)
            swing, delay = -rg['side'] * 0.28, 0.05 + 0.25 * (rg['y'] - LEG_ZONE[0]) / (LEG_ZONE[1] - LEG_ZONE[0])
        else:
            hx, hy = float(rx.mean() + 0.5), float(ry.max() + 0.5)
            swing, delay = rg['side'] * 0.2, 0.0
        parts.append(dict(mask=m, hinge=to_c(hx, hy), swing=swing, delay=delay, kind=rg['kind']))
    for side in (-1, 1):
        for i in range(len(ABDOMEN) - 1):
            m = flank & (X * side > 0) & (Yr >= ABDOMEN[i]) & (Yr < ABDOMEN[i + 1])
            ry, rx = np.nonzero(m)
            inner = np.abs(rx + 0.5 - cxs) <= np.percentile(np.abs(rx + 0.5 - cxs), 20)
            hx, hy = float(np.median(rx[inner]) + 0.5), float(ry.min() + 0.5)
            parts.append(dict(mask=m, hinge=to_c(hx, hy), swing=-side * 0.16, delay=0.35 + 0.25 * i, kind='plate'))
    # on the canvas
    def canvas_of(rgba):
        c = np.zeros((S, S, 4), F32)
        c[oy:oy + h0, ox:ox + w0] = rgba
        return c

    closed = to_u8(*(lambda c: (c[..., :3], c[..., 3]))(canvas_of(ref)))
    touched = fix_markers(closed)
    closed, nbal = balance(closed)
    print('watcher: reference pixels touched by the frame rules', touched, '+ balance pixels', nbal, flush=True)
    # the open body: the reference less the parts, the cavity painted under the flank plates
    moving = np.zeros((h0, w0), bool)
    for p in parts:
        moving |= p['mask']
    body_rgba = ref.copy()
    body_rgba[..., 3] = np.where(moving & ~flank, 0, body_rgba[..., 3])
    cav = cavity(kit.pal, ref, flank, X, Yr, half)
    body_rgba[..., :3] = np.where(flank[..., None], cav[..., :3], body_rgba[..., :3])
    body_img = to_u8(canvas_of(body_rgba)[..., :3], canvas_of(body_rgba)[..., 3])
    fix_markers(body_img)
    cav_glow = np.where(flank, cav[..., 3], 0)
    # the parts, each on the canvas (cropped by pack)
    part_imgs = []
    for p in parts:
        r = ref.copy()
        r[..., 3] = r[..., 3] * p['mask']
        im = to_u8(canvas_of(r)[..., :3], canvas_of(r)[..., 3])
        fix_markers(im)
        part_imgs.append(im)
    # the light: the reference's lines (closed); the cavity's glow and the leg sockets (open)
    # the small light in the head (it would read as an eye) keeps its pixels but takes no part in the swell
    spot = (Yr < yb0 + 30) & (np.abs(X) < 8)
    g_pulse = np.where(spot, 0, g_ref)
    g_c = canvas_of(np.concatenate([np.zeros((h0, w0, 3), F32), g_pulse[..., None]], -1))[..., 3]
    fx = light_layer(closed.astype(F32) / 255, g_c, kit.pal)
    sock = np.zeros((S, S), F32)
    Yc, Xc = np.mgrid[0:S, 0:S].astype(F32) + 0.5
    for p in parts:
        if p['kind'] == 'leg':
            hx, hy = p['hinge'][0] + S / 2, p['hinge'][1] + S / 2
            sock = np.maximum(sock, np.exp(-((Xc - hx) ** 2 + (Yc - hy) ** 2) / 16.0) * 0.8)
    cg = canvas_of(np.concatenate([np.zeros((h0, w0, 3), F32), cav_glow[..., None]], -1))[..., 3]
    open_fx = kit.pal.light(np.full((S, S), 0.8, F32)) * np.clip(np.maximum(sock, cg * 0.7), 0, 1)[..., None]
    return dict(S=S, closed=closed, body=body_img, parts=[(im, p['hinge'], p['swing'], p['delay']) for im, p in zip(part_imgs, parts)],
                fx=fx, open_fx=open_fx.astype(F32))


def cavity(pal, ref, flank, X, Yr, half):
    """Under a flank plate: a recess ribbed across, dark, the reference's cyan between its ribs (RGBA, A = its light)."""
    h, w = flank.shape
    q = np.clip(np.abs(X) / half, 0, 1)
    rib = np.sqrt(np.clip(1 - (2 * ((Yr / 5.0) % 1.0) - 1) ** 2, 0, 1)) * np.ones((1, w))
    depth = smoothstep(QB, QB + 0.12, q) * (1 - smoothstep(0.92, 1.0, q))
    L = (0.035 + 0.11 * rib) * (0.55 + 0.45 * depth)
    col = pal.hull(L.astype(F32))
    light = np.clip(1 - rib * 1.7, 0, 1) * depth
    col = col * (1 - light[..., None]) + pal.light(np.full((h, w), 0.7, F32)) * light[..., None] * 0.8
    return np.concatenate([col, light[..., None]], -1).astype(F32)


def watcher_pose(w, t):
    """The Watcher at opening t (0 closed .. 1 open), on transparent (RGBA uint8), with the opened light."""
    S = w['S']
    if t <= 0:
        return Image.fromarray(w['closed'], 'RGBA')
    canvas = Image.fromarray(w['body'], 'RGBA').copy()
    arr = np.asarray(canvas).astype(F32) / 255
    rise = float(smoothstep(0, 0.6, t))
    arr[..., :3] = np.clip(arr[..., :3] + w['open_fx'] * rise * 0.6 * (arr[..., 3:4] > 0), 0, 1)
    canvas = Image.fromarray(np.round(arr * 255).astype(np.uint8), 'RGBA')
    for (img, hinge, swing, delay) in w['parts']:
        u = float(np.clip((t - delay) / max(1 - delay, 1e-3), 0, 1))
        u = u * u * (3 - 2 * u)
        im = Image.fromarray(img, 'RGBA').rotate(-math.degrees(swing * u), resample=Image.BICUBIC,
                                                center=(hinge[0] + S / 2, hinge[1] + S / 2))
        canvas.alpha_composite(im)
    return canvas


# ---------------------------------------------------------------------------------------------------------------
# The warships: composites of the set's pieces (bow up; canvas coords, origin at the frame centre)
# ---------------------------------------------------------------------------------------------------------------

def design_escort(kit):
    """The escort: the passenger ship's slim body (its cyan chevrons) carrying the escort's great claws."""
    cv = Canvas(330)
    body = kit.cut('passengership', box=(108, 52, 200, 300), keep=lambda X, Y: smoothstep(56, 64, Y))
    cv.place(body, 0, 22)
    claws = kit.cut('escort', box=(88, 0, 210, 140), keep=lambda X, Y: 1 - smoothstep(118, 136, Y) * (np.abs(X - 149) < 34))
    cv.place(claws, 0, -86, scale=0.82, under=True)
    cv.line(kit.pal, [(0, -40), (0, 120)], dash=(6, 3))
    return cv


def design_frigate(kit):
    """The frigate: the frigate's horned front and legs run into the large freighter's split twin tail."""
    cv = Canvas(360)
    front = kit.cut('frigate', box=(100, 0, 208, 170), keep=lambda X, Y: 1 - smoothstep(150, 168, Y))
    tail = kit.cut('largefreighter', box=(98, 120, 210, 300), keep=lambda X, Y: smoothstep(126, 140, Y))
    cv.place(tail, 0, 62, scale=1.05)
    cv.place(front, 0, -78)
    cv.line(kit.pal, [(-40, -18), (0, 0), (40, -18)])
    cv.line(kit.pal, [(0, -100), (0, 70)], dash=(6, 3))
    cv.line(kit.pal, [(-14, 30), (-34, 66)], mirror=True)
    return cv


def design_destroyer(kit):
    """The destroyer: the destroyer's four great arms and core on the cruiser's long abdomen."""
    cv = Canvas(420)
    abdomen = kit.cut('cruiser', box=(160, 180, 336, 494), keep=lambda X, Y: smoothstep(186, 200, Y))
    cv.place(abdomen, 0, 50, scale=0.86)
    arms = kit.cut('destroyer', box=(28, 0, 272, 220), keep=lambda X, Y: 1 - smoothstep(196, 214, Y))
    cv.place(arms, 0, -100)
    cv.line(kit.pal, [(-46, -12), (0, 8), (46, -12)])
    cv.line(kit.pal, [(0, -40), (0, 150)], dash=(6, 3))
    cv.line(kit.pal, [(-10, 60), (-36, 92)], mirror=True)
    return cv


def design_cruiser(kit):
    """The cruiser: the cruiser's horned head and thorax, the colony ship's spined rear, the capital ship's flank spines."""
    cv = Canvas(560)
    rear = kit.cut('colonyship', box=(140, 230, 366, 500), keep=lambda X, Y: smoothstep(236, 256, Y))
    cv.place(rear, 0, 120, scale=0.86)
    spines = kit.cut('capitalship', box=(143, 160, 214, 280), keep=lambda X, Y: smoothstep(196, 206, X) * 0 + (X < 205))
    cv.place(spines, -78, 30, mirror=True, under=True)
    front = kit.cut('cruiser', box=(160, 0, 336, 330), keep=lambda X, Y: 1 - smoothstep(300, 328, Y))
    cv.place(front, 0, -110)
    cv.line(kit.pal, [(-62, 22), (0, 46), (62, 22)])
    cv.line(kit.pal, [(0, -130), (0, 190)], dash=(7, 3))
    cv.line(kit.pal, [(-44, -96), (0, -82), (44, -96)])
    cv.line(kit.pal, [(-14, 100), (-46, 140)], mirror=True)
    return cv


def design_capitalship(kit):
    """The capital ship (the longest): the capital ship's silver-spined front, the troop transport's great arms at
    its shoulders, the colony ship's spined body behind."""
    cv = Canvas(660)
    rear = kit.cut('colonyship', box=(128, 180, 378, 500), keep=lambda X, Y: smoothstep(186, 206, Y))
    cv.place(rear, 0, 150)
    arms = kit.cut('trooptransport', box=(111, 0, 200, 175), keep=lambda X, Y: (X < 196))
    cv.place(arms, -78, -150, mirror=True, under=True)
    front = kit.cut('capitalship', box=(140, 0, 362, 330), keep=lambda X, Y: 1 - smoothstep(300, 328, Y))
    cv.place(front, 0, -150)
    cv.line(kit.pal, [(-70, -12), (0, 14), (70, -12)])
    cv.line(kit.pal, [(0, -230), (0, 250)], dash=(8, 3))
    cv.line(kit.pal, [(-52, -150), (0, -128), (52, -150)])
    cv.line(kit.pal, [(-16, 110), (-56, 160)], mirror=True)
    return cv


def design_carrier(kit):
    """The carrier: the troop transport's broad armed front over the supply ship's wide dark launch wings, their bays lit."""
    cv = Canvas(600)
    wings = kit.cut('resupplyship', box=(100, 180, 406, 500), keep=lambda X, Y: smoothstep(188, 210, Y))
    cv.place(wings, 0, 112)
    front = kit.cut('trooptransport', box=(108, 0, 394, 330), keep=lambda X, Y: 1 - smoothstep(300, 328, Y))
    cv.place(front, 0, -118)
    cv.line(kit.pal, [(-74, 18), (0, 44), (74, 18)])
    cv.line(kit.pal, [(0, -150), (0, 230)], dash=(8, 3))
    cv.line(kit.pal, [(-60, 70), (-130, 160)], mirror=True)
    return cv


def design_trooptransport(kit):
    """The troop transport: the gas miner's double hull (its pods), the passenger ship's head, the frigate's tail."""
    cv = Canvas(480)
    tail = kit.cut('frigate', box=(100, 160, 208, 300), keep=lambda X, Y: smoothstep(166, 182, Y))
    cv.place(tail, 0, 150, scale=1.1)
    body = kit.cut('gasminingship', box=(18, 0, 284, 296))
    cv.place(body, 0, 0)
    head = kit.cut('passengership', box=(108, 0, 200, 110), keep=lambda X, Y: 1 - smoothstep(92, 108, Y))
    cv.place(head, 0, -150, under=True)
    cv.line(kit.pal, [(-60, -20), (0, 6), (60, -20)])
    cv.line(kit.pal, [(0, -110), (0, 200)], dash=(6, 3))
    return cv


def design_construction(kit):
    """The utility ship: the supply ship's many work arms round the large freighter's twin-tailed hull."""
    cv = Canvas(440)
    hull = kit.cut('largefreighter', box=(98, 0, 210, 300))
    cv.place(hull, 0, 24, scale=1.15)
    arms = kit.cut('resupplyship', box=(100, 0, 406, 240), keep=lambda X, Y: 1 - smoothstep(214, 236, Y))
    cv.place(arms, 0, -92, scale=0.72, under=True)
    cv.line(kit.pal, [(0, -40), (0, 160)], dash=(6, 3))
    return cv


def design_beacon(kit):
    """The Beacon, seen from above: two of the set's three-spined stations crossed into a six-pointed star, a third
    station's three lobes over the hub."""
    cv = Canvas(860)
    star = kit.cut('genericbase', match=0.9)
    cv.place(star, 0, 0, scale=1.45, rot=0, anchor=(248.5, 300.0))
    cv.place(star, 0, 0, scale=1.45, rot=60, anchor=(248.5, 300.0), under=True)
    hub = kit.cut('gasminingstation', match=0.9)
    cv.place(hub, 0, 0, scale=0.7, rot=180, anchor=(249.0, 250.0))
    # the light lines: dashed down each spine, a ring round the hub
    for k in range(6):
        th = math.radians(k * 60)
        r0, r1 = (120, 330) if k % 2 == 0 else (110, 300)
        cv.line(kit.pal, [(r0 * math.sin(th), -r0 * math.cos(th)), (r1 * math.sin(th), -r1 * math.cos(th))], width=2.4, dash=(9, 4))
    ring = [(96 * math.sin(math.radians(a)), -96 * math.cos(math.radians(a))) for a in range(0, 361, 6)]
    cv.line(kit.pal, ring, width=2.4, dash=(10, 4))
    return cv


DESIGNS = {
    'escort': design_escort,
    'frigate': design_frigate,
    'destroyer': design_destroyer,
    'cruiser': design_cruiser,
    'capitalship': design_capitalship,
    'carrier': design_carrier,
    'trooptransport': design_trooptransport,
    'construction': design_construction,
    'beacon': design_beacon,
}


# ---------------------------------------------------------------------------------------------------------------
# Outputs: frames, the light atlases, the data table
# ---------------------------------------------------------------------------------------------------------------

def layer_rgba(light):
    """An additive light layer as straight-alpha RGBA: alpha = intensity (max channel), colour = light / intensity."""
    inten = np.clip(light.max(-1), 0, 1)
    colour = light / np.maximum(inten[..., None], 1e-4)
    out = np.zeros(light.shape[:2] + (4,), F32)
    out[..., :3] = np.clip(colour, 0, 1)
    out[..., 3] = inten
    out[out[..., 3] < 2 / 255] = 0
    return out


def crop_box(a, pad=1):
    ys, xs = np.nonzero(a > 0)
    if len(ys) == 0:
        return 0, 0, 1, 1
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return max(0, x0 - pad), max(0, y0 - pad), min(a.shape[1], x1 + pad), min(a.shape[0], y1 + pad)


def pack(images, float_rgba=False):
    """Crop each image (S x S x 4: uint8 RGBA, or float straight-alpha) to its content and pack them in a column.
    Returns (atlas uint8, rects [(x, y, w, h, dx, dy)])."""
    crops = []
    for im in images:
        x0, y0, x1, y1 = crop_box(im[..., 3])
        crops.append((im[y0:y1, x0:x1], int(x0), int(y0)))
    W = max(c[0].shape[1] for c in crops)
    Hh = sum(c[0].shape[0] + 2 for c in crops)
    atlas = np.zeros((Hh, W, 4), F32 if float_rgba else np.uint8)
    rects = []
    y = 0
    for (c, dx, dy) in crops:
        h, w = c.shape[:2]
        atlas[y:y + h, 0:w] = c
        rects.append((0, y, w, h, dx, dy))
        y += h + 2
    if float_rgba:
        atlas = np.round(np.clip(atlas, 0, 1) * 255).astype(np.uint8)
    fix_markers(atlas)
    return atlas, rects


def save(img, path):
    Image.fromarray(img, 'RGBA').save(path, optimize=True)


def write_frame(name, img, fx, out):
    save(img, os.path.join(out, name + '.png'))
    atlas, rects = pack([layer_rgba(fx)], float_rgba=True)
    save(atlas, os.path.join(out, name + '-fx.png'))
    S = img.shape[0]
    return dict(size=S, breath=BREATH[name], glow=rects[0])


def write_watcher(w, out):
    S = w['S']
    save(w['closed'], os.path.join(out, 'watcher.png'))
    save(w['body'], os.path.join(out, 'watcher-body.png'))
    atlas, prs = pack([p[0] for p in w['parts']])
    save(atlas, os.path.join(out, 'watcher-parts.png'))
    fxa, rects = pack([layer_rgba(w['fx']), layer_rgba(w['open_fx'])], float_rgba=True)
    save(fxa, os.path.join(out, 'watcher-fx.png'))
    parts = [dict(rect=r, hinge=(hinge[0] + S / 2, hinge[1] + S / 2), swing=swing, delay=delay)
             for (img, hinge, swing, delay), r in zip(w['parts'], prs)]
    return dict(size=S, breath=BREATH['watcher'], glow=rects[0],
                sockets=rects[1], parts=parts)


def ts_rect(r):
    x, y, w, h, dx, dy = r
    return '{ x: %d, y: %d, w: %d, h: %d, dx: %d, dy: %d }' % (x, y, w, h, dx, dy)


def write_data(path, frames, watcher):
    out = ["// GENERATED by scripts/beacon-ships.py (do not edit): the Beacon's bundled art (public/art/beacon/, built from the",
           "// Mass Effect 4 Mod's Reaper set) - per frame its breathing period (s) and its",
           "// lights' swell in <file>-fx.png (x, y, w, h in the atlas; dx, dy where it sits on the frame); the Watcher's moving",
           '// parts (in watcher-parts.png, at dx, dy on its canvas), their hinges (canvas px), swings (rad) and delays. beaconFx.ts reads it.',
           '',
           'export interface BeaconFxRect {',
           '    readonly x: number;',
           '    readonly y: number;',
           '    readonly w: number;',
           '    readonly h: number;',
           '    readonly dx: number;',
           '    readonly dy: number;',
           '}',
           '',
           'export interface BeaconFrameArt {',
           '    /** Frame side (px). */',
           '    readonly size: number;',
           '    /** Breathing period (s). */',
           '    readonly breath: number;',
           "    /** The lights' swell (additive). */",
           '    readonly glow: BeaconFxRect;',
           '}',
           '',
           'export const BEACON_FRAMES: Readonly<Record<string, BeaconFrameArt>> = {']
    for name, d in frames:
        out.append('    %s: {' % name)
        out.append('        size: %d,' % d['size'])
        out.append('        breath: %.2f,' % d['breath'])
        out.append('        glow: %s,' % ts_rect(d['glow']))
        out.append('    },')
    out.append('};')
    out.append('')
    out += ['export interface WatcherPartArt {',
            '    /** Its rectangle in watcher-parts.png (x, y, w, h) and where it sits on the canvas at rest (dx, dy). */',
            '    readonly rect: BeaconFxRect;',
            '    /** The hinge it swings about (canvas px). */',
            '    readonly hinge: readonly [number, number];',
            '    /** Its swing when fully open (rad, screen rotation about the hinge). */',
            '    readonly swing: number;',
            '    /** When it starts to move (a fraction of the opening). */',
            '    readonly delay: number;',
            '}',
            '',
            'export interface WatcherArt extends BeaconFrameArt {',
            '    /** The light in the cavity and the sockets the parts uncover as they swing out (in watcher-fx.png). */',
            '    readonly sockets: BeaconFxRect;',
            '    readonly parts: readonly WatcherPartArt[];',
            '}',
            '']
    w = watcher
    out.append('export const WATCHER_ART: WatcherArt = {')
    out.append('    size: %d,' % w['size'])
    out.append('    breath: %.2f,' % w['breath'])
    out.append('    glow: %s,' % ts_rect(w['glow']))
    out.append('    sockets: %s,' % ts_rect(w['sockets']))
    out.append('    parts: [')
    for p in w['parts']:
        out.append('        { rect: %s, hinge: [%.1f, %.1f], swing: %.4f, delay: %.3f },' % (ts_rect(p['rect']), p['hinge'][0], p['hinge'][1], p['swing'], p['delay']))
    out.append('    ],')
    out.append('};')
    out.append('')
    with open(path, 'w') as f:
        f.write('\n'.join(out))


# ---------------------------------------------------------------------------------------------------------------
# Previews
# ---------------------------------------------------------------------------------------------------------------

def starfield(w, h, seed=3):
    bg = np.zeros((h, w, 4), np.uint8)
    bg[...] = (4, 5, 9, 255)
    rng = np.random.default_rng(seed)
    for _ in range(w * h // 700):
        y, x = rng.integers(h), rng.integers(w)
        v = int(rng.integers(50, 190))
        bg[y, x] = (v, v, min(255, v + 25), 255)
    return Image.fromarray(bg, 'RGBA')


def fleet_sheet(out_dir, frames, watcher):
    """The whole fleet at full frame size (cropped), the Watcher closed and open, the Beacon; small sizes underneath."""
    os.makedirs(out_dir, exist_ok=True)
    items = [(n, Image.fromarray(img, 'RGBA')) for n, img in frames if n != 'beacon']
    if watcher is not None:
        items += [('watcher', watcher_pose(watcher, 0.0)), ('watcher (open)', watcher_pose(watcher, 1.0))]
    crops = [(n, im.crop(im.getbbox())) for n, im in items]
    pad = 24
    W = sum(c.width for _, c in crops) + pad * (len(crops) + 1)
    H = max(c.height for _, c in crops) + 40 + 140
    sheet = starfield(W, H)
    d = ImageDraw.Draw(sheet)
    x = pad
    for n, c in crops:
        sheet.alpha_composite(c, (x, 26 + (H - 180 - c.height)))
        d.text((x, 8), n, fill=(230, 232, 245, 255))
        cr = c
        f = 90 / max(cr.size)
        t = cr.resize((max(1, int(cr.width * f)), max(1, int(cr.height * f))), Image.LANCZOS)
        sheet.alpha_composite(t, (x, H - 120))
        f = 40 / max(cr.size)
        t2 = cr.resize((max(1, int(cr.width * f)), max(1, int(cr.height * f))), Image.LANCZOS)
        sheet.alpha_composite(t2, (x + t.width + 10, H - 60))
        x += c.width + pad
    sheet.save(os.path.join(out_dir, 'fleet-sheet.png'))
    for n, img in frames:
        if n == 'beacon':
            im = Image.fromarray(img, 'RGBA')
            bg = starfield(im.width, im.height)
            bg.alpha_composite(im)
            bg.save(os.path.join(out_dir, 'beacon-preview.png'))
    if watcher is not None:
        poses = [watcher_pose(watcher, t) for t in (0.0, 0.5, 1.0)]
        bb = poses[2].getbbox()
        bb = (min(bb[0], poses[0].getbbox()[0]), 0, max(bb[2], poses[0].getbbox()[2]), watcher['S'])
        ww = bb[2] - bb[0]
        sh = starfield(ww * 3 + 40, watcher['S'])
        for i, p in enumerate(poses):
            sh.alpha_composite(p.crop(bb), (10 + i * (ww + 10), 0))
        sh.save(os.path.join(out_dir, 'watcher-poses.png'))
    print('sheet', os.path.join(out_dir, 'fleet-sheet.png'), flush=True)


# ---------------------------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dwu', default=os.path.join(GAME, 'public', 'assets', 'dwu'))
    ap.add_argument('--out', default=os.path.join(GAME, 'public', 'art', 'beacon'))
    ap.add_argument('--data', default=os.path.join(GAME, 'src', 'render', 'beaconArtData.ts'))
    ap.add_argument('--preview', default=None)
    ap.add_argument('--only', default=None, help='comma-separated frames (and/or "watcher"); skips writing --data')
    args = ap.parse_args()
    kit = Kit(args.dwu)
    names = list(DESIGNS) + ['watcher'] if args.only is None else args.only.split(',')
    os.makedirs(args.out, exist_ok=True)
    frames, made, watcher, wdata = [], [], None, None
    for name in names:
        if name == 'watcher':
            watcher = build_watcher(kit)
            wdata = write_watcher(watcher, args.out)
            print('watcher', len(watcher['parts']), 'parts', flush=True)
            continue
        cv = DESIGNS[name](kit)
        img, fx, _ = finish(cv, kit.pal)
        frames.append((name, write_frame(name, img, fx, args.out)))
        made.append((name, img))
        print(name, img.shape[0], flush=True)
    if args.only is None:
        write_data(args.data, frames, wdata)
        print('data', args.data)
    if args.preview:
        fleet_sheet(args.preview, made, watcher)


if __name__ == '__main__':
    main()
