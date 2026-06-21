#!/usr/bin/env python3
"""Render SmartPDF logo files directly from SVG source using CairoSVG.

Uses the SVG file (assets/logo2-pdf-shield-red.svg) as the single source of truth
and renders all formats (PNG, ICO, ICNS) from it, preserving exact proportions,
colors, and layout.

Usage:
    python scripts/render-logo.py                     # renders assets/logo.png
    python scripts/render-logo.py --ico               # also generates .ico
    python scripts/render-logo.py --icns              # also generates .icns
    python scripts/render-logo.py --all               # generates all formats
"""
import io
import os
import struct
import sys

from PIL import Image
import cairosvg

# ── Paths ──
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), 'assets')
SVG_PATH = os.path.join(ASSETS_DIR, 'logo2-pdf-shield-red.svg')

# ── SVG parameters ──
SVG_VIEWBOX_SIZE = 200  # SVG is 200x200
BASE_SIZE = 1024        # Internal render size for quality

# macOS app icons must sit inside the canvas with a transparent margin so the
# Dock renders them at the same effective size as other apps. Apple's icon grid
# places the artwork at ~824px inside a 1024px canvas (≈80%), leaving ~10%
# transparent padding on every side. A full-bleed icon looks oversized in the
# Dock — which is exactly what we're fixing here.
MACOS_CONTENT_RATIO = 0.80


def render_svg_to_png(scale):
    """Render the SVG at a given scale factor, return PNG bytes (full-bleed)."""
    output_width = round(SVG_VIEWBOX_SIZE * scale)
    png_data = cairosvg.svg2png(
        url=SVG_PATH,
        output_width=output_width,
        output_height=output_width,
    )
    return png_data


def render_padded_png(canvas_size, content_ratio=MACOS_CONTENT_RATIO):
    """Render the SVG centered on a transparent square canvas with margins.

    The artwork occupies `content_ratio` of the canvas; the remainder is
    transparent padding. This is required for macOS Dock icons to match the
    size of native apps.
    """
    content = round(canvas_size * content_ratio)
    art_bytes = cairosvg.svg2png(
        url=SVG_PATH,
        output_width=content,
        output_height=content,
    )
    art = Image.open(io.BytesIO(art_bytes)).convert('RGBA')

    canvas = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    offset = (canvas_size - content) // 2
    canvas.paste(art, (offset, offset), art)

    buf = io.BytesIO()
    canvas.save(buf, format='PNG')
    return buf.getvalue()


def create_ico(png_512_bytes, output_path):
    """Create a multi-resolution ICO file from a 512x512 PNG source.

    Builds the ICO manually with PNG-encoded icon entries for formats
    that support it (all modern Windows versions handle PNG in ICO).
    """
    # ICO sizes required
    ico_sizes = [16, 32, 64, 128, 256]

    # Load the 512px source
    source = Image.open(io.BytesIO(png_512_bytes))

    # Generate PNG data for each size
    icon_data = []
    for size in ico_sizes:
        if size == 512:
            # Already have the 512px data
            data = png_512_bytes
        else:
            resized = source.resize((size, size), Image.LANCZOS)
            buf = io.BytesIO()
            resized.save(buf, format='PNG')
            data = buf.getvalue()
        icon_data.append((size, data))

    # Build ICO file
    num_entries = len(ico_sizes)
    header_size = 6 + num_entries * 16

    with open(output_path, 'wb') as f:
        # Write ICO header
        f.write(struct.pack('<HHH', 0, 1, num_entries))

        # Calculate offsets and write directory entries
        offset = header_size
        for size, data in icon_data:
            w = size if size < 256 else 0  # 0 means 256 for ICO
            h = size if size < 256 else 0
            f.write(struct.pack(
                '<BBBBHHII',
                w, h, 0, 0, 1, 32, len(data), offset
            ))
            offset += len(data)

        # Write icon data
        for _, data in icon_data:
            f.write(data)

    print(f'  ✓ ICO saved: {output_path} (sizes: {ico_sizes})')


