#!/usr/bin/env python3
"""The Beacon's art (Giantworks add-on, the Beacon wonder): the Reclaimers' warships, the two Watchers and the finished
Beacon, built from the Mass Effect 4 Mod's Reaper ship set. Offline build step; the outputs are committed under
public/art/beacon/ (src/render/threatArt.ts beaconArtUrl draws them; src/render/beaconFx.ts animates them), plus the
table src/render/beaconArtData.ts (each frame's breathing period and light layer, the Watcher's moving parts),
written by this script.

    python3 -I scripts/beacon-ships.py [--dwu <DW:U install>] [--out public/art/beacon]
        [--data src/render/beaconArtData.ts] [--preview <dir>] [--only escort,watcher,beacon]

Credits: the Beacon faction's ships are built from the Mass Effect 4 Mod for DW:U (original Mass Effect Mod by
Kalthaniell + Team for Legends, modified for Shadows by dostillevi, for Universe by Demonius, compiled and assembled
(ME4) by Tyrador, using some of the Prothean Cycle mod's assets), used with the user's decision (2026-10-17).

NEEDS THE MOD INSTALLED: it reads the Reaper set, <DW:U>/Customization/Mass Effect 4 Mod/images/units/ships/family15/
(or the same set as family20 in Customization/MassEffect mod 1.00/shipImages/), default --dwu public/assets/dwu (the
symlink npm run import-assets makes). Python 3 with numpy and Pillow only. Deterministic.

- The Watchers are the mod's carrier.png exactly: its own pixels, at its native scale, centred on a padded canvas; the
  only pixels touched are the ones the frame rules demand (none of opaque black or a marker colour in that sprite; the
  four balance pixels). For their opening (when sighted) the reference is cut into its body, its two horns, its six
  legs and two flank plates a side (watcher-parts.png); under the flank plates the open body (watcher-body.png)
  shows a ribbed cavity lit red-orange from inside; as it opens its cyan lines heat to red-orange (watcher-hot.png: the
  lines recoloured, the body's and each part's on that part's own box, beaconFx.ts blends them in); closed, the frame
  is the reference.
- The warships and the Beacon are composites: pieces cut from the set's frames (cut edges bevelled), transformed,
  mirrored and meshed into new ships, each with a contact shadow on what is below. The warships are long and slim:
  every piece's legs and side spines are cut away (body_mask: a morphological opening of its alpha) and the bodies
  drawn out lengthwise; the escort, frigate, troop transport and utility ship have no legs, the destroyer and cruiser
  carry a pair laid back along their flanks, the capital ship (the biggest and heaviest) its side spines swept back
  and the Watcher's own tapering tail. Every piece but the reference's is
  graded to the reference's palette (its hull luminance matched to the carrier's, its colour to the carrier's neutral
  gunmetal per luminance band, a trace of its own hue kept), its cyan lights to the carrier's cyan.
- The Beacon (the station) is a relay, the user's design: the mod's Mass Relay picture (environment/planets/other/
  massrelay.png) for its layout only; a ring of the capital ship's plated spine bent round (a polar warp), two parallel
  prongs of stacked hull segments (cruiser thorax, colony-ship body, capital-ship spine, the carrier's tapering tail),
  antenna masts (the generic base's spines) fanned off the ring's back, clamp blocks and a brace between the prongs, in
  the faction's wine-red light with deep teal marks.
  Its outputs: beacon.png (at rest), beacon-body.png (less the lower prong's tip, the gyros and the core: beaconFx.ts
  draws them), beacon-parts.png, beacon-fx.png, beacon-beam.png (the launch beam's procedural textures) and the
  BEACON_RELAY / BEACON_BEAM tables.
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
# The Watcher's light when it opens: its lines and cavity turn from the reference's cyan to a red-orange heat
# (value -> colour: deep red, red-orange, orange, a pale-orange core).
WARM_X = np.array([0.0, 0.35, 0.6, 0.85, 1.0], F32)
WARM_C = np.array([[0.10, 0.01, 0.0], [0.62, 0.07, 0.02], [0.95, 0.30, 0.06], [1.0, 0.56, 0.16], [1.0, 0.82, 0.52]], F32)


def warm(v):
    out = np.empty(np.shape(v) + (3,), F32)
    for c in range(3):
        out[..., c] = np.interp(v, WARM_X, WARM_C[:, c])
    return out


class WarmPalette:
    """The light_layer interface in the opening's red-orange."""

    @staticmethod
    def light(v):
        return warm(v)


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


def transform(p, scale=1.0, rot=0.0, flip=False, sy=1.0):
    """Premultiplied (rgb·a, a, glow·a) planes of a piece, flipped, scaled and rotated (deg, counter-clockwise on
    screen) about its centre; exact (no resampling) when scale is 1 and rot 0."""
    rgba, g = p.rgba, p.glow
    if flip:
        rgba, g = rgba[:, ::-1], g[:, ::-1]
    a = rgba[..., 3]
    planes = [rgba[..., 0] * a, rgba[..., 1] * a, rgba[..., 2] * a, a, g * a]
    if scale == 1.0 and sy == 1.0 and rot % 360 == 0:
        return [np.ascontiguousarray(q) for q in planes]
    out = []
    nw, nh = max(1, int(round(p.w * scale))), max(1, int(round(p.h * scale * sy)))
    for q in planes:
        im = Image.fromarray(q.astype(F32), 'F')
        if scale != 1.0 or sy != 1.0:
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

    def place(self, p, cx, cy, scale=1.0, rot=0.0, flip=False, shadow=0.45, under=False, mirror=False, anchor=None, sy=1.0):
        """Lay piece `p` with its centre (or `anchor`, piece px) at (cx, cy); `mirror`: also flipped at -cx (rot
        mirrored); `under`: beneath what is there; a soft contact shadow toward the lower right."""
        for m in ([False, True] if mirror else [False]):
            fl = flip != m
            x = -cx if m else cx
            r = -rot if m else rot
            planes = transform(p, scale, r, fl, sy)
            ph, pw = planes[3].shape
            if anchor is None:
                ax, ay = pw / 2, ph / 2
            else:
                axp, ayp = anchor
                if fl:
                    axp = p.w - axp
                # the anchor through the transform (about the piece centre)
                dx, dy = (axp - p.w / 2) * scale, (ayp - p.h / 2) * scale * sy
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
    print('watcher: cavity in the opening\'s red-orange', flush=True)
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
    open_fx = warm(np.full((S, S), 0.8, F32)) * np.clip(np.maximum(sock, cg * 0.7), 0, 1)[..., None]
    # the heat: the lines recoloured red-orange (normal-blended over the cyan as the Watcher opens), on the body and on
    # each part; its swell in the same colours
    v = ref[..., :3].max(-1)
    hot_rgb = warm(np.clip(0.15 + 0.72 * v, 0, 1))
    g_hot = g_pulse * ref[..., 3]
    hot = lambda m: canvas_of(np.concatenate([hot_rgb, (g_hot * m)[..., None]], -1))
    hot_body = hot((~moving) * 1.0)
    hot_parts = [hot(p['mask'] * 1.0) for p in parts]
    warm_fx = light_layer(closed.astype(F32) / 255, g_c, WarmPalette)
    return dict(S=S, closed=closed, body=body_img, parts=[(im, p['hinge'], p['swing'], p['delay']) for im, p in zip(part_imgs, parts)],
                fx=fx, open_fx=open_fx.astype(F32), hot_body=hot_body, hot_parts=hot_parts, warm_fx=warm_fx)


def cavity(pal, ref, flank, X, Yr, half):
    """Under a flank plate: a recess ribbed across, dark, the reference's cyan between its ribs (RGBA, A = its light)."""
    h, w = flank.shape
    q = np.clip(np.abs(X) / half, 0, 1)
    rib = np.sqrt(np.clip(1 - (2 * ((Yr / 5.0) % 1.0) - 1) ** 2, 0, 1)) * np.ones((1, w))
    depth = smoothstep(QB, QB + 0.12, q) * (1 - smoothstep(0.92, 1.0, q))
    L = (0.035 + 0.11 * rib) * (0.55 + 0.45 * depth)
    col = pal.hull(L.astype(F32))
    light = np.clip(1 - rib * 1.7, 0, 1) * depth
    col = col * (1 - light[..., None]) + warm(np.full((h, w), 0.72, F32)) * light[..., None] * 0.85
    return np.concatenate([col, light[..., None]], -1).astype(F32)


