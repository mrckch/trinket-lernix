"""Schnellanleitung als eine Datei bauen: Bilder aus anleitung-bilder/ als JPEG-Daten-URIs einbetten.

Aufruf: python docs/lernix/build_anleitung.py [Zieldatei]
Ergebnis (Standard): docs/lernix/dist/schnellanleitung-lehrkraefte.html – zum Hochladen nach HTML-Share.
"""
import base64
import io
import re
import sys
from pathlib import Path

from PIL import Image

HIER = Path(__file__).resolve().parent
QUELLE = HIER / "schnellanleitung-lehrkraefte.html"
ZIEL = Path(sys.argv[1]) if len(sys.argv) > 1 else HIER / "dist" / QUELLE.name
MAX_BREITE = 1100


def daten_uri(pfad: Path) -> str:
    bild = Image.open(pfad).convert("RGB")
    if bild.width > MAX_BREITE:
        bild = bild.resize((MAX_BREITE, round(bild.height * MAX_BREITE / bild.width)), Image.LANCZOS)
    puffer = io.BytesIO()
    bild.save(puffer, "JPEG", quality=82, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(puffer.getvalue()).decode("ascii")


html = QUELLE.read_text(encoding="utf-8")
html = re.sub(r'src="(anleitung-bilder/[^"]+)"', lambda m: 'src="%s"' % daten_uri(HIER / m.group(1)), html)
ZIEL.parent.mkdir(parents=True, exist_ok=True)
ZIEL.write_text(html, encoding="utf-8", newline="\n")
print(f"{ZIEL} ({ZIEL.stat().st_size // 1024} KB)")
