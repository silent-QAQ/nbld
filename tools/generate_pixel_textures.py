#!/usr/bin/env python3
import os
import random
import struct
import zlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TILE_DIR = os.path.join(ROOT, "client", "unity", "Assets", "Art", "Tiles")
DECOR_DIR = os.path.join(ROOT, "client", "unity", "Assets", "Art", "Decorations")


def rgba(hex_color, alpha=255):
    hex_color = hex_color.lstrip("#")
    return (
        int(hex_color[0:2], 16),
        int(hex_color[2:4], 16),
        int(hex_color[4:6], 16),
        alpha,
    )


BASE_TILES = {
    "grass": ("#5faa43", "#6fbd51", "#4f8f38"),
    "cold_grass": ("#6f854c", "#7e9659", "#586c3d"),
    "dry_grass": ("#a8a047", "#b7ad58", "#837c37"),
    "plateau_grass": ("#839254", "#96a866", "#697640"),
    "forest_floor": ("#2e6232", "#3d7840", "#224b27"),
    "needle_floor": ("#253f2c", "#315338", "#1a3021"),
    "rainforest_floor": ("#1f5130", "#2c6b3f", "#163b24"),
    "leaf_litter": ("#6b542c", "#8a6a35", "#47381f"),
    "dirt": ("#8b6b45", "#a17c50", "#6d5336"),
    "dry_soil": ("#9d8150", "#b0935f", "#7a643e"),
    "wet_mud": ("#3e3f30", "#535441", "#2a2c23"),
    "mud": ("#5a4630", "#6f573b", "#3d3022"),
    "frozen_soil": ("#868473", "#9b9986", "#6c6a5c"),
    "rocky_soil": ("#675f51", "#7b7363", "#4e493f"),
    "moss": ("#315e34", "#40743f", "#244827"),
    "rock": ("#777772", "#8d8d86", "#5c5c58"),
    "mountain_rock": ("#5f6263", "#747879", "#484b4c"),
    "cliff_rock": ("#4e5153", "#666a6c", "#383b3d"),
    "glacier_rock": ("#8f9ba1", "#aab4b8", "#6f7b82"),
    "gravel": ("#8b8778", "#a39e8d", "#6c685d"),
    "sand": ("#d5be63", "#e2cc77", "#b99f4e"),
    "dune_sand": ("#dfc873", "#ead78e", "#c4aa5b"),
    "coast_sand": ("#d7ca91", "#e5d8a5", "#bdae78"),
    "snow": ("#dce3df", "#f0f3f1", "#bcc7c3"),
    "hard_snow": ("#eef2f0", "#ffffff", "#d0d8d5"),
    "ice": ("#b7d8ea", "#d0e9f5", "#8bbbd7"),
    "packed_ice": ("#8fc5df", "#a8d7ec", "#6aa5c9"),
    "deep_ice_water": ("#5d9dc9", "#75b6da", "#356f9b"),
    "ice_water": ("#8ac8df", "#a5dcec", "#5da9ca"),
    "cold_deep_water": ("#153b6f", "#1d4d87", "#0e284d"),
    "shallow_sea_water": ("#3a8fbd", "#4fa6cc", "#2875a2"),
    "open_ocean_water": ("#16408d", "#2355a8", "#0d2c68"),
    "wave_water": ("#2b63a8", "#5ba7d9", "#19427a"),
    "tropical_shallow_water": ("#20b3b7", "#4ed0cc", "#13898e"),
    "tropical_deep_water": ("#0d67a5", "#1682c2", "#084a7a"),
}