def watcher_heat(t):
    """The opening's heat 0..1 at unfold t (beaconFx.ts watcherHeat): it ramps up as the Watcher opens."""
    return float(smoothstep(0.04, 0.55, t))


def watcher_pose(w, t):
    """The Watcher at opening t (0 closed .. 1 open), on transparent (RGBA uint8), with the opened light and heat."""
    S = w['S']
    if t <= 0:
        return Image.fromarray(w['closed'], 'RGBA')
    heat = watcher_heat(t)
    rise = float(smoothstep(0, 0.6, t))

    def hot_over(img, hot):
        im = Image.fromarray(img, 'RGBA').copy()
        if hot is not None and heat > 0:
            h = hot.copy()
            h[..., 3] *= heat
            im.alpha_composite(Image.fromarray(np.round(np.clip(h, 0, 1) * 255).astype(np.uint8), 'RGBA'))
        return im
    canvas = hot_over(w['body'], w.get('hot_body'))
    arr = np.asarray(canvas).astype(F32) / 255
    add = w['open_fx'] * rise * 0.6 + w.get('warm_fx', 0) * heat * 0.5
    arr[..., :3] = np.clip(arr[..., :3] + add * (arr[..., 3:4] > 0), 0, 1)
    canvas = Image.fromarray(np.round(arr * 255).astype(np.uint8), 'RGBA')
    for k, (img, hinge, swing, delay) in enumerate(w['parts']):
        u = float(np.clip((t - delay) / max(1 - delay, 1e-3), 0, 1))
        u = u * u * (3 - 2 * u)
        hp = w['hot_parts'][k] if 'hot_parts' in w else None
        im = hot_over(img, hp).rotate(-math.degrees(swing * u), resample=Image.BICUBIC, center=(hinge[0] + S / 2, hinge[1] + S / 2))
        canvas.alpha_composite(im)
    return canvas


# ---------------------------------------------------------------------------------------------------------------
# The warships: composites of the set's pieces (bow up; canvas coords, origin at the frame centre)
# ---------------------------------------------------------------------------------------------------------------

def body_mask(a, rows=None, keep_top=0, thick=15, keep_rows=None):
    """The body of a frame without what sticks out of it (legs, side spines, antennae: anything thinner than `thick`
    px), by a morphological opening of its alpha, the body's own edge kept crisp; rows above `keep_top` kept whole
    (horns, antennae: they point forward); outside `rows` cut."""
    h, w = a.shape
    m8 = Image.fromarray(((a > 0.5) * 255).astype(np.uint8))
    op = m8.filter(ImageFilter.MinFilter(thick)).filter(ImageFilter.MaxFilter(thick))
    op = op.filter(ImageFilter.MaxFilter(3))
    m = (np.asarray(op).astype(F32) / 255)
    m = np.clip(gblur(m, 0.6) * 1.6, 0, 1) * (m > 0)
    Y = np.arange(h)[:, None] * np.ones((1, w))
    if keep_top > 0:
        m = np.where(Y < keep_top, 1.0, m)
    if keep_rows is not None:
        m = np.where((Y >= keep_rows[0]) & (Y < keep_rows[1]), 1.0, m)
    if rows is not None:
        m = m * ((Y >= rows[0]) & (Y < rows[1]))
    return m.astype(F32)


def body_only(kit, name, rows=None, keep_top=0, thick=15, deeye=False, keep_rows=None):
    a = kit.frame(name).rgba[..., 3]
    m = body_mask(a, rows, keep_top, thick, keep_rows)
    p = kit.cut(name, keep=lambda X, Y: m)
    if deeye:
        p = no_eyes(p)
    return p


def col(kit, name):
    """The centre column of a frame's content (frame px)."""
    ys, xs = np.nonzero(kit.frame(name).rgba[..., 3] > 0.5)
    return (xs.min() + xs.max() + 1) / 2


def no_eyes(p):
    """Small bright spots (the set's white lamps, which read as eyes) graded into the hull round them."""
    rgba = p.rgba.copy()
    L = rgba[..., :3] @ LUM
    bright = ((L > 0.62) & (rgba[..., 3] > 0.5)).astype(F32)
    small = (gblur(bright, 0.8) > 0.25) & (gblur(bright, 4.0) < 0.22)
    spot = gblur(small.astype(F32), 1.0)
    keep = (1 - np.clip(spot * 3, 0, 1))
    around = gblur(rgba[..., :3] * (keep * rgba[..., 3])[..., None], 3.0) / np.maximum(gblur(keep * rgba[..., 3], 3.0), 1e-3)[..., None]
    k = np.clip(spot * 3, 0, 1)[..., None]
    rgba[..., :3] = rgba[..., :3] * (1 - k) + around * k
    return Piece(rgba, p.glow * (1 - k[..., 0]))


def design_escort(kit):
    """The escort (the smallest, no legs): the passenger ship's slim body alone, its antennae forward."""
    cv = Canvas(400)
    body = body_only(kit, 'passengership', keep_top=58)
    cv.place(body, 0, 0, anchor=(col(kit, 'passengership'), 150), sy=1.1)
    cv.line(kit.pal, [(0, -60), (0, 130)], dash=(6, 3))
    return cv


def design_frigate(kit):
    """The frigate (no legs): the frigate's horned head and long tapering body, its legs gone, drawn out long."""
    cv = Canvas(460)
    body = body_only(kit, 'frigate', keep_top=64)
    cv.place(body, 0, 0, anchor=(col(kit, 'frigate'), 150), sy=1.35)
    cv.line(kit.pal, [(-24, -78), (0, -66), (24, -78)])
    cv.line(kit.pal, [(0, -120), (0, 150)], dash=(6, 3))
    return cv


def leg_piece(kit, name, box, body_x):
    """A leg cut from the left side of frame `name`: the box, the body (x >= body_x) cut away; the piece keeps the
    frame's coordinates (anchors are frame px)."""
    return kit.cut(name, keep=lambda X, Y: ((X >= box[0]) & (X < min(box[2], body_x)) & (Y >= box[1]) & (Y < box[3])).astype(F32), bevel=False)


def design_destroyer(kit):
    """The destroyer: the cruiser's horned head and thorax on the capital ship's long silver body column, one leg a
    side laid back along its flanks."""
    cv = Canvas(600)
    c_cap, c_cr = col(kit, 'capitalship'), col(kit, 'cruiser')
    body = body_only(kit, 'capitalship', rows=(176, 500))
    cv.place(body, 0, -40, anchor=(c_cap, 176), scale=0.8, sy=1.15)
    legs = leg_piece(kit, 'cruiser', (150, 146, 216, 180), 206)
    cv.place(legs, -30, -44, anchor=(206, 162), scale=0.8, rot=72, mirror=True, under=True)
    head = body_only(kit, 'cruiser', rows=(0, 208), keep_top=96, deeye=True)
    cv.place(head, 0, -36, anchor=(c_cr, 208), scale=0.8)
    cv.line(kit.pal, [(-30, -96), (0, -80), (30, -96)])
    cv.line(kit.pal, [(0, -70), (0, 250)], dash=(7, 3))
    cv.line(kit.pal, [(-10, 150), (-30, 186)], mirror=True)
    return cv


def design_cruiser(kit):
    """The cruiser: the cruiser's horned head and broad body drawn out long, its two legs a side laid back along its
    flanks."""
    cv = Canvas(760)
    c_cr = col(kit, 'cruiser')
    legs = leg_piece(kit, 'cruiser', (150, 146, 216, 208), 208)
    cv.place(legs, -41, -88, anchor=(206, 162), scale=1.15, rot=70, mirror=True, under=True)
    body = body_only(kit, 'cruiser', keep_top=96, deeye=True)
    cv.place(body, 0, 0, anchor=(c_cr, 250), scale=1.15, sy=1.1)
    cv.line(kit.pal, [(-53, -61), (0, -41), (53, -61)])
    cv.line(kit.pal, [(0, -174), (0, 276)], dash=(7, 3))
    cv.line(kit.pal, [(-15, 123), (-48, 164)], mirror=True)
    return cv