def create_icns(png_1024_bytes, output_path):
    """Create an ICNS file from 1024x1024 PNG data.

    Embeds PNG data at multiple sizes (16, 32, 64, 128, 256, 512, 1024).
    """
    source = Image.open(io.BytesIO(png_1024_bytes))

    icon_entries = []

    def add_icon_entry(icon_type, size):
        """Create a PNG of the given size and add as icon entry."""
        if size == 1024:
            data = png_1024_bytes
        else:
            resized = source.resize((size, size), Image.LANCZOS)
            buf = io.BytesIO()
            resized.save(buf, format='PNG')
            data = buf.getvalue()
        icon_entries.append((icon_type, data))

    # Add entries for common sizes
    add_icon_entry(b'ic13', 16)    # 16×16
    add_icon_entry(b'ic11', 32)    # 32×32
    add_icon_entry(b'ic14', 64)    # 64×64
    add_icon_entry(b'ic07', 128)   # 128×128
    add_icon_entry(b'ic09', 256)   # 256×256
    add_icon_entry(b'ic10', 512)   # 512×512
    add_icon_entry(b'ic12', 1024)  # 1024×1024

    # Build the ICNS file
    total_size = 8  # header
    for entry_type, data in icon_entries:
        total_size += 8 + len(data)

    with open(output_path, 'wb') as f:
        # Write header
        f.write(b'icns')
        f.write(struct.pack('>I', total_size))

        # Write icon entries
        for entry_type, data in icon_entries:
            f.write(entry_type)
            f.write(struct.pack('>I', 8 + len(data)))
            f.write(data)

    print(f'  ✓ ICNS saved: {output_path} (sizes: 16,32,64,128,256,512,1024)')


def verify_outputs(png_512_path):
    """Verify the generated files have correct properties."""
    errors = []

    # Check PNG
    img = Image.open(png_512_path)
    w, h = img.size
    print(f'\n── Verification ──')
    print(f'  PNG: {w}x{h}px')
    if w != 512 or h != 512:
        errors.append(f'PNG size expected 512×512, got {w}×{h}')

    # Sample colors at key positions
    px = img.load()
    # Top-left corner (should be transparent or red)
    tl = px[5, 5]
    print(f'  Top-left (5,5):    RGBA{tl}')
    # Center (shield area)
    center = px[w // 2, h // 2]
    print(f'  Center ({w//2},{h//2}): RGBA{center}')
    # Check some red background area
    bg_red = px[int(w * 0.1), int(h * 0.1)]
    print(f'  Background:        RGBA{bg_red}')
    # Bottom area (SMARTPDF text)
    bottom = px[w // 2, int(h * 0.88)]
    print(f'  Bottom-center:     RGBA{bottom}')

    if errors:
        print('  ❌ FAILED:')
        for e in errors:
            print(f'    - {e}')
        return False

    print('  ✅ All checks passed')
    return True


if __name__ == '__main__':
    gen_ico = '--ico' in sys.argv or '--all' in sys.argv
    gen_icns = '--icns' in sys.argv or '--all' in sys.argv

    os.makedirs(ASSETS_DIR, exist_ok=True)

    if not os.path.exists(SVG_PATH):
        print(f'❌ SVG file not found: {SVG_PATH}')
        sys.exit(1)

    print(f'Rendering SVG: {SVG_PATH}')

    # ── Render at base resolution (1024×1024) ──
    scale_1024 = BASE_SIZE / SVG_VIEWBOX_SIZE  # 5.12
    print(f'  Rendering SVG at {BASE_SIZE}×{BASE_SIZE} (scale={scale_1024:.2f})...')
    png_1024_bleed = render_svg_to_png(scale_1024)  # full-bleed (Windows ICO)

    # Padded version with the macOS icon-grid margin (Dock / Linux / ICNS).
    print(f'  Rendering padded {BASE_SIZE}×{BASE_SIZE} (content={MACOS_CONTENT_RATIO:.0%})...')
    png_1024_padded = render_padded_png(BASE_SIZE)

    # ── Produce 512×512 PNG (padded — used for the macOS Dock icon) ──
    png_512_path = os.path.join(ASSETS_DIR, 'logo.png')
    print(f'Exporting PNG 512×512 → {png_512_path}')
    img_1024_padded = Image.open(io.BytesIO(png_1024_padded))
    img_512 = img_1024_padded.resize((512, 512), Image.LANCZOS)
    img_512.save(png_512_path, 'PNG')
    print('  ✓ PNG saved (with macOS margin)')

    # ── ICO (full-bleed — Windows expects edge-to-edge icons) ──
    if gen_ico:
        ico_path = os.path.join(ASSETS_DIR, 'logo.ico')
        print(f'Generating ICO → {ico_path}')
        create_ico(png_1024_bleed, ico_path)
    else:
        print('  (skip ICO; use --ico or --all)')

    # ── ICNS (padded — macOS app bundle icon) ──
    if gen_icns:
        icns_path = os.path.join(ASSETS_DIR, 'logo.icns')
        print(f'Generating ICNS → {icns_path}')
        create_icns(png_1024_padded, icns_path)
    else:
        print('  (skip ICNS; use --icns or --all)')

    # ── Verification ──
    verify_outputs(png_512_path)

    print('\nDone.')