DECORATIONS = {
    "grass_tuft": (32, 32, "#2f7a34", "#67b94b"),
    "flower": (32, 32, "#378540", "#f1d65b"),
    "red_flower": (32, 32, "#347a3b", "#e85b4a"),
    "blue_flower": (32, 32, "#347a3b", "#5b8ee8"),
    "purple_flower": (32, 32, "#347a3b", "#a46ee8"),
    "white_flower": (32, 32, "#496f40", "#f2f0d7"),
    "alpine_flower": (32, 32, "#4f7a42", "#d88be8"),
    "bog_flower": (32, 32, "#54783b", "#d4b65d"),
    "clover_patch": (32, 32, "#2e7a39", "#70c05a"),
    "lichen_patch": (32, 32, "#7c9660", "#b7c997"),
    "bush": (48, 40, "#1f5d2f", "#3f8a42"),
    "dry_bush": (40, 36, "#7f6334", "#b4934a"),
    "snow_bush": (48, 40, "#5f754f", "#d9e3dc"),
    "cold_shrub": (40, 36, "#49683d", "#7f995e"),
    "alpine_shrub": (40, 36, "#587044", "#92a96f"),
    "hill_shrub": (44, 38, "#426b36", "#75a45a"),
    "thorn_bush": (40, 36, "#6f5b32", "#b08d42"),
    "berry_bush": (48, 40, "#245f34", "#c74343"),
    "reed": (32, 48, "#6a8f3a", "#b7c56a"),
    "swamp_reed": (32, 48, "#4f7a3a", "#91a850"),
    "water_lily": (40, 32, "#2f7a4e", "#e8d8ef"),
    "cactus": (32, 48, "#2f7a41", "#6aac69"),
    "desert_cactus": (40, 56, "#2c7040", "#82b86a"),
    "tree_deciduous": (64, 80, "#6b4526", "#2f7a35"),
    "tree_conifer": (64, 96, "#5a3c24", "#1c5a32"),
    "tree_jungle": (80, 96, "#5b3b22", "#0f6a31"),
    "pine_sapling": (40, 56, "#5a3c24", "#1f6a3a"),
    "broadleaf_sapling": (40, 52, "#6b4526", "#3f8a42"),
    "acacia_sapling": (48, 56, "#6b4a25", "#78943c"),
    "palm_sapling": (48, 64, "#6a4b28", "#2f9148"),
    "dead_tree": (48, 64, "#6b5234", "#a58a55"),
    "stump": (32, 32, "#6b4526", "#a8753d"),
    "fallen_log": (64, 32, "#6b4526", "#a8753d"),
    "jungle_fern": (48, 48, "#0f6a31", "#42a856"),
    "fern": (40, 40, "#1f6f38", "#58a85a"),
    "jungle_vine": (32, 80, "#16703a", "#52a85a"),
    "mushroom_red": (32, 32, "#e04a42", "#f4d7be"),
    "mushroom_brown": (32, 32, "#8a5b32", "#d6b47a"),
    "small_stone": (32, 32, "#555653", "#898985"),
    "flat_stone": (32, 32, "#5e625e", "#92958e"),
    "large_stone": (48, 40, "#555653", "#8e8f8a"),
    "mossy_rock": (40, 36, "#4f5850", "#6f9a61"),
    "sharp_rock": (40, 48, "#51545a", "#8d9298"),
    "granite_boulder": (56, 48, "#6f6f70", "#a8a8a6"),
    "basalt_rock": (48, 44, "#35383b", "#666b70"),
    "slate_rock": (44, 36, "#4b5360", "#8791a0"),
    "sandstone_rock": (48, 40, "#b8944f", "#d6bd78"),
    "desert_rock": (40, 36, "#8a6c42", "#ba945a"),
    "weathered_stone": (44, 36, "#7e735b", "#aa9c7d"),
    "pebble_cluster": (32, 32, "#66665f", "#a1a092"),
}


