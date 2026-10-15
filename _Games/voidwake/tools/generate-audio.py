"""Bake VOIDWAKE's original synthesized audio into deterministic engine assets.

No third-party modules or remote media. Run `python tools/generate-audio.py` to
rebuild, or add `--check` to verify the checked-in bytes and manifest read-only.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import random
import struct
import wave

ROOT = Path(__file__).resolve().parents[1]
RATE = 22_050
NAMES = ("shot", "explosion", "hit", "dash", "upgrade", "click", "hum")


def tone(duration: float, start: float, end: float, gain: float, triangle: bool = False) -> list[float]:
    result = []
    phase = 0.0
    for i in range(round(duration * RATE)):
        t = i / RATE
        frequency = start * (end / start) ** (t / duration)
        carrier = 2.0 / math.pi * math.asin(math.sin(phase)) if triangle else math.sin(phase)
        envelope = math.exp(-7.0 * t / duration)
        result.append(carrier * gain * envelope)
        phase += math.tau * frequency / RATE
    return result


def noise(duration: float, gain: float, seed: int) -> list[float]:
    rng = random.Random(seed)
    alpha = 1 - math.exp(-math.tau * 650 / RATE)
    previous = 0.0
    result = []
    length = round(duration * RATE)
    for i in range(length):
        previous += alpha * (rng.uniform(-1, 1) - previous)
        result.append(previous * gain * (1 - i / length) ** 2)
    return result


def mix(*layers: tuple[float, list[float]]) -> list[float]:
    count = max(round(offset * RATE) + len(samples) for offset, samples in layers)
    result = [0.0] * count
    for offset, samples in layers:
        start = round(offset * RATE)
        for i, sample in enumerate(samples):
            result[start + i] += sample
    peak = max(abs(x) for x in result)
    if peak > 0.9:
        result = [x * 0.9 / peak for x in result]
    return result


def sounds() -> dict[str, list[float]]:
    # The descending triangle pulse, low-pass noise impacts, ascending dash and
    # four-note chord retain the character of the former audio.mjs synthesizer.
    return {
        "shot": tone(0.09, 420, 95, 0.35, triangle=True),
        "explosion": mix((0, noise(0.55, 0.8, 0x564F4944)), (0, tone(0.4, 80, 25, 0.45))),
        "hit": mix((0, noise(0.12, 0.5, 0x484954)), (0, tone(0.14, 130, 60, 0.38))),
        "dash": mix((0, noise(0.25, 0.35, 0x44415348)), (0, tone(0.22, 90, 480, 0.3))),
        "upgrade": mix(*[(i * 0.075, tone(0.6, f, f * 0.995, 0.23)) for i, f in enumerate((220, 330, 440, 660))]),
        "click": tone(0.06, 700, 350, 0.3),
        # Exactly 86 cycles in two seconds, with integer-cycle harmonics: a
        # continuous loop seam without a runtime oscillator or random source.
        "hum": [0.11 * math.sin(math.tau * 43 * i / RATE)
                + 0.015 * math.sin(math.tau * 86 * i / RATE)
                for i in range(RATE * 2)],
    }


def encode(samples: list[float]) -> bytes:
    assert samples and all(math.isfinite(x) and abs(x) <= 0.9 for x in samples)
    pcm = struct.pack(f"<{len(samples)}h", *[round(x * 32767) for x in samples])
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
        output.writeframes(pcm)
    return buffer.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate deterministic WAV bytes and manifest without writing")
    args = parser.parse_args()
    manifest_path = ROOT / "assets.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    audio_dir = ROOT / "assets" / "audio"
    if not args.check:
        audio_dir.mkdir(parents=True, exist_ok=True)
    report = []
    for name, samples in sounds().items():
        data = encode(samples)
        path = audio_dir / f"{name}.wav"
        entry = {"id": f"audio://voidwake/{name}", "kind": "audio", "source": f"assets/audio/{name}.wav", "bundle": "content"}
        existing = [asset for asset in manifest["assets"] if asset["id"] == entry["id"]]
        if args.check:
            assert path.read_bytes() == data, f"Non-reproducible audio bytes: {path}"
            assert existing == [entry], f"Incorrect audio manifest entry: {entry['id']}"
        else:
            path.write_bytes(data)
            manifest["assets"] = [asset for asset in manifest["assets"] if asset["id"] != entry["id"]]
            manifest["assets"].append(entry)
        with wave.open(io.BytesIO(data)) as audio:
            assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, RATE)
            assert audio.getnframes() == len(samples)
        assert max(abs(x) for x in samples) > 0.01, f"Silent clip: {name}"
        report.append({"name": name, "seconds": round(len(samples) / RATE, 4), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    if not args.check:
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "mode": "check" if args.check else "bake", "sample_rate": RATE, "clips": report, "total_bytes": sum(clip["bytes"] for clip in report)}, indent=2))


if __name__ == "__main__":
    main()
