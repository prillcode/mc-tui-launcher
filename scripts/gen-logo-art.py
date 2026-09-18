#!/usr/bin/env python3
"""Generate src/assets/blockhavenLogo.ts from the reference launcher icon.

The icon is a PNG; there is no pre-made ANSI art in the reference repo, so
we downscale it and encode it as palette-indexed pixel grids that the TUI
renders with half-block characters (fg = top pixel, bg = bottom pixel).
"""
import subprocess, re, json, os, sys

SRC = os.path.expanduser("~/dev/bh-minecraft-launcher/resources/icon.png")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "assets", "blockhavenLogo.ts")
SIZES = [8, 12, 16, 20, 24, 32]
BG = "#181825"
MAX_COLORS = 64
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def dump(n: int):
    # Composite over the panel background, downscale, and quantize so the
    # palette is small (base64-indexable) and the art looks ANSI-ish.
    txt = subprocess.run(
        [
            "magick", SRC,
            "-background", BG, "-alpha", "remove", "-alpha", "off",
            "-resize", f"{n}x{n}!",
            "-dither", "None",
            "-colors", str(MAX_COLORS),
            "-depth", "8",
            "txt:-",
        ],
        capture_output=True, text=True, check=True,
    ).stdout
    grid = [[None] * n for _ in range(n)]
    for line in txt.splitlines():
        m = re.match(r"(\d+),(\d+):\s*\(([^)]*)\)", line)
        if not m:
            continue
        x, y = int(m.group(1)), int(m.group(2))
        parts = [int(p) for p in m.group(3).split(",")[:3]]
        grid[y][x] = "#%02x%02x%02x" % tuple(parts)
    missing = [(x, y) for y in range(n) for x in range(n) if grid[y][x] is None]
    if missing:
        raise SystemExit(f"missing pixels for size {n}: {missing[:5]}")
    return grid


def encode(grid):
    n = len(grid)
    palette, index = [], {}
    rows = []
    for y in range(n):
        row = []
        for x in range(n):
            c = grid[y][x]
            if c not in index:
                index[c] = len(palette)
                palette.append(c)
            row.append(index[c])
        rows.append("".join(ALPHABET[i] for i in row))
    if len(palette) > len(ALPHABET):
        raise SystemExit(f"palette too large: {len(palette)}")
    return palette, rows


sizes = {}
for n in SIZES:
    palette, rows = encode(dump(n))
    sizes[n] = {"palette": palette, "rows": rows}
    print(f"size {n:2d}: {len(palette)} colors")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    f.write("// AUTO-GENERATED from resources/icon.png in bh-minecraft-launcher.\n")
    f.write("// Pixel grids are palette-indexed (base64 alphabet) and drawn with\n")
    f.write("// half-block characters; regenerate with scripts/gen-logo-art.py.\n\n")
    f.write("export interface LogoArt {\n")
    f.write("  /** Index of the art width/height this grid represents (square). */\n")
    f.write("  size: number\n")
    f.write("  palette: string[]\n")
    f.write("  /** `size` rows of `size` base64 chars indexing `palette`. */\n")
    f.write("  rows: string[]\n")
    f.write("}\n\n")
    f.write(f'export const LOGO_ALPHABET = {json.dumps(ALPHABET)}\n\n')
    f.write("export const BLOCKHAVEN_LOGO: Record<number, LogoArt> = {\n")
    for n in SIZES:
        f.write(f"  {n}: {{\n    size: {n},\n    palette: {json.dumps(sizes[n]['palette'])},\n    rows: [\n")
        for r in sizes[n]["rows"]:
            f.write(f'      "{r}",\n')
        f.write("    ],\n  },\n")
    f.write("}\n")
print("wrote", OUT)
