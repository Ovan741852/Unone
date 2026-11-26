"""Encode a straight RGBA import product as lossless WebP on the build host."""
import io
import sys

from PIL import Image

width, height = map(int, sys.argv[1:])
raw = sys.stdin.buffer.read()
image = Image.frombytes("RGBA", (width, height), raw)
encoded = io.BytesIO()
image.save(encoded, format="WEBP", lossless=True, exact=True, method=6, quality=100)

# Some encoders discard the RGB stored beneath transparent pixels by default.
encoded.seek(0)
with Image.open(encoded) as decoded:
    if decoded.size != image.size or decoded.convert("RGBA").tobytes() != raw:
        raise ValueError("WebP encoder changed image dimensions or straight RGBA pixels")
sys.stdout.buffer.write(encoded.getbuffer())