def design_capitalship(kit):
    """The capital ship (the biggest, heaviest and longest): the capital ship's spiked silver front and broad body,
    its side spines swept back along its flanks, ending in the Watcher's own tapering tail (its thick middle spike
    between flat blades)."""
    cv = Canvas(1000)
    c_cap, c_car = col(kit, 'capitalship'), col(kit, 'carrier')
    S, SY = 1.42, 1.02   # the front: broad, long
    tail = kit.cut('carrier', keep=lambda X, Y: smoothstep(318, 326, Y))
    cv.place(tail, 0, -14, anchor=(c_car, 318), scale=1.36, sy=1.12)
    k = S * SY
    spines = leg_piece(kit, 'capitalship', (140, 162, 214, 296), 206)
    cv.place(spines, -57, (170 - 312) * k + 17, scale=S, rot=36, anchor=(206.0, 170.0), mirror=True, under=True, sy=1.0)
    front = body_only(kit, 'capitalship', rows=(0, 312), keep_top=150)
    cv.place(front, 0, 17, anchor=(c_cap, 312), scale=S, sy=SY)
    cv.line(kit.pal, [(-66, (180 - 312) * k), (0, (180 - 312) * k + 26), (66, (180 - 312) * k)])
    cv.line(kit.pal, [(0, (40 - 312) * k), (0, -20)], dash=(8, 3))
    cv.line(kit.pal, [(-74, (276 - 312) * k), (0, (276 - 312) * k + 28), (74, (276 - 312) * k)])
    return cv


def design_carrier(kit):
    """The carrier: the troop transport's horned head (its great arms gone) over the supply ship's dark launch wings,
    their tips clipped, and its long tail."""
    cv = Canvas(720)
    c_tt, c_rs = col(kit, 'trooptransport'), col(kit, 'resupplyship')
    wings = kit.cut('resupplyship', keep=lambda X, Y: smoothstep(186, 206, Y) * (np.abs(X - c_rs) < 96))
    cv.place(wings, 0, -60, anchor=(c_rs, 196), scale=0.95, sy=1.2)
    head = body_only(kit, 'trooptransport', rows=(0, 340), thick=35, deeye=True)
    cv.place(head, 0, -40, anchor=(c_tt, 340), scale=0.95)
    cv.line(kit.pal, [(-50, -150), (0, -126), (50, -150)])
    cv.line(kit.pal, [(0, -260), (0, 300)], dash=(8, 3))
    cv.line(kit.pal, [(-30, 80), (-74, 150)], mirror=True)
    return cv


def design_trooptransport(kit):
    """The troop transport (no legs): the colony ship's long podded body alone, its spines and arms gone."""
    cv = Canvas(620)
    body = body_only(kit, 'colonyship', keep_top=0, thick=23, deeye=True)
    cv.place(body, 0, 0, anchor=(col(kit, 'colonyship'), 250), scale=0.9, sy=1.15)
    cv.line(kit.pal, [(-34, -110), (0, -90), (34, -110)])
    cv.line(kit.pal, [(0, -200), (0, 230)], dash=(7, 3))
    return cv


def design_construction(kit):
    """The utility ship (no legs): the large freighter's twin-lobed hull, its arms gone, the escort's great pincers
    forward."""
    cv = Canvas(520)
    c_lf, c_es = col(kit, 'largefreighter'), col(kit, 'escort')
    hull = body_only(kit, 'largefreighter', rows=(56, 300), keep_rows=(196, 300))
    cv.place(hull, 0, -60, anchor=(c_lf, 56), scale=1.05, sy=1.25)
    claws = kit.cut('escort', keep=lambda X, Y: (Y < 150) * (1 - smoothstep(128, 146, Y) * (np.abs(X - c_es) < 34)))
    cv.place(claws, 0, -40, anchor=(c_es, 140), scale=0.8, under=True)
    cv.line(kit.pal, [(0, 0), (0, 230)], dash=(6, 3))
    return cv


# ---------------------------------------------------------------------------------------------------------------
# The Beacon: the relay
# ---------------------------------------------------------------------------------------------------------------
# The user's design (2026-10-17): the Mass Effect Mass Relay's twin-prong layout (the mod's massrelay.png as the
# reference for the layout only), built as our own composite of the mod's Reaper pieces like the fleet: a massive ring
# housing the core, two long parallel prongs of stacked hull segments reaching out of one side, antenna masts on the
# ring's back. The faction's
# light here is wine red to dark orange (the user's palette for the faction), with deep teal markings on the ring.
# In the ring's well the core and its three gyroscope rings are drawn by beaconFx.ts: they turn faster as the season
# counts down to a launch (a blur on the eve) and the core heats from dim wine red to white-hot; on launch day charge
# pulses run down the prongs' seams, then the beam fires straight up (end-on) from the core.

_rl = np.array([-0.42, -0.58, 0.70])
RL_LIGHT = (_rl / np.linalg.norm(_rl)).astype(F32)
# The gyros' axes (screen angle, rad) and relative rates, and their rest pose (beacon.png): beaconFx.ts reads the same.
RL_GYRO_AXES = (0.3, 1.35, 2.4)
RL_GYRO_RATES = (1.0, -1.31, 1.73)
RL_REST_PHASE = 0.8
# The tip of the lower prong when it is snapped (heavy damage): turned about the break (rad, clockwise), slid (px).
RL_TIP_BEND = 0.16
RL_TIP_SLIDE = (6.0, 10.0)
# The core's heat colours (beaconFx.ts HEAT_*): dim wine red, wine red, red, red-orange, orange, pale yellow, white.
RL_HEAT_X = (0.0, 0.22, 0.38, 0.55, 0.78, 0.93, 1.0)
RL_HEAT_C = ((0.34, 0.04, 0.08), (0.50, 0.06, 0.10), (0.80, 0.12, 0.06), (1.0, 0.30, 0.06), (1.0, 0.58, 0.16), (1.0, 0.88, 0.62), (1.0, 1.0, 1.0))


def rot_screen(x, y, t):
    """(x, y) turned by t (rad, clockwise on screen: y is down)."""
    c, s = math.cos(t), math.sin(t)
    return x * c - y * s, x * s + y * c


def mirror_idx(i, n):
    i = np.mod(i, 2 * n)
    return np.where(i < n, i, 2 * n - 1 - i)

RL_S = 1120
RL_ORI = math.radians(22)
RL_R_OUT = 152.0
RL_R_IN = 92.0
RL_PRONG_Y = 58.0
RL_RING_SEGS = 8
RL_BREAK_X = 470.0                    # where the lower prong snaps (relay X)
RL_CORE_R = 21.0
RL_MASTS = ((180.0, 0.95), (152.0, 0.8), (208.0, 0.8))   # antenna masts: relay angle (deg), scale
RL_GYROS = ((79.0, 10.0), (63.0, 9.0), (47.0, 8.0))   # gyroscope rings: radius, width (px)


# The faction's light (the user's palette, 2026-10-17): the lines in wine red to dark orange (by brightness); deep teal
# markings as accents on the ring.
WINE_X = np.array([0.0, 0.35, 0.6, 0.85, 1.0], F32)
WINE_C = np.array([[0.10, 0.01, 0.03], [0.36, 0.04, 0.08], [0.62, 0.08, 0.10], [0.86, 0.30, 0.08], [1.0, 0.58, 0.28]], F32)
RL_TEAL = np.array([0.05, 0.24, 0.26], F32)


def wine(v):
    out = np.empty(np.shape(v) + (3,), F32)
    for c in range(3):
        out[..., c] = np.interp(v, WINE_X, WINE_C[:, c])
    return out


def rl_recolour(cv):
    """Every light pixel (the mod's cyan, our lines) into the wine-red palette by its brightness."""
    a = np.clip(cv.a, 1e-4, 1)
    g = np.clip(cv.g / a, 0, 1)
    rgb = cv.rgb / a[..., None]
    v = np.clip(rgb.max(-1) * 0.8, 0, 1)
    k = np.clip(g * 1.4, 0, 1)[..., None]
    cv.rgb = (rgb * (1 - k) + wine(v) * k) * a[..., None]


def rl_to_cv(X, Y):
    """Relay coords -> canvas coords (origin at the canvas centre)."""
    x, y = rot_screen(X, Y, RL_ORI)
    ox, oy = rot_screen(-200.0, 0.0, RL_ORI)
    return x + ox, y + oy


def rl_from_cv(x, y):
    ox, oy = rot_screen(-200.0, 0.0, RL_ORI)
    return rot_screen(x - ox, y - oy, -RL_ORI)


def rl_rot_deg(dir_deg=0.0):
    """Canvas.place's rotation (deg, counter-clockwise) for a bow-up piece to point along relay direction dir_deg
    (0 = +X, toward the prongs' tips; positive turns toward +Y)."""
    return -90.0 - math.degrees(RL_ORI) - dir_deg


