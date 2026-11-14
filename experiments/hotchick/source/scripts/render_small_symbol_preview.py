"""Render a viewing-only MP4 of the small WebP sprite crop and shrink motion."""
from pathlib import Path
import subprocess
from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "artifacts" / "small-symbol-sample"


def main():
    frames_dir = BASE / "_preview_frames"
    frames_dir.mkdir(exist_ok=True)
    font_path = "C:/Windows/Fonts/msjh.ttc"
    font = ImageFont.truetype(font_path, 17)
    small_font = ImageFont.truetype(font_path, 14)
    crops = []
    for index in range(0, 121, 2):
        image = Image.open(BASE / "rgba" / f"frame_{index:04d}.png").convert("RGBA")
        crops.append(image.crop((96, 18, 416, 338)))

    def bubble(image, size, opacity=1):
        image = image.resize((size, size), Image.Resampling.LANCZOS)
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse((2, 2, size-3, size-3), fill=255)
        image.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
        surface = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(surface)
        d.ellipse((2, 2, size-3, size-3), fill=(64, 144, 185, 45))
        surface.alpha_composite(image)
        d = ImageDraw.Draw(surface)
        d.ellipse((2, 2, size-3, size-3), outline=(174, 228, 255, 220), width=max(1, size//90))
        if size > 16:
            d.arc((7, 7, size-8, size-8), 205, 285, fill=(236, 251, 255, 225), width=max(1, size//80))
        if opacity < 1:
            surface.putalpha(surface.getchannel("A").point(lambda a: round(a*opacity)))
        return surface

    output_index = 0
    # Hold neutral; play the 12-fps atlas-equivalent frames on a 24-fps preview;
    # shrink independently of the source image animation.
    states = [(0, 1.0, 1.0)] * 12
    states += [(i//2, 1.0, 1.0) for i in range(121)]
    states += [(60, 1-.88*(1-(1-i/8)**3), 1-.65*(1-(1-i/8)**3)) for i in range(9)]
    states += [(60, 0.12, 0.35)] * 12
    for selected, scale, opacity in states:
        canvas = Image.new("RGBA", (512, 360), "#10304a")
        d = ImageDraw.Draw(canvas)
        d.text((20, 16), "小 symbol：微笑／揮手 → 縮小", font=font, fill="#e4f5ff")
        d.text((20, 44), "WebP sprite · 12 FPS · 泡泡框為預覽效果", font=small_font, fill="#b5d5e8")
        for x, nominal in ((155, 192), (382, 128)):
            size = round(nominal * scale)
            if size > 8:
                surface = bubble(crops[selected], size, opacity)
                canvas.alpha_composite(surface, (x-size//2, 192-size//2))
            d = ImageDraw.Draw(canvas)
            d.text((x-42, 310), f"{nominal} × {nominal}", font=font, fill="#d5e8f5")
        canvas.convert("RGB").save(frames_dir / f"frame_{output_index:04d}.png")
        if output_index == 60:
            canvas.convert("RGB").save(BASE / "preview-contact.jpg", quality=92)
        output_index += 1
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", "24",
                    "-start_number", "0", "-i", str(frames_dir / "frame_%04d.png"), "-an",
                    "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                    str(BASE / "small-symbol-preview.mp4")], check=True)
    print(BASE / "small-symbol-preview.mp4")


if __name__ == "__main__":
    main()
