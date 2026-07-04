#!/usr/bin/env python3
import os
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "client" / "unity" / "Assets" / "Art"
OUT = ART / "preview_atlas.png"


def read_png(path):
    data = path.read_bytes()
    pos = 8
    width = height = None
    compressed = bytearray()
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        typ = data[pos + 4 : pos + 8]
        payload = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if typ == b"IHDR":
            width, height = struct.unpack(">II", payload[:8])
        elif typ == b"IDAT":
            compressed.extend(payload)
        elif typ == b"IEND":
            break
    raw = zlib.decompress(bytes(compressed))
    pixels = []
    stride = width * 4
    p = 0
    for _ in range(height):
        p += 1
        row = raw[p : p + stride]
        p += stride
        pixels.extend(tuple(row[i : i + 4]) for i in range(0, len(row), 4))
    return width, height, pixels


def write_png(path, width, height, pixels):
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for px in pixels[y * width : (y + 1) * width]:
            raw.extend(px)

    def chunk(name, payload):
        return (
            struct.pack(">I", len(payload))
            + name
            + payload
            + struct.pack(">I", zlib.crc32(name + payload) & 0xFFFFFFFF)
        )

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def blit(dst, dw, dh, src, sw, sh, ox, oy):
    for y in range(sh):
        for x in range(sw):
            dx, dy = ox + x, oy + y
            if 0 <= dx < dw and 0 <= dy < dh:
                r, g, b, a = src[y * sw + x]
                if a == 255:
                    dst[dy * dw + dx] = (r, g, b, a)
                elif a:
                    br, bg, bb, ba = dst[dy * dw + dx]
                    t = a / 255
                    dst[dy * dw + dx] = (
                        int(r * t + br * (1 - t)),
                        int(g * t + bg * (1 - t)),
                        int(b * t + bb * (1 - t)),
                        255,
                    )


def main():
    files = sorted((ART / "Tiles").glob("*.png")) + sorted((ART / "Decorations").glob("*.png"))
    cell = 104
    cols = 8
    rows = (len(files) + cols - 1) // cols
    width, height = cols * cell, rows * cell
    pixels = [(30, 34, 40, 255)] * (width * height)
    for i, path in enumerate(files):
        sw, sh, src = read_png(path)
        cx = (i % cols) * cell + (cell - sw) // 2
        cy = (i // cols) * cell + (cell - sh) // 2
        blit(pixels, width, height, src, sw, sh, cx, cy)
    write_png(OUT, width, height, pixels)
    print(OUT)


if __name__ == "__main__":
    main()
