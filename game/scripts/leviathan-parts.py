#!/usr/bin/env python3
"""Cuts the Leviathan's art (Void Whale threat) out of the user-supplied reference picture (a whale seen from above,
head to the left, on a flat grey background) into the rig's parts:

  public/art/leviathan/body.png       trunk + head + tail stock, head toward +x (LEV_W x LEV_H)
  public/art/leviathan/fin-left.png   pectoral fin on the left flank (-y)
  public/art/leviathan/fin-right.png  pectoral fin on the right flank (+y)
  public/art/leviathan/fluke.png      the flukes and the end of the stalk
  public/art/leviathan/harpoons.png   the old harpoons stuck in it and their trailing lines (leviathan_harpoons.py)
  src/render/leviathanParts.ts        generated: sizes, pivots, the body outline, the glowing dots / beads and the
                                      harpoons' placements

It keys the grey out (clean alpha, the grey unmixed from the edge pixels, no fringe), flips it, splits off the fins
and the flukes, tones it down to sit in the dark of space (darker, a little desaturated, the bright white fin tips and
fluke patches compressed to a pale grey, the sides shaded) and scales it to about a large space port's pixel count.
The joins are made to hold while the parts move: under each fin root the body edge is interpolated and its hide
repainted (no keyed-out background or root shadow inside the edge), the hide runs out into the fin's base and the body
carries a fillet over the root (no straight seam), each fin carries a deep strip of hide under its root (no gap as it
rows), and the flukes' stalk is shaded like the body's and tapered under it (no step, nothing poking out as it sweeps).
Before the cut it weathers the hide (an old, hunted animal: scuffs, scrapes, scars, worn patches, chipped fin / fluke
edges, the scarred entries of the harpoons; leviathan_harpoons.py).
Usage (needs Pillow + numpy):

  python3 scripts/leviathan-parts.py [reference=~/data/agent-tmp/leviathan/reference.webp]
"""
import json
import math
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.dont_write_bytecode = True
import leviathan_harpoons as harp  # noqa: E402 (next to this script)

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
REF = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/data/agent-tmp/leviathan/reference.webp')
OUT = os.path.join(GAME, 'public', 'art', 'leviathan')
TS = os.path.join(GAME, 'src', 'render', 'leviathanParts.ts')

BG = np.array([147.0, 138.0, 141.0])
CROP = (50, 50, 1600, 915)  # inside the picture frame
SNOUT_X = 75  # reference px: the snout tip
ROOT_X = 1300  # the fluke root (the narrow end of the stalk)
FIN_X = (470, 775)  # the fins' columns
LEV_W, LEV_H = 800, 240
LEV_X1 = 792
S = (LEV_X1 - 20) / (ROOT_X - SNOUT_X)

src = np.asarray(Image.open(REF).convert('RGB')).astype(np.float64)
H, W, _ = src.shape

