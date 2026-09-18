#!/usr/bin/env python3
"""Generate src/assets/blockhavenLogo.ts from the reference launcher icon.

The icon is a PNG; there is no pre-made ANSI art in the reference repo. We
downscale it and encode each cell as a *shading level*, and the TUI draws
classic character-shaded ANSI art:

    level:  0 1 2 3 4 5 6 7 8 9
    glyph: (space) . : - = + * # % @
    color:  dark navy .............. -> mauve

Only the glyphs are drawn (no filled blocks), on a 2:1 cell grid, so it
reads as terminal art rather than a downscaled bitmap.
"""
import subprocess, re, json, os

SRC = os.path.expanduser("~/dev/bh-minecraft-launcher/resources/icon.png")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "assets", "blockhavenLogo.ts")
SIZES = [8, 12, 16, 20, 24, 32, 40]
BG = "#181825"          # panel background -> level 0 (blank)
ACCENT = "#cba6f7"      # mauve accent -> level 9 (brightest glyph)
CHARS = " .:-=+*#%@"
LEVELS = len(CHARS)
BLUR = "0x0.8"          # soften the stone speckle before sampling


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def make_ramp(a, b, n):
    ra, rb = hex_to_rgb(a), hex_to_rgb(b)
    out = []
    for t in range(n):
        rgb = [round(ra[i] + (rb[i] - ra[i]) * t / (n - 1)) for i in range(3)]
        out.append("#%02x%02x%02x" % tuple(max(0, min(255, c)) for c in rgb))
    return out


RAMP = make_ramp(BG, ACCENT, LEVELS)


def dump(w):
    h = w // 2
    txt = subprocess.run(
        [
            "magick", SRC,
            "-background", BG, "-alpha", "remove", "-alpha", "off",
            "-resize", f"{w}x{h}!",
            "-blur", BLUR,
            "-colorspace", "Gray",
            "-depth", "8",
            "txt:-",
        ],
        capture_output=True, text=True, check=True,
    ).stdout
    gray = [[0] * w for _ in range(h)]
    for line in txt.splitlines():
        m = re.match(r"(\d+),(\d+):\s*\(([^)]*)\)", line)
        if not m:
            continue
        x, y = int(m.group(1)), int(m.group(2))
        gray[y][x] = int(m.group(3).split(",")[0])
    # Stretch the cube's own range so the brightest pixels reach the top
    # level; anything at/below FLOOR (the panel background) stays blank.
    FLOOR = 34
    top = max(FLOOR + 1, max(max(r) for r in gray))
    grid = [[0] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            v = gray[y][x]
            if v <= FLOOR:
                grid[y][x] = 0
            else:
                grid[y][x] = 1 + round((v - FLOOR) / (top - FLOOR) * (LEVELS - 2))
    return grid


sizes = {}
for w in SIZES:
    grid = dump(w)
    sizes[w] = ["".join(str(level) for level in row) for row in grid]
    used = sorted({int(c) for row in sizes[w] for c in row})
    print(f"width {w:2d} ({w//2} rows): levels {used}")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    f.write("// AUTO-GENERATED from resources/icon.png in bh-minecraft-launcher.\n")
    f.write("// Character-shaded ANSI art; regenerate with scripts/gen-logo-art.py.\n\n")
    f.write("export interface LogoArt {\n")
    f.write("  /** Character-grid width. Rows = size / 2. */\n")
    f.write("  size: number\n")
    f.write("  /** `size / 2` rows of `size` shading levels ('0'..'9'). */\n")
    f.write("  rows: string[]\n")
    f.write("}\n\n")
    f.write(f"export const LOGO_CHARS = {json.dumps(CHARS)}\n")
    f.write(f"export const LOGO_PALETTE = {json.dumps(RAMP)}\n\n")
    f.write("export const BLOCKHAVEN_LOGO: Record<number, LogoArt> = {\n")
    for w in SIZES:
        f.write(f"  {w}: {{\n    size: {w},\n    rows: [\n")
        for r in sizes[w]:
            f.write(f'      "{r}",\n')
        f.write("    ],\n  },\n")
    f.write("}\n")
print("palette:", RAMP)
print("wrote", OUT)
