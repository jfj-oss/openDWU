#!/usr/bin/env python3
"""Concord "photo" ship art: real insect specimen photos (no winged insects: beetles with closed elytra and a shield
bug), cut out, straightened bow-up, recoloured per class within one dark purple / pink family with an iridescent
sheen, and grafted with teal-metal cybernetics (gold trim, emerald / cyan glow). Offline build step; its outputs are
our derived art, committed under public/art/concord-photo/ (CREDITS.md there lists every source photo, its licence
and URL).

    python3 -I scripts/concord-photo-art.py <download-dir> [--out public/art/concord-photo] [--preview <dir>] [kind ...]

Sources are public-domain files (US Government: USGS Bee Inventory and Monitoring Lab) on Wikimedia Commons
(SOURCES below); missing ones are downloaded into <download-dir> (never into the repo). One image is
processed at a time at a modest working resolution (RAM). Needs Python 3 with numpy and Pillow only.

Per kind: cut-out (difference from the border colour, flood-filled from the frame so dark interiors stay in, opened,
largest component, enclosed holes filled) -> rotate bow-up (manual angle, refined by the principal axis of the eroded
core), optionally mirrored from its better half -> height map (sqrt of the silhouette distance field + a high-pass of
the photo luminance) -> albedo (the class palette: the photo's own markings kept on a dark base, plate margins
tinted) -> segment joints found from the transverse crease profile -> cybernetics that follow the body: an exo-ribcage
(rib pairs from the midline conduit arching out and back along the outline, tapered, gold root clamps), emerald seams
traced along the joints, cables along the margins, a sensor cluster on the head, and a per-class engine recipe (rim cups, drive tube, staggered pods,
engine shelf, manifold + dozer blade, nacelles, cargo hauler cans, nozzle cluster) -> lighting as concordArt.ts does
it (normals from the height field, the key light CONCORD_LIGHT from ahead of the bow, ambient occlusion, cast shadow,
specular: a thin-film sheen on chitin, cool glints on teal metal, warm on gold), after rust and wear on the metal
(grime in recesses, discolouration, chipped edges, scratches, rust streaks running aft) -> emissive glow added unlit ->
downsampled to the kind's source side (2 x its largest texture side, like concordHullSource).

The base and the port are an egg sac: a procedural translucent membrane (highlight rim) over large eggs carrying the
egg photo's texture with a soft inner glow, a cradle ring, a central hub and docking arms (the base folds them to the
flanks, the port spreads them; both sized to the stock frames). Rust and wear are sized for the stock texture sides
(broad patches, rust along every part's aft edge, darker worn edges, streaks).

Next to each <kind>.png goes <kind>.json: the lights drawn on the cybernetic parts (blue blinking position lights on
rib tips, the widest ribs, stern and masthead, a blue strobe pair on all but the frigate, steady emerald running
lights along the ribs and flanks, engine glow at each nozzle), the thruster runs at each nozzle, and the limbs (legs /
antennae: the silhouette's thin parts, split into pieces with their attachment points) packed into <kind>-limbs.png,
all in output px. The game maps them through
its placement and bakes them (concordArt.ts finishConcordImages): pure-blue nozzle runs for the ambient exhaust, halos
by blink group on the ambient nav-light cycle.
"""

import json
import math
import os
import sys
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

UA = {"User-Agent": "openDWU-art-build/0.1 (https://github.com/jfj-oss/openDWU)"}

# kind -> source. rot: degrees counter-clockwise that bring the head up; crop: (l, t, r, b) fractions of the frame
# kept before cutting out; thr: background difference threshold; open: opening radius (working px) that strips hairs /
# antennae; close: closing radius that fills wing membranes between veins.
SOURCES = {
    "frigate": dict(file="File:Tortoise beetle horse nettle, talbot, md, back 2015-05-17-17.02.39 ZS PMax (17647306988).jpg", rot=0, thr=0.10, open=3, close=2, mirror="right"),
    "destroyer": dict(file="File:Black weevil, back, MAGLEV 2020-08-12-18.06.06 ZS PMax UDR (50226838318).jpg", rot=90, thr=0.10, open=3, close=0, mirror="left"),
    "battleship": dict(file="File:Longhorn beetle back, full body shot 2020-08-06-13.58.52 ZS PMax UDR (50249971271).jpg", rot=-90, thr=0.10, open=3, close=0, mirror="left"),
    "carrier": dict(file="File:Stenocrepis mexicana, u, maryland, cove point, back 2017-01-13-10.39.46 ZS PMax UDR (31524066523).jpg", rot=-90, thr=0.10, open=3, close=0, mirror="left"),
    "construction": dict(file="File:Pterostichus permundus, u, maryland, cove point, back 2017-01-13-11.11.29 ZS PMax UDR (32263131336).jpg", rot=-90, thr=0.10, open=3, close=0, mirror="left"),
    "explorer": dict(file="File:Carabus serratus, back, penn state, stout PMax UDR 01 copy - Flickr - Sam Droege.jpg", rot=90, thr=0.10, open=3, close=0, mirror="right"),
    "freighter": dict(file="File:Brown marmorated stink bug (Halyomorpha halys) - Back - USGS Bee Inventory and Monitoring Laboratory.jpg", rot=0, thr=0.10, open=3, close=0),
    "treasure": dict(file="File:Gold beetle, u, back, South Africa 2019-12-18-12.24.08 ZS PMax UDR (49689294367).jpg", rot=0, thr=0.10, open=3, close=0),
    "base": dict(file="File:Corn earworm, eggs 2014-06-06-10.46.51 ZS PMax (15938018542).jpg", rot=0, thr=0, open=0, close=0),
    "port": dict(file="File:Corn earworm, eggs 2014-06-06-10.46.51 ZS PMax (15938018542).jpg", rot=0, thr=0, open=0, close=0),
}
KINDS = list(SOURCES)

# Output side per kind: 2 x the kind's largest texture side (concordArt.ts SHIP_SIDES / BASE_SIDES / treasure 512).
OUT_SIDE = {k: 768 for k in KINDS}
OUT_SIDE["base"] = 896
OUT_SIDE["port"] = 896
OUT_SIDE["treasure"] = 1024

# Working resolution: the cut-out's longest side (the output is downsampled from it).
WORK = 1100

# concordArt.ts CONCORD_LIGHT (x right, y down the image, z out of it): from ahead of the bow, high.
def norm3(x, y, z):
    l = math.sqrt(x * x + y * y + z * z)
    return np.array([x / l, y / l, z / l], np.float32)


LIGHT = norm3(0.08, -0.72, 0.69)
HALF = norm3(LIGHT[0], LIGHT[1], LIGHT[2] + 1)

# Materials.
M_CHITIN, M_MEMBRANE, M_METAL, M_CABLE, M_ENGINE = 0, 1, 2, 3, 4


# ------------------------------------------------------------------------------------------------------------------
# Download
# ------------------------------------------------------------------------------------------------------------------

def fetch(dl, kind):
    src = SOURCES[kind]
    path = os.path.join(dl, kind + ".jpg")
    meta = os.path.join(dl, kind + ".json")
    if os.path.exists(path) and os.path.exists(meta):
        return path, json.load(open(meta))
    q = urllib.parse.urlencode({"action": "query", "format": "json", "titles": src["file"], "prop": "imageinfo",
                                "iiprop": "url|size|extmetadata", "iiurlwidth": "2400"})
    d = json.load(urllib.request.urlopen(urllib.request.Request("https://commons.wikimedia.org/w/api.php?" + q, headers=UA)))
    ii = next(iter(d["query"]["pages"].values()))["imageinfo"][0]
    m = ii["extmetadata"]
    lic = m.get("LicenseShortName", {}).get("value", "")
    if lic not in ("Public domain", "CC0"):
        raise SystemExit(f"{kind}: licence {lic!r} is not public domain / CC0")
    rec = {"file": src["file"], "page": ii["descriptionurl"], "url": ii["url"].split("?")[0], "licence": lic,
           "artist": m.get("Artist", {}).get("value", ""), "credit": m.get("Credit", {}).get("value", "")}
    os.makedirs(dl, exist_ok=True)
    data = urllib.request.urlopen(urllib.request.Request(ii.get("thumburl") or ii["url"], headers=UA)).read()
    open(path, "wb").write(data)
    json.dump(rec, open(meta, "w"), indent=1)
    return path, rec


# ------------------------------------------------------------------------------------------------------------------
# Small image helpers (numpy + Pillow; no scipy)
# ------------------------------------------------------------------------------------------------------------------

def to_l(a):
    return Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8), "L")


def from_l(im):
    return np.asarray(im, np.float32) / 255


def blur(a, r):
    """Gaussian-ish blur of a float field (three box passes via cumulative sums), edge-clamped."""
    if r <= 0:
        return a
    k = max(1, int(round(r * 0.9)))
    out = a.astype(np.float32)
    for axis in (0, 1):
        for _ in range(3):
            pad = [(0, 0), (0, 0)]
            pad[axis] = (k + 1, k)
            p = np.pad(out, pad, mode="edge")
            c = np.cumsum(p, axis=axis, dtype=np.float64)
            if axis == 0:
                out = ((c[2 * k + 1:, :] - c[:-2 * k - 1, :]) / (2 * k + 1)).astype(np.float32)
            else:
                out = ((c[:, 2 * k + 1:] - c[:, :-2 * k - 1]) / (2 * k + 1)).astype(np.float32)
    return out


def morph(mask, r, op):
    """Binary dilate (max) / erode (min) by a (2r+1) square, via Pillow."""
    if r <= 0:
        return mask
    im = to_l(mask.astype(np.float32))
    f = ImageFilter.MaxFilter if op == "max" else ImageFilter.MinFilter
    for _ in range(r):
        im = im.filter(f(3))
    return from_l(im) > 0.5


def distance(mask, cap):
    """Chamfer-ish inside distance (px, capped): count of erosions a pixel survives."""
    d = np.zeros(mask.shape, np.float32)
    im = to_l(mask.astype(np.float32))
    for i in range(cap):
        a = np.asarray(im) > 127
        if not a.any():
            break
        d += a
        im = im.filter(ImageFilter.MinFilter(3) if i % 2 == 0 else ImageFilter.MinFilter(3))
    return d