def rl_ring(kit, cv):
    """The ring: the capital ship's graded spine strip warped round, segment by segment, a torus's light over it."""
    S = cv.S
    f = kit.frame('capitalship')
    c = 248.5
    hw = 38
    strip = f.rgba[176:496, int(c - hw):int(c + hw)]
    sg = f.glow[176:496, int(c - hw):int(c + hw)]
    sh, sw = strip.shape[:2]
    Y, X = np.mgrid[0:S, 0:S].astype(F32) + 0.5 - S / 2
    rx, ry = rl_from_cv(X, Y)
    r = np.hypot(rx, ry)
    phi = np.arctan2(ry, rx)
    band = (r > RL_R_IN - 1) & (r < RL_R_OUT + 1)
    s = np.clip((r - RL_R_IN) / (RL_R_OUT - RL_R_IN), 0, 1)
    rmid = (RL_R_IN + RL_R_OUT) / 2
    seg_len = 2 * math.pi * rmid / RL_RING_SEGS
    a = ((phi + math.pi) % (2 * math.pi)) * rmid
    k = np.floor(a / seg_len).astype(np.int32)
    t = a - k * seg_len
    offs = [0, 96, 40, 150, 12, 120, 70, 180]
    sy = np.zeros_like(t)
    for i in range(RL_RING_SEGS):
        sy = np.where(k == i, offs[i] + t * 1.05, sy)
    yi = np.clip(sy.astype(np.int32), 0, sh - 1)
    xi = np.clip((s * (sw - 1)).astype(np.int32), 0, sw - 1)
    rgb = strip[yi, xi, :3]
    g = sg[yi, xi]
    # the torus's light: its cross-section's normal tilts out across the band
    beta = (s - 0.5) * math.pi * 0.85
    nx, ny = np.cos(phi) * np.sin(beta), np.sin(phi) * np.sin(beta)
    cx_, cy_ = nx * math.cos(RL_ORI) - ny * math.sin(RL_ORI), nx * math.sin(RL_ORI) + ny * math.cos(RL_ORI)
    lam = np.clip(cx_ * RL_LIGHT[0] + cy_ * RL_LIGHT[1] + np.cos(beta) * RL_LIGHT[2], 0, 1)
    # the joins: a dark groove, a lit lip, a clamp band either side
    dj = np.minimum(t, seg_len - t)
    groove = np.clip(2.0 - dj, 0, 1)
    clamp = (dj < 9) & (s > 0.08) & (s < 0.92)
    shade = (0.45 + 0.75 * lam) * (1 - 0.6 * groove) * np.where(clamp, 0.78, 1.0)
    L = (rgb @ LUM) * shade
    col = kit.pal.hull(np.clip(L, 0, 1).astype(F32))
    # deep teal markings: a band on every other segment's clamps, a thin stripe near the outer lip
    teal = (clamp & (k % 2 == 0) & (s > 0.3) & (s < 0.7)) | ((np.abs(s - 0.86) < 0.025) & (t > 14) & (t < seg_len - 14))
    col = np.where(teal[..., None], col * 0.45 + RL_TEAL[None, None] * (0.6 + 1.6 * L[..., None]), col)
    # the inner and outer lips
    edge = np.minimum(r - RL_R_IN, RL_R_OUT - r)
    col = col * (1 - 0.5 * np.exp(-np.maximum(edge, 0) / 2.5))[..., None]
    aa = np.clip(np.minimum(r - RL_R_IN, RL_R_OUT - r) + 0.5, 0, 1) * band
    planes = [col[..., 0] * aa, col[..., 1] * aa, col[..., 2] * aa, aa, g * aa * 0.6]
    cv.over([q.astype(F32) for q in planes], 0, 0, shadow=0.5, under=False)
    return r, phi


def rl_well(kit, cv):
    """The core's well inside the ring: a dark recess, faintly ribbed, a lip lit by the core."""
    S = cv.S
    Y, X = np.mgrid[0:S, 0:S].astype(F32) + 0.5 - S / 2
    rx, ry = rl_from_cv(X, Y)
    r = np.hypot(rx, ry)
    phi = np.arctan2(ry, rx)
    rib = 0.5 + 0.5 * np.cos(phi * 36)
    L = 0.035 + 0.05 * (r / RL_R_IN) ** 2 * (0.6 + 0.4 * rib)
    col = kit.pal.hull(np.clip(L, 0, 1).astype(F32))
    aa = np.clip(RL_R_IN + 1.5 - r, 0, 1)
    planes = [col[..., 0] * aa, col[..., 1] * aa, col[..., 2] * aa, aa, np.zeros_like(aa)]
    cv.over([q.astype(F32) for q in planes], 0, 0, shadow=0, under=True)
    light = np.clip(1 - r / RL_R_IN, 0, 1) ** 1.5 * 0.5 + np.exp(-((r - RL_R_IN) / 3.5) ** 2) * 0.9
    light *= (r < RL_R_IN + 4)
    return light.astype(F32)


def rl_prong(kit, cv, side):
    """One prong (side -1: Y < 0, +1: Y > 0): stacked hull segments, bow toward the tip, laid with their inner edge
    toward the gap; the lower one mirrored."""
    flip = side > 0
    Yp = side * RL_PRONG_Y
    root = body_only(kit, 'cruiser', rows=(150, 470), thick=17)
    spine = body_only(kit, 'capitalship', rows=(176, 500))
    tail = kit.cut('carrier', keep=lambda X, Y: smoothstep(300, 312, Y))
    col_ = body_only(kit, 'colonyship', rows=(150, 470), thick=23, deeye=True)
    rr = rl_rot_deg()
    # tip first (it lies under the spine's end), then the spine, the second spine, the root block over all
    # (the tail reversed: its narrow end out at the tip)
    for piece, name, X, sc, anchor, d in ((tail, 'carrier', 565.0, 0.95, (250.0, 400.0), 180.0),
                                          (spine, 'capitalship', 440.0, 0.70, (248.5, 338.0), 0.0),
                                          (col_, 'colonyship', 290.0, 0.66, (252.5, 310.0), 0.0),
                                          (root, 'cruiser', 168.0, 0.62, (248.5, 310.0), 0.0)):
        x, y = rl_to_cv(X, Yp)
        cv.place(piece, x, y, scale=sc, rot=rl_rot_deg(d), flip=flip, anchor=anchor, shadow=0.5)


def rl_masts(kit, cv):
    """Antenna masts off the ring's back: the generic base's top spine, three of them fanned."""
    blade = kit.cut('genericbase', keep=lambda X, Y: (np.abs(X - 240.5) < 22) * (Y < 160), match=0.9)
    for ang, sc in RL_MASTS:
        th = math.radians(ang)
        X, Y = (RL_R_OUT - 14) * math.cos(th), (RL_R_OUT - 14) * math.sin(th)
        x, y = rl_to_cv(X, Y)
        cv.place(blade, x, y, scale=sc, rot=rl_rot_deg(ang), anchor=(240.5, 158.0), under=True, shadow=0.0)


def rl_clamps(kit, cv):
    """Heavy blocks where the prongs meet the ring, and a brace between them."""
    blk = body_only(kit, 'largefreighter', rows=(196, 300), keep_rows=(196, 300))
    for side in (-1, 1):
        x, y = rl_to_cv(RL_R_OUT - 8, side * (RL_PRONG_Y + 4))
        cv.place(blk, x, y, scale=0.62, rot=rl_rot_deg(), flip=side > 0, anchor=(col(kit, 'largefreighter'), 248.0))
    brace = body_only(kit, 'frigate', keep_top=0)
    x, y = rl_to_cv(330.0, 0.0)
    cv.place(brace, x, y, scale=0.42, rot=rl_rot_deg(90.0), anchor=(col(kit, 'frigate'), 150.0), under=True)


def rl_seams():
    """The charge's path down each prong (relay coords, tip to ring): its seam line."""
    return [[(640.0, s * RL_PRONG_Y), (520.0, s * RL_PRONG_Y), (300.0, s * RL_PRONG_Y), (RL_R_OUT + 6, s * (RL_PRONG_Y - 4)), (RL_R_IN + 4, s * 40.0)] for s in (-1, 1)]


def build_relay(kit):
    """The relay's pieces: its body (canvas premultiplied), the lower prong's tip (split off along a jagged break),
    the well's core light, the seam paths."""
    cv = Canvas(RL_S)
    rl_masts(kit, cv)
    rl_prong(kit, cv, -1)
    rl_prong(kit, cv, 1)
    rl_clamps(kit, cv)
    rl_ring(kit, cv)
    light = rl_well(kit, cv)
    ring = [rl_to_cv((RL_R_IN + RL_R_OUT) / 2 * math.cos(math.radians(a)), (RL_R_IN + RL_R_OUT) / 2 * math.sin(math.radians(a))) for a in range(0, 361, 4)]
    cv.line(kit.pal, ring, width=2.4, dash=(10, 4))
    for path in rl_seams():
        cv.line(kit.pal, [rl_to_cv(X, Y) for X, Y in path[:3]], width=2.2, dash=(9, 4))
    rl_recolour(cv)
    S = RL_S
    Yg, Xg = np.mgrid[0:S, 0:S].astype(F32) + 0.5 - S / 2
    rx, ry = rl_from_cv(Xg, Yg)
    jag = 7 * np.sin(ry * 0.45) + 4 * np.sin(ry * 1.3 + 1)
    tipm = ((ry > 18) & (rx > RL_BREAK_X + jag)).astype(F32)
    tip = dict(rgb=cv.rgb * tipm[..., None], a=cv.a * tipm, g=cv.g * tipm)
    body = dict(rgb=cv.rgb * (1 - tipm)[..., None], a=cv.a * (1 - tipm), g=cv.g * (1 - tipm))
    hinge = rl_to_cv(RL_BREAK_X, RL_PRONG_Y)
    return dict(S=S, body=body, tip=tip, light=light, hinge=hinge, core=rl_to_cv(0.0, 0.0), seams=[[rl_to_cv(X, Y) for X, Y in p] for p in rl_seams()])


class WinePalette:
    """The light_layer interface in the faction's wine red."""

    @staticmethod
    def light(v):
        return wine(np.clip(v * 0.85, 0, 1))


def heat_col(h):
    return np.array([np.interp(h, RL_HEAT_X, [c[i] for c in RL_HEAT_C]) for i in range(3)], F32)


def rl_gyro(pal, R, w, seed):
    """A gyroscope ring in its own frame (x its axis of turn): gunmetal, notched, two bearing studs on its axis; its
    light ticks apart (a mask, tinted by the core's heat in the game). Even-sided, the ring's centre at the centre."""
    S = int(2 * (R + w) + 8)
    S += S % 2
    Y, X = np.mgrid[0:S, 0:S].astype(F32) + 0.5 - S / 2
    r = np.hypot(X, Y)
    th = np.arctan2(Y, X)
    a = np.clip(np.minimum(r - (R - w / 2), (R + w / 2) - r) + 0.5, 0, 1)
    rng = np.random.default_rng(seed)
    n = int(rng.integers(10, 16))
    notch = np.cos(th * n) > 0.86
    s = (r - R) / (w / 2)
    L = (0.34 + 0.22 * (1 - s * s)) * np.where(notch, 0.45, 1.0) * (1 - 0.45 * np.exp(-((np.abs(s) - 1) / 0.18) ** 2))
    rgb = pal.hull(np.clip(L, 0, 1).astype(F32))
    tick = ((np.cos(th * n + math.pi / n) > 0.97) & (np.abs(s) < 0.45)).astype(F32) * a
    stud = ((np.abs(th) < 0.12) | (np.abs(np.abs(th) - math.pi) < 0.12)) & (np.abs(s) < 1.2)
    rgb = np.where(stud[..., None], np.clip(rgb * 1.5, 0, 1), rgb)
    rgba = np.concatenate([np.clip(rgb, 0, 1), a[..., None]], -1).astype(F32)
    ticks = np.zeros((S, S, 4), F32)
    ticks[..., :3] = 1.0
    ticks[..., 3] = tick
    # its blur, spun: a shell, its limb brightest (the envelope of a ring turning about its axis)
    al = (0.10 + 0.55 * np.exp(-((r - R) / (w * 0.6)) ** 2)) * (r < R + w / 2) * np.clip(R + w / 2 - r, 0, 1)
    blur = np.zeros((S, S, 4), F32)
    blur[..., :3] = 0.62
    blur[..., 3] = al
    return rgba, ticks, blur


def rl_gyro_angles(phase, k):
    """Gyro k's axis (screen angle, rad) and its turn about it at spin phase `phase` (beaconFx.ts gyroAngles)."""
    return RL_GYRO_AXES[k] + 0.15 * math.sin(phase * 0.05 + k), phase * RL_GYRO_RATES[k] + k * 1.1


def rl_paste_gyro(rgb, a, tex, cx, cy, psi, theta, half):
    """Lay half of a gyro (premultiplied over rgb / a, canvas px) as beaconFx.ts draws it: its frame turned psi, scaled
    cos(theta) across its axis; `half` 'back' or 'front' (the half toward the viewer)."""
    S = tex.shape[0]
    Yl = np.arange(S)[:, None] + 0.5 - S / 2
    front_is_bottom = math.sin(theta) >= 0
    keep = (Yl > 0) if ((half == 'front') == front_is_bottom) else (Yl <= 0)
    t = tex.copy()
    t[..., 3] *= keep
    c, s = math.cos(psi), math.sin(psi)
    sy = math.cos(theta)
    if abs(sy) < 1e-3:
        sy = 1e-3
    M = np.array([[c, -s * sy], [s, c * sy]])
    Mi = np.linalg.inv(M)
    H, W = a.shape
    coeffs = (Mi[0, 0], Mi[0, 1], S / 2 - Mi[0, 0] * cx - Mi[0, 1] * cy, Mi[1, 0], Mi[1, 1], S / 2 - Mi[1, 0] * cx - Mi[1, 1] * cy)
    pl = [np.asarray(Image.fromarray((t[..., ch] * t[..., 3]).astype(F32), 'F').transform((W, H), Image.AFFINE, coeffs, resample=Image.BILINEAR)) for ch in range(4)]
    pa = np.clip(pl[3], 0, 1)
    rgb[...] = np.stack(pl[:3], -1) + rgb * (1 - pa[..., None])
    a[...] = pa + a * (1 - pa)


def rl_pits(body_a, seed=42):
    """Heavy damage over the hull: pits (dark, RGBA) with lit rims (a mask) and a few cracks."""
    S = body_a.shape[0]
    rng = np.random.default_rng(seed)
    pit = np.zeros((S, S), F32)
    rim = np.zeros((S, S), F32)
    Y, X = np.mgrid[0:S, 0:S].astype(F32) + 0.5
    ys, xs = np.nonzero(body_a > 0.9)
    for _ in range(80):
        i = rng.integers(len(ys))
        cy, cx = ys[i] + 0.5, xs[i] + 0.5
        rr = rng.uniform(2.5, 7.5)
        y0, y1, x0, x1 = int(cy - 12), int(cy + 12), int(cx - 12), int(cx + 12)
        y0, x0 = max(0, y0), max(0, x0)
        d = np.hypot(X[y0:y1, x0:x1] - cx, Y[y0:y1, x0:x1] - cy)
        pit[y0:y1, x0:x1] = np.maximum(pit[y0:y1, x0:x1], np.clip(rr - d, 0, 1))
        rim[y0:y1, x0:x1] = np.maximum(rim[y0:y1, x0:x1], np.exp(-((d - rr - 0.8) / 0.9) ** 2) * (d > rr))
    # cracks: jagged walks from some pits
    for _ in range(14):
        i = rng.integers(len(ys))
        x, y = float(xs[i]), float(ys[i])
        ang = rng.uniform(0, 2 * math.pi)
        for _s in range(int(rng.integers(6, 14))):
            ang += float(rng.normal(0, 0.5))
            x2, y2 = x + 4 * math.cos(ang), y + 4 * math.sin(ang)
            for t in np.linspace(0, 1, 6):
                xi, yi = int(x + (x2 - x) * t), int(y + (y2 - y) * t)
                if 0 <= xi < S and 0 <= yi < S:
                    pit[yi, xi] = max(pit[yi, xi], 0.9)
            x, y = x2, y2
    pit *= body_a
    rim *= body_a * (1 - pit)
    rgba = np.zeros((S, S, 4), F32)
    rgba[..., :3] = 0.03
    rgba[..., 3] = np.clip(pit * 0.92, 0, 1)
    return rgba, np.clip(rim, 0, 1)


# ---- the beam (launch day; beaconFx.ts BeaconBeam): its textures, all our own procedural shapes

RL_GREEN = np.array([0.22, 1.0, 0.42], F32)


def _radial(S):
    Y, X = np.mgrid[0:S, 0:S].astype(F32) + 0.5 - S / 2
    return np.hypot(X, Y) / (S / 2), np.arctan2(Y, X)


