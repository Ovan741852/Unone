"""Independent API/media acceptance for the local media workbench.

Writes fixtures/reports only beneath .cache/tmp and artifacts/media-tool-qa;
the tool itself writes generated media beneath assets/generated/media-tool-qa.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = Path(r"C:\ffmpeg\ffmpeg.exe")
FFPROBE = Path(r"C:\ffmpeg\ffprobe.exe")


def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def all_dicts(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from all_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from all_dicts(child)


def video_info(value):
    candidates = [d for d in all_dicts(value) if "width" in d and "height" in d]
    return next((d for d in candidates if d.get("codec_type") == "video"), candidates[0] if candidates else {})


def preview_url(value):
    for record in all_dicts(value):
        for key, child in record.items():
            if isinstance(child, str) and "/api/previews/" in child:
                return child
    raise AssertionError(f"No preview URL in API response: {value}")


def probe_file(path):
    return json.loads(subprocess.run([str(FFPROBE), "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)], capture_output=True, text=True, encoding="utf-8", check=True).stdout)


def color_near(pixel, expected, tolerance=35):
    return all(abs(int(pixel[i])-expected[i]) <= tolerance for i in range(3))


def make_source(path):
    colors = [("#ff0000", "#00ff00", "#0000ff", "#ffff00"), ("#00ffff", "#ff00ff", "#ffffff", "#000000")]
    images = []
    for palette in colors:
        image = Image.new("RGB", (320,240))
        draw = ImageDraw.Draw(image)
        for box,color in zip(((0,0,159,119),(160,0,319,119),(0,120,159,239),(160,120,319,239)),palette):
            draw.rectangle(box,fill=color)
        images.append(image.tobytes())
    result = subprocess.run([str(FFMPEG), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "320x240", "-framerate", "24", "-i", "pipe:0", "-frames:v", "96", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(path)], input=images[0]*48+images[1]*48, capture_output=True)
    assert result.returncode == 0, result.stderr.decode(errors="replace")


def decode_frame(path, seconds, target):
    subprocess.run([str(FFMPEG), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(seconds), "-i", str(path), "-frames:v", "1", str(target)], check=True)
    return Image.open(target).convert("RGB")


def inspect_yeseul_proof(directory):
    canonical = json.loads((ROOT/"assets/media/yeseul/recipe.json").read_text(encoding="utf-8"))
    manifest = json.loads((directory/"runtime-manifest.json").read_text(encoding="utf-8"))
    expected_files = {item["file"] for item in canonical["outputs"]}
    assert len(expected_files) == 19 and expected_files <= {item["file"] for item in manifest["outputs"]}
    for item in manifest["outputs"]:
        assert sha(directory/item["file"]) == item["sha256"]
    for item in canonical["sources"]:
        assert sha(Path(canonical["source_directory"])/item["file"]) == item["sha256"]
    originals = json.loads((directory/"source-manifest.json").read_text(encoding="utf-8"))["clips"]
    assert len(originals) == 6
    original_by_id = {item["id"]:item for item in originals}
    for item in canonical["sources"]:
        record = original_by_id[item["id"]]
        copy_path = (directory/record["copy"]).resolve()
        assert copy_path.is_relative_to(directory.resolve())
        assert sha(copy_path) == record["sha256"] == item["sha256"]
    for output in canonical["outputs"]:
        path = directory/output["file"]
        if output["type"] == "video":
            info = probe_file(path)
            stream = video_info(info)
            assert (int(stream["width"]),int(stream["height"])) == (output["width"],output["height"])
            assert stream["r_frame_rate"] == "24/1"
            expected_duration = original_by_id[output["source_id"]]["media"]["duration"]
            assert abs(float(info["format"]["duration"])-expected_duration) < .05
        elif output["type"] == "atlas":
            with Image.open(path) as image:
                atlas = image.convert("RGBA")
            assert atlas.size == (1024,1024) and atlas.getpixel((1023,1023))[3] == 0
        elif output["type"] == "poster":
            with Image.open(path) as image:
                assert 0 < image.width <= output["max_width"] and 0 < image.height <= output["max_height"]
    fields = json.loads((directory/"field-sprites.json").read_text(encoding="utf-8"))
    assert fields["frame_count"] == 49 and fields["fps"] == 12 and fields["columns"] == fields["rows"] == 8
    assert len(fields["sources"]) == 3
    for item in fields["sources"]:
        assert item["poster"] == f'field-{item["symbol_tier"]}-poster.webp'
        assert item["frame_count"] == 49 and len(set(item["source_frame_indices"])) == 49
        assert item["source_frame_indices"][0] == 0 and item["source_frame_indices"][-1] == 96
        assert abs(item["source_duration"]-4.041667) < .00001
        assert abs(item["source_original_duration"]-(8.041667 if item["symbol_tier"] == "large" else 4.041667)) < .00001
    return {"directory":str(directory),"outputs":19,"hashes":"all matched","source_hashes":"all six originals and preserved copies matched","media":"8 video dimensions/fps/durations, 3 atlas sizes/padding and 8 poster bounds verified","field_metadata":"3 x 49 frames; actual source indices/durations and field-specific posters matched"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8242")
    parser.add_argument("--proof", type=Path, help="Inspect a completed Yeseul proof directory only after its build has finished")
    parser.add_argument("--proof-only", action="store_true", help="Inspect an existing completed proof without generating API test outputs again")
    parser.add_argument("--metadata-only", action="store_true", help="Build only a small cover-fit/field-poster metadata regression fixture")
    args = parser.parse_args()
    base = args.url.rstrip("/")
    fixtures = ROOT/".cache/tmp/media-tool-qa"
    artifacts = ROOT/"artifacts/media-tool-qa"
    fixtures.mkdir(parents=True,exist_ok=True)
    artifacts.mkdir(parents=True,exist_ok=True)
    checks, evidence = [], {}
    if args.proof_only:
        assert args.proof is not None,"--proof-only requires --proof"
        report = {"ok":True,"check":"independent-Yeseul-19-output-proof-manifest-hashes","evidence":inspect_yeseul_proof(args.proof)}
        (artifacts/"yeseul-proof-acceptance.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
        print(json.dumps(report,ensure_ascii=False))
        return

    def request(path, payload=None, *, raw=None, headers=None, expected=(200,)):
        address = urllib.parse.urljoin(base+"/",path)
        body = json.dumps(payload).encode() if payload is not None else raw
        request_headers = dict(headers or {})
        if payload is not None: request_headers.setdefault("Content-Type","application/json")
        req = urllib.request.Request(address,data=body,headers=request_headers,method="POST" if body is not None else "GET")
        try:
            with urllib.request.urlopen(req,timeout=60) as response:
                status, meta, data = response.status, {key.lower():value for key,value in response.headers.items()}, response.read()
        except urllib.error.HTTPError as error:
            status, meta, data = error.code, {key.lower():value for key,value in error.headers.items()}, error.read()
        assert status in expected,(path,status,data[:1200])
        parsed = json.loads(data) if "json" in meta.get("content-type","") else data
        return parsed,status,meta

    def complete_job(job_id):
        samples = []
        end = time.monotonic()+180
        while time.monotonic() < end:
            job,_,_ = request("/api/jobs/"+urllib.parse.quote(job_id,safe=""))
            samples.append({"status":job.get("status"),"progress":job.get("progress")})
            if job.get("status") in ("completed","complete","done","failed","error"):
                break
            time.sleep(.15)
        else: raise AssertionError("Build did not finish in 180 seconds")
        assert job["status"] in ("completed","complete","done"),job
        progress = [sample["progress"] for sample in samples]
        assert all(isinstance(value,(int,float)) and 0 <= value <= 100 for value in progress)
        assert all(b >= a for a,b in zip(progress,progress[1:])) and progress[-1] > 0
        return job,samples

    try:
        source = fixtures/"quadrants.mp4"
        make_source(source)
        source_hash = sha(source)
        source_probe = probe_file(source)
        assert abs(float(source_probe["format"]["duration"])-4) < .02
        assert int(video_info(source_probe)["nb_frames"]) == 96
        info,_,_ = request("/api/info")
        assert isinstance(info,dict) and info
        probed,_,_ = request("/api/probe",{"path":str(source)})
        stream = video_info(probed)
        assert (int(stream["width"]),int(stream["height"])) == (320,240),probed
        evidence["probe"] = probed
        if args.metadata_only:
            output_dir = f"assets/generated/media-tool-qa/metadata-{uuid.uuid4().hex[:10]}"
            recipe = {
                "schema":"hotchick.media.recipe.v1","character_id":"qa-metadata","character_name":"Metadata QA",
                "source_directory":str(fixtures),"output_directory":output_dir,"preserve_originals":False,"cropped":False,
                "sources":[{"id":"quad","file":source.name,"sha256":source_hash}],
                "outputs":[
                    {"file":"field-small.webp","source_id":"quad","type":"atlas","symbol_tier":"small","start_seconds":1,"end_seconds":3,"fps":2,"frame_count":4,"tile_width":64,"tile_height":64,"columns":3,"rows":2,"fit":"cover","padding":"transparent","quality":90},
                    {"file":"general-poster.webp","source_id":"quad","type":"poster","at_seconds":1.25,"width":80,"height":60,"fit":"contain","quality":90},
                    {"file":"field-small-poster.webp","source_id":"quad","type":"poster","at_seconds":2.25,"width":80,"height":60,"fit":"contain","quality":90},
                ],
                "field_metadata":{"file":"field-sprites.json","fps":2,"frame_count":4,"columns":3,"rows":2,"tile":64,"order":"row-major"},
                "runtime_manifest":"runtime-manifest.json",
            }
            created,_,_ = request("/api/build",{"recipe":recipe,"output_directory":output_dir},expected=(200,202))
            job,_ = complete_job(created["job_id"])
            directory = Path(job["output_directory"])
            manifest = json.loads((directory/"runtime-manifest.json").read_text(encoding="utf-8"))
            fields = json.loads((directory/"field-sprites.json").read_text(encoding="utf-8"))
            assert manifest["cropped"] and fields["cropped"]
            assert fields["sources"][0]["poster"] == "field-small-poster.webp"
            assert len(set(fields["sources"][0]["source_frame_indices"])) == 4
            with Image.open(directory/"field-small.webp") as image:
                atlas = image.convert("RGBA")
            assert atlas.size == (192,128) and atlas.getpixel((3,3))[3] == 255
            assert color_near(atlas.getpixel((3,3)),(255,0,0))
            assert color_near(atlas.getpixel((3,67)),(0,255,255))
            assert atlas.getpixel((160,96))[3] == 0
            report = {"ok":True,"checks":["cover-fit-without-explicit-crop-is-marked-cropped","atlas-specific-poster-wins-over-general-source-poster","actual-distinct-frame-indices-and-unused-alpha"],"output_directory":str(directory),"job_id":created["job_id"]}
            (artifacts/"metadata-regression.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
            print(json.dumps(report,ensure_ascii=False))
            return
        uploaded,_,_ = request("/api/upload?filename=qa-quadrants.mp4",raw=source.read_bytes(),headers={"Content-Type":"video/mp4"},expected=(200,201))
        for key,data in (("source",probed),("upload",uploaded)):
            address = preview_url(data)
            block,status,headers = request(address,headers={"Range":"bytes=0-127"},expected=(206,))
            assert len(block) == 128 and block[4:8] == b"ftyp",(key,status,headers)
            assert headers.get("content-range","").startswith("bytes 0-127/")
        checks.append("probe-upload-and-browser-preview-byte-ranges")

        imported,_,_ = request("/api/recipe/yeseul")
        canonical = json.loads((ROOT/"assets/media/yeseul/recipe.json").read_text(encoding="utf-8"))
        assert imported == canonical and len(imported["sources"]) == 6 and len(imported["outputs"]) == 19
        for item in canonical["sources"]:
            assert sha(Path(canonical["source_directory"])/item["file"]) == item["sha256"]
        checks.append("saved-Yeseul-recipe-import-and-all-six-source-hashes")

        crop = {"x":160,"y":0,"width":160,"height":120}
        output_dir = f"assets/generated/media-tool-qa/run-{uuid.uuid4().hex[:10]}"
        recipe = {
            "schema":"hotchick.media.recipe.v1","character_id":"qa-quadrants","character_name":"Media QA",
            "source_directory":str(fixtures),"output_directory":output_dir,"preserve_originals":False,
            "cropped":True,"background_removed":False,
            "sources":[{"id":"quad","file":source.name,"sha256":source_hash}],
            "outputs":[
                {"file":"crop.mp4","source_id":"quad","type":"video","start_seconds":1,"end_seconds":3,"crop":crop,"width":96,"height":96,"fit":"contain","fps":12,"codec":"h264","pixel_format":"yuv420p","audio":"copy_if_present","crf":18,"preset":"fast","faststart":True},
                {"file":"atlas.webp","source_id":"quad","type":"atlas","symbol_tier":"small","start_seconds":1,"end_seconds":3,"crop":crop,"fps":4,"frame_count":8,"tile_width":64,"tile_height":64,"columns":3,"rows":3,"fit":"cover","padding":"transparent","format":"webp","quality":90,"method":4},
                {"file":"poster.webp","source_id":"quad","type":"poster","at_seconds":2.5,"crop":crop,"width":80,"height":80,"fit":"cover","format":"webp","quality":90},
            ],
            "field_metadata":{"file":"field-sprites.json","fps":4,"frame_count":8,"columns":3,"rows":3,"tile":64,"order":"row-major"},
            "runtime_manifest":"runtime-manifest.json",
        }
        (artifacts/"recipe.json").write_text(json.dumps(recipe,ensure_ascii=False,indent=2),encoding="utf-8")
        validated,_,_ = request("/api/validate",{"recipe":recipe,"output_directory":output_dir})
        assert validated["ok"] and not validated.get("errors"),validated

        failures = []
        def invalid(label, mutate, output=None):
            value = copy.deepcopy(recipe)
            mutate(value)
            result,_,_ = request("/api/validate",{"recipe":value,"output_directory":output or output_dir},expected=(200,400,422))
            assert isinstance(result,dict) and not result.get("ok",False) and (result.get("errors") or result.get("error")),(label,result)
            failures.append({"case":label,"response":result})
        invalid("reversed time range",lambda r:r["outputs"][0].update(start_seconds=3,end_seconds=1))
        invalid("time beyond source",lambda r:r["outputs"][0].update(end_seconds=5))
        invalid("crop outside frame",lambda r:r["outputs"][0]["crop"].update(x=300,width=160))
        invalid("negative crop coordinate",lambda r:r["outputs"][0]["crop"].update(x=-2))
        invalid("zero fps",lambda r:r["outputs"][0].update(fps=0))
        invalid("atlas grid too small",lambda r:r["outputs"][1].update(frame_count=10))
        invalid("output path traversal",lambda r:r["outputs"][0].update(file="../escape.mp4"))
        invalid("absolute output filename",lambda r:r["outputs"][0].update(file="C:/escape.mp4"))
        invalid("source overwrite",lambda r:r["outputs"][0].update(file=source.name),str(fixtures))
        invalid("protected game runtime output",lambda r:None,"game/presentation/assets/yeseul")
        origin,_,_ = request("/api/probe",{"path":str(source)},headers={"Origin":"https://example.invalid"},expected=(400,403))
        assert isinstance(origin,dict) and origin.get("error")
        evidence["validationFailures"] = failures
        checks.append("ten-invalid-recipes-and-untrusted-Origin-rejected")

        created,_,_ = request("/api/build",{"recipe":recipe,"output_directory":output_dir},expected=(200,202))
        job_id = created["job_id"]
        job,samples = complete_job(job_id)
        destination = Path(job["output_directory"]).resolve()
        allowed = (ROOT/"assets/generated/media-tool-qa").resolve()
        assert destination.is_relative_to(allowed),(destination,allowed)
        assert isinstance(job.get("log"),list) or isinstance(job.get("log"),str)
        paths = {entry["file"]:Path(entry["path"]) for entry in job["outputs"]}
        for filename in ("crop.mp4","atlas.webp","poster.webp"):
            assert filename in paths and paths[filename].is_file(),job
            entry = next(item for item in job["outputs"] if item["file"] == filename)
            downloaded,_,_ = request(entry.get("url") or f"/api/file?job_id={urllib.parse.quote(job_id)}&file={urllib.parse.quote(filename)}")
            assert hashlib.sha256(downloaded).hexdigest() == sha(paths[filename])
        _,_,_ = request(f"/api/file?job_id={urllib.parse.quote(job_id)}&file=..%2Fquadrants.mp4",expected=(400,403,404))
        evidence["job"] = job
        evidence["progress"] = samples
        checks.append("async-build-progress-outputs-downloads-and-file-traversal-protection")

        video = probe_file(paths["crop.mp4"])
        stream = video_info(video)
        assert (int(stream["width"]),int(stream["height"])) == (96,96)
        assert stream["r_frame_rate"] == "12/1" and int(stream["nb_frames"]) == 24
        assert abs(float(video["format"]["duration"])-2) < .09
        first = decode_frame(paths["crop.mp4"],.25,artifacts/"video-first.png")
        second = decode_frame(paths["crop.mp4"],1.25,artifacts/"video-second.png")
        assert color_near(first.getpixel((48,48)),(0,255,0))
        assert color_near(second.getpixel((48,48)),(255,0,255))
        assert color_near(first.getpixel((48,3)),(0,0,0))
        checks.append("decoded-video-proves-time-crop-top-right-region-contain-fps-and-duration")

        with Image.open(paths["atlas.webp"]) as decoded:
            atlas = decoded.convert("RGBA")
        assert atlas.size == (192,192)
        for point in ((32,32),(160,32),(3,3)):
            assert color_near(atlas.getpixel(point),(0,255,0)) and atlas.getpixel(point)[3] == 255
        for point in ((32,160),(96,160)):
            assert color_near(atlas.getpixel(point),(255,0,255))
        assert atlas.getpixel((160,160))[3] == 0
        atlas.save(artifacts/"atlas-decoded.png")
        metadata = json.loads((destination/"field-sprites.json").read_text(encoding="utf-8"))
        assert metadata["frame_count"] == 8 and metadata["columns"] == metadata["rows"] == 3 and metadata["fps"] == 4
        checks.append("decoded-WebP-grid-has-eight-cropped-temporal-frames-and-transparent-unused-cell")
        with Image.open(paths["poster.webp"]) as decoded:
            poster = decoded.convert("RGB")
        assert poster.size == (80,80) and color_near(poster.getpixel((40,40)),(255,0,255))
        assert color_near(poster.getpixel((3,3)),(255,0,255))
        checks.append("poster-proves-source-time-crop-and-cover-fit")
        assert sha(source) == source_hash
        for item in canonical["sources"]:
            assert sha(Path(canonical["source_directory"])/item["file"]) == item["sha256"]

        before = {filename:sha(paths[filename]) for filename in ("crop.mp4","atlas.webp","poster.webp")}
        refused,_,_ = request("/api/build",{"recipe":recipe,"output_directory":output_dir},expected=(400,409,422))
        assert isinstance(refused,dict) and (refused.get("error") or refused.get("errors"))
        assert before == {filename:sha(paths[filename]) for filename in before}
        rebuilt,_,_ = request("/api/build",{"recipe":recipe,"output_directory":output_dir,"overwrite":True},expected=(200,202))
        rebuilt_job,_ = complete_job(rebuilt["job_id"])
        assert Path(rebuilt_job["output_directory"]).resolve() == destination
        assert before == {filename:sha(paths[filename]) for filename in before}
        evidence["rebuild"] = {"job_id":rebuilt["job_id"],"matching_media_hashes":before}
        checks.append("existing-targets-protected-unless-explicit-overwrite-and-rebuild-media-hashes-match")

        if args.proof is not None:
            evidence["yeseulProof"] = inspect_yeseul_proof(args.proof)
            checks.append("independent-Yeseul-19-output-proof-manifest-hashes")
        else:
            evidence["yeseulProof"] = {"status":"not requested; inspect separately after the proof build finishes"}
        report = {"ok":True,"url":base,"checks":checks,"evidence":evidence,"source_hash_unchanged":source_hash}
        (artifacts/"acceptance.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
        (artifacts/"failure.json").unlink(missing_ok=True)
        print(json.dumps({"ok":True,"checks":checks,"count":len(checks),"validationFailures":len(failures),"output_directory":str(destination)},ensure_ascii=False))
    except Exception as error:
        (artifacts/"failure.json").write_text(json.dumps({"ok":False,"error":str(error),"checks":checks,"evidence":evidence},ensure_ascii=False,indent=2),encoding="utf-8")
        raise


if __name__ == "__main__":
    main()