def components(mask, keep_frac=0.03):
    """The largest 4-connected component plus any at least keep_frac of it (Pillow flood fill, one per component)."""
    work = Image.fromarray((mask * 255).astype(np.uint8), "L").copy()
    comps = []
    a = np.asarray(work).copy()
    for _ in range(400):
        ys, xs = np.nonzero(a == 255)
        if len(ys) == 0:
            break
        ImageDraw.floodfill(work, (int(xs[0]), int(ys[0])), 128)
        b = np.asarray(work)
        c = b == 128
        comps.append(c)
        work = Image.fromarray(np.where(c, 0, b).astype(np.uint8), "L").copy()
        a = np.asarray(work)
    if not comps:
        return mask
    comps.sort(key=lambda c: -int(c.sum()))
    big = int(comps[0].sum())
    out = np.zeros(mask.shape, bool)
    for c in comps:
        if c.sum() >= big * keep_frac:
            out |= c
    return out


def holes(mask):
    """Pixels outside `mask` not connected to the frame."""
    lab = Image.fromarray(np.pad(np.where(mask, 255, 0).astype(np.uint8), 1), "L").copy()
    ImageDraw.floodfill(lab, (0, 0), 128)
    return np.asarray(lab)[1:-1, 1:-1] == 0


def bbox(mask):
    ys, xs = np.nonzero(mask)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def hash01(x, y, seed):
    h = (x * 374761393 + y * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFF) / 0xFFFFFF


def value_noise(shape, cell, seed):
    h, w = shape
    gy, gx = h // cell + 2, w // cell + 2
    rng = np.random.default_rng(seed)
    g = rng.random((gy, gx)).astype(np.float32)
    im = Image.fromarray(g, "F").resize((gx * cell, gy * cell), Image.BICUBIC)
    return np.asarray(im, np.float32)[:h, :w]


# ------------------------------------------------------------------------------------------------------------------
# Cut-out and straighten
# ------------------------------------------------------------------------------------------------------------------

