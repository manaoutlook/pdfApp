#!/usr/bin/env python3
"""Render SmartPDF logo from scratch at 1024x1024 PNG."""
from PIL import Image, ImageDraw, ImageFont

S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# ── Red background (macOS applies its own corner mask) ──
d.rectangle([0, 0, S - 1, S - 1], fill=(234, 67, 53, 255))

# ── Shield group centred at (cx, cy) ──
cx = round(100 * S / 200)  # 512
cy = round(68 * S / 200)   # 348

def to_abs(points):
    return [(round(x * S / 200 + cx), round(y * S / 200 + cy)) for (x, y) in points]

# White shield outline fill
white_shield = to_abs([
    (0, -58), (58, -34), (58, 24), (0, 92), (-58, 24), (-58, -34)
])
d.polygon(white_shield, fill=(255, 255, 255, 255))

# Light pink shield inner
pink_shield = to_abs([
    (0, -46), (46, -28), (46, 20), (0, 76), (-46, 20), (-46, -28)
])
d.polygon(pink_shield, fill=(252, 232, 230, 255))

# ── "PDF" text ──
pdf_size = round(36 * S / 200)
try:
    font_pdf = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', pdf_size)
except Exception:
    font_pdf = ImageFont.load_default()

txt = 'PDF'
bbox = d.textbbox((0, 0), txt, font=font_pdf)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
txt_x = round(cx - tw / 2)
txt_y = round(cy + 10 * S / 200 - th / 2)
d.text((txt_x, txt_y), txt, fill=(234, 67, 53, 255), font=font_pdf)

# ── Green checkmark ──
check = to_abs([(-14, 26), (-4, 38), (18, 16)])
d.line(check, fill=(52, 168, 83, 255), width=round(3.5 * S / 200))

# ── "SMARTPDF" at bottom ──
sm_size = round(14 * S / 200)
try:
    font_sm = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', sm_size)
except Exception:
    font_sm = font_pdf

txt2 = 'SMARTPDF'
bbox2 = d.textbbox((0, 0), txt2, font=font_sm)
tw2, th2 = bbox2[2] - bbox2[0], bbox2[3] - bbox2[1]
txt2_x = round(100 * S / 200 - tw2 / 2)
txt2_y = round(185 * S / 200 - th2 / 2)
d.text((txt2_x, txt2_y), txt2, fill=(255, 255, 255, 255), font=font_sm)

# Save
img.save('assets/logo.png', 'PNG')
print('SmartPDF logo saved to assets/logo.png')