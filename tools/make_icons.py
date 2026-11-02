"""Draws the No Brakes app icons into icons/ (a red sports car from behind, racing up a highway).

Usage: python3 tools/make_icons.py   (needs Pillow)
Everything important sits inside the central 80% so the icon also works as a
maskable icon on Android.
"""
import os
from PIL import Image, ImageDraw

S = 1024  # draw large, then downscale for smooth edges
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
HORIZON = 430
VANISH = (512, HORIZON - 40)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def road_x(u, y):
    """x on the road surface: u = -1 at the left edge, 1 at the right, receding to the vanishing point."""
    t = (y - VANISH[1]) / (S - VANISH[1])
    return VANISH[0] + u * 620 * t


def draw():
    img = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(img)
    top, bottom = (0x4f, 0xa3, 0xe3), (0xd4, 0xec, 0xff)
    for y in range(HORIZON):
        d.line([(0, y), (S, y)], fill=lerp(top, bottom, y / HORIZON))

    # sun, distant hills and a cloud
    d.ellipse([700, 120, 820, 240], fill=(0xff, 0xf3, 0xc8))
    d.polygon([(0, HORIZON), (180, 330), (380, HORIZON)], fill=(0x9d, 0xb3, 0xcc))
    d.polygon([(560, HORIZON), (820, 300), (1024, HORIZON)], fill=(0x8d, 0xa5, 0xc0))
    for cx, cy, r in [(250, 190, 50), (315, 170, 66), (385, 195, 46)]:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill="white")

    # fields either side, then the road
    d.rectangle([0, HORIZON, S, S], fill=(0x8c, 0xbc, 0x5c))
    d.polygon([(road_x(-1.15, HORIZON), HORIZON), (road_x(1.15, HORIZON), HORIZON), (road_x(1.15, S), S), (road_x(-1.15, S), S)],
              fill=(0x44, 0x47, 0x4d))
    # edge lines (yellow left, white right) and dashed lane lines
    d.polygon([(road_x(-1.0, HORIZON), HORIZON), (road_x(-0.97, HORIZON), HORIZON), (road_x(-0.97, S), S), (road_x(-1.0, S), S)], fill=(0xf2, 0xc2, 0x30))
    d.polygon([(road_x(0.97, HORIZON), HORIZON), (road_x(1.0, HORIZON), HORIZON), (road_x(1.0, S), S), (road_x(0.97, S), S)], fill=(0xf4, 0xf4, 0xee))
    for u in (-0.5, 0.0, 0.5):
        y = HORIZON
        step = 40
        while y < S:
            y1 = min(S, y + step * 0.5)
            d.polygon([(road_x(u - 0.012, y), y), (road_x(u + 0.012, y), y), (road_x(u + 0.012, y1), y1), (road_x(u - 0.012, y1), y1)], fill=(0xf4, 0xf4, 0xee))
            y += step
            step *= 1.35

    # the car from behind
    red, dark, white, glass = (0xe8, 0x4a, 0x3a), (0x1b, 0x1c, 0x20), (0xf7, 0xf7, 0xf2), (0x2b, 0x3a, 0x4a)
    cx, base = 512, 860
    d.rounded_rectangle([cx - 250, base - 40, cx - 160, base + 40], radius=18, fill=dark)  # tyres
    d.rounded_rectangle([cx + 160, base - 40, cx + 250, base + 40], radius=18, fill=dark)
    d.polygon([(cx - 170, base - 300), (cx + 170, base - 300), (cx + 225, base - 200), (cx - 225, base - 200)], fill=red)  # cabin
    d.polygon([(cx - 140, base - 285), (cx + 140, base - 285), (cx + 185, base - 210), (cx - 185, base - 210)], fill=glass)
    d.rounded_rectangle([cx - 270, base - 210, cx + 270, base + 10], radius=34, fill=red)  # body
    d.rectangle([cx - 52, base - 300, cx - 18, base + 10], fill=white)  # racing stripes
    d.rectangle([cx + 18, base - 300, cx + 52, base + 10], fill=white)
    d.rounded_rectangle([cx - 285, base - 250, cx + 285, base - 215], radius=10, fill=white)  # spoiler
    d.rectangle([cx - 200, base - 225, cx - 180, base - 205], fill=dark)
    d.rectangle([cx + 180, base - 225, cx + 200, base - 205], fill=dark)
    d.rounded_rectangle([cx - 245, base - 150, cx - 140, base - 112], radius=10, fill=(0xff, 0x3a, 0x30))  # tail lights
    d.rounded_rectangle([cx + 140, base - 150, cx + 245, base - 112], radius=10, fill=(0xff, 0x3a, 0x30))
    d.rounded_rectangle([cx - 275, base - 15, cx + 275, base + 25], radius=12, fill=dark)  # bumper
    # nitro flames
    for ex in (cx - 100, cx + 100):
        d.polygon([(ex - 22, base + 15), (ex + 22, base + 15), (ex, base + 120)], fill=(0x66, 0xd9, 0xff))
        d.polygon([(ex - 10, base + 15), (ex + 10, base + 15), (ex, base + 70)], fill="white")
    return img


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    big = draw()
    for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180), ("favicon-32.png", 32)]:
        big.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name))
    print("wrote", OUT)
