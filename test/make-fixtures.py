#!/usr/bin/env python3
"""
Generate the fixture photos the browser suite plays with.

No image library is available or wanted here: PNG is a short format, so each
fixture is written by hand. Every fixture is a grid of flat colour bands with
hard edges, which is what lets probe.html prove a card really does show the
right slice of the photo -- sample a pixel, compare it to the band that piece
belongs to.

The grid is 6 columns x 5 rows, matching the 30-card board, so band (col, row)
sits exactly where card (col, row) of the assembled photo does.

usage: make-fixtures.py [target-dir]
"""

import os
import struct
import sys
import zlib

COLS = 6
ROWS = 5
# Small on purpose. What these fixtures are for is proving a card shows the
# right slice of the photo, which a flat colour band answers at any size; the
# resolution the game actually stores is asserted as a number in probe.html,
# where a bigger image would only make every run slower.
W = 480
H = 400

# Flat colours, chosen to stay far apart after JPEG at q0.88 and after the
# browser's own scaling. Anything less than ~60 apart in one channel is too
# close to tell apart reliably.
PALETTE = [
    (220, 30, 30),    (30, 200, 60),   (40, 60, 220),
    (240, 200, 20),   (200, 30, 200),  (30, 200, 200),
    (250, 140, 20),   (120, 40, 180),  (90, 130, 30),
    (20, 90, 130),    (160, 160, 160), (250, 120, 170),
    (60, 40, 20),     (140, 200, 120), (100, 100, 250),
    (230, 230, 120),  (170, 60, 30),   (40, 160, 170),
    (200, 200, 200),  (120, 10, 10),   (10, 120, 20),
    (10, 20, 120),    (120, 120, 10),  (80, 80, 80),
    (240, 60, 90),    (20, 180, 190),  (150, 110, 60),
    (70, 60, 200),    (190, 220, 90),  (250, 250, 250),
    (15, 15, 15),
]


def band(col, row):
    """The colour of grid cell (col, row). Flat, so one pixel proves the slice."""
    return PALETTE[(row * COLS + col) % len(PALETTE)]


def png_bytes(width, height, rows):
    """Minimal 8-bit RGB PNG. `rows` is a list of bytearrays, one per line."""
    raw = bytearray()
    for line in rows:
        raw.append(0)                      # filter type 0 (none)
        raw.extend(line)

    def chunk(tag, payload):
        out = struct.pack('>I', len(payload)) + tag + payload
        return out + struct.pack('>I', zlib.crc32(tag + payload) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


def render():
    cw, ch = W // COLS, H // ROWS
    lines = []
    for y in range(H):
        row_no = min(ROWS - 1, y // ch)
        line = bytearray()
        for x in range(W):
            col_no = min(COLS - 1, x // cw)
            line.extend(band(col_no, row_no))
        lines.append(line)
    return png_bytes(W, H, lines)


# path relative to the fixture root, and the title the game should derive from
# the filename before anyone renames it
FIXTURES = [
    ('beach_sunset.png', 'beach sunset'),
    ('2023 Spain/Beach.png', 'Beach'),
    ('2024 Iceland/aurora.png', 'aurora'),
    ('2024 Iceland/Beach.png', 'Beach'),
]


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), 'fixtures')
    lib = os.path.join(root, 'Photo library')

    blob = render()
    written = []
    for rel, title in FIXTURES:
        path = os.path.join(lib, *rel.split('/'))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as fh:
            fh.write(blob)
        written.append((rel, title))

    print('%d fixtures in %s (%d bytes each)' % (len(written), lib, len(blob)))
    for rel, title in written:
        print('  %-28s -> answers %r' % (rel, title))


if __name__ == '__main__':
    main()