def _contour(r, a, b):
    k = (smoothstep(a, b, r) ** 2)[..., None]
    return np.ones(3, F32)[None, None] * (1 - k) + RL_GREEN[None, None] * k


def beam_textures():
    """The beam's layers (additive light, float RGB) and its particles (straight RGBA): the end-on column's disc (white,
    its green contour fading fast into white, spiral fringes), two swirls, the rising ring, the bloom (white, and a green
    aura), a streak, the embers' tapered arcs (white, tinted in the game) and their cores, the debris chips, a spark,
    smoke, the charge's pulse."""
    out = {}
    S = 384
    r, th = _radial(S)
    arms = (0.5 + 0.5 * np.cos(th * 5 + np.log(r + 0.04) * 7.0)) ** 1.5
    fringe = smoothstep(0.55, 0.85, r)
    I = (1 - smoothstep(0.93, 1.0, r * (0.92 + 0.16 * arms))) * (1 - fringe * (1 - arms) * 0.85)
    out['disc'] = ('add', _contour(r, 0.78, 0.95) * I[..., None])
    for name, n, k in (('swirl', 4, 5.0), ('swirl2', 3, -4.0)):
        ph = th * n + np.log(r + 0.04) * k
        I = (0.5 + 0.5 * np.cos(ph)) ** 4 * smoothstep(0.04, 0.3, r) * (1 - smoothstep(0.7, 1.0, r))
        out[name] = ('add', _contour(r, 0.45, 0.8) * I[..., None])
    I = np.exp(-((r - 0.9) / 0.035) ** 2)
    out['ring'] = ('add', _contour(r, 0.84, 0.92) * I[..., None])
    r2, _ = _radial(256)
    I = (0.65 * np.exp(-(r2 / 0.38) ** 2) + 0.35 * np.exp(-(r2 / 0.12) ** 2)) * (1 - smoothstep(0.9, 1.0, r2))
    out['bloom'] = ('add', np.ones(3, F32)[None, None] * I[..., None])
    I = np.exp(-((r2 - 0.42) / 0.14) ** 2) * (1 - smoothstep(0.85, 1.0, r2))
    out['bloomGreen'] = ('add', RL_GREEN[None, None] * I[..., None])
    Y, X = np.mgrid[0:16, 0:128].astype(F32) + 0.5
    x, y = X / 128, (Y - 8) / 8
    I = np.exp(-(y / 0.35) ** 2) * smoothstep(0, 0.7, x) * (1 - smoothstep(0.92, 1.0, x))
    kk = (1 - smoothstep(0.4, 0.95, x))[..., None]
    out['streak'] = ('add', (np.ones(3, F32)[None, None] * (1 - kk) + RL_GREEN[None, None] * kk) * I[..., None])
    for i in range(4):
        # debris chips (heavy damage): a dark flake, twice as long as it is wide
        rng = np.random.default_rng(i)
        Y, X = np.mgrid[0:24, 0:48].astype(F32) + 0.5
        u, v = (X - 24) / 24, (Y - 12) / 12
        rr = np.hypot(u, v)
        tt = np.arctan2(v, u)
        edge = 0.75 + sum(rng.uniform(0.04, 0.1) * np.cos(tt * f + rng.uniform(0, 6.28)) for f in (2, 3))
        a = (1 - smoothstep(edge - 0.42, edge, rr)) * 0.95
        rgba = np.zeros((24, 48, 4), F32)
        rgba[..., :3] = 0.012
        rgba[..., 3] = a
        out['ash%d' % i] = ('rgba', rgba)
    # the swirl's streaks: tapered arcs (bowed as a path turning clockwise on screen: their ends toward +y), soft-edged,
    # white (tinted in the game), with a thin core of their own; a gentle and a tighter curve
    for name, (W, H, sag) in (('arc0', (64, 16, 0.10)), ('arc1', (64, 24, 0.22))):
        Y, X = np.mgrid[0:H, 0:W].astype(F32) + 0.5
        u = (X - W / 2) / (W / 2)
        yc = H / 2 - sag * W / 2 * (1 - u * u) + sag * W / 4
        tt = np.clip((u + 1) / 2, 0, 1)
        wdt = 2.2 * np.sin(np.pi * tt) ** 0.7 * (0.75 + 0.25 * tt)
        dist = np.abs(Y - yc)
        body = np.exp(-(dist / np.maximum(wdt, 0.25)) ** 2) * (np.abs(u) < 1)
        core = np.exp(-(dist / np.maximum(wdt * 0.38, 0.2)) ** 2) * np.sin(np.pi * tt) ** 1.5 * (np.abs(u) < 1)
        for key, a in ((name, body), (name + 'Core', core)):
            rgba = np.zeros((H, W, 4), F32)
            rgba[..., :3] = 1.0
            rgba[..., 3] = np.clip(a, 0, 1)
            out[key] = ('rgba', rgba)
    Y, X = np.mgrid[0:6, 0:24].astype(F32) + 0.5
    I = np.exp(-(((Y - 3) / 3) / 0.5) ** 2) * np.sin(np.clip(X / 24, 0, 1) * math.pi)
    out['spark'] = ('add', np.array([1.0, 0.75, 0.4], F32)[None, None] * I[..., None])
    for i in range(3):
        rng = np.random.default_rng(10 + i)
        rr, tt = _radial(64)
        edge = 0.75 + sum(rng.uniform(0.04, 0.1) * np.cos(tt * f + rng.uniform(0, 6.28)) for f in (2, 3))
        a = (1 - smoothstep(edge - 0.85, edge, rr)) * 0.8
        rgba = np.zeros((64, 64, 4), F32)
        rgba[..., :3] = np.array([0.36, 0.35, 0.37], F32)
        rgba[..., 3] = a
        out['smoke%d' % i] = ('rgba', rgba)
    rr, _ = _radial(64)
    out['pulse'] = ('add', np.ones(3, F32)[None, None] * (np.exp(-(rr / 0.5) ** 2) * (rr < 1))[..., None])
    return out


BEAM_KEYS = ('disc', 'swirl', 'swirl2', 'ring', 'bloom', 'bloomGreen', 'streak', 'arc0', 'arc0Core', 'arc1', 'arc1Core', 'ash0', 'ash1', 'ash2', 'ash3', 'spark', 'smoke0', 'smoke1', 'smoke2', 'pulse')


def no_faint(img, below=4):
    """No pixel fainter than `below` alpha (a premultiplied read could turn it into a marker colour)."""
    img[img[..., 3] < below] = 0
    return img


