"""
Vectoriza el logo a partir de la captura original (JPEG 738x1600).

Pasos: recorta el área blanca central, amplía 6x con Lanczos, umbraliza y traza
con potrace. El resultado es un trazado automático: conserva la forma del
original pero NO es el archivo vectorial de la diseñadora. Si aparece el SVG
original, debe reemplazar a estos archivos.

Uso: python3 scripts/vectorize-logo.py
Requiere: Pillow y potrace (apt install potrace).
"""
import re, subprocess, pathlib
from PIL import Image, ImageFilter, ImageOps

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets/logo/original/WhatsApp Image 2026-10-21 at 8.42.27 PM.jpeg'
OUT = ROOT / 'assets/logo/vector'
OUT.mkdir(parents=True, exist_ok=True)
SCALE = 6

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

# El monograma tiene trazos gruesos; los textos tienen líneas finas que en la
# captura quedan grises, así que se umbralizan más claro para no romperlas.
top_bw = binarize(art.crop((0, 0, art.width, gap)), 128, 1.2)
bottom_bw = binarize(art.crop((0, gap, art.width, art.height)), 185, 0.8)
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
