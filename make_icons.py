#!/usr/bin/env python3
"""컬러 블록 아이콘(PNG) 생성기 — 외부 라이브러리 없이 동작합니다.
사용법:  python3 make_icons.py   ->  icons/ 폴더에 PNG 생성
"""
import os, struct, zlib

BG = (5, 5, 31)
FRAME = (139, 143, 216)
COLORS = {
    'I': (255, 59, 48), 'O': (255, 214, 10), 'T': (48, 209, 88), 'S': (255, 45, 149),
    'Z': (25, 211, 243), 'J': (61, 90, 254), 'L': (255, 159, 10),
}
LAYOUT = ["..T.",
          "ZTTL",
          "ZSLL",
          "IIJJ"]


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def cell_pixel(ch, x, y, b):
    base = COLORS[ch]
    if y == 0 or x == 0:
        return shade(base, 1.45)          # 위/왼쪽 하이라이트
    if y == b - 1 or x == b - 1:
        return shade(base, 0.55)          # 아래/오른쪽 그림자
    if x == 1 and y == 1:
        return shade(base, 1.7)
    return base


def make_grid(b, frame):
    g = [[BG] * 32 for _ in range(32)]
    if frame:
        for y in range(32):
            for x in range(32):
                if x < 1 or y < 1 or x >= 31 or y >= 31:
                    g[y][x] = FRAME
    off = (32 - 4 * b) // 2
    for r, row in enumerate(LAYOUT):
        for c, ch in enumerate(row):
            if ch == '.':
                continue
            for y in range(b):
                for x in range(b):
                    g[off + r * b + y][off + c * b + x] = cell_pixel(ch, x, y, b)
    return g


def write_png(path, size, grid):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(grid[y * 32 // size][x * 32 // size])

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)


if __name__ == '__main__':
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
    os.makedirs(out, exist_ok=True)
    normal = make_grid(6, True)
    maskable = make_grid(4, False)       # 마스크 안전영역을 위해 블록을 작게
    write_png(os.path.join(out, 'icon-192.png'), 192, normal)
    write_png(os.path.join(out, 'icon-512.png'), 512, normal)
    write_png(os.path.join(out, 'icon-maskable-512.png'), 512, maskable)
    write_png(os.path.join(out, 'apple-touch-icon.png'), 180, normal)
    print('icons generated in', out)