def write_png(path, width, height, pixels):
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        row = pixels[y * width : (y + 1) * width]
        for px in row:
            raw.extend(px)
    data = zlib.compress(bytes(raw), 9)

    def chunk(name, payload):
        return (
            struct.pack(">I", len(payload))
            + name
            + payload
            + struct.pack(">I", zlib.crc32(name + payload) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", data)
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def blend(a, b, t):
    return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(4))


def noise_tile(name, colors):
    rng = random.Random(name)
    base, light, dark = [rgba(c) for c in colors]
    pixels = []
    water = "water" in name
    for y in range(32):
        for x in range(32):
            v = rng.random()
            c = base
            if v < 0.22:
                c = blend(base, dark, rng.uniform(0.25, 0.65))
            elif v > 0.78:
                c = blend(base, light, rng.uniform(0.25, 0.65))
            if water and ((x + y * 2 + rng.randrange(4)) % 17 == 0):
                c = blend(c, light, 0.55)
            if name in {"rock", "mountain_rock", "cliff_rock", "glacier_rock", "gravel", "rocky_soil"} and rng.random() < 0.08:
                c = blend(c, light if rng.random() > 0.5 else dark, 0.75)
            pixels.append(c)
    return pixels


def transparent(width, height):
    return [(0, 0, 0, 0)] * (width * height)


def set_px(pixels, width, height, x, y, color):
    if 0 <= x < width and 0 <= y < height:
        pixels[y * width + x] = color


def disk(pixels, width, height, cx, cy, rx, ry, color):
    for y in range(int(cy - ry), int(cy + ry) + 1):
        for x in range(int(cx - rx), int(cx + rx) + 1):
            if ((x - cx) / max(1, rx)) ** 2 + ((y - cy) / max(1, ry)) ** 2 <= 1:
                set_px(pixels, width, height, x, y, color)


def rect(pixels, width, height, x0, y0, x1, y1, color):
    for y in range(y0, y1):
        for x in range(x0, x1):
            set_px(pixels, width, height, x, y, color)


def line(pixels, width, height, x0, y0, x1, y1, color):
    dx = abs(x1 - x0)
    dy = -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    while True:
        set_px(pixels, width, height, x0, y0, color)
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def decoration(name, spec):
    width, height, main_hex, light_hex = spec
    main = rgba(main_hex)
    light = rgba(light_hex)
    dark = blend(main, rgba("#000000"), 0.35)
    bark = rgba("#6b4526")
    pixels = transparent(width, height)

    if "stone" in name or "rock" in name or "boulder" in name or "pebble" in name:
        rng = random.Random(name)
        blobs = 1 if width <= 40 else 2
        for i in range(blobs):
            cx = width // 2 + rng.randrange(-width // 8, width // 8 + 1)
            cy = height - 12 + rng.randrange(-4, 4)
            disk(pixels, width, height, cx, cy, width // (3 + i), height // (5 + i), main)
            disk(pixels, width, height, cx - 4, cy - 2, max(2, width // 10), max(2, height // 12), light)
            disk(pixels, width, height, cx + 4, cy + 3, max(3, width // 8), max(2, height // 14), dark)
        if name == "sharp_rock":
            for x in range(width // 3, width * 2 // 3):
                line(pixels, width, height, x, height - 5, width // 2, 5, main)
    elif "mushroom" in name:
        rect(pixels, width, height, width // 2 - 2, height // 2, width // 2 + 3, height - 7, rgba("#e7d7be"))
        disk(pixels, width, height, width // 2, height // 2, width // 4, height // 7, main)
        disk(pixels, width, height, width // 2 - 5, height // 2 - 2, 2, 2, light)
    elif name in {"grass_tuft", "flower", "red_flower", "blue_flower", "white_flower", "alpine_flower", "bog_flower", "clover_patch", "lichen_patch"}:
        for x in range(8, 25, 4):
            line(pixels, width, height, 16, 28, x, 12, main)
            line(pixels, width, height, 17, 28, x + 2, 14, light)
        if "flower" in name or name == "clover_patch":
            for x, y in [(12, 11), (18, 9), (22, 14)]:
                disk(pixels, width, height, x, y, 2, 2, light)
    elif "reed" in name:
        for x in [10, 14, 18, 22]:
            line(pixels, width, height, x, height - 3, x + random.Random(x + len(name)).randrange(-3, 4), 8, main)
            disk(pixels, width, height, x, 10, 2, 5, light)
    elif name == "water_lily":
        disk(pixels, width, height, width // 2, height // 2 + 6, 13, 6, main)
        disk(pixels, width, height, width // 2 + 2, height // 2 + 2, 4, 3, light)
    elif "bush" in name or "shrub" in name:
        disk(pixels, width, height, width // 2, height - 14, width // 3, 13, main)
        disk(pixels, width, height, width // 3, height - 18, width // 4, 10, light)
        disk(pixels, width, height, width * 2 // 3, height - 18, width // 4, 10, dark)
    elif "cactus" in name:
        rect(pixels, width, height, 13, 9, 20, 45, main)
        rect(pixels, width, height, 8, 21, 13, 27, main)
        rect(pixels, width, height, 20, 17, 25, 23, main)
        rect(pixels, width, height, 15, 10, 17, 44, light)
    elif name in {"fern", "jungle_fern"}:
        for y in range(14, height - 4, 6):
            line(pixels, width, height, width // 2, height - 4, 8, y, main)
            line(pixels, width, height, width // 2, height - 4, width - 8, y + 2, light)
    elif name == "jungle_vine":
        for x in [12, 18, 23]:
            line(pixels, width, height, x, 2, x + random.Random(x).randrange(-5, 6), height - 4, main)
            for y in range(12, height - 8, 15):
                disk(pixels, width, height, x + 2, y, 3, 2, light)
    elif name in {"stump", "fallen_log"}:
        if name == "stump":
            rect(pixels, width, height, 9, 13, 24, 29, main)
            disk(pixels, width, height, 16, 13, 8, 5, light)
        else:
            rect(pixels, width, height, 8, 14, width - 8, 25, main)
            disk(pixels, width, height, 10, 19, 6, 6, light)
            disk(pixels, width, height, width - 10, 19, 6, 6, dark)
    else:
        trunk_w = max(5, width // 10)
        rect(pixels, width, height, width // 2 - trunk_w // 2, height // 2, width // 2 + trunk_w // 2 + 1, height - 4, bark)
        if name in {"tree_conifer", "pine_sapling"}:
            for i, y in enumerate([18, 32, 47, 62]):
                if y >= height - 6:
                    continue
                ry = 18 - i * 2
                disk(pixels, width, height, width // 2, y, 23 - i * 4, ry, main if i % 2 == 0 else light)
        elif name in {"tree_jungle", "palm_sapling"}:
            disk(pixels, width, height, width // 2, 30, 31, 22, main)
            disk(pixels, width, height, width // 3, 44, 24, 20, light)
            disk(pixels, width, height, width * 2 // 3, 45, 25, 19, dark)
            for x in [20, 52, 64]:
                line(pixels, width, height, x, 38, x - 4, 78, light)
        else:
            disk(pixels, width, height, width // 2, 31, 27, 23, main)
            disk(pixels, width, height, width // 3, 41, 19, 16, light)
            disk(pixels, width, height, width * 2 // 3, 41, 19, 16, dark)
    return pixels


def main():
    os.makedirs(TILE_DIR, exist_ok=True)
    os.makedirs(DECOR_DIR, exist_ok=True)
    for name, colors in BASE_TILES.items():
        write_png(os.path.join(TILE_DIR, f"{name}.png"), 32, 32, noise_tile(name, colors))
    for name, spec in DECORATIONS.items():
        width, height = spec[0], spec[1]
        write_png(os.path.join(DECOR_DIR, f"{name}.png"), width, height, decoration(name, spec))
    print(f"tiles={len(BASE_TILES)} dir={TILE_DIR}")
    print(f"decorations={len(DECORATIONS)} dir={DECOR_DIR}")


if __name__ == "__main__":
    main()
