#!/usr/bin/env python3
"""Cut the Concord ship / port sprites out of our FLUX renders (ship on flat white, some with a soft grey cast shadow).

Writes public/art/concord/<kind>.png (512 x 512) plus <kind>-256.png and <kind>-128.png: straight-alpha RGBA, bow up,
the silhouette centred on a transparent square. Our own generated art (CLAUDE.md "Art"), consumed by
src/render/concordArt.ts.

    python3 scripts/concord-cutout.py [--src DIR] [--manifest scripts/concord-sources.json]

The sources are named in scripts/concord-sources.json (kind -> {file, rotate}); DIR defaults to ~/comfyui/ComfyUI/output.

Steps per source: alpha from the distance to white (soft ramp); the cast shadow removed by flood-filling the
background from the four corners through every near-white or neutral-grey pixel, everything reached made transparent;
the alpha edge eroded ~1 px and feathered; edge colours un-premultiplied against white (de-fringe); cropped to the alpha
bbox + 4 px, rotated where the render faces the wrong way, centred on a square and resampled (LANCZOS, premultiplied).
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'art', 'concord')
DEFAULT_SRC = os.path.expanduser('~/comfyui/ComfyUI/output')

# kind -> {"file": source (relative to --src, or absolute), "rotate": degrees counter-clockwise to put the bow up}.
# Swapping the renders = editing this manifest and re-running the script.
MANIFEST = os.path.join(HERE, 'concord-sources.json')
KINDS = ('frigate', 'destroyer', 'battleship', 'construction', 'explorer', 'port')
SIZES = (512, 256, 128)
# Low RGB bits dropped per output size (keeps the set under the 1.5 MB budget; the 512 px file is only ever drawn
# downsampled, so 6 bits per channel do not band on screen).
RGB_MASK = {512: 0xFC, 256: 0xFE, 128: 0xFF}

# Alpha ramp on the RGB distance to white (0 … 441): transparent at or below LO, opaque from HI up.
RAMP_LO = 14.0
RAMP_HI = 60.0
# Background / shadow flood: pixels at most SHADOW_D from white and at most SHADOW_CHROMA in max-min chroma.
SHADOW_D = 150.0
SHADOW_CHROMA = 22.0
MARGIN = 4


def cutout(path, rotate_ccw):
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    h, w, _ = rgb.shape
    d = np.sqrt(((255.0 - rgb) ** 2).sum(-1))
    chroma = rgb.max(-1) - rgb.min(-1)

    # (a) soft alpha from the distance to white.
    ramp = np.clip((d - RAMP_LO) / (RAMP_HI - RAMP_LO), 0.0, 1.0)

    # (b) background + cast shadow: flood from the corners through near-white / neutral-grey pixels.
    cand = ((d <= SHADOW_D) & (chroma <= SHADOW_CHROMA)) | (d <= RAMP_LO)
    fill = Image.fromarray(np.where(cand, 255, 0).astype(np.uint8), 'L').copy()  # (floodfill edits in place: own buffer)
    for xy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if fill.getpixel(xy) == 255:
            ImageDraw.floodfill(fill, xy, 128, thresh=0)
    reached = np.asarray(fill) == 128
    # Away from the background the ship is solid (enclosed light paint keeps its alpha); within a few px of it the
    # soft white ramp shapes the antialiased edge.
    near_bg = np.asarray(Image.fromarray(np.where(reached, 255, 0).astype(np.uint8), 'L').filter(ImageFilter.MaxFilter(7))) > 0
    alpha = np.where(reached, 0.0, np.where(near_bg, ramp, 1.0))
    # Erode ~1 px (drops the grey shadow halo hugging the hull) and feather.
    a8 = Image.fromarray((alpha * 255).astype(np.uint8), 'L').filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    alpha = np.asarray(a8).astype(np.float32) / 255.0
    alpha[alpha < 0.02] = 0.0

    # (c) de-fringe: un-premultiply the edge colours against white.
    a3 = alpha[..., None]
    edge = (alpha > 0.0) & (alpha < 0.999)
    fg = np.where(a3 > 0.05, (rgb - (1.0 - a3) * 255.0) / np.maximum(a3, 1e-3), rgb)
    rgb = np.where(edge[..., None], np.clip(fg, 0.0, 255.0), rgb)

    rgba = np.dstack([rgb, alpha * 255.0]).round().clip(0, 255).astype(np.uint8)
    img = Image.fromarray(rgba, 'RGBA')

    # (d) crop to the alpha bbox + margin, rotate, centre on a square.
    ys, xs = np.nonzero(rgba[..., 3] > 8)
    x0, x1 = max(0, xs.min() - MARGIN), min(w, xs.max() + 1 + MARGIN)
    y0, y1 = max(0, ys.min() - MARGIN), min(h, ys.max() + 1 + MARGIN)
    img = img.crop((x0, y0, x1, y1))
    if rotate_ccw:
        img = img.rotate(rotate_ccw, expand=True)
    side = max(img.size)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(img, ((side - img.size[0]) // 2, (side - img.size[1]) // 2))
    return sq


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=DEFAULT_SRC)
    ap.add_argument('--manifest', default=MANIFEST)
    args = ap.parse_args()
    with open(args.manifest) as fh:
        manifest = json.load(fh)
    missing = [k for k in KINDS if k not in manifest]
    if missing:
        print(f'manifest lacks {missing}', file=sys.stderr)
        return 2
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for kind in KINDS:
        entry = manifest[kind]
        sq = cutout(os.path.join(args.src, os.path.expanduser(entry['file'])), int(entry.get('rotate', 0)))
        pre = sq.convert('RGBa')
        for s in SIZES:
            out = pre.resize((s, s), Image.LANCZOS).convert('RGBA')
            # Fully transparent pixels carry no colour (smaller files, no stray fringe on bilinear sampling).
            a = np.asarray(out).copy()
            a[a[..., 3] == 0] = 0
            a[..., :3] &= RGB_MASK[s]
            out = Image.fromarray(a, 'RGBA')
            name = f'{kind}.png' if s == 512 else f'{kind}-{s}.png'
            p = os.path.join(OUT, name)
            out.save(p, optimize=True)
            n = os.path.getsize(p)
            total += n
            print(f'{name:22s} {s:4d}px {n / 1024:7.1f} KiB  (source {sq.size[0]}px square)')
    print(f'total {total / 1024:.1f} KiB')
    if total > 1.5 * 1024 * 1024:
        print('warning: over the 1.5 MB budget', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
