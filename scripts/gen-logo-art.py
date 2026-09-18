#!/usr/bin/env python3
"""Generate src/assets/blockhavenLogo.ts from the reference launcher icon.

The icon is a PNG; there is no pre-made ANSI art in the reference repo. We
downscale it and encode each pixel as a palette index. The TUI draws square
pixels with half-block characters (fg = top pixel, bg = bottom pixel):

  * background pixels are index 0 (drawn as a blank/transparent cell)
  * the cube's stone faces map to a few mauve theme shades
  * the gold "BH" letters map to a bright catppuccin accent

The result is a transparent grid of solid squares, not a filled bitmap.
"""
import subprocess, re, json, os

SRC = os.path.expanduser("~/dev/bh-minecraft-launcher/resources/icon.png")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "assets", "blockhavenLogo.ts")
SIZES = [8, 12, 16, 20, 24, 32]
BG = (24, 24, 37)                       # #181825 panel background -> index 0
FACES = [(64, 56, 84), (104, 87, 130), (150, 123, 180), (190, 163, 228)]
BH = (205, 214, 244)                    # catppuccin "text" for the letters
PALETTE = [BG, *FACES, BH]
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def luma(p):
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]


def dump(n):
    txt = subprocess.run(
        [
            "magick", SRC,
            "-background", "#181825", "-alpha", "remove", "-alpha", "off",
            "-resize", f"{n}x{n}!",
            "-depth", "8",
            "txt:-",
        ],
        capture_output=True, text=True, check=True,
    ).stdout
    px = {}
    for line in txt.splitlines():
        m = re.match(r"(\d+),(\d+):\s*\(([^)]*)\)", line)
        if not m:
            continue
        x, y = int(m.group(1)), int(m.group(2))
        px[(x, y)] = tuple(int(v) for v in m.group(3).split(",")[:3])

    grid = [[0] * n for _ in range(n)]
    bh_index = len(PALETTE) - 1
    for y in range(n):
        for x in range(n):
            r, g, b = px[(x, y)]
            if r > 140 and r - b > 25 and g > 80:      # gold letters
                grid[y][x] = bh_index
                continue
            L = luma((r, g, b))
            if L < 55:                                  # background
                continue
            t = (L - 55) / (205 - 55)
            grid[y][x] = 1 + max(0, min(len(FACES) - 1, round(t * (len(FACES) - 1))))
    return grid


def encode(grid):
    return ["".join(ALPHABET[i] for i in row) for row in grid]


sizes = {}
for n in SIZES:
    sizes[n] = encode(dump(n))
    used = sorted({ALPHABET.index(c) for row in sizes[n] for c in row})
    print(f"size {n:2d} ({n // 2} rows): palette indices {used}")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    f.write("// AUTO-GENERATED from resources/icon.png in bh-minecraft-launcher.\n")
    f.write("// Block pixel art; regenerate with scripts/gen-logo-art.py.\n\n")
    f.write("export interface LogoArt {\n")
    f.write("  /** Width/height of the square pixel grid. */\n")
    f.write("  size: number\n")
    f.write("  /** `size` rows of `size` base64 chars indexing LOGO_PALETTE. */\n")
    f.write("  rows: string[]\n")
    f.write("}\n\n")
    f.write(f"export const LOGO_ALPHABET = {json.dumps(ALPHABET)}\n")
    f.write("export const LOGO_PALETTE = [\n")
    names = ["transparent (panel bg)", *[f"cube face {i + 1}" for i in range(len(FACES))], "BH letters"]
    for i, c in enumerate(PALETTE):
        f.write(f'  "{("#%02x%02x%02x" % c)}", // {names[i]}\n')
    f.write("]\n\n")
    f.write("export const BLOCKHAVEN_LOGO: Record<number, LogoArt> = {\n")
    for n in SIZES:
        f.write(f"  {n}: {{\n    size: {n},\n    rows: [\n")
        for r in sizes[n]:
            f.write(f'      "{r}",\n')
        f.write("    ],\n  },\n")
    f.write("}\n")
print("wrote", OUT)