def cutout(path, kind):
    src = SOURCES[kind]
    im = Image.open(path).convert("RGB")
    if "crop" in src:
        l, t, r, b = src["crop"]
        im = im.crop((int(l * im.width), int(t * im.height), int(r * im.width), int(b * im.height)))
    s = 1600 / max(im.size)
    if s < 1:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    rgb = np.asarray(im, np.float32) / 255
    H, W, _ = rgb.shape
    border = np.concatenate([rgb[:4].reshape(-1, 3), rgb[-4:].reshape(-1, 3), rgb[:, :4].reshape(-1, 3), rgb[:, -4:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    diff = np.abs(blur(rgb[..., 0], 1.5) - bg[0])
    diff = np.maximum(diff, np.abs(blur(rgb[..., 1], 1.5) - bg[1]))
    diff = np.maximum(diff, np.abs(blur(rgb[..., 2], 1.5) - bg[2]))
    near = diff < src["thr"]
    if "sat" in src:
        # A textured light backdrop: the specimen is what is saturated (or dark), not what differs from the frame.
        near = (saturation(np.dstack([blur(rgb[..., c], 1.5) for c in range(3)])) < src["sat"]) & (luma(rgb) > 0.35)
    # Flood the background from a one-pixel frame: dark interiors not connected to the frame stay in.
    lab = Image.fromarray(np.pad(np.where(near, 0, 255).astype(np.uint8), 1), "L").copy()  # copy: fromarray may share a read-only buffer
    ImageDraw.floodfill(lab, (0, 0), 128)
    fg = (np.asarray(lab)[1:-1, 1:-1] != 128)
    fg = morph(fg, src["close"], "max")
    fg = morph(fg, src["close"], "min")
    fg = morph(fg, src["open"], "min")
    fg = morph(fg, src["open"], "max")
    fg = components(fg)
    # Dark chitin can touch the backdrop through thin gaps (sutures, the pronotum seam): fill what a closed outline
    # encloses (only the enclosed holes are added, not the bridges).
    if src.get("seal", 10) > 0:
        fg |= holes(morph(morph(fg, src.get("seal", 10), "max"), src.get("seal", 10), "min"))
    # Rotate bow-up (expand canvas), then refine by the principal axis of the core (legs / wings eroded away).
    rgba = np.dstack([rgb, fg.astype(np.float32)])
    img = Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").rotate(src["rot"], Image.BICUBIC, expand=True)
    a = np.asarray(img, np.float32)[..., 3] / 255 > 0.5
    core = morph(a, max(4, int(0.02 * max(a.shape))), "min")
    if core.sum() > 100:
        ys, xs = np.nonzero(core)
        x0 = xs - xs.mean()
        y0 = ys - ys.mean()
        cxx, cyy, cxy = (x0 * x0).mean(), (y0 * y0).mean(), (x0 * y0).mean()
        ang = 0.5 * math.degrees(math.atan2(2 * cxy, cxx - cyy))  # major axis angle from +x (y down)
        tilt = ang - 90 if ang > 0 else ang + 90  # deviation from vertical
        if abs(tilt) < 25 and cyy > cxx * 1.15:
            img = img.rotate(tilt, Image.BICUBIC, expand=True)
    arr = np.asarray(img, np.float32) / 255
    m = arr[..., 3] > 0.5
    if src.get("mirror"):
        # Bilateral symmetry from the better-preserved half (a leg folded under on one side, a tilted specimen).
        core = morph(m, max(4, int(0.03 * max(m.shape))), "min")
        cx = int(round(np.nonzero(core)[1].mean())) if core.any() else m.shape[1] // 2
        half = min(cx, m.shape[1] - cx)
        if src["mirror"] == "left":
            keep = arr[:, cx - half:cx]
            arr = np.concatenate([keep, keep[:, ::-1]], axis=1)
        else:
            keep = arr[:, cx:cx + half]
            arr = np.concatenate([keep[:, ::-1], keep], axis=1)
        m = arr[..., 3] > 0.5
    x0, y0, x1, y1 = bbox(m)
    arr = arr[y0:y1, x0:x1]
    # Working resolution, with a margin for the grafted engine pods / plates.
    s = WORK / max(arr.shape[:2])
    out = Image.fromarray((arr * 255 + 0.5).astype(np.uint8), "RGBA").resize((max(1, round(arr.shape[1] * s)), max(1, round(arr.shape[0] * s))), Image.LANCZOS)
    arr = np.asarray(out, np.float32) / 255
    return arr


def preview_cutout(arr, path):
    a = arr[..., 3:4]
    rgb = arr[..., :3] * a + np.array([0.15, 0.15, 0.2]) * (1 - a)
    Image.fromarray((rgb * 255).astype(np.uint8)).save(path)




# ------------------------------------------------------------------------------------------------------------------
# Per-kind parameters
# ------------------------------------------------------------------------------------------------------------------

def rgb3(r, g, b):
    return np.array([r, g, b], np.float32)


# Body colouring per class: one family of dark purples / pinks (related species of one faction), each its own.
# base: the darkest chitin; pat: the photo's lighter markings; margin: plate edges / creases; sheen: the thin-film
# highlight pair (and how far it leans to blue).
PALETTES = {
    "frigate": dict(base=rgb3(0.075, 0.022, 0.045), pat=rgb3(0.46, 0.12, 0.26), margin=rgb3(0.62, 0.18, 0.36), sheen=(rgb3(1.0, 0.45, 0.72), rgb3(0.85, 0.35, 0.95)), blue=0.15),  # dark rose-pink
    "destroyer": dict(base=rgb3(0.022, 0.022, 0.07), pat=rgb3(0.16, 0.14, 0.42), margin=rgb3(0.3, 0.24, 0.62), sheen=(rgb3(0.6, 0.5, 1.0), rgb3(0.4, 0.5, 1.0)), blue=0.5),  # blackened indigo
    "battleship": dict(base=rgb3(0.045, 0.018, 0.08), pat=rgb3(0.3, 0.09, 0.44), margin=rgb3(0.46, 0.14, 0.58), sheen=(rgb3(0.9, 0.42, 1.0), rgb3(0.62, 0.36, 1.0)), blue=0.3),  # deep violet
    "carrier": None,  # the construction bug's wine (user call)
    "construction": dict(base=rgb3(0.07, 0.012, 0.025), pat=rgb3(0.42, 0.06, 0.15), margin=rgb3(0.58, 0.12, 0.24), sheen=(rgb3(1.0, 0.4, 0.55), rgb3(0.85, 0.3, 0.7)), blue=0.1),  # wine / burgundy
    "explorer": dict(base=rgb3(0.03, 0.025, 0.08), pat=rgb3(0.22, 0.16, 0.5), margin=rgb3(0.36, 0.3, 0.7), sheen=(rgb3(0.55, 0.45, 1.0), rgb3(0.35, 0.6, 1.0)), blue=0.7),  # iridescent purple-blue
    "freighter": dict(base=rgb3(0.06, 0.028, 0.055), pat=rgb3(0.38, 0.18, 0.32), margin=rgb3(0.52, 0.24, 0.44), sheen=(rgb3(0.95, 0.55, 0.85), rgb3(0.7, 0.45, 0.95)), blue=0.2),  # dusky mauve
    "treasure": None,  # the construction bug's wine (user call)
    "base": dict(base=rgb3(0.045, 0.016, 0.065), pat=rgb3(0.3, 0.09, 0.4), margin=rgb3(0.46, 0.14, 0.52), sheen=(rgb3(0.9, 0.42, 1.0), rgb3(0.6, 0.4, 1.0)), blue=0.35),  # violet-plum
}

PALETTES["carrier"] = PALETTES["construction"]
PALETTES["port"] = PALETTES["base"]
PALETTES["treasure"] = PALETTES["construction"]

# The cybernetics: a complementary teal / emerald family against the purple-pink bodies (hue opposite magenta, so the
# grafts read as foreign machinery at a glance and the glow does not merge with the sheen), with small warm-gold trim.
TEAL = rgb3(0.12, 0.21, 0.22)
TEAL_DARK = rgb3(0.05, 0.095, 0.105)
TEAL_LIGHT = rgb3(0.2, 0.33, 0.33)
GOLD = rgb3(0.8, 0.6, 0.26)
CABLE = rgb3(0.04, 0.07, 0.075)
GLOW_EM = rgb3(0.2, 1.0, 0.62)
GLOW_CY = rgb3(0.25, 0.9, 1.0)
LIGHT_EM = (0.35, 1.0, 0.7)  # steady running lights (concordArt.ts ConcordLight.c)
LIGHT_BLUE = (0.35, 0.62, 1.0)  # every blinking light (user call): position / navigation lights and strobes
GLOW_PINK = rgb3(1.0, 0.4, 0.75)  # the egg sac's living glow
RUST = rgb3(0.42, 0.2, 0.08)
BARE = rgb3(0.46, 0.5, 0.5)
SHEEN_BLUE = rgb3(0.36, 0.42, 1.0)

# Per class: segs = how many segment-joint grafts; style = the engine recipe; strobes on the larger hulls.
# ribs: the exo-ribcage's rib pairs (scaled with the hull); style: the engine recipe; strobes: a strobe pair.
SHAPE = {
    "frigate": dict(ribs=3, style="rim", n=2, strobes=False, seed=11, small=True),
    "destroyer": dict(ribs=5, style="tube", n=3, strobes=True, seed=23),
    "battleship": dict(ribs=7, style="pods", n=4, strobes=True, seed=37),
    "carrier": dict(ribs=7, style="shelf", n=4, strobes=True, seed=41),
    "construction": dict(ribs=5, style="manifold", n=3, strobes=True, seed=53),
    "explorer": dict(ribs=4, style="nacelles", n=2, strobes=True, seed=67, small=True),
    "freighter": dict(ribs=5, style="twin", n=2, strobes=True, seed=71),
    "treasure": dict(ribs=8, style="cluster", n=4, strobes=True, seed=83),
}

M_CHITIN, M_METAL, M_CABLE, M_ENGINE, M_GOLD = 0, 2, 3, 4, 5


def luma(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def saturation(rgb):
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    return np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)


class GBuf:
    """The working canvas: albedo, height (px), material, gloss, emissive, alpha."""

    def __init__(self, h, w):
        self.h, self.w = h, w
        self.alb = np.zeros((h, w, 3), np.float32)
        self.hgt = np.zeros((h, w), np.float32)
        self.mat = np.zeros((h, w), np.uint8)
        self.emis = np.zeros((h, w, 3), np.float32)
        self.alpha = np.zeros((h, w), np.float32)
        self.gloss = np.zeros((h, w), np.float32)

    def stamp(self, mask, prof, raise_h, alb, mat, on_top=True, emis=None):
        """Lays a part (bool mask + 0..1 profile) over the canvas: height raised by raise_h * prof above what is there
        (or above 0 off the body), albedo / material replaced, alpha set."""
        m = mask
        if on_top:
            ys, xs = np.nonzero(m)
            if len(ys) == 0:
                return
            pad = 24
            y0, y1, x0, x1 = max(0, ys.min() - pad), ys.max() + pad + 1, max(0, xs.min() - pad), xs.max() + pad + 1
            sm = np.zeros_like(self.hgt)
            sm[y0:y1, x0:x1] = blur(self.hgt[y0:y1, x0:x1], 10)
            base = np.where(self.alpha > 0.5, sm, 0)
        else:
            base = 0
        nh = base + raise_h * prof
        self.hgt = np.where(m, np.maximum(nh, self.hgt if not on_top else nh), self.hgt)
        if alb.ndim == 1:
            self.alb[m] = alb
        else:
            self.alb[m] = alb[m]
        self.mat[m] = mat
        self.alpha[m] = 1
        self.gloss[m] = 0
        if emis is not None:
            self.emis[m] = emis[m] if emis.ndim == 3 else emis


def poly_mask(h, w, pts):
    im = Image.new("L", (w, h), 0)
    ImageDraw.Draw(im).polygon([(float(x), float(y)) for x, y in pts], fill=255)
    return np.asarray(im) > 127


def ellipse_mask(h, w, cx, cy, rx, ry):
    im = Image.new("L", (w, h), 0)
    ImageDraw.Draw(im).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    return np.asarray(im) > 127


def line_mask(h, w, pts, width):
    im = Image.new("L", (w, h), 0)
    ImageDraw.Draw(im).line([(float(x), float(y)) for x, y in pts], fill=255, width=max(1, int(round(width))), joint="curve")
    r = width / 2
    d = ImageDraw.Draw(im)
    for x, y in (pts[0], pts[-1]):
        d.ellipse((x - r, y - r, x + r, y + r), fill=255)
    return np.asarray(im) > 127


def bevel(mask, r):
    """0..1 profile rising from the mask edge over ~r px (a blur of the mask, renormalised)."""
    b = blur(mask.astype(np.float32), max(1, r))
    return np.clip((b - 0.5) * 2, 0, 1) * mask


def cylinder(mask, r):
    """Rounded cross-section profile (sqrt of the blurred mask)."""
    b = blur(mask.astype(np.float32), max(1, r * 0.6))
    return np.sqrt(np.clip(b, 0, 1)) * mask


def bezier(p0, p1, p2, p3, n=48):
    t = np.linspace(0, 1, n)[:, None]
    pts = (1 - t) ** 3 * np.array(p0) + 3 * (1 - t) ** 2 * t * np.array(p1) + 3 * (1 - t) * t * t * np.array(p2) + t ** 3 * np.array(p3)
    return [tuple(p) for p in pts]


# ------------------------------------------------------------------------------------------------------------------
# Chitin: height, albedo and seams from the photo
# ------------------------------------------------------------------------------------------------------------------

def body_geometry(mask, body):
    """Centre column, body extent and per-row half width of the body core (legs / wings eroded away)."""
    H, W = mask.shape
    core = morph(body, max(3, int(0.018 * max(H, W))), "min")
    if core.sum() < 50:
        core = body
    ys, xs = np.nonzero(core)
    cx = float(xs.mean())
    top, bot = int(ys.min()), int(ys.max())
    hw = np.zeros(H, np.float32)
    cb = bbox(core)
    cx = (cb[0] + cb[2] - 1) / 2
    ci = int(round(cx))
    reach = max(2, int(0.04 * W))
    for y in range(top, bot + 1):
        row = core[y]
        # The run at (or nearest to) the centre column: a dark suture can split the core down the middle.
        hits = np.nonzero(row[max(0, ci - reach):ci + reach + 1])[0]
        if len(hits) == 0:
            continue
        l = r = max(0, ci - reach) + int(hits[np.argmin(np.abs(hits + max(0, ci - reach) - ci))])
        while l > 0 and row[l - 1]:
            l -= 1
        while r < W - 1 and row[r + 1]:
            r += 1
        hw[y] = max(r - ci, ci - l) + 0.5
    # Fill gaps (waists) by the running maximum of a small window, then smooth.
    hw = np.maximum(hw, 0)
    k = max(3, int(0.01 * H))
    hw = np.convolve(hw, np.ones(2 * k + 1) / (2 * k + 1), mode="same")
    bbox_full = bbox(mask)
    col = body[:, max(0, ci - 2):ci + 3].any(1)
    rows = np.nonzero(col)[0]
    if len(rows):
        # The lowest centre-column row connected to the core (a dangling leg tip below the abdomen does not count).
        y = bot
        while y + 1 < H and col[y + 1]:
            y += 1
        bot = y
        y = top
        while y - 1 >= 0 and col[y - 1]:
            y -= 1
        top = y
    return dict(cx=cx, top=top, bot=bot, hw=hw, core=core, beam=bbox_full[2] - bbox_full[0], fullbot=bbox_full[3] - 1)


def chitin(g, rgb, mask, kind, rng):
    """Height, albedo, gloss and the faint emerald joint glow of the photo's chitin (class palette)."""
    pal = PALETTES[kind]
    H, W = mask.shape
    S = max(H, W)
    L = luma(rgb)
    body = mask
    geo = body_geometry(mask, body)
    d = distance(body, int(0.2 * S))
    D = max(4.0, float(np.percentile(d[body], 99.5)))
    dome = np.sqrt(np.clip(2 * D * d - d * d, 0, None)) * 0.7
    # Photo detail: high-pass luminance (highlights clipped so the photo's own glints don't read as bumps).
    Lc = blur(np.minimum(L, np.percentile(L[body], 92)), 1.2)
    hp = Lc - blur(Lc, 0.01 * S + 2)
    crease = blur(np.clip((blur(Lc, 4) - Lc) / 0.07, 0, 1) * body, 1.0)
    detail_h = 0.006 * S
    hgt = dome + detail_h * np.clip(hp / 0.1, -1, 1) * 0.6 - crease * detail_h * 0.8
    # Albedo: the photo's own markings kept in the class colour on its dark base.
    lo, hi = np.percentile(L[body], 5), np.percentile(L[body], 95)
    ln = blur(np.clip((L - lo) / max(1e-3, hi - lo), 0, 1), 1.5)
    alb = pal["base"] + (pal["pat"] - pal["base"]) * (ln ** 1.7)[..., None] * 0.9
    small = SHAPE.get(kind, {}).get("small", False)
    band = np.clip(1 - d / ((0.02 if small else 0.012) * S), 0, 1) * body
    # Small hulls (stock 80-100 px textures) get a brighter, wider margin so the outline still reads at play size.
    alb = alb + (pal["margin"] * (1.35 if small else 1.0) - alb) * ((0.75 if small else 0.5) * band ** 1.5)[..., None]
    alb = alb + (pal["margin"] - alb) * (0.35 * crease ** 1.5)[..., None]
    # The deepest creases glow faintly emerald where they cross the body core (the grafts' nervous system).
    nz = value_noise((H, W), max(8, int(0.03 * S)), SHAPE.get(kind, {"seed": 5})["seed"])
    seam = np.clip((crease - 0.65) / 0.25, 0, 1) * (nz > 0.5) * (d > 0.012 * S) * body
    seam = blur(seam * morph(seam > 0.3, 1, "min"), 0.8)
    gl_lo = np.percentile(L[body], 88)
    g.gloss = np.clip((blur(L, 1.5) - gl_lo) / max(1e-3, 1 - gl_lo), 0, 1) * body
    g.alb[mask] = alb[mask]
    g.hgt = np.where(mask, hgt, 0).astype(np.float32)
    g.mat[mask] = M_CHITIN
    g.alpha[mask] = 1
    g.emis = (seam[..., None] * GLOW_EM * 0.45).astype(np.float32)
    # Segment joints: rows where the transverse crease energy across the body core peaks.
    cx, top, bot, hw = geo["cx"], geo["top"], geo["bot"], geo["hw"]
    prof = np.zeros(H, np.float32)
    for y in range(top, bot + 1):
        w = int(hw[y] * 0.7)
        if w > 2:
            prof[y] = crease[y, int(cx) - w:int(cx) + w].mean()
    prof = np.convolve(prof, np.ones(9) / 9, mode="same")
    Lb = max(1, bot - top)
    cand = [y for y in range(top + int(0.12 * Lb), bot - int(0.1 * Lb)) if prof[y] == prof[max(top, y - int(0.04 * Lb)):y + int(0.04 * Lb) + 1].max() and prof[y] > 0]
    cand.sort(key=lambda y: -prof[y])
    joints = []
    for y in cand:
        if all(abs(y - j) > 0.1 * Lb for j in joints):
            joints.append(y)
    geo["joints"] = sorted(joints)
    geo["crease"] = crease
    return geo


# ------------------------------------------------------------------------------------------------------------------
# The cybernetic layer: grafts that follow the body (teal metal, gold trim, emerald glow) and its lights
# ------------------------------------------------------------------------------------------------------------------

def light(g, x, y, kind, c=None):
    g.lights.append((float(x), float(y), kind, c))


def rivet(g, x, y, r):
    m = ellipse_mask(g.h, g.w, x, y, r, r)
    g.stamp(m, cylinder(m, r), r * 0.8, GOLD, M_GOLD)


def glow_line(g, pts, width, colour, k=1.0):
    m = line_mask(g.h, g.w, pts, width)
    g.emis[m] = np.maximum(g.emis[m], colour * k)


def plate_poly(g, pts, raise_h, colour=TEAL, glow_edge=None, trim=None):
    m = poly_mask(g.h, g.w, pts)
    if m.sum() < 6:
        return m
    nz = value_noise((g.h, g.w), 6, len(pts) * 977 + int(pts[0][0]))
    alb = np.broadcast_to(colour, (g.h, g.w, 3)) * (0.85 + 0.3 * nz)[..., None]
    g.stamp(m, bevel(m, max(1.5, raise_h * 0.9)), raise_h, alb, M_METAL)
    if trim is not None:
        edge = m & ~morph(m, 2, "min")
        g.alb[edge] = trim
        g.mat[edge] = M_GOLD
    if glow_edge is not None:
        inner = morph(m, 3, "min") & ~morph(m, 5, "min")
        g.emis[inner] = np.maximum(g.emis[inner], glow_edge)
    return m


def contour_band(geo, y0, y1, inset, step=2):
    """A polygon between rows y0..y1 whose sides follow the body's own outline (cx +- inset * half width)."""
    cx, hw = geo["cx"], geo["hw"]
    ys = list(range(int(y0), int(y1) + 1, step)) or [int(y0)]
    left = [(cx - max(2.0, hw[y] * inset), y) for y in ys]
    right = [(cx + max(2.0, hw[y] * inset), y) for y in reversed(ys)]
    return left + right


def graft_band(g, geo, yc, thick, inset, ph, running=True):
    """Armour collar along a segment joint: hugs the outline, gold leading edge, emerald seam along the joint itself,
    gold rivets, emerald running lights at its ends."""
    pts = contour_band(geo, yc - thick / 2, yc + thick / 2, inset)
    plate_poly(g, pts, ph, TEAL, trim=None)
    cx, hw = geo["cx"], geo["hw"]
    y = int(yc)
    xl, xr = cx - hw[y] * inset, cx + hw[y] * inset
    lead = [(cx - hw[int(yc - thick / 2)] * inset, yc - thick / 2), (cx + hw[int(yc - thick / 2)] * inset, yc - thick / 2)]
    glow_line(g, [(p[0], p[1] + 1) for p in lead], 2, GOLD * 0.0)  # (no glow; gold trim below)
    trim = line_mask(g.h, g.w, lead, max(2, thick * 0.12))
    g.alb[trim] = GOLD
    g.mat[trim] = M_GOLD
    seam = [(cx - hw[int(yc + thick / 2)] * inset * 0.96, yc + thick / 2 - 1), (cx + hw[int(yc + thick / 2)] * inset * 0.96, yc + thick / 2 - 1)]
    glow_line(g, seam, max(2, thick * 0.1), GLOW_EM, 0.85)
    n = max(2, int((xr - xl) / max(8, thick * 1.2)))
    for i in range(n):
        rivet(g, xl + (xr - xl) * (i + 0.5) / n, yc, max(1.5, thick * 0.1))
    if running:
        light(g, xl + thick * 0.4, yc, "deck", LIGHT_EM)
        light(g, xr - thick * 0.4, yc, "deck", LIGHT_EM)
    return xl, xr


def spine(g, geo, y0, y1, w, lights=4):
    """A conduit down the suture / dorsal midline with gold clamps and a row of emerald running lights."""
    cx = geo["cx"]
    m = line_mask(g.h, g.w, [(cx, y0), (cx, y1)], w)
    g.stamp(m, cylinder(m, w / 2), w * 0.6, TEAL_DARK, M_CABLE)
    core = line_mask(g.h, g.w, [(cx, y0 + w), (cx, y1 - w)], max(1, w * 0.25))
    g.emis[core] = np.maximum(g.emis[core], GLOW_CY * 0.5)
    for i in range(1, 6):
        y = y0 + (y1 - y0) * i / 6
        cm = line_mask(g.h, g.w, [(cx - w * 0.9, y), (cx + w * 0.9, y)], max(2, w * 0.4))
        g.stamp(cm, cylinder(cm, w * 0.3), w * 0.8, GOLD, M_GOLD)
    for i in range(lights):
        light(g, cx, y0 + (y1 - y0) * (i + 0.5) / lights, "deck", LIGHT_EM)


def flank_cables(g, geo, f0, f1, inset, w):
    """Cables routed along the body margin (the joint between the dorsal plates and the flank), gold clamps."""
    cx, top, bot, hw = geo["cx"], geo["top"], geo["bot"], geo["hw"]
    Lb = bot - top
    for s in (-1, 1):
        ys = np.linspace(top + f0 * Lb, top + f1 * Lb, 40)
        pts = [(cx + s * hw[int(y)] * inset, float(y)) for y in ys]
        m = line_mask(g.h, g.w, pts, w)
        g.stamp(m, cylinder(m, w / 2), w * 0.55, CABLE, M_CABLE)
        for i in range(4, len(pts) - 2, 9):
            x, y = pts[i]
            cm = line_mask(g.h, g.w, [(x - w, y), (x + w, y)], max(2, w * 0.5))
            g.stamp(cm, cylinder(cm, w * 0.4), w * 0.75, GOLD, M_GOLD)


def sensors(g, geo, f, r, n=3):
    """Sensor cluster on the head / pronotum: teal domes with emerald lenses, the masthead light on the middle one."""
    cx, top, bot, hw = geo["cx"], geo["top"], geo["bot"], geo["hw"]
    y = top + f * (bot - top)
    xs = [cx] if n == 1 else [cx + (i - (n - 1) / 2) * r * 2.6 for i in range(n)]
    for i, x in enumerate(xs):
        rr = r if x == cx else r * 0.7
        m = ellipse_mask(g.h, g.w, x, y, rr, rr)
        g.stamp(m, cylinder(m, rr), rr * 0.9, TEAL_LIGHT, M_METAL)
        ring = m & ~morph(m, 2, "min")
        g.alb[ring] = GOLD
        lens = ellipse_mask(g.h, g.w, x - rr * 0.15, y - rr * 0.15, rr * 0.4, rr * 0.4)
        g.emis[lens] = np.maximum(g.emis[lens], GLOW_EM * 0.9)
    light(g, cx, y + r * 0.2, "white")


def nozzle(g, x, y_exit, r, ring=GOLD):
    """An engine bell opening aft: teal shroud, gold rim, cyan-emerald glow; registers a thruster mark + engine light."""
    sh = ellipse_mask(g.h, g.w, x, y_exit - r * 0.75, r, r * 0.75)
    g.stamp(sh, cylinder(sh, r), r * 0.8, TEAL_DARK, M_ENGINE)
    rim = sh & ~morph(sh, max(2, int(r * 0.18)), "min")
    g.alb[rim] = ring
    g.mat[rim] = M_GOLD
    core = ellipse_mask(g.h, g.w, x, y_exit - r * 0.55, r * 0.55, r * 0.35)
    g.alb[core] = TEAL_DARK * 0.4
    g.emis[core] = np.maximum(g.emis[core], GLOW_CY * 0.6)
    g.thrusters.append((float(x), float(y_exit - r * 0.3), float(r * 0.55)))
    light(g, x, y_exit - r * 0.45, "engine")


def pod(g, x, y0, y1, r, bands=2):
    """A capsule engine pod with gold bands and an emerald seam."""
    pts = [(x - r, y0 + r), (x + r, y0 + r), (x + r * 0.85, y1), (x - r * 0.85, y1)]
    m = poly_mask(g.h, g.w, pts) | ellipse_mask(g.h, g.w, x, y0 + r, r, r)
    g.stamp(m, cylinder(m, r), r * 1.1, TEAL, M_ENGINE)
    for i in range(bands):
        yy = y0 + (y1 - y0) * (0.3 + 0.35 * i)
        b = poly_mask(g.h, g.w, [(x - r, yy), (x + r, yy), (x + r, yy + max(2, r * 0.2)), (x - r, yy + max(2, r * 0.2))]) & m
        g.alb[b] = GOLD
        g.mat[b] = M_GOLD
    seam = line_mask(g.h, g.w, [(x, y0 + r * 1.2), (x, y1 - r * 0.4)], max(1, r * 0.12))
    g.emis[seam] = np.maximum(g.emis[seam], GLOW_EM * 0.6)
    return m


def strut(g, x0, y0, x1, y1, w):
    m = line_mask(g.h, g.w, [(x0, y0), (x1, y1)], w)
    g.stamp(m, cylinder(m, w / 2), w * 0.6, TEAL_DARK, M_METAL)


def engines(g, geo, style, n, ph):
    """Per-class engine recipes (never one shared block). Returns the stern light position."""
    cx, top, bot, hw = geo["cx"], geo["top"], geo["bot"], geo["hw"]
    Lb = bot - top
    at = lambda f: int(np.clip(top + f * Lb, 0, g.h - 1))
    half = lambda f: float(max(hw[at(f)], 0.03 * Lb))
    if style == "rim":
        # Small round hull: two cups set into the rear rim, flush with the outline.
        r = 0.05 * Lb
        for s in (-1, 1):
            x = cx + s * max(half(0.85) * 0.5, r * 1.3)
            yb = top + 0.95 * Lb + r * 0.35
            nozzle(g, x, yb, r)
        return cx, bot - 0.02 * Lb
    if style == "tube":
        # Long sleek hull: a central drive tube running out past the tail, two small vents beside it.
        r = max(4.0, half(0.85) * 0.28)
        y0, y1 = at(0.62), bot + 0.12 * Lb
        m = poly_mask(g.h, g.w, [(cx - r, y0), (cx + r, y0), (cx + r * 0.9, y1), (cx - r * 0.9, y1)])
        g.stamp(m, cylinder(m, r), r, TEAL, M_ENGINE)
        for f in (0.35, 0.6, 0.85):
            yy = y0 + (y1 - y0) * f
            b = poly_mask(g.h, g.w, [(cx - r, yy), (cx + r, yy), (cx + r, yy + max(2, r * 0.18)), (cx - r, yy + max(2, r * 0.18))]) & m
            g.alb[b] = GOLD
            g.mat[b] = M_GOLD
            g.emis[b] = np.maximum(g.emis[b], GLOW_EM * 0.35)
        nozzle(g, cx, y1 + r * 0.5, r * 1.1)
        for s in (-1, 1):
            nozzle(g, cx + s * half(0.88) * 0.62, at(0.97) + r * 0.2, r * 0.55)
        return cx, y1 - r
    if style == "pods":
        # Capital ship: four pods, the inner pair along the elytral tips, the outer pair on pylons, staggered.
        r = max(5.0, 0.036 * Lb)
        for s in (-1, 1):
            xi = cx + s * max(half(0.88) * 0.3, r * 1.2)
            pod(g, xi, at(0.84), bot + 0.04 * Lb, r)
            nozzle(g, xi, bot + 0.04 * Lb + r * 0.7, r * 0.95)
            xo = cx + s * (half(0.62) * 1.0 + r * 1.5)
            strut(g, cx + s * half(0.6) * 0.7, at(0.6), xo, at(0.62), r * 0.5)
            pod(g, xo, at(0.56), at(0.8), r * 0.8)
            nozzle(g, xo, at(0.8) + r * 0.6, r * 0.75)
        return cx, bot + 0.02 * Lb
    if style == "shelf":
        # Carrier: an engine shelf curving with the rear of the hull, four bells along its trailing edge.
        y0 = at(0.86)
        y1 = bot + 0.05 * Lb
        pts = contour_band(geo, y0, bot - 2, 0.92)
        plate_poly(g, pts, ph * 1.2, TEAL_DARK, glow_edge=GLOW_EM * 0.5)
        r = max(6.0, half(0.86) * 1.5 / (n * 2.1))
        for i in range(n):
            x = cx + (i - (n - 1) / 2) * r * 2.2
            nozzle(g, x, at(0.97) + r * 0.6, r)
        y1 = at(0.97)
        return cx, y1 - r
    if style == "manifold":
        # Construction: a trapezoid manifold fused to the rear with three bells; a gold-edged dozer blade on the head.
        y0 = at(0.84)
        y1 = bot + 0.06 * Lb
        y0 = at(0.9)
        plate_poly(g, [(cx - half(0.9) * 0.34, y0), (cx + half(0.9) * 0.34, y0), (cx + half(0.9) * 0.46, y1), (cx - half(0.9) * 0.46, y1)], ph * 1.2, TEAL_DARK, glow_edge=GLOW_EM * 0.4, trim=GOLD)
        r = max(5.0, half(0.9) * 0.15)
        for i in range(3):
            nozzle(g, cx + (i - 1) * r * 2.3, y1 + r * 0.5, r)
        bt, bb = top - 0.01 * Lb, at(0.05)
        blade = [(cx - half(0.06) * 1.05, bb), (cx - half(0.03) * 0.9, bt), (cx + half(0.03) * 0.9, bt), (cx + half(0.06) * 1.05, bb)]
        plate_poly(g, blade, ph * 1.4, TEAL_LIGHT, trim=GOLD)
        for s in (-1, 1):
            light(g, cx + s * half(0.05) * 0.85, at(0.035), "flood")
        return cx, y1 - r
    if style == "nacelles":
        # Explorer: two slim nacelles on pylons beside the abdomen, reaching past the tail.
        r = max(4.0, 0.03 * Lb)
        for s in (-1, 1):
            x = cx + s * (half(0.72) + r * 1.6)
            strut(g, cx + s * half(0.6) * 0.8, at(0.6), x, at(0.62), r * 0.6)
            strut(g, cx + s * half(0.8) * 0.8, at(0.8), x, at(0.82), r * 0.5)
            pod(g, x, at(0.5), bot + 0.04 * Lb, r, bands=3)
            nozzle(g, x, bot + 0.04 * Lb + r * 0.6, r * 0.9)
        return cx, bot - 0.01 * Lb
    if style == "twin":
        # Freighter: two big engine cans at the rear corners; cargo pods grafted in rows along the back.
        r = max(6.0, half(0.78) * 0.26)
        for s in (-1, 1):
            x = cx + s * half(0.82) * 0.5
            pod(g, x, at(0.8), bot + 0.03 * Lb, r, bands=1)
            nozzle(g, x, bot + 0.03 * Lb + r * 0.6, r)
        return cx, bot - 0.02 * Lb
    # cluster (treasure): four bells in a 2 x 2 cluster on a gold-trimmed mount.
    r = max(6.0, half(0.9) * 0.2)
    mount = ellipse_mask(g.h, g.w, cx, bot - 0.035 * Lb, r * 2.6, r * 2.0)
    g.stamp(mount, bevel(mount, r * 0.5), ph * 1.3, TEAL_DARK, M_METAL)
    ring = mount & ~morph(mount, 3, "min")
    g.alb[ring] = GOLD
    g.mat[ring] = M_GOLD
    for (dx, dy) in ((-1, -0.3), (1, -0.3), (-0.55, 0.9), (0.55, 0.9)):
        nozzle(g, cx + dx * r * 1.3, bot - 0.035 * Lb + dy * r * 1.2 + r * 0.6, r * 0.75)
    return cx, bot - 0.03 * Lb


def trace_joint(geo, yc, inset=0.9):
    """The segment joint near row yc traced across the body: per column, the crease maximum within a small band,
    smoothed. Returns [(x, y)] from left to right."""
    cx, hw, crease = geo["cx"], geo["hw"], geo["crease"]
    Lb = geo["bot"] - geo["top"]
    w = hw[int(yc)] * inset
    band = max(3, int(0.04 * Lb))
    xs = np.linspace(cx - w, cx + w, 33)
    ys = []
    for x in xs:
        xi = int(round(x))
        col = crease[max(0, int(yc) - band):int(yc) + band + 1, xi]
        ys.append(int(yc) - band + int(np.argmax(col)) if col.max() > 0.2 else yc)
    ys = np.convolve(np.pad(np.array(ys, np.float32), 3, mode="edge"), np.ones(7) / 7, mode="valid")
    return list(zip(xs.tolist(), ys.tolist()))


def strip_mask(h, w, pts, w0, w1):
    """A tapered strip along a polyline (width w0 at the first point, w1 at the last)."""
    pts = np.array(pts, np.float32)
    n = len(pts)
    d = np.gradient(pts, axis=0)
    l = np.maximum(1e-3, np.hypot(d[:, 0], d[:, 1]))
    nx, ny = -d[:, 1] / l, d[:, 0] / l
    wv = np.linspace(w0, w1, n) / 2
    left = [(float(pts[i, 0] + nx[i] * wv[i]), float(pts[i, 1] + ny[i] * wv[i])) for i in range(n)]
    right = [(float(pts[i, 0] - nx[i] * wv[i]), float(pts[i, 1] - ny[i] * wv[i])) for i in reversed(range(n))]
    m = poly_mask(h, w, left + right)
    m |= ellipse_mask(h, w, float(pts[-1, 0]), float(pts[-1, 1]), w1 / 2, w1 / 2)
    return m


def ribcage(g, geo, nribs, ph, rng, small=False):
    """A cybernetic exo-ribcage clamped over the carapace: rib pairs branching from the spine conduit, arching outward
    and back along the body's outline, tapering to the tips, gold clamps at the roots, blue lights on some tips.
    Head and abdomen tip stay clear. Returns the rib tips [(y, xl, xr)] from bow to stern."""
    cx, top, bot, hw = geo["cx"], geo["top"], geo["bot"], geo["hw"]
    Lb = bot - top
    H = g.h
    at = lambda f: int(np.clip(top + f * Lb, 0, H - 1))
    rows = list(np.linspace(0.22, 0.74, nribs))
    # Snap to the photo's own segment joints where one is close (the ribs follow the segmentation).
    for j in geo["joints"]:
        fj = (j - top) / Lb
        k = int(np.argmin([abs(fj - f) for f in rows]))
        if abs(rows[k] - fj) < 0.5 / nribs:
            rows[k] = fj
    w0 = max(5.0, 0.034 * Lb) * (1.5 if small else 1.0)
    tips = []
    for i, f in enumerate(rows):
        y0 = at(f)
        sweep = 0.05 * Lb * (0.6 + 0.8 * f)
        side = []
        for s in (-1, 1):
            pts = []
            for t in np.linspace(0, 1, 28):
                y = y0 + sweep * t * t
                reach = hw[int(min(H - 1, y))] * 0.88
                pts.append((cx + s * (w0 * 0.4 + (reach - w0 * 0.4) * (t ** 0.85)), y))
            m = strip_mask(g.h, g.w, pts, w0, w0 * 0.3)
            g.stamp(m, cylinder(m, w0 * 0.5), ph * 2.2, TEAL_LIGHT, M_METAL)
            side.append(pts[-1])
            # Blue position lights on alternate rib tips, steady emerald running lights midway along the others.
            if i % 2 == 0:
                light(g, pts[-2][0], pts[-2][1], "blink", LIGHT_BLUE)
            else:
                mid = pts[len(pts) // 2]
                light(g, mid[0], mid[1], "deck", LIGHT_EM)
        clamp = ellipse_mask(g.h, g.w, cx, y0 + 1, w0 * 0.95, w0 * 0.6)
        g.stamp(clamp, cylinder(clamp, w0 * 0.6), ph * 2.0, GOLD, M_GOLD)
        tips.append((y0, side[0], side[1]))
    return tips


def cyber(g, geo, kind, sh, rng):
    cx, top, bot, hw = geo["cx"], geo["top"], geo["bot"], geo["hw"]
    Lb = bot - top
    S = max(g.h, g.w)
    ph = max(2.0, 0.0055 * S)
    at = lambda f: int(np.clip(top + f * Lb, 0, g.h - 1))
    # Joint seams: emerald glow traced along the photo's segment joints (under the ribs).
    for y in geo["joints"][:4]:
        glow_line(g, trace_joint(geo, y, 0.8), max(2, 0.006 * Lb), GLOW_EM, 0.75)
    spine(g, geo, at(0.16), at(0.8), max(3.0, 0.014 * Lb), lights=3 if Lb < 900 else 4)
    tips = ribcage(g, geo, sh["ribs"], ph, rng, sh.get("small", False))
    flank_cables(g, geo, 0.2, 0.86, 0.9, max(2.5, 0.009 * Lb))
    # Edge running lights along the flanks.
    for s in (-1, 1):
        for f in np.linspace(0.3, 0.8, 4):
            y = at(f)
            light(g, cx + s * hw[y] * 0.9, y, "deck", LIGHT_EM)
    sensors(g, geo, 0.09, max(3.0, 0.018 * Lb))
    sx, sy = engines(g, geo, sh["style"], sh["n"], ph)
    # Position lights (all blue, all blinking, user call): the widest rib's tips, the stern and the masthead (sensors);
    # a strobe pair at the last rib's tips.
    widest = max(tips, key=lambda t: t[2][0] - t[1][0])
    light(g, widest[1][0], widest[1][1], "blink", LIGHT_BLUE)
    light(g, widest[2][0], widest[2][1], "blink", LIGHT_BLUE)
    light(g, sx, sy, "blink", LIGHT_BLUE)
    if sh["strobes"]:
        last = tips[-1]
        light(g, last[1][0], last[1][1] + 2, "strobe", LIGHT_BLUE)
        light(g, last[2][0], last[2][1] + 2, "strobe", LIGHT_BLUE)


def wear(g, seed):
    """Rust and wear on the teal gunmetal (never the chitin), sized to read at the stock texture sizes: grime in
    recesses, low-frequency discolouration, broad rust patches, darker worn edges with chips of bare metal, scratches,
    and rust streaks running aft (down the image) from random points."""
    H, W = g.h, g.w
    metal = (g.mat == M_METAL) | (g.mat == M_ENGINE)
    if not metal.any():
        return
    rng = np.random.default_rng(seed + 1000)
    S = max(H, W)
    u = S / 1400
    rec = np.clip((blur(g.hgt, 6) - g.hgt) / 3, 0, 1)
    n1 = value_noise((H, W), max(10, S // 25), seed + 11)
    n2 = value_noise((H, W), max(6, S // 60), seed + 12)
    nb = value_noise((H, W), max(16, S // 12), seed + 14)
    alb = g.alb
    m3 = metal[..., None]
    alb[:] = np.where(m3, alb * (1 - 0.45 * rec)[..., None] * (0.82 + 0.36 * n1)[..., None], alb)
    alb[:] = np.where(m3, alb + (rgb3(0.2, 0.16, 0.1) - alb) * (0.2 * np.clip(n2 - 0.5, 0, 1) * 2)[..., None], alb)
    # Broad rust patches (mottled by the finer noise).
    patch = np.clip((nb - 0.5) / 0.16, 0, 1) * (0.55 + 0.45 * n2) * metal
    # Rust gathers on the aft side of every part (it runs aft): a band along each trailing edge, mottled.
    aft = metal & ~np.roll(morph(metal, 1, "min"), -max(3, int(6 * u)), axis=0)
    aft = blur(aft.astype(np.float32), 1.5 * u) * metal * (0.5 + 0.5 * n2)
    rust = np.clip(0.75 * patch + 0.8 * aft, 0, 0.85)
    alb[:] = alb + (RUST - alb) * rust[..., None]
    g.rust = np.maximum(getattr(g, "rust", np.zeros((H, W), np.float32)), rust).astype(np.float32)
    # Worn edges: a darker band along every metal edge, chips of bare metal on it.
    band = metal & ~morph(metal, max(2, int(3 * u)), "min")
    alb[band] *= 0.62
    hf = value_noise((H, W), max(3, int(4 * u)), seed + 13)
    chips = (metal & ~morph(metal, max(1, int(1.5 * u)), "min")) & (hf > 0.64)
    alb[chips] = BARE
    ys, xs = np.nonzero(metal)
    for _ in range(int(len(ys) / 900)):
        k = rng.integers(len(ys))
        x, y = xs[k], ys[k]
        a = rng.uniform(0, math.pi)
        ln = rng.uniform(6, 22) * u
        sm = line_mask(H, W, [(x, y), (x + math.cos(a) * ln, y + math.sin(a) * ln)], max(1, int(u))) & metal
        alb[sm] = np.minimum(1, alb[sm] + 0.09)
    # Rust streaks running aft, wide and long enough for the stock texture sizes.
    for _ in range(int(len(ys) / 1400)):
        k = rng.integers(len(ys))
        x, y = int(xs[k]), int(ys[k])
        ln = int(rng.uniform(40, 120) * u)
        wd = rng.uniform(3, 7) * u
        for dy in range(ln):
            yy = y + dy
            if yy >= H:
                break
            t = dy / max(1, ln)
            ww = wd * (1 - 0.6 * t)
            x0, x1 = int(x - ww), int(x + ww + 1)
            seg = metal[yy, x0:x1]
            if not seg.any():
                break
            k2 = 0.7 * (1 - t) ** 1.2
            row = alb[yy, x0:x1]
            row[seg] = row[seg] + (RUST - row[seg]) * k2
            rr = g.rust[yy, x0:x1]
            rr[seg] = np.maximum(rr[seg], k2)


# ------------------------------------------------------------------------------------------------------------------
# Lighting (concordArt.ts's approach: normals from the height field, key light, AO, cast shadow, specular)
# ------------------------------------------------------------------------------------------------------------------

def shade(g, kind, seed):
    pal = PALETTES[kind]
    H, W = g.h, g.w
    a = g.alpha > 0.5
    h = blur(g.hgt, 1.2)

    def normals(hh):
        gx = np.zeros_like(hh)
        gy = np.zeros_like(hh)
        gx[:, 1:-1] = (hh[:, 2:] - hh[:, :-2]) * 0.5
        gy[1:-1, :] = (hh[2:, :] - hh[:-2, :]) * 0.5
        ln = np.sqrt(gx * gx + gy * gy + 1)
        return -gx / ln, -gy / ln, 1 / ln

    nx, ny, nz = normals(h)
    ndl = np.clip(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2], 0, 1)
    ndh = np.clip(nx * HALF[0] + ny * HALF[1] + nz * HALF[2], 0, 1)
    bx, by, bz = normals(blur(g.hgt, 0.012 * max(H, W) + 2))
    ndh_b = np.clip(bx * HALF[0] + by * HALF[1] + bz * HALF[2], 0, 1)
    dx, dy = LIGHT[0], LIGHT[1]
    l2 = math.hypot(dx, dy)
    dx, dy = dx / l2, dy / l2
    tanel = LIGHT[2] / l2
    occ = np.zeros_like(h)
    for t in range(2, int(0.06 * max(H, W)), 2):
        sx, sy = int(round(dx * t)), int(round(dy * t))
        sh = np.roll(np.roll(h, -sy, 0), -sx, 1)
        occ = np.maximum(occ, sh - h - t * tanel)
    shadow = np.clip(1 - occ / 3, 0.3, 1)
    ao = np.clip(1 - np.maximum(0, blur(h, 10) - h) * 0.05, 0.5, 1) * np.clip(1 - np.maximum(0, blur(h, 3) - h) * 0.12, 0.55, 1)
    mat = g.mat
    chit = mat == M_CHITIN
    nzv = value_noise((H, W), max(6, int(0.05 * max(H, W))), seed + 5)
    t = (1 - bz) * 2.4 + nzv * 0.5 + (bx * 0.6 - by * 0.4)
    s1 = 0.5 + 0.5 * np.sin(2 * math.pi * t)
    s2 = np.clip(np.sin(2 * math.pi * (t * 0.5 + 0.2)), 0, 1)
    sa, sb = pal["sheen"]
    sheen = sa * s1[..., None] + sb * (1 - s1)[..., None]
    sheen = sheen + (SHEEN_BLUE - sheen) * (pal["blue"] * s2)[..., None]
    sheen_hot = sheen + (rgb3(1.0, 0.95, 1.0) - sheen) * (0.6 * ndh_b ** 90)[..., None]
    spec_c = 1.0 * ndh_b ** 30 + 0.16 * ndh_b ** 5 + 0.5 * ndh ** 110
    spec_m = (0.8 * ndh ** 32 + 0.14 * ndh ** 6) * (1 - 0.85 * getattr(g, "rust", 0))
    fres = (1 - bz) ** 2.5
    diffuse = (0.34 * ao + 1.0 * ndl * shadow)[..., None]
    rgb = g.alb * diffuse
    glint = g.gloss ** 1.5 * 0.55
    rgb = rgb + np.where(chit[..., None], sheen_hot * (spec_c * shadow)[..., None] + (SHEEN_BLUE * pal["blue"] + sheen * (1 - pal["blue"])) * (0.18 * fres * ao)[..., None]
                         + (sheen * 0.6 + 0.4) * glint[..., None], 0)
    metal = (mat == M_METAL) | (mat == M_ENGINE)
    rgb = rgb + np.where(metal[..., None], rgb3(0.75, 0.95, 0.92) * (spec_m * shadow)[..., None] + GLOW_CY * (0.05 * fres)[..., None], 0)
    gold = mat == M_GOLD
    rgb = rgb + np.where(gold[..., None], rgb3(1.0, 0.85, 0.5) * ((0.9 * ndh ** 24 + 0.2 * ndh ** 4) * shadow)[..., None], 0)
    cab = mat == M_CABLE
    rgb = rgb + np.where(cab[..., None], rgb3(0.5, 0.85, 0.8) * (0.45 * ndh ** 20 * shadow)[..., None], 0)
    e = g.emis
    bloom = np.dstack([blur(e[..., c], 1.6) for c in range(3)])
    rgb = rgb + e + bloom * 0.6
    # Readability at game size: a gentle lift of the darks.
    rgb = np.clip(rgb, 0, 1) ** 0.88
    return rgb, a


# ------------------------------------------------------------------------------------------------------------------
# Build one kind
# ------------------------------------------------------------------------------------------------------------------

def new_gbuf(H, W):
    g = GBuf(H, W)
    g.lights = []
    g.thrusters = []
    g.limbs = []
    return g


def pieces(mask, min_px):
    """4-connected components of `mask` with at least min_px pixels."""
    work = Image.fromarray((mask * 255).astype(np.uint8), "L").copy()
    out = []
    for _ in range(200):
        a = np.asarray(work)
        ys, xs = np.nonzero(a == 255)
        if len(ys) == 0:
            break
        ImageDraw.floodfill(work, (int(xs[0]), int(ys[0])), 128)
        b = np.asarray(work)
        c = b == 128
        if c.sum() >= min_px:
            out.append(c)
        work = Image.fromarray(np.where(c, 0, b).astype(np.uint8), "L").copy()
    return out


def find_limbs(g, mask, geo):
    """The appendages (legs, antennae): the thin parts of the insect's silhouette (what an opening by the body's own
    scale removes), still bare chitin after the grafts, split into pieces, each with its attachment point (the mean of
    its pixels touching the body) and its kind (antenna: attached near the head and reaching forward)."""
    cx, top, bot = geo["cx"], geo["top"], geo["bot"]
    Lb = bot - top
    r = max(4, int(0.03 * Lb))
    body = morph(morph(mask, r, "min"), r, "max")
    body = morph(body, 2, "max") & mask
    limbs = mask & ~body & (g.mat == M_CHITIN)
    near = morph(body, 3, "max")
    out = []
    for c in pieces(limbs, int(0.0008 * mask.sum())):
        contact = c & near
        if contact.sum() < 3:
            continue
        ys, xs = np.nonzero(contact)
        px, py = float(xs.mean()), float(ys.mean())
        cys, cxs = np.nonzero(c)
        antenna = py < top + 0.16 * Lb and cys.mean() < py
        out.append(dict(mask=c, pivot=(px, py), kind="antenna" if antenna else "leg", area=int(c.sum())))
    out.sort(key=lambda d: -d["area"])
    return out[:12]


def build_ship(path, kind):
    sh = SHAPE[kind]
    rng = np.random.default_rng(sh["seed"])
    cut = cutout(path, kind)
    h0, w0 = cut.shape[:2]
    P = int(0.16 * max(h0, w0))
    H, W = h0 + 2 * P, w0 + 2 * P
    rgb = np.zeros((H, W, 3), np.float32)
    rgb[P:P + h0, P:P + w0] = cut[..., :3]
    mask = np.zeros((H, W), bool)
    mask[P:P + h0, P:P + w0] = cut[..., 3] > 0.5
    g = new_gbuf(H, W)
    geo = chitin(g, rgb, mask, kind, rng)
    cyber(g, geo, kind, sh, rng)
    wear(g, sh["seed"])
    col, a = shade(g, kind, sh["seed"])
    g.limbs = find_limbs(g, mask, geo)
    return col, a, g


def build_base(path, dl, kind="base"):
    """The generic base / the Exchange: an egg sac. A smooth translucent sac membrane (clear silhouette, highlight rim)
    over about nineteen large eggs (each carrying the photo's own egg texture, a soft inner glow, dark gaps between
    them), a cradle ring with gold clamps and short prongs, a teal hub at the centre where the docking arms attach.
    The base folds its arms to the flanks (its length then matches the stock base), the port spreads them evenly."""
    Wb = 1300
    H = W = int(Wb * 1.3)
    c = W / 2
    R = 0.3 * Wb
    pal = PALETTES[kind]
    # One egg's texture from the photo: a square of the solid egg mass, used (scaled) inside every egg.
    e = np.asarray(Image.open(path).convert("RGB"), np.float32) / 255
    side = int(e.shape[0] * 0.5)
    x0 = (e.shape[1] - side) // 2
    e = e[e.shape[0] - side:, x0:x0 + side]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    rx, ry = R, R * 0.93
    q = ((xx - c) / rx) ** 2 + ((yy - c) / ry) ** 2
    sac = q <= 1
    re = R * 0.19
    centres = [(c, c)]
    for ring, n in ((1, 6), (2, 12)):
        for k in range(n):
            a = 2 * math.pi * k / n + (0.26 if ring == 2 else 0)
            centres.append((c + math.sin(a) * re * 2.05 * ring, c + math.cos(a) * re * 2.05 * ring * 0.93))
    egg_h = np.zeros((H, W), np.float32)
    egg_glow = np.zeros((H, W), np.float32)
    egg_tex = np.zeros((H, W), np.float32)
    tex = luma(np.asarray(Image.fromarray((e * 255).astype(np.uint8)).resize((int(re * 2), int(re * 2)), Image.LANCZOS), np.float32) / 255)
    tex = (tex - tex.mean()) / max(1e-3, tex.std())
    for ex, ey in centres:
        rr = np.hypot(xx - ex, yy - ey) / re
        inside = (rr < 1) & sac
        if not inside.any():
            continue
        egg_h = np.maximum(egg_h, np.where(inside, np.sqrt(np.clip(1 - rr * rr, 0, 1)), 0))
        egg_glow = np.maximum(egg_glow, np.where(inside, np.clip(1 - rr, 0, 1) ** 1.3, 0))
        x0i, y0i = int(ex - re), int(ey - re)
        th, tw = tex.shape
        sl = (slice(max(0, y0i), min(H, y0i + th)), slice(max(0, x0i), min(W, x0i + tw)))
        sub = tex[sl[0].start - y0i:sl[0].stop - y0i, sl[1].start - x0i:sl[1].stop - x0i]
        egg_tex[sl] = np.where(inside[sl], sub, egg_tex[sl])
    g = new_gbuf(H, W)
    rng = np.random.default_rng(97)
    g.alpha[sac] = 1
    g.mat[sac] = M_CHITIN
    # The membrane drapes smoothly over the eggs: a broad dome with a faint echo of them.
    dome = np.sqrt(np.clip(1 - q, 0, 1)) * 0.1 * Wb
    g.hgt = np.where(sac, dome + egg_h * 0.012 * Wb, 0).astype(np.float32)
    eggs_alb = rgb3(0.62, 0.34, 0.5) * (0.85 + 0.12 * np.clip(egg_tex, -2, 2))[..., None]
    gaps = pal["base"] * 0.6
    under = np.where((egg_h > 0)[..., None], eggs_alb, gaps)
    membrane = rgb3(0.22, 0.08, 0.26)
    g.alb[:] = np.where(sac[..., None], under * 0.55 + membrane * 0.45, 0)
    # Eggs glow softly through the skin; a bright highlight rim along the sac's outline.
    rim = np.clip((q - 0.82) / 0.18, 0, 1) * sac
    g.emis = (egg_glow[..., None] * GLOW_PINK * 0.28 + rim[..., None] ** 2 * rgb3(0.7, 0.55, 0.9) * 0.22).astype(np.float32)
    g.gloss[:] = 0
    # Cradle ring around the sac, gold clamps, short prongs gripping the membrane between the arms.
    ring = (q <= 1.06) & (q >= 0.97)
    g.stamp(ring, bevel(ring, 4), 0.012 * Wb, TEAL, M_METAL, on_top=False)
    lateral = kind == "base"
    angles = [60, 90, 120, 240, 270, 300] if lateral else [30, 90, 150, 210, 270, 330]
    for k in range(6):
        a = math.radians(angles[k] + (90 if lateral else 30))
        p0 = (c + math.sin(a) * rx * 1.01, c + math.cos(a) * ry * 1.01)
        p1 = (c + math.sin(a) * rx * 0.8, c + math.cos(a) * ry * 0.8)
        m = strip_mask(H, W, [p0, ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2), p1], 0.024 * Wb, 0.01 * Wb)
        g.stamp(m, cylinder(m, 0.01 * Wb), 0.012 * Wb, TEAL_LIGHT, M_METAL)
        cm = ellipse_mask(H, W, p0[0], p0[1], 0.016 * Wb, 0.016 * Wb)
        g.stamp(cm, cylinder(cm, 0.016 * Wb), 0.016 * Wb, GOLD, M_GOLD)
        light(g, p1[0], p1[1], "deck", LIGHT_EM)
    # Docking arms from the hub, over the sac and out past the ring.
    arm_len = (0.16 if lateral else 0.09) * Wb
    hubr = R * 0.26
    tips = []
    for deg in angles:
        ang = math.radians(deg)
        ux, uy = math.sin(ang), math.cos(ang)
        vx, vy = uy, -ux
        r0, r1 = hubr * 0.9, R * 1.02 + arm_len
        w = 0.02 * Wb
        for sgn in (-1, 1):
            q0 = (c + ux * r0 + vx * w * sgn, c + uy * r0 + vy * w * sgn)
            q1 = (c + ux * r1 + vx * w * 0.6 * sgn, c + uy * r1 + vy * w * 0.6 * sgn)
            m = line_mask(H, W, [q0, q1], 0.012 * Wb)
            g.stamp(m, cylinder(m, 0.006 * Wb), 0.02 * Wb, TEAL, M_METAL, on_top=False)
        for i in range(1, 8):
            f = r0 + (r1 - r0) * i / 8
            ww = w * (1 - 0.4 * i / 8)
            q0 = (c + ux * f + vx * ww, c + uy * f + vy * ww)
            q1 = (c + ux * (f + (r1 - r0) / 16) - vx * ww, c + uy * (f + (r1 - r0) / 16) - vy * ww)
            m = line_mask(H, W, [q0, q1], 0.006 * Wb)
            g.stamp(m, cylinder(m, 0.003 * Wb), 0.018 * Wb, TEAL_DARK, M_METAL, on_top=False)
            if i % 3 == 0:
                light(g, c + ux * f + vx * w, c + uy * f + vy * w, "deck", LIGHT_EM)
        tx, ty = c + ux * (r1 + 0.02 * Wb), c + uy * (r1 + 0.02 * Wb)
        ringm = ellipse_mask(H, W, tx, ty, 0.04 * Wb, 0.04 * Wb)
        g.stamp(ringm, bevel(ringm, 6), 0.02 * Wb, TEAL_LIGHT, M_METAL, on_top=False)
        inner = ellipse_mask(H, W, tx, ty, 0.023 * Wb, 0.023 * Wb)
        g.alb[inner] = TEAL_DARK * 0.4
        g.emis[inner] = np.maximum(g.emis[inner], GLOW_EM * 0.6)
        gr = ringm & ~morph(ringm, 3, "min")
        g.alb[gr] = GOLD
        g.mat[gr] = M_GOLD
        tips.append((tx, ty))
    # The hub: the focal point where every arm meets (teal boss, gold ring, emerald ring, gold rivets).
    hub = ellipse_mask(H, W, c, c, hubr, hubr)
    g.stamp(hub, bevel(hub, 10), 0.045 * Wb, TEAL, M_METAL)
    gring = ellipse_mask(H, W, c, c, hubr, hubr) & ~ellipse_mask(H, W, c, c, hubr * 0.88, hubr * 0.88)
    g.alb[gring] = GOLD
    g.mat[gring] = M_GOLD
    ering = ellipse_mask(H, W, c, c, hubr * 0.62, hubr * 0.62) & ~ellipse_mask(H, W, c, c, hubr * 0.52, hubr * 0.52)
    g.emis[ering] = np.maximum(g.emis[ering], GLOW_EM * 0.9)
    boss = ellipse_mask(H, W, c, c, hubr * 0.4, hubr * 0.4)
    g.stamp(boss, cylinder(boss, hubr * 0.4), 0.03 * Wb, TEAL_LIGHT, M_METAL)
    for k in range(10):
        a = 2 * math.pi * k / 10
        rivet(g, c + math.sin(a) * hubr * 0.75, c + math.cos(a) * hubr * 0.75, 6)
    for p in tips:
        light(g, p[0], p[1], "blink", LIGHT_BLUE)
    light(g, c, c, "blink", LIGHT_BLUE)
    for p in (tips[1], tips[4]):
        light(g, p[0], p[1] + 0.035 * Wb, "strobe", LIGHT_BLUE)
    wear(g, 97)
    col, a = shade(g, kind, 97)
    return col, a, g


def finish(col, a, side, fill=0.94):
    """Crops to the silhouette, scales its longest side to fill x side, centres it on a side x side RGBA canvas
    (premultiplied area resample). Returns the image and the work -> output coordinate map."""
    x0, y0, x1, y1 = bbox(a)
    col = col[y0:y1, x0:x1]
    al = a[y0:y1, x0:x1].astype(np.float32)
    al = np.clip(blur(al, 0.7) * 1.15, 0, 1) * (blur(al, 0.7) > 0.25)
    s = fill * side / max(col.shape[:2])
    nw, nh = max(1, round(col.shape[1] * s)), max(1, round(col.shape[0] * s))
    pm = np.dstack([col * al[..., None], al])
    out = np.zeros((side, side, 4), np.float32)
    chans = [np.asarray(Image.fromarray(pm[..., c].astype(np.float32), "F").resize((nw, nh), Image.BOX), np.float32) for c in range(4)]
    ox, oy = (side - nw) // 2, (side - nh) // 2
    for c in range(4):
        out[oy:oy + nh, ox:ox + nw, c] = chans[c]
    al = out[..., 3]
    rgbo = np.where(al[..., None] > 1e-4, out[..., :3] / np.maximum(al[..., None], 1e-4), 0)
    rgba = np.dstack([np.clip(rgbo, 0, 1), np.clip(al, 0, 1)])
    img = (rgba * 255 + 0.5).astype(np.uint8)
    pb = (img[..., 0] == 0) & (img[..., 1] == 0) & (img[..., 2] == 255)
    img[pb, 2] = 254
    py = (img[..., 0] == 255) & (img[..., 1] == 255) & (img[..., 2] == 0)
    img[py, 2] = 1
    sx = nw / col.shape[1]
    sy = nh / col.shape[0]

    def mask_out(m):
        """A work-canvas mask in output px (same crop / resample as the image)."""
        mm = m[y0:y1, x0:x1].astype(np.float32)
        r = np.asarray(Image.fromarray(mm, "F").resize((nw, nh), Image.BOX), np.float32)
        o = np.zeros((side, side), bool)
        o[oy:oy + nh, ox:ox + nw] = r > 0.5
        return o

    return img, (lambda x, y: ((x - x0) * sx + ox, (y - y0) * sy + oy)), sx, mask_out


def limb_atlas(img, g, tf, mask_out):
    """The appendages cut from the output image as sprites packed into one atlas (shelf packing), with their place in
    the image and their pivot. The game removes exactly these pixels from the body when it animates them."""
    sprites = []
    for L in g.limbs:
        m = mask_out(L["mask"]) & (img[..., 3] > 0)
        if m.sum() < 4:
            continue
        x0, y0, x1, y1 = bbox(m)
        spr = img[y0:y1, x0:x1].copy()
        spr[..., 3] = np.where(m[y0:y1, x0:x1], spr[..., 3], 0)
        px, py = tf(*L["pivot"])
        sprites.append(dict(img=spr, at=[int(x0), int(y0)], pivot=[round(px, 2), round(py, 2)], kind=L["kind"]))
    if not sprites:
        return None, []
    width = 512
    x = y = rowh = 0
    for sp in sprites:
        h, w = sp["img"].shape[:2]
        if x + w + 2 > width:
            x, y, rowh = 0, y + rowh + 2, 0
        sp["rect"] = [x, y, w, h]
        x += w + 2
        rowh = max(rowh, h)
    atlas = np.zeros((y + rowh + 2, width, 4), np.uint8)
    for sp in sprites:
        ax, ay, w, h = sp["rect"]
        atlas[ay:ay + h, ax:ax + w] = sp["img"]
    return atlas, [dict(rect=sp["rect"], at=sp["at"], pivot=sp["pivot"], kind=sp["kind"]) for sp in sprites]


def manifest(g, tf, scale, side):
    """The fittings in output px: lights (x, y, kind, colour or null) and thruster runs (centre x, row y, half width)."""
    lights = []
    for x, y, kind, c in g.lights:
        X, Y = tf(x, y)
        lights.append([round(X, 2), round(Y, 2), kind, list(c) if c is not None else None])
    thr = []
    for x, y, w in g.thrusters:
        X, Y = tf(x, y)
        thr.append([round(X, 2), round(Y, 2), round(w * scale, 2)])
    return {"side": side, "lights": lights, "thrusters": thr}


def preview_on_dark(img, path, size=512):
    im = Image.fromarray(img, "RGBA").resize((size, size), Image.LANCZOS)
    bg = Image.new("RGBA", (size, size), (10, 10, 16, 255))
    bg.alpha_composite(im)
    bg.convert("RGB").save(path)


# ------------------------------------------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------------------------------------------

def main():
    args = sys.argv[1:]
    dl = args.pop(0)
    out_dir = "public/art/concord-photo"
    preview = None
    kinds = []
    while args:
        a = args.pop(0)
        if a == "--out":
            out_dir = args.pop(0)
        elif a == "--preview":
            preview = args.pop(0)
        else:
            kinds.append(a)
    kinds = kinds or KINDS
    os.makedirs(out_dir, exist_ok=True)
    for kind in kinds:
        path, rec = fetch(dl, kind)
        if kind in ("base", "port"):
            col, a, g = build_base(path, dl, kind)
        else:
            col, a, g = build_ship(path, kind)
        img, tf, scale, mask_out = finish(col, a, OUT_SIDE[kind])
        Image.fromarray(img, "RGBA").save(os.path.join(out_dir, f"{kind}.png"), optimize=True)
        atlas, limbs = limb_atlas(img, g, tf, mask_out)
        man = manifest(g, tf, scale, OUT_SIDE[kind])
        man["limbs"] = limbs
        if atlas is not None:
            Image.fromarray(atlas, "RGBA").save(os.path.join(out_dir, f"{kind}-limbs.png"), optimize=True)
        with open(os.path.join(out_dir, f"{kind}.json"), "w") as f:
            json.dump(man, f, separators=(",", ":"))
        if preview:
            os.makedirs(preview, exist_ok=True)
            preview_on_dark(img, os.path.join(preview, f"{kind}.png"))
        print(kind, img.shape, "lights", len(g.lights), "thrusters", len(g.thrusters), "limbs", len(limbs), flush=True)


if __name__ == "__main__":
    main()
