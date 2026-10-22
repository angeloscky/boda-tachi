"""
Vectoriza el logo a partir de la captura original (JPEG 738x1600).

Pasos: recorta el área blanca central, amplía 6x con Lanczos, umbraliza y traza
con potrace. Los textos (nombres y fecha) se umbralizan de forma adaptativa: cada
trazo se corta a la mitad entre su tono más oscuro y el blanco, para que las líneas
finas y claras de la captura (diagonales de M, A y Y) no queden partidas. El resultado es un trazado automático: conserva la forma del
original pero NO es el archivo vectorial de la diseñadora. Si aparece el SVG
original, debe reemplazar a estos archivos.

Uso: python3 scripts/vectorize-logo.py
Requiere: Pillow y potrace (apt install potrace).
"""
import re, subprocess, pathlib
import numpy as np
from PIL import Image, ImageFilter, ImageOps

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets/logo/original/WhatsApp Image 2026-10-21 at 8.42.27 PM.jpeg'
OUT = ROOT / 'assets/logo/vector'
OUT.mkdir(parents=True, exist_ok=True)
SCALE = 6
CLOSE = 3

im = Image.open(SRC).convert('L')
w, h = im.size
# Zona blanca central: filas cuya media es clara.
rows = [sum(im.crop((0, y, w, y + 1)).tobytes()) / w for y in range(h)]
white = [y for y, v in enumerate(rows) if v > 200]
top, bottom = white[0], white[-1]
band = im.crop((0, top, w, bottom + 1))
# Caja de la tinta dentro de la franja blanca.
ink = ImageOps.invert(band).point(lambda p: 255 if p > 60 else 0)
bbox = ink.getbbox()
pad = 6
box = (max(bbox[0] - pad, 0), max(bbox[1] - pad, 0), min(bbox[2] + pad, w), min(bbox[3] + pad, band.height))
art = band.crop(box)
print('franja blanca', top, bottom, 'caja', box, 'tamaño', art.size)

# Separación entre monograma y textos: primera fila vacía después de la mitad.
ink_art = ImageOps.invert(art).point(lambda p: 255 if p > 60 else 0)
empty = [y for y in range(ink_art.height) if ink_art.crop((0, y, ink_art.width, y + 1)).getbbox() is None]
gap = next(y for y in empty if y > ink_art.height * 0.5)

def binarize(img, threshold, blur):
    big = img.resize((img.width * SCALE, img.height * SCALE), Image.LANCZOS).filter(ImageFilter.GaussianBlur(blur))
    return big.point(lambda p: 0 if p < threshold else 255).convert('L')

def binarize_adaptive(img, blur, window, close=0, ink_max=215, floor=242):
    """Umbral local: mitad entre el tono más oscuro del entorno y el blanco.

    Un trazo fino de la captura es gris claro (no negro); con un umbral fijo se
    parte en puntos. Aquí cada trazo se corta a media intensidad de sí mismo, así
    conserva su continuidad y un grosor parecido al de los trazos oscuros.
    `ink_max` evita convertir en tinta el ruido JPEG lejos de cualquier trazo.
    """
    big = img.resize((img.width * SCALE, img.height * SCALE), Image.LANCZOS).filter(ImageFilter.GaussianBlur(blur))
    local_min = np.asarray(big.filter(ImageFilter.MinFilter(window)), dtype=np.float32)
    px = np.asarray(big, dtype=np.float32)
    ink = (px < (local_min + 255) / 2) & (local_min < ink_max) & (px < floor)
    if close:
        # Cierre morfológico con un disco pequeño: une cortes de menos de un píxel de la
        # captura original sin dejar esquinas cuadradas.
        ink = ~dilate(~dilate(ink, close), close)
    return Image.fromarray(np.where(ink, 0, 255).astype(np.uint8), 'L')

def dilate(mask, r):
    out = mask.copy()
    h, w = mask.shape
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > r * r or (dx == 0 and dy == 0):
                continue
            src = mask[max(-dy, 0):h - max(dy, 0), max(-dx, 0):w - max(dx, 0)]
            out[max(dy, 0):h - max(-dy, 0), max(dx, 0):w - max(-dx, 0)] |= src
    return out

# El monograma tiene trazos gruesos y oscuros: umbral fijo. Los textos tienen
# líneas finas que en la captura quedan grises: umbral adaptativo.
top_bw = binarize(art.crop((0, 0, art.width, gap)), 128, 1.2)
bottom_bw = binarize_adaptive(art.crop((0, gap, art.width, art.height)), 1.4, 2 * SCALE + 1, close=CLOSE)
bw = Image.new('L', (art.width * SCALE, art.height * SCALE), 255)
bw.paste(top_bw, (0, 0))
bw.paste(bottom_bw, (0, gap * SCALE))
pbm = OUT / '_trace.pbm'
bw.convert('1').save(pbm)

def trace(name, color, extra=()):
    out = OUT / name
    subprocess.run(['potrace', str(pbm), '-s', '-o', str(out), '--turdsize', '8', '--alphamax', '1.0',
                    '--opttolerance', '0.2', '-C', color, *extra], check=True)
    return out

trace('logo-negro.svg', '#0B0C0B')
trace('logo-claro.svg', '#F3F1EB')
pbm.unlink()

# Recorte del monograma (parte superior, antes de los nombres): filas vacías separan bloques.
mono = art.crop((0, 0, art.width, gap))
mb = ImageOps.invert(mono).point(lambda p: 255 if p > 60 else 0).getbbox()
mono = mono.crop((max(mb[0] - pad, 0), 0, min(mb[2] + pad, mono.width), mb[3] + pad))
bigm = mono.resize((mono.width * SCALE, mono.height * SCALE), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
bigm.point(lambda p: 0 if p < 128 else 255).convert('1').save(pbm)
trace('monograma-negro.svg', '#0B0C0B')
trace('monograma-claro.svg', '#F3F1EB')
pbm.unlink()
for f in OUT.glob('*.svg'):
    t = f.read_text()
    t = re.sub(r' width="[0-9.]+pt" height="[0-9.]+pt"', '', t)
    t = re.sub(r'<\?xml[^>]*\?>\s*|<!DOCTYPE[^>]*>\s*', '', t)
    f.write_text(t)
print('listo')
