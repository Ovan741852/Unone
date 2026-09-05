"""Receive rendered frames from web/presentation/ and build a GIF.

The presentation host renders engine frames in a browser and POSTs each one
here as a PNG. This script only stores what it is given and assembles the
result; it never decides what the engine simulated.

Usage:
    python scripts/record-presentation.py --out artifacts/presentation
Then, from the page:
    await window.unoneHost.record({endpoint: "http://127.0.0.1:8010/frame", ...})
Finally, stop the server (Ctrl+C) or POST /finish to write the GIF.
"""

from __future__ import annotations

import argparse
import re
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

FRAME_NAME = re.compile(r"^/frame/(\d{1,8})\.png$")


class FrameHandler(BaseHTTPRequestHandler):
    output_dir: Path
    done = threading.Event()

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")

    def do_OPTIONS(self) -> None:  # noqa: N802 - http.server API
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        if self.path == "/states.json":
            length = int(self.headers.get("content-length", "0"))
            (self.output_dir / "states.json").write_bytes(self.rfile.read(length))
            self.send_response(200)
            self._cors()
            self.end_headers()
            self.wfile.write(b"ok")
            FrameHandler.done.set()
            return
        if self.path == "/finish":
            self.send_response(200)
            self._cors()
            self.end_headers()
            self.wfile.write(b"finished")
            FrameHandler.done.set()
            return
        match = FRAME_NAME.match(self.path)
        if not match:
            self.send_error(404, "frames are posted to /frame/<number>.png")
            return
        length = int(self.headers.get("content-length", "0"))
        payload = self.rfile.read(length)
        if not payload.startswith(b"\x89PNG"):
            self.send_error(415, "only PNG frames are accepted")
            return
        (self.output_dir / f"{int(match.group(1)):05d}.png").write_bytes(payload)
        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *_args) -> None:
        return


def build_gif(frames_dir: Path, gif_path: Path, fps: int) -> int:
    import json

    from PIL import Image, ImageDraw

    frames = sorted(frames_dir.glob("*.png"))
    if not frames:
        raise SystemExit(f"no frames were captured in {frames_dir}")
    states_path = frames_dir / "states.json"
    states = {}
    if states_path.is_file():
        states = {entry["file"]: entry for entry in json.loads(states_path.read_text())}
    images = []
    for path in frames:
        image = Image.open(path).convert("RGB")
        state = states.get(path.name)
        if state:
            draw_overlay(ImageDraw.Draw(image), state, image.size)
        images.append(image)
    images[0].save(
        gif_path,
        save_all=True,
        append_images=images[1:],
        duration=max(1, round(1000 / fps)),
        loop=0,
        optimize=True,
    )
    return len(images)


def draw_overlay(draw, state, size) -> None:
    """Label each frame with the engine state that produced it."""
    width, _ = size
    lines = [
        f"engine frame {state['frame']}   {state['message']}",
        f"reels {state['reels']}   credits {state['credits']}   win {state['last_win']}",
        "  ".join(state["clips"]) or "no animation",
        ("effects: " + ", ".join(state["effects"])) if state["effects"] else "no effects",
    ]
    draw.rectangle([0, 0, width, 66], fill=(8, 12, 24))
    for index, line in enumerate(lines):
        colour = (147, 197, 253) if index == 0 else (167, 243, 208)
        draw.text((12, 6 + index * 14), line, fill=colour)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="artifacts/presentation")
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--gif", default=None, help="GIF path (default: <out>.gif)")
    parser.add_argument("--keep-frames", action="store_true")
    arguments = parser.parse_args()

    frames_dir = Path(arguments.out)
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True)
    FrameHandler.output_dir = frames_dir

    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), FrameHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"recorder listening on http://127.0.0.1:{arguments.port}/frame")
    try:
        FrameHandler.done.wait()
    except KeyboardInterrupt:
        pass
    server.shutdown()

    gif_path = Path(arguments.gif) if arguments.gif else frames_dir.with_suffix(".gif")
    count = build_gif(frames_dir, gif_path, arguments.fps)
    if not arguments.keep_frames:
        shutil.rmtree(frames_dir)
    print(f"wrote {gif_path} from {count} frames at {arguments.fps} fps")


if __name__ == "__main__":
    main()
