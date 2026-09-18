#!/usr/bin/env python3
"""Generate src/assets/blockhavenLogo.ts from the reference launcher icon.

The icon is a PNG; there is no pre-made ANSI art in the reference repo, so
we downscale it and encode it as palette-indexed pixel grids that the TUI
renders with half-block characters (fg = top pixel, bg = bottom pixel).

The pixels are mapped to a *monochrome theme ramp* (dark navy -> mauve) so
the art matches the launcher's palette instead of carrying full color.
"""
import subprocess, re, json, os

SRC = os.path.expanduser("~/dev/bh-minecraft-launcher/resources/icon.png")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "assets", "blockhavenLogo.ts")
SIZES = [8, 12, 16, 20, 24, 32]
BG = "#181825"          # panel background (also ramp[0])
ACCENT = "#cba6f7"      # banner border / mauve accent (ramp[-1])
STOPS = 10
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(c))) for c in rgb)


def make_ramp(a, b, n):
    ra, rb = hex_to_rgb(a), hex_to_rgb(b)
    return [rgb_to_hex([ra[i] + (rb[i] - ra[i]) * t / (n - 1) for i in range(3)]) for t in range(n)]


def luma(rgb):
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


RAMP = make_ramp(BG, ACCENT, STOPS)
L0 = luma(hex_to_rgb(BG))
LMAX = 255.0


def dump(n):
    """Downscale to n x n and return a grid of ramp indices."""
    txt = subprocess.run(
        [
            "magick", SRC,
            "-background", BG, "-alpha", "remove", "-alpha", "off",
            "-resize", f"{n}x{n}!",
            "-depth", "8",
            "txt:-",
        ],
        capture_output=True, text=True, check=True,
    ).stdout
    grid = [[0] * n for _ in range(n)]
    for line in txt.splitlines():
        m = re.match(r"(\d+),(\d+):\s*\(([^)]*)\)", line)
        if not m:
            continue
        x, y = int(m.group(1)), int(m.group(2))
        rgb = tuple(int(p) for p in m.group(3).split(",")[:3])
        # Normalise the panel background to ramp[0]; brighten everything else
        # into the ramp so the cube keeps its shading.
        idx = round((luma(rgb) - L0) / (LMAX - L0) * (len(RAMP) - 1))
        grid[y][x] = max(0, min(len(RAMP) - 1, idx))
    return grid


def encode(grid):
    n = len(grid)
    return [[ALPHABET[grid[y][x]] for x in range(n)] for y in range(n)]


sizes = {}
for n in SIZES:
    rows = encode(dump(n))
    sizes[n] = rows
    used = sorted({c for row in rows for c in row})
    print(f"size {n:2d}: ramp stops used = {len(used)}")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    f.write("// AUTO-GENERATED from resources/icon.png in bh-minecraft-launcher.\n")
    f.write("// Pixels are mapped to a monochrome theme ramp and drawn with\n")
    f.write("// half-block characters; regenerate with scripts/gen-logo-art.py.\n\n")
    f.write("export interface LogoArt {\n")
    f.write("  /** Width/height of the square pixel grid. */\n")
    f.write("  size: number\n")
    f.write("  palette: string[]\n")
    f.write("  /** `size` rows of `size` base64 chars indexing `palette`. */\n")
    f.write("  rows: string[]\n")
    f.write("}\n\n")
    f.write(f"export const LOGO_ALPHABET = {json.dumps(ALPHABET)}\n")
    f.write(f"export const LOGO_PALETTE = {json.dumps(RAMP)}\n\n")
    f.write("export const BLOCKHAVEN_LOGO: Record<number, LogoArt> = {\n")
    for n in SIZES:
        f.write(f"  {n}: {{\n    size: {n},\n    palette: LOGO_PALETTE,\n    rows: [\n")
        for r in sizes[n]:
            f.write(f'      "{"".join(r)}",\n')
        f.write("    ],\n  },\n")
    f.write("}\n")
print("ramp:", RAMP)
print("wrote", OUT)