def build_relay_outputs(kit, out):
    """Every Beacon file: beacon.png (at rest: the gyros and the core in their rest pose), beacon-body.png (the same
    frame less the lower prong's tip, the gyros and the core), beacon-parts.png (the tip, the gyros, their light ticks
    and blurs, the pits), beacon-fx.png (the light layers), beacon-beam.png (the launch's beam); returns the data."""
    R = build_relay(kit)
    S = R['S']
    pal = kit.pal
    body, tip = R['body'], R['tip']
    gyros = [rl_gyro(pal, rr, w, 3 + i) for i, (rr, w) in enumerate(RL_GYROS)]
    # the rest frame: body, tip, then the gyros' back halves, the core (dim wine, unlit), the front halves
    rgb = body['rgb'] + tip['rgb']
    a = np.clip(body['a'] + tip['a'], 0, 1)
    ccx, ccy = R['core'][0] + S / 2, R['core'][1] + S / 2
    Y, X = np.mgrid[0:S, 0:S].astype(F32) + 0.5
    rc = np.hypot(X - ccx, Y - ccy)
    for half in ('back', 'front'):
        if half == 'front':
            orb = np.clip(1 - rc / RL_CORE_R, 0, 1) ** 0.35 * (rc < RL_CORE_R)
            oa = np.clip(RL_CORE_R - rc + 0.5, 0, 1)
            col = heat_col(0.0)[None, None] * (0.55 + 0.6 * orb)[..., None]
            rgb = col * oa[..., None] + rgb * (1 - oa[..., None])
            a = oa + a * (1 - oa)
        for k in range(3):
            psi, th = rl_gyro_angles(RL_REST_PHASE, k)
            rl_paste_gyro(rgb, a, gyros[k][0], ccx, ccy, psi, th, half)
    full = to_u8(rgb / np.maximum(a, 1e-4)[..., None], a)
    ys, xs = np.nonzero(full[..., 3] > 0)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    Sf = int(max(x1 - x0, y1 - y0)) + 20
    Sf += Sf % 2
    ox, oy = (Sf - (x1 - x0)) // 2 - x0, (Sf - (y1 - y0)) // 2 - y0     # canvas px + (ox, oy) = frame px

    def frame_of(img):
        o = np.zeros((Sf, Sf) + img.shape[2:], img.dtype)
        sy0, sx0 = max(0, -oy), max(0, -ox)
        dy0, dx0 = max(0, oy), max(0, ox)
        h = min(S - sy0, Sf - dy0)
        w = min(S - sx0, Sf - dx0)
        o[dy0:dy0 + h, dx0:dx0 + w] = img[sy0:sy0 + h, sx0:sx0 + w]
        return o
    fp = lambda p: (p[0] + S / 2 + ox, p[1] + S / 2 + oy)       # canvas coords -> frame px
    full = no_faint(frame_of(full))
    fix_markers(full)
    before = full[..., 3] > 0
    full, _ = balance(full)
    bal = (full[..., 3] > 0) & ~before
    save(full, os.path.join(out, 'beacon.png'))
    ba = np.clip(body['a'], 0, 1)
    bimg = no_faint(frame_of(to_u8(body['rgb'] / np.maximum(ba, 1e-4)[..., None], ba)))
    fix_markers(bimg)
    bimg[bal] = full[bal]
    save(bimg, os.path.join(out, 'beacon-body.png'))
    # parts
    ta = np.clip(tip['a'], 0, 1)
    tip_img = frame_of(to_u8(tip['rgb'] / np.maximum(ta, 1e-4)[..., None], ta))
    pits, rims = rl_pits(np.clip(frame_of(np.clip(body['a'] + tip['a'], 0, 1)), 0, 1))
    imgs = [tip_img.astype(F32) / 255]
    boxes = [None]
    for (ring, ticks, blur) in gyros:
        g = ring.shape[0]
        for im in (ring, ticks, blur):
            imgs.append(im)
            boxes.append((0, 0, g, g))
    imgs.append(pits)
    boxes.append(None)
    patlas, prects = pack_boxes(imgs, boxes)
    no_faint(patlas)
    fix_markers(patlas)
    save(patlas, os.path.join(out, 'beacon-parts.png'))
    # the light layers: the lines' swell (wine), the well's light, the pits' rims, the orb, its halo, its white heart
    gl = np.clip(frame_of(np.clip((body['g'] + tip['g']) / np.maximum(np.clip(body['a'] + tip['a'], 0, 1), 1e-4), 0, 1)), 0, 1)
    swell = light_layer(full.astype(F32) / 255, gl, WinePalette)
    well = frame_of(R['light'])[..., None] * np.ones(3, F32)[None, None]
    rimL = rims[..., None] * np.ones(3, F32)[None, None]
    r1, _ = _radial(64)
    orb = (np.clip(1 - r1, 0, 1) ** 0.35 * (r1 < 1) * (0.55 + 0.45 * np.clip(1 - r1 * r1, 0, 1) ** 0.5))[..., None] * np.ones(3, F32)
    r2, _ = _radial(128)
    halo = (np.exp(-(r2 / 0.5) ** 2) * (r2 < 1))[..., None] * np.ones(3, F32)
    layers = [layer_rgba(x) for x in (swell, well, rimL, orb, halo)]
    fatlas, frects = pack(layers, float_rgba=True)
    no_faint(fatlas)
    fix_markers(fatlas)
    save(fatlas, os.path.join(out, 'beacon-fx.png'))
    # the beam
    bt = beam_textures()
    bimgs = [layer_rgba(bt[k][1]) if bt[k][0] == 'add' else bt[k][1] for k in BEAM_KEYS]
    batlas, brects = pack_boxes(bimgs, [(0, 0, im.shape[1], im.shape[0]) for im in bimgs])
    no_faint(batlas)
    fix_markers(batlas)
    save(batlas, os.path.join(out, 'beacon-beam.png'))
    core = fp(R['core'])
    data = dict(
        size=Sf, breath=BREATH['beacon'], core=core, ringIn=RL_R_IN, ringOut=RL_R_OUT, coreR=RL_CORE_R,
        glow=frects[0], well=frects[1], rims=frects[2], orb=frects[3], halo=frects[4],
        tip=prects[0], hinge=fp(R['hinge']), tipBend=RL_TIP_BEND, tipSlide=RL_TIP_SLIDE,
        gyros=[dict(r=RL_GYROS[k][0], w=RL_GYROS[k][1], ring=prects[1 + 3 * k], ticks=prects[2 + 3 * k], blur=prects[3 + 3 * k],
                    axis=RL_GYRO_AXES[k], rate=RL_GYRO_RATES[k]) for k in range(3)],
        pits=prects[10], seams=[[fp(p) for p in path] for path in R['seams']],
        breaks=[fp(rl_to_cv(RL_BREAK_X, RL_PRONG_Y + dy)) for dy in (-22, -12, -3, 6)],
        vents=[fp(rl_to_cv(RL_BREAK_X + 6, RL_PRONG_Y)), fp(rl_to_cv(200.0, -RL_PRONG_Y - 30)), fp(rl_to_cv(-120.0, 70.0))],
        beam={k: brects[i] for i, k in enumerate(BEAM_KEYS)}, beamR=262.0,
    )
    return data, full