# --- Key out the grey: a solid mask (holes filled) with a soft unmixed edge.
d = np.sqrt(((src - BG) ** 2).sum(2))
solid = d > 16
solid[:, : CROP[0]] = False
solid[:, CROP[2]:] = False
solid[: CROP[1], :] = False
solid[CROP[3]:, :] = False
mimg = Image.fromarray((solid * 255).astype(np.uint8)).convert("L").copy()
ImageDraw.floodfill(mimg, (5, 5), 128)
filled = np.asarray(mimg) != 128
inner = np.asarray(Image.fromarray((filled * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5))) > 0
outer = np.asarray(Image.fromarray((filled * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0
alpha = np.where(inner, 1.0, np.clip((d - 8) / 40, 0, 1) * outer)
a3 = np.maximum(alpha, 1e-3)[..., None]
rgb = np.where(alpha[..., None] > 0.05, (src - (1 - alpha[..., None]) * BG) / a3, 0)
rgb = np.clip(rgb, 0, 255)

ys, xs = np.nonzero(filled)
cy = 0.0
# The body edge per column (the fins' columns interpolated from both sides).
top = np.full(W, np.nan)
bot = np.full(W, np.nan)
for x in range(CROP[0], CROP[2]):
    col = np.nonzero(filled[:, x])[0]
    if len(col) > 0:
        top[x], bot[x] = col.min(), col.max()
fit_x = np.r_[np.arange(300, FIN_X[0]), np.arange(FIN_X[1], 950)]
pt = np.polyfit(fit_x, top[fit_x], 3)
pb = np.polyfit(fit_x, bot[fit_x], 3)
# Under the fins: the real edge wherever the flank shows between a fin and the body (the solid run from the centreline
# outward), and the fit only across each fin's root, where the fin is attached (bent onto the real edge at both ends of
# the root, so the edge has no step). FIN_ROOT[side] = the root's columns (reference px).
FIN_ROOT = {}
# The centreline as measured across the plain fit (kept from the first cut: the glow spots and harpoons stay put).
_t, _b = top.copy(), bot.copy()
_t[FIN_X[0]:FIN_X[1]] = np.polyval(pt, np.arange(FIN_X[0], FIN_X[1]))
_b[FIN_X[0]:FIN_X[1]] = np.polyval(pb, np.arange(FIN_X[0], FIN_X[1]))
cy = float(np.nanmean((_t[200:1200] + _b[200:1200]) / 2))
for side, edge, p in ((-1, top, pt), (1, bot, pb)):
    xs = np.arange(FIN_X[0] - 12, FIN_X[1] + 12)
    run = np.empty(len(xs))
    for i, x in enumerate(xs):
        y = int(round((np.polyval(pt, x) + np.polyval(pb, x)) / 2))
        while filled[y + side, x]:
            y += side
        run[i] = y
    fit = np.polyval(p, xs)
    attached = np.convolve((run - fit) * side > 4, np.ones(9), mode='same') > 0
    attached &= (xs >= FIN_X[0]) & (xs < FIN_X[1])
    # The longest attached stretch is the root.
    best, cur = (0, -1), None
    for i in range(len(xs)):
        if attached[i]:
            cur = i if cur is None else cur
            if i - cur > best[1] - best[0]:
                best = (cur, i)
        else:
            cur = None
    a, b = best[0] - 1, best[1] + 1
    ra = float(np.mean(run[a - 3: a + 1] - fit[a - 3: a + 1]))
    rb = float(np.mean(run[b: b + 4] - fit[b: b + 4]))
    e = run.copy()
    for i in range(a + 1, b):
        k = (xs[i] - xs[a]) / (xs[b] - xs[a])
        e[i] = fit[i] + ra * (1 - k) + rb * k
    # A light smoothing (the edge fringe jitters the run by a pixel or so).
    es = np.convolve(np.pad(e, 3, mode='edge'), np.ones(7) / 7, mode='valid')
    for i, x in enumerate(xs):
        if FIN_X[0] <= x < FIN_X[1]:
            edge[x] = es[i]
    FIN_ROOT[side] = (int(xs[a + 1]), int(xs[b - 1]))

# --- Tone: darker, a touch desaturated, the whites compressed to a pale grey, sides shaded (lit from above).
lum = (rgb * [0.3, 0.55, 0.15]).sum(2, keepdims=True)
tone = lum + (rgb - lum) * 0.85
tone *= 0.62
mx = tone.max(2, keepdims=True)
knee = 92.0
comp = np.where(mx > knee, (knee + (mx - knee) * 0.4) / np.maximum(mx, 1), 1.0)
tone *= comp
yy = np.arange(H)[:, None]
half = np.maximum(1, (bot - top) / 2)[None, :]
across = np.clip((yy - cy) / half, -1.5, 1.5)
body_cols = (np.arange(W) >= SNOUT_X - 5) & (np.arange(W) <= ROOT_X)
shade = np.where(body_cols[None, :], 0.72 + 0.28 * (1 - np.clip(np.abs(across), 0, 1) ** 2), 0.85)
# Past the fluke root the stalk's shading runs on (its width at the root) and eases into the flukes' flat 0.85, so the
# tone has no step where the flukes join the stalk.
acrossS = np.clip((yy - cy) / max(1.0, (bot[ROOT_X] - top[ROOT_X]) / 2), -1.5, 1.5)
shadeS = 0.72 + 0.28 * (1 - np.clip(np.abs(acrossS), 0, 1) ** 2)
wFl = np.clip((np.arange(W)[None, :] - ROOT_X) / 60, 0, 1)
shade = np.where(np.arange(W)[None, :] > ROOT_X, shadeS * (1 - wFl) + 0.85 * wFl, shade)
tone *= shade[..., None]

# --- The glowing dots (head V, snout line) and spine beads: bright blue-white blobs; dimmed in the hide, listed for
# the rig's pulsing glow sprites.
bright = (rgb[..., 2] > 165) & (rgb[..., 2] - rgb[..., 0] > 40) & inner
headZone = (np.arange(W)[None, :] < 372) & (np.arange(W)[None, :] > SNOUT_X + 6) & (np.abs(yy - cy) < 0.8 * half)
spineZone = (np.arange(W)[None, :] > 990) & (np.arange(W)[None, :] < ROOT_X - 4) & (np.abs(yy - cy) < 24)
glowMask = bright & (headZone | spineZone)
# The spine beads merge into streaks: find them as brightness peaks along the centreline instead.
icy = int(round(cy))
line = rgb[icy - 3: icy + 4, :, 2].mean(0)
line = np.convolve(line, np.ones(5) / 5, mode='same')
peaks = [x for x in range(1000, ROOT_X - 6) if line[x] >= line[x - 4: x + 5].max() and line[x] > 120 and line[x] - min(line[x - 14: x + 15]) > 6]
dedup = []
for x in peaks:
    if not dedup or x - dedup[-1] > 8:
        dedup.append(x)
peaks = dedup
spine_glows = []
for j, x in enumerate(peaks):
    gap = min([abs(x - q) for q in peaks if q != x] or [20])
    colv = rgb[icy - 20: icy + 21, x, 2]
    wy = max(3, int((colv > (colv.max() + colv.min()) / 2).sum() / 2))
    spine_glows.append((float(x), cy, gap * 0.45, float(wy), 'spine'))
glowMask &= ~spineZone
seen = np.zeros_like(glowMask)
glows = []
for y0, x0 in zip(*np.nonzero(glowMask)):
    if seen[y0, x0]:
        continue
    q = deque([(y0, x0)])
    seen[y0, x0] = True
    pts = []
    while q:
        y, x = q.popleft()
        pts.append((y, x))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if glowMask[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    if len(pts) < 6:
        continue
    py = np.array([p[0] for p in pts])
    px = np.array([p[1] for p in pts])
    kind = 'spine' if px.mean() > 900 else 'head'
    # Long blobs (the snout line) become a chain of beads.
    span = px.max() - px.min()
    n = max(1, int(round(span / 22))) if kind == 'head' and span > 30 else 1
    for k in range(n):
        lo = px.min() + span * k / n
        hi = px.min() + span * (k + 1) / n
        sel = (px >= lo) & (px <= hi) if n > 1 else np.ones_like(px, bool)
        if sel.sum() < 2:
            continue
        gx, gy = px[sel].mean(), py[sel].mean()
        rx = (px[sel].max() - px[sel].min() + 1) / 2
        ry = (py[sel].max() - py[sel].min() + 1) / 2
        glows.append((gx, gy, rx, ry, kind))
glows += spine_glows
# Dim the blobs a little more in the hide: the glow comes from the additive sprites.
tone = np.where(glowMask[..., None], tone * 0.85, tone)

# --- The fin roots blended into the flank. Under each root (and a little past its ends) the edge band of the body is
# repainted with the hide just inside it, mirrored about a line FILL_B px in (its shading taken out and that of the
# destination put back, so the lighting from above stays right): no keyed-out background or fin-root shadow is left
# inside the body edge. The same mirrored hide also runs a little way out into the base of the fin, fading into the fin's
# own skin, so fin and flank are one surface where they meet (the body's fillet over the root, below, then matches it).
FILL_B = 22  # mirror line (reference px in from the edge)
FILL_G = 16  # how far into the fin base the hide runs (reference px)


def ramp(x, a, b, r):
    """1 inside [a, b], easing to 0 over r px beyond each end (smoothstep)."""
    t = np.clip(np.minimum(x - (a - r), (b + r) - x) / r, 0, 1)
    return t * t * (3 - 2 * t)


Xc = np.arange(W)
for side, edge in ((-1, top), (1, bot)):
    r0, r1 = FIN_ROOT[side]
    cols = np.arange(r0 - 24, r1 + 25)
    lat = ramp(cols, r0 - 4, r1 + 4, 20)
    for x, lw in zip(cols, lat):
        e = edge[x]
        ys_ = np.arange(int(e) - FILL_G - 2, int(e) + FILL_B + 3) if side < 0 else np.arange(int(e) - FILL_B - 2, int(e) + FILL_G + 3)
        d = (ys_ - e) * -side  # inward distance from the edge
        w = np.where(d >= 0, np.clip((FILL_B - d) / (FILL_B - 6), 0, 1), np.clip(1 + d / FILL_G, 0, 1) * alpha[ys_, x])
        w = w * lw
        src_y = np.round(e - side * (2 * FILL_B - d)).astype(int)
        mir = tone[src_y, x] / shade[src_y, x][:, None] * shade[ys_, x][:, None]
        tone[ys_, x] = tone[ys_, x] * (1 - w[:, None]) + mir * w[:, None]


def to_tex(x, y):
    """Reference px -> body texture px (flipped: head toward +x)."""
    return LEV_X1 - (x - SNOUT_X) * S, LEV_H / 2 + (y - cy) * S


def save_part(name, mask_alpha, x0, y0, x1, y1):
    """Crops [x0, x1) x [y0, y1) of the toned picture (alpha = mask_alpha), flips it, scales by S, saves it."""
    a = mask_alpha[y0:y1, x0:x1]
    c = tone[y0:y1, x0:x1]
    rgba = np.dstack([c * a[..., None], a * 255]).astype(np.float64)  # premultiplied for clean resampling
    w = max(1, int(round((x1 - x0) * S)))
    h = max(1, int(round((y1 - y0) * S)))
    chans = [Image.fromarray(rgba[..., k].astype(np.float32), 'F').transpose(Image.FLIP_LEFT_RIGHT).resize((w, h), Image.LANCZOS) for k in range(4)]
    arr = np.dstack([np.asarray(ch) for ch in chans])
    al = np.clip(arr[..., 3], 0, 255)
    col = np.where(al[..., None] > 0.5, arr[..., :3] / np.maximum(al[..., None], 1e-3) * 255, 0)
    out = np.dstack([np.clip(np.nan_to_num(col), 0, 255), al]).round().astype(np.uint8)
    out[al < 3] = 0
    Image.fromarray(out, 'RGBA').save(os.path.join(OUT, name), optimize=True)
    return w, h


os.makedirs(OUT, exist_ok=True)
X = np.arange(W)[None, :]
inBody = (yy >= top[None, :] - 0.5) & (yy <= bot[None, :] + 0.5)

# --- The old wear and the harpoons' entry scars, painted on the toned picture before the cut (the chips bite into the
# alpha of the fin and fluke edges).
def to_ref(tx, ty):
    """Body texture px -> reference px (the inverse of to_tex)."""
    return SNOUT_X + (LEV_X1 - tx) / S, cy + (ty - LEV_H / 2) / S


placed = harp.place(alpha, to_ref, to_tex, S)
inFinCols = (X >= FIN_X[0] - 40) & (X < FIN_X[1] + 40)
outside = ~inBody
regions = {
    'body': (inBody & (X >= SNOUT_X - 5) & (X <= ROOT_X + 10), 0.0),
    'finL': (inFinCols & outside & (yy < cy), -0.86),
    'finR': (inFinCols & outside & (yy > cy), 0.86),
    'flukeU': ((X > ROOT_X) & outside & (yy < cy), -0.75),
    'flukeD': ((X > ROOT_X) & outside & (yy > cy), 0.75),
}
chippable = (inFinCols & ((yy < top[None, :] - 24) | (yy > bot[None, :] + 24))) | ((X > ROOT_X + 45) & outside)
avoid = np.asarray(Image.fromarray((glowMask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))) > 0
avoid |= spineZone & (np.abs(yy - cy) < 14)
alpha = harp.weather(tone, alpha, regions, chippable, avoid, to_ref, S, placed)

# Body: inside the edge, snout to the fluke root. Past the root the stalk runs on, only as wide as at the root, fading
# out over the flukes' join (the flukes are drawn under it and match it there: no seam across the stalk).
dIn = np.minimum(yy - top[None, :], bot[None, :] - yy)
cS, hS = (top[ROOT_X] + bot[ROOT_X]) / 2, (bot[ROOT_X] - top[ROOT_X]) / 2
endFade = np.clip((ROOT_X + 14 - X) / 16, 0, 1)
stalkW = np.where(X > ROOT_X, np.clip((hS - np.abs(yy - cS)) / 3 + 0.5, 0, 1), 1.0)
bodyA = alpha * inBody * endFade ** 1.5 * stalkW
# Under the fins: the real alpha, trimmed softly at the edge; over each fin's root a fillet of the fin's base (the same
# pixels as the fin there, fading out FILLET_F px over it), so the flank swells into the fin instead of a hard line
# across its root.
FILLET_F = 12
inFins = (X >= FIN_X[0]) & (X < FIN_X[1])
bodyF = alpha * np.clip((dIn + 2) / 3, 0, 1)
for side, edge in ((-1, top), (1, bot)):
    r0, r1 = FIN_ROOT[side]
    dOut = (edge[None, :] - yy) * -side
    fil = ramp(X, r0 + 6, r1 - 6, 10) * np.clip(1 - dOut / FILLET_F, 0, 1) ** 1.6 * alpha
    bodyF = np.maximum(bodyF, np.where((dOut > 0) & ((yy < cy) if side < 0 else (yy > cy)), fil, 0))
bodyA = np.where(inFins, bodyF, bodyA)
bx0 = int(round(SNOUT_X - (LEV_W - LEV_X1) / S))
bx1 = bx0 + int(round(LEV_W / S))
by0 = int(round(cy - LEV_H / 2 / S))
by1 = by0 + int(round(LEV_H / S))
# Pad the source so the crop can run past the picture edges.
pad = 200
tone = np.pad(tone, ((pad, pad), (pad, pad), (0, 0)))
P = lambda m: np.pad(m, ((pad, pad), (pad, pad)))
bw, bh = save_part('body.png', P(bodyA), bx0 + pad, by0 + pad, bx1 + pad, by1 + pad)
assert (bw, bh) == (LEV_W, LEV_H), (bw, bh)

# Fins: outside the body edge in the fins' columns, plus a deep strip of the (blended) hide under the whole root, square
# to its ends: rowing tips the root's ends up to ~6 texture px out of the flank, and the strip fills that, so no gap or
# dark sliver opens between fin and body at any point of the stroke.
ROOT_IN = 24
parts = {}
for name, side in (('fin-left.png', -1), ('fin-right.png', 1)):
    edge = top if side < 0 else bot
    # Where the fin leaves the body edge (its root), then the fin plus a strip of the hide just under that root.
    # (Every column where the fin's flesh meets the edge, the corners included: the longest such stretch.)
    touch = [x for x in range(FIN_X[0], FIN_X[1]) if alpha[int(round(edge[x])) + side * 3, x] > 0.8]
    spans = np.split(np.array(touch), np.nonzero(np.diff(touch) > 1)[0] + 1)
    t0, t1 = (lambda sp: (int(sp[0]), int(sp[-1])))(max(spans, key=len))
    depth = np.clip((np.minimum(X - t0, t1 - X) + 6) / 3, 0, 1) * ROOT_IN
    # Beside the root the body's own fringe stays with the body (it reaches ~2 px past the edge).
    clear = np.where((X >= t0) & (X <= t1), 0, 3)
    if side < 0:
        m = inFins & (yy < cy) & (yy < top[None, :] + depth - clear)
    else:
        m = inFins & (yy > cy) & (yy > bot[None, :] - depth + clear)
    # The strip runs a few px past the root's ends, its square ends a little soft (when the stroke tips an end out, it
    # shows as the root's own flesh).
    strip = (yy > top[None, :]) if side < 0 else (yy < bot[None, :])
    fa = alpha * m * np.where(strip, np.clip((np.minimum(X - t0, t1 - X) + 6) / 4, 0, 1), 1.0)
    fy, fx = np.nonzero(fa > 0.05)
    x0, x1 = fx.min() - 2, fx.max() + 3
    y0, y1 = fy.min() - 2, fy.max() + 3
    pxr = (t0 + t1) / 2
    pyr = float(edge[int(pxr)])
    w, h = save_part(name, P(fa), x0 + pad, y0 + pad, x1 + pad, y1 + pad)
    # In the flipped texture: x measured from the right end of the crop.
    parts[name] = dict(w=w, h=h, ax=(x1 - pxr) / (x1 - x0), ay=(pyr - y0) / (y1 - y0), root=to_tex(pxr, pyr))

# Fluke: from a little before the root to the tips (it is drawn under the body, the stalk overlap hides the joint).
FL0 = ROOT_X - 34
# Under the stalk it is narrowed toward FL0 (by more than its sweep turns it: 0.26 rad), so swinging it never pushes it
# out past the stalk's edge.
mc = (top + bot)[None, :] / 2
inStalk = np.clip((bot - top)[None, :] / 2 - (ROOT_X - X) * 0.3 - 1.5 - np.abs(yy - mc) + 0.5, 0, 1)
fa = alpha * (X >= FL0) * np.clip((X - FL0) / 8, 0, 1) * np.where(X < ROOT_X, inStalk, 1.0)
fy, fx = np.nonzero(fa > 0.05)
x1 = fx.max() + 3
y0, y1 = fy.min() - 2, fy.max() + 3
w, h = save_part('fluke.png', P(fa), FL0 + pad, y0 + pad, x1 + pad, y1 + pad)
parts['fluke.png'] = dict(w=w, h=h, ax=(x1 - ROOT_X) / (x1 - FL0), ay=(cy - y0) / (y1 - y0), root=to_tex(ROOT_X, cy))

# The harpoons: one atlas of their sprites and lines (body texture scale).
atlas, hrecs = harp.harpoons(placed)
Image.fromarray(atlas, 'RGBA').save(os.path.join(OUT, 'harpoons.png'), optimize=True)

# Outlines of the fins and flukes for the galaxy icon: polar hull round a point inside each (body texture px, unbent).
def outline(key, cx_f, cy_f, n=32):
    p = parts[key]
    al = np.asarray(Image.open(os.path.join(OUT, key)))[..., 3] > 110
    h, w = al.shape
    cx, cy0 = cx_f * w, cy_f * h
    pts = []
    for k in range(n):
        a = 2 * np.pi * k / n
        r_best = 0.0
        for r in np.arange(0, max(w, h), 0.5):
            x, y = int(cx + np.cos(a) * r), int(cy0 + np.sin(a) * r)
            if x < 0 or y < 0 or x >= w or y >= h:
                break
            if al[y, x]:
                r_best = r
        x = cx + np.cos(a) * r_best - p['ax'] * w + p['root'][0]
        y = cy0 + np.sin(a) * r_best - p['ay'] * h + p['root'][1]
        pts.append(f"{x:.1f}, {y:.1f}")
    return '[' + ', '.join(pts) + ']'


def centroid(key):
    al = np.asarray(Image.open(os.path.join(OUT, key)))[..., 3] > 110
    ys_, xs_ = np.nonzero(al)
    return xs_.mean() / al.shape[1], ys_.mean() / al.shape[0]


outlines = {
    'finL': outline('fin-left.png', *centroid('fin-left.png')),
    'finR': outline('fin-right.png', *centroid('fin-right.png')),
    'fluke': outline('fluke.png', parts['fluke.png']['ax'] * 0.75, parts['fluke.png']['ay']),
}

# The outline: half-width at u (0 fluke root .. 1 snout), from the body alpha.
prof = []
for k in range(41):
    u = k / 40
    xr = ROOT_X - u * (ROOT_X - SNOUT_X)
    xr = min(max(xr, SNOUT_X + 0.5), ROOT_X)
    xi = int(round(xr))
    hw = 0.0 if u >= 1 else (bot[xi] - top[xi]) / 2 * S
    prof.append(round(float(hw), 2))

gl = []
for gx, gy, rx, ry, kind in glows:
    tx, ty = to_tex(gx, gy)
    gl.append(f"    {{ x: {tx:.1f}, y: {ty:.1f}, rx: {max(1.0, rx * S):.2f}, ry: {max(1.0, ry * S):.2f}, kind: '{kind}' }},")
gl.sort()

hl = []
for r in hrecs:
    p = r['spec']
    fx, fy, fw, fh = r['frame']
    line = 'null' if r['line'] is None else '{{ fx: {}, fy: {}, fw: {}, fh: {}, len: {} }}'.format(*r['line'], p['line'][1])
    hl.append(f"    {{ part: '{p['part']}', x: {p['ex']:.1f}, y: {p['ey']:.1f}, ang: {math.radians(p['ang']):.4f}, fx: {fx}, fy: {fy}, fw: {fw}, fh: {fh}, ax: {r['ax']:.4f}, ay: {r['ay']:.4f}, attach: {r['attach']:.1f}, line: {line} }},")


def part_ts(key, label):
    p = parts[key]
    return f"    {label}: {{ url: '/art/leviathan/{key}', w: {p['w']}, h: {p['h']}, ax: {p['ax']:.4f}, ay: {p['ay']:.4f}, rootX: {p['root'][0]:.1f}, rootY: {p['root'][1]:.1f} }},"


ts = f"""// GENERATED by scripts/leviathan-parts.py from the user-supplied Leviathan reference picture — do not edit by hand.
// The cut parts live in public/art/leviathan/; this lists their sizes, pivots (anchor fractions in each part, and the
// point on the body texture each is pinned to), the body outline and the glowing dots / spine beads (body texture px,
// head toward +x).

export const LEV_PART_W = {LEV_W};
export const LEV_PART_H = {LEV_H};
export const LEV_PART_X0 = 20;
export const LEV_PART_X1 = {LEV_X1};
export const LEV_BODY_URL = '/art/leviathan/body.png';

export interface LevPart {{
    url: string;
    w: number;
    h: number;
    /** Anchor (pivot) as fractions of the part. */
    ax: number;
    ay: number;
    /** Where the pivot sits on the body texture (px). */
    rootX: number;
    rootY: number;
}}

export const LEV_PARTS: {{ finL: LevPart; finR: LevPart; fluke: LevPart }} = {{
{part_ts('fin-left.png', 'finL')}
{part_ts('fin-right.png', 'finR')}
{part_ts('fluke.png', 'fluke')}
}};

/** Body half-width (px) at u = k / 40 (0 the fluke root … 1 the snout tip). */
export const LEV_HALF_PROFILE: readonly number[] = {json.dumps(prof)};

/** Outlines (x0, y0, x1, y1, …; body texture px, unbent) of the fins and the flukes: the galaxy icon's shapes. */
export const LEV_PART_OUTLINES: {{ finL: number[]; finR: number[]; fluke: number[] }} = {{
    finL: {outlines['finL']},
    finR: {outlines['finR']},
    fluke: {outlines['fluke']},
}};

export interface LevGlowSpot {{
    x: number;
    y: number;
    rx: number;
    ry: number;
    kind: 'head' | 'spine';
}}

export const LEV_GLOW_SPOTS: readonly LevGlowSpot[] = [
{chr(10).join(gl)}
];

export const LEV_HARPOON_URL = '/art/leviathan/harpoons.png';

/** A frame (px) in the harpoon atlas. */
export interface LevFrame {{
    fx: number;
    fy: number;
    fw: number;
    fh: number;
}}

/**
 * An old harpoon stuck in the Leviathan: the part it is pinned to, its entry point on that part (body texture px at
 * rest, unbent / unrotated), the shaft's direction out of the hide (rad, texture frame), its sprite (the entry at the
 * anchor, the shaft along +x), where its line is tied (px along the shaft from the entry) and the trailing line's
 * sprite (drawn along a swaying rope, `len` px long), if it has one.
 */
export interface LevHarpoon extends LevFrame {{
    part: 'body' | 'finL' | 'finR' | 'fluke';
    x: number;
    y: number;
    ang: number;
    ax: number;
    ay: number;
    attach: number;
    line: (LevFrame & {{ len: number }}) | null;
}}

export const LEV_HARPOONS: readonly LevHarpoon[] = [
{chr(10).join(hl)}
];
"""
open(TS, 'w').write(ts)
print('parts', {k: (v['w'], v['h']) for k, v in parts.items()}, 'glows', len(gl), 'harpoons', len(hl), 'atlas', atlas.shape[:2], 'cy', round(cy, 1), 'S', round(S, 4))
