# Asset-free handoff smoke

Run from `experiments/hotchick`:

```sh
python validation/smoke.py --ffmpeg /path/to/ffmpeg --ffprobe /path/to/ffprobe
```

Requires Python 3.10+, Pillow, FFmpeg with libx264/libwebp and FFprobe. Node.js is optional; if unavailable, the report explicitly skips JavaScript syntax checks. Binary paths may also use `HOTCHICK_FFMPEG` / `HOTCHICK_FFPROBE`, or executable discovery through `PATH`.

The script parses the supplied Python and JSON, checks JavaScript syntax, copies the unchanged asset CLI files into a temporary workspace, generates abstract colored test media and runs both real CLI validation/build flows. It verifies card dimensions, atlas metadata/transparent unused cells, poster dimensions, H.264 decoding and unchanged original source hashes. Generated media, recipes with temporary paths and intermediate caches are removed with the temporary workspace. Only sanitized `validation/RESULTS.json` is retained.

The recipes in `../examples/` are templates. Supply your own sources (paths resolve against `source/` for the original tools), or use this smoke script, which supplies synthetic sources automatically.

This does not run the original asset-dependent QA scripts, original native gameplay acceptance, a browser, GPU shaders, concurrent video playback or performance benchmarks. Those source files are review references and require their original media/runtime environment. A passing report does not prove visual completion or portability of the complete game.