DESIGNS = {
    'escort': design_escort,
    'frigate': design_frigate,
    'destroyer': design_destroyer,
    'cruiser': design_cruiser,
    'capitalship': design_capitalship,
    'carrier': design_carrier,
    'trooptransport': design_trooptransport,
    'construction': design_construction,
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
    fxa, rects = pack([layer_rgba(w['fx']), layer_rgba(w['open_fx']), layer_rgba(w['warm_fx'])], float_rgba=True)
    save(fxa, os.path.join(out, 'watcher-fx.png'))
    # the heat overlays: the body's, then each part's cropped to that part's own box (so it turns with the part)
    boxes = [None] + [(r[4], r[5], r[4] + r[2], r[5] + r[3]) for r in prs]
    hot_atlas, hrs = pack_boxes([w['hot_body']] + w['hot_parts'], boxes)
    save(hot_atlas, os.path.join(out, 'watcher-hot.png'))
    parts = []
    for k, ((img, hinge, swing, delay), r) in enumerate(zip(w['parts'], prs)):
        has = bool((w['hot_parts'][k][..., 3] > 2 / 255).any())
        parts.append(dict(rect=r, hinge=(hinge[0] + S / 2, hinge[1] + S / 2), swing=swing, delay=delay, hot=hrs[k + 1] if has else None))
    return dict(size=S, breath=BREATH['watcher'], glow=rects[0], sockets=rects[1], warm=rects[2], hot=hrs[0], parts=parts)


def pack_boxes(images, boxes):
    """As pack (float straight-alpha RGBA), each image cropped to its box (x0, y0, x1, y1), or to its content (None)."""
    crops = []
    for im, b in zip(images, boxes):
        x0, y0, x1, y1 = b if b is not None else crop_box(im[..., 3])
        crops.append((im[y0:y1, x0:x1], int(x0), int(y0)))
    W = max(c[0].shape[1] for c in crops)
    Hh = sum(c[0].shape[0] + 2 for c in crops)
    atlas = np.zeros((Hh, W, 4), F32)
    rects = []
    y = 0
    for (c, dx, dy) in crops:
        h, w = c.shape[:2]
        atlas[y:y + h, 0:w] = c
        rects.append((0, y, w, h, dx, dy))
        y += h + 2
    a8 = np.round(np.clip(atlas, 0, 1) * 255).astype(np.uint8)
    a8[a8[..., 3] == 0] = 0
    fix_markers(a8)
    return a8, rects


def ts_rect(r):
    x, y, w, h, dx, dy = r
    return '{ x: %d, y: %d, w: %d, h: %d, dx: %d, dy: %d }' % (x, y, w, h, dx, dy)


def ts_pt(p):
    return '[%.1f, %.1f]' % (p[0], p[1])


def relay_data_lines(d):
    """The relay's table (BEACON_RELAY) and the beam's (BEACON_BEAM)."""
    out = ['export interface BeaconGyroArt {',
           '    /** Radius and width (frame px). */',
           '    readonly r: number;',
           '    readonly w: number;',
           '    /** In beacon-parts.png: the ring (metal), its light ticks (a white mask, tinted), its blur (spun); each square, the ring centred. */',
           '    readonly ring: BeaconFxRect;',
           '    readonly ticks: BeaconFxRect;',
           '    readonly blur: BeaconFxRect;',
           '    /** Its axis of turn (screen angle, rad) and its rate relative to the spin. */',
           '    readonly axis: number;',
           '    readonly rate: number;',
           '}',
           '',
           'export interface BeaconRelayArt {',
           '    /** Frame side (beacon.png and beacon-body.png, px) and the lines\' breathing period (s). */',
           '    readonly size: number;',
           '    readonly breath: number;',
           '    /** The core (frame px), the ring\'s inner and outer radius, the core\'s radius. */',
           '    readonly core: readonly [number, number];',
           '    readonly ringIn: number;',
           '    readonly ringOut: number;',
           '    readonly coreR: number;',
           '    /** In beacon-fx.png (additive): the lines\' swell, the well\'s light (white, tinted by the heat), the pits\' lit rims, the orb, its halo. */',
           '    readonly glow: BeaconFxRect;',
           '    readonly well: BeaconFxRect;',
           '    readonly rims: BeaconFxRect;',
           '    readonly orb: BeaconFxRect;',
           '    readonly halo: BeaconFxRect;',
           '    /** In beacon-parts.png: the lower prong\'s tip (at dx, dy on the frame); it snaps at the hinge (frame px), turning tipBend rad and sliding tipSlide px. */',
           '    readonly tip: BeaconFxRect;',
           '    readonly hinge: readonly [number, number];',
           '    readonly tipBend: number;',
           '    readonly tipSlide: readonly [number, number];',
           '    readonly gyros: readonly BeaconGyroArt[];',
           '    /** In beacon-parts.png: the heavy damage\'s pits and cracks (dark, at dx, dy on the frame). */',
           '    readonly pits: BeaconFxRect;',
           '    /** The charge\'s paths down the prongs\' seams, tip to core (frame px); the break\'s raw edge; where smoke vents. */',
           '    readonly seams: readonly (readonly (readonly [number, number])[])[];',
           '    readonly breaks: readonly (readonly [number, number])[];',
           '    readonly vents: readonly (readonly [number, number])[];',
           '    /** The beam\'s scale: its disc\'s reference radius (frame px). */',
           '    readonly beamR: number;',
           '}',
           '',
           'export const BEACON_RELAY: BeaconRelayArt = {']
    out.append('    size: %d,' % d['size'])
    out.append('    breath: %.2f,' % d['breath'])
    out.append('    core: %s,' % ts_pt(d['core']))
    out.append('    ringIn: %.1f,' % d['ringIn'])
    out.append('    ringOut: %.1f,' % d['ringOut'])
    out.append('    coreR: %.1f,' % d['coreR'])
    for k in ('glow', 'well', 'rims', 'orb', 'halo', 'tip'):
        out.append('    %s: %s,' % (k, ts_rect(d[k])))
    out.append('    hinge: %s,' % ts_pt(d['hinge']))
    out.append('    tipBend: %.3f,' % d['tipBend'])
    out.append('    tipSlide: %s,' % ts_pt(d['tipSlide']))
    out.append('    gyros: [')
    for g in d['gyros']:
        out.append('        { r: %.1f, w: %.1f, ring: %s, ticks: %s, blur: %s, axis: %.3f, rate: %.3f },' % (g['r'], g['w'], ts_rect(g['ring']), ts_rect(g['ticks']), ts_rect(g['blur']), g['axis'], g['rate']))
    out.append('    ],')
    out.append('    pits: %s,' % ts_rect(d['pits']))
    out.append('    seams: [')
    for path in d['seams']:
        out.append('        [%s],' % ', '.join(ts_pt(p) for p in path))
    out.append('    ],')
    out.append('    breaks: [%s],' % ', '.join(ts_pt(p) for p in d['breaks']))
    out.append('    vents: [%s],' % ', '.join(ts_pt(p) for p in d['vents']))
    out.append('    beamR: %.1f,' % d['beamR'])
    out.append('};')
    out.append('')
    out.append('/** The launch beam\'s textures in beacon-beam.png (additive light, but the ash and the smoke: normal). */')
    out.append('export const BEACON_BEAM: Readonly<Record<%s, BeaconFxRect>> = {' % ' | '.join("'%s'" % k for k in BEAM_KEYS))
    for k in BEAM_KEYS:
        out.append('    %s: %s,' % (k, ts_rect(d['beam'][k])))
    out.append('};')
    out.append('')
    out.append('/** The core\'s heat colours (0 cold .. 1 white-hot at launch): dim wine red, wine red, red, red-orange, orange, pale yellow, white. */')
    out.append('export const BEACON_HEAT_X: readonly number[] = [%s];' % ', '.join('%.2f' % x for x in RL_HEAT_X))
    out.append('export const BEACON_HEAT_C: readonly (readonly [number, number, number])[] = [%s];' % ', '.join('[%.2f, %.2f, %.2f]' % c for c in RL_HEAT_C))
    out.append('/** The faction\'s light (the lines at rest): wine red. */')
    out.append('export const BEACON_LINE_RGB: readonly [number, number, number] = [%.2f, %.2f, %.2f];' % tuple(WINE_C[2]))
    out.append('/** The gyros\' rest phase (as beacon.png bakes them). */')
    out.append('export const BEACON_REST_PHASE = %.2f;' % RL_REST_PHASE)
    out.append('')
    return out


def write_data(path, frames, watcher, relay=None):
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
            "    /** Its lines in the opening's red-orange (in watcher-hot.png, the part's own box), or null (no lines). */",
            '    readonly hot: BeaconFxRect | null;',
            '}',
            '',
            'export interface WatcherArt extends BeaconFrameArt {',
            '    /** The light in the cavity and the sockets the parts uncover as they swing out (in watcher-fx.png). */',
            '    readonly sockets: BeaconFxRect;',
            "    /** The lights' swell in the opening's red-orange (in watcher-fx.png). */",
            '    readonly warm: BeaconFxRect;',
            "    /** The body's lines in the opening's red-orange (in watcher-hot.png), drawn over the cyan as it opens. */",
            '    readonly hot: BeaconFxRect;',
            '    readonly parts: readonly WatcherPartArt[];',
            '}',
            '']
    w = watcher
    out.append('export const WATCHER_ART: WatcherArt = {')
    out.append('    size: %d,' % w['size'])
    out.append('    breath: %.2f,' % w['breath'])
    out.append('    glow: %s,' % ts_rect(w['glow']))
    out.append('    sockets: %s,' % ts_rect(w['sockets']))
    out.append('    warm: %s,' % ts_rect(w['warm']))
    out.append('    hot: %s,' % ts_rect(w['hot']))
    out.append('    parts: [')
    for p in w['parts']:
        hot = 'null' if p['hot'] is None else ts_rect(p['hot'])
        out.append('        { rect: %s, hinge: [%.1f, %.1f], swing: %.4f, delay: %.3f, hot: %s },' % (ts_rect(p['rect']), p['hinge'][0], p['hinge'][1], p['swing'], p['delay'], hot))
    out.append('    ],')
    out.append('};')
    out.append('')
    if relay is not None:
        out += relay_data_lines(relay)
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
        strip = [watcher_pose(watcher, t) for t in (0.0, 0.1, 0.2, 0.35, 0.5, 0.7, 1.0)]
        bb = strip[-1].getbbox()
        bb = (min(bb[0], strip[0].getbbox()[0]) - 6, 0, max(bb[2], strip[0].getbbox()[2]) + 6, watcher['S'])
        ww = bb[2] - bb[0]
        sh = starfield(ww * len(strip) + 10 * (len(strip) + 1), watcher['S'])
        dd = ImageDraw.Draw(sh)
        for i, p in enumerate(strip):
            sh.alpha_composite(p.crop(bb), (10 + i * (ww + 10), 0))
            dd.text((14 + i * (ww + 10), 6), 'open %d%%' % round([0, 10, 20, 35, 50, 70, 100][i]), fill=(220, 225, 240, 255))
        sh.save(os.path.join(out_dir, 'watcher-opening-strip.png'))
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
    names = list(DESIGNS) + ['watcher', 'beacon'] if args.only is None else args.only.split(',')
    os.makedirs(args.out, exist_ok=True)
    frames, made, watcher, wdata, rdata = [], [], None, None, None
    for name in names:
        if name == 'beacon':
            rdata, rimg = build_relay_outputs(kit, args.out)
            made.append(('beacon', rimg))
            print('beacon (the relay)', rdata['size'], flush=True)
            continue
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
        write_data(args.data, frames, wdata, rdata)
        print('data', args.data)
    if args.preview:
        fleet_sheet(args.preview, made, watcher)


if __name__ == '__main__':
    main()
