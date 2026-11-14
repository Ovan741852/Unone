"""Local, reusable video/atlas workbench using FFmpeg and Pillow.

Examples:
  python scripts/media-tool/media_tool.py serve --host 127.0.0.1 --port 8242
  python scripts/media-tool/media_tool.py build --recipe assets/media/yeseul/recipe.json --output-dir assets/generated/yeseul-tool-proof --json
  python scripts/media-tool/media_tool.py validate --recipe assets/media/yeseul/recipe.json --output-dir assets/generated/yeseul-tool-proof
"""
from __future__ import annotations

import argparse
import bisect
from datetime import datetime, timezone
import errno
import hashlib
import http.server
import json
import math
import mimetypes
import os
from pathlib import Path, PurePosixPath
import queue
import re
import shutil
import subprocess
import sys
import threading
from urllib.parse import parse_qs, urlencode, urlsplit
import uuid

from PIL import Image

WORKSPACE = Path(__file__).resolve().parents[2]
TOOL_DIR = Path(__file__).resolve().parent
CACHE = WORKSPACE / ".cache/media-tool"
GENERATED = WORKSPACE / "assets/generated"
FFMPEG = Path(os.environ.get("HOTCHICK_FFMPEG", r"C:\ffmpeg\ffmpeg.exe"))
FFPROBE = Path(os.environ.get("HOTCHICK_FFPROBE", r"C:\ffmpeg\ffprobe.exe"))
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
SCHEMA = "hotchick.media.recipe.v1"
MAX_UPLOAD = 512 * 1024 * 1024
MAX_JSON = 4 * 1024 * 1024
ID_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,79}$")
PRESETS = {"ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow", "placebo"}
RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1,10)), *(f"LPT{i}" for i in range(1,10))}


class RecipeError(ValueError):
    def __init__(self, errors):
        self.errors = [str(x) for x in (errors if isinstance(errors,list) else [errors])]
        super().__init__("; ".join(self.errors))


def inside(path: Path, root: Path) -> bool:
    try: path.resolve().relative_to(root.resolve()); return True
    except ValueError: return False


def digest(path: Path) -> str:
    with path.open("rb") as stream: return hashlib.file_digest(stream,"sha256").hexdigest()


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary = path.with_name(f".{uuid.uuid4().hex}-{path.name}")
    temporary.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    temporary.replace(path)


def publish_file(staging: Path, target: Path) -> None:
    """Publish atomically even when explicit CLI output is on another drive."""
    try:
        staging.replace(target)
    except OSError as error:
        if error.errno!=errno.EXDEV and getattr(error,"winerror",None)!=17: raise
        temporary=target.with_name("."+uuid.uuid4().hex+"-"+target.name)
        shutil.copy2(staging,temporary)
        temporary.replace(target)


def command(args, timeout=600) -> subprocess.CompletedProcess:
    result = subprocess.run([str(x) for x in args],capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=timeout)
    if result.returncode:
        raise RuntimeError((result.stderr.strip() or result.stdout.strip() or "Media process failed")[-6000:])
    return result


def ffmpeg(*args) -> None:
    command([FFMPEG,"-nostdin","-hide_banner","-loglevel","error","-y","-threads","2",*args])


def ratio(value: str | None, fallback=0.0) -> float:
    try:
        left, right = str(value).split("/")
        return float(left)/float(right) if float(right) else fallback
    except (ValueError,TypeError):
        try: return float(value)
        except (ValueError,TypeError): return fallback


def probe_media(path: Path) -> dict:
    path = path.expanduser().resolve()
    if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
        raise RecipeError("Source must be an existing supported video file.")
    raw = json.loads(command([FFPROBE,"-v","error","-show_streams","-show_format","-of","json",path],timeout=120).stdout)
    video = next((x for x in raw.get("streams",[]) if x.get("codec_type")=="video"),None)
    if not video: raise RecipeError("Source does not contain a video stream.")
    duration = float(raw.get("format",{}).get("duration",video.get("duration",0)))
    if not math.isfinite(duration) or duration <= 0: raise RecipeError("Source duration is unavailable.")
    rotation = float(video.get("tags",{}).get("rotate",0))
    for data in video.get("side_data_list",[]):
        if "rotation" in data: rotation=float(data["rotation"])
    width,height=int(video["width"]),int(video["height"])
    if round(rotation)%180: width,height=height,width
    audio=next((x for x in raw.get("streams",[]) if x.get("codec_type")=="audio"),None)
    sha=digest(path)
    return {"source_id":"src-"+sha[:20],"path":str(path),"filename":path.name,"sha256":sha,"duration":duration,
            "width":width,"height":height,"fps":ratio(video.get("avg_frame_rate"),ratio(video.get("r_frame_rate"),24)),
            "has_audio":audio is not None,"audio_codec":audio.get("codec_name") if audio else None,
            "codec":video.get("codec_name"),"rotation":rotation,"bytes":path.stat().st_size}


def safe_relative(value, suffixes=None) -> str:
    if not isinstance(value,str) or not value or "\x00" in value or ":" in value: raise RecipeError("Output file must be a safe relative path.")
    value=value.replace("\\","/")
    parts=value.split("/")
    if value.startswith("/") or any(x in {"",".",".."} or x.endswith((" ",".")) for x in parts): raise RecipeError("Output path traversal or ambiguous path is not allowed.")
    if any(x.split(".")[0].upper() in RESERVED for x in parts): raise RecipeError("Reserved Windows output name is not allowed.")
    relative=PurePosixPath(value)
    if suffixes and relative.suffix.lower() not in suffixes: raise RecipeError("Output extension does not match its media type.")
    return str(relative)


def destination(root: Path, relative: str) -> Path:
    path=(root/safe_relative(relative)).resolve()
    if not inside(path,root): raise RecipeError("Output path escapes the output directory.")
    return path


def number(value, label, minimum=0, maximum=None, integer=False):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value): raise RecipeError(label+" must be a finite number.")
    if value<minimum or (maximum is not None and value>maximum) or (integer and int(value)!=value): raise RecipeError(label+" is outside its allowed range.")
    return int(value) if integer else float(value)


def time_range(output: dict, source: dict) -> tuple[float,float]:
    start=number(output.get("start_seconds",0),"start_seconds")
    end=output.get("end_seconds")
    duration=output.get("duration_seconds")
    if end is None: end=start+number(duration,"duration_seconds",0.000001) if duration is not None else source["duration"]
    end=number(end,"end_seconds",0.000001)
    if duration is not None and abs((end-start)-number(duration,"duration_seconds",0.000001))>0.00001: raise RecipeError("end_seconds and duration_seconds disagree.")
    if start>=end or end>source["duration"]+0.00001: raise RecipeError("Requested time range is outside the source duration.")
    return start,min(end,source["duration"])


def crop_box(output: dict, source: dict):
    crop=output.get("crop")
    if crop is None: return None
    if not isinstance(crop,dict): raise RecipeError("crop must contain x, y, width and height in source pixels.")
    c={k:number(crop.get(k),"crop."+k,1 if k in {"width","height"} else 0,integer=True) for k in ("x","y","width","height")}
    if c["x"]+c["width"]>source["width"] or c["y"]+c["height"]>source["height"]: raise RecipeError("Crop rectangle is outside the source frame.")
    return c


def validate_recipe(recipe: dict, output_dir_override=None, *, http=False, overwrite=False, authorized_sources=None) -> dict:
    if not isinstance(recipe,dict) or recipe.get("schema")!=SCHEMA: raise RecipeError("Unsupported recipe schema; expected "+SCHEMA)
    if not FFMPEG.is_file() or not FFPROBE.is_file(): raise RecipeError("FFmpeg and FFprobe are required.")
    raw_dir=output_dir_override or recipe.get("output_directory")
    if not isinstance(raw_dir,str) or not raw_dir.strip(): raise RecipeError("An output directory is required.")
    directory=Path(raw_dir).expanduser()
    if not directory.is_absolute(): directory=WORKSPACE/directory
    directory=directory.resolve()
    if http:
        if not any(inside(directory,p) for p in (GENERATED,CACHE)): raise RecipeError("HTTP output must stay inside assets/generated or .cache in this workspace.")
    elif output_dir_override is None and not inside(directory,WORKSPACE): raise RecipeError("Recipe output must stay in the workspace; an explicit --output-dir may select another directory.")
    if directory.exists() and not directory.is_dir(): raise RecipeError("Output directory points to a file.")
    source_dir=Path(recipe.get("source_directory") or WORKSPACE).expanduser()
    if not source_dir.is_absolute(): source_dir=WORKSPACE/source_dir
    source_items=recipe.get("sources")
    if not isinstance(source_items,list) or not 1<=len(source_items)<=100: raise RecipeError("Recipe requires 1 to 100 sources.")
    sources={}
    for item in source_items:
        if not isinstance(item,dict) or not ID_PATTERN.fullmatch(str(item.get("id",""))): raise RecipeError("Every source id must be an ASCII identifier.")
        ident=item["id"]
        if ident in sources: raise RecipeError("Duplicate source id: "+ident)
        if not isinstance(item.get("file"),str): raise RecipeError("Every source requires a file path.")
        path=Path(item["file"]).expanduser()
        if not path.is_absolute(): path=source_dir/path
        path=path.resolve()
        if http and authorized_sources is not None and str(path).casefold() not in authorized_sources: raise RecipeError("Source must be explicitly probed or uploaded before HTTP build: "+path.name)
        source=probe_media(path)
        if item.get("sha256") and item["sha256"].lower()!=source["sha256"]: raise RecipeError("Source SHA256 changed: "+path.name)
        sources[ident]=source
    raw_outputs=recipe.get("outputs")
    if not isinstance(raw_outputs,list) or not 1<=len(raw_outputs)<=100: raise RecipeError("Recipe requires 1 to 100 outputs.")
    outputs=[];used=set();source_paths={str(Path(s["path"]).resolve()).casefold() for s in sources.values()}
    for raw in raw_outputs:
        if not isinstance(raw,dict): raise RecipeError("Each output must be an object.")
        item=dict(raw);kind=item.get("type")
        if kind not in {"video","poster","atlas"}: raise RecipeError("Output type must be video, poster or atlas.")
        suffixes={".mp4"} if kind=="video" else {".webp",".png"}
        item["file"]=safe_relative(item.get("file"),suffixes)
        target=destination(directory,item["file"])
        folded=str(target).casefold()
        if folded in used: raise RecipeError("Duplicate output path: "+item["file"])
        used.add(folded)
        if folded in source_paths: raise RecipeError("An output cannot overwrite a source file.")
        if target.exists() and not overwrite: raise RecipeError("Output already exists; choose a new directory or explicitly enable overwrite: "+item["file"])
        source=sources.get(item.get("source_id"))
        if source is None: raise RecipeError("Output refers to an unknown source_id.")
        item["fit"]=item.get("fit","contain")
        if item["fit"] not in {"contain","cover"}: raise RecipeError("fit must be contain or cover.")
        item["crop"]=crop_box(item,source)
        item["quality"]=number(item.get("quality",88 if kind=="atlas" else 90),"quality",0,100,integer=True)
        if kind in {"video","atlas"}:
            start,end=time_range(item,source);item["start_seconds"]=start;item["end_seconds"]=end;item["duration_seconds"]=end-start
            item["fps"]=number(item.get("fps",24 if kind=="video" else 12),"fps",0.01,120)
        if kind=="video":
            for key in ("width","height"):
                item[key]=number(item.get(key),key,2,8192,integer=True)
                if item[key]%2: raise RecipeError("H.264 video width and height must be even.")
            item["crf"]=number(item.get("crf",20),"crf",0,51)
            item["preset"]=item.get("preset","medium")
            if item["preset"] not in PRESETS: raise RecipeError("Unsupported H.264 preset.")
            if item.get("codec","h264") not in {"h264","libx264"}: raise RecipeError("Only H.264 video output is supported.")
            if item.get("audio","copy_if_present") not in {"copy_if_present","aac","none"}: raise RecipeError("audio must be copy_if_present, aac or none.")
        elif kind=="poster":
            item["at_seconds"]=number(item.get("at_seconds",0),"at_seconds",0)
            if item["at_seconds"]>=source["duration"]: raise RecipeError("Poster time is outside the source duration.")
            explicit="width" in item or "height" in item
            for key in (("width","height") if explicit else ("max_width","max_height")):
                item[key]=number(item.get(key,640),key,1,8192,integer=True)
            item["explicit_size"]=explicit
        else:
            item["tile_width"]=number(item.get("tile_width",item.get("tile",128)),"tile_width",1,1024,integer=True)
            item["tile_height"]=number(item.get("tile_height",item.get("tile",128)),"tile_height",1,1024,integer=True)
            default_count=math.ceil(item["duration_seconds"]*item["fps"]-1e-7)
            item["frame_count"]=number(item.get("frame_count",default_count),"frame_count",1,1024,integer=True)
            item["columns"]=number(item.get("columns",8),"columns",1,64,integer=True)
            item["rows"]=number(item.get("rows",math.ceil(item["frame_count"]/item["columns"])),"rows",1,64,integer=True)
            if item["columns"]*item["rows"]<item["frame_count"]: raise RecipeError("Atlas grid cannot contain all requested frames.")
            if item["columns"]*item["tile_width"]>8192 or item["rows"]*item["tile_height"]>8192: raise RecipeError("Atlas dimensions may not exceed 8192 pixels.")
            if item.get("symbol_tier","small") not in {"small","medium","large"}: raise RecipeError("symbol_tier must be small, medium or large.")
            if "sample_frame_indices" in item:
                indices=item["sample_frame_indices"]
                if not isinstance(indices,list) or not 1<=len(indices)<=1024: raise RecipeError("sample_frame_indices must be a non-empty array, at most 1024 entries.")
                for index in indices: number(index,"sample_frame_index",0,integer=True)
                if indices!=sorted(indices): raise RecipeError("sample_frame_indices must be ordered.")
            item["method"]=number(item.get("method",6),"method",0,6,integer=True)
        outputs.append(item)
    metadata_names=["source-manifest.json","recipe.snapshot.json","runtime-manifest.json"]
    if any(o["type"]=="atlas" for o in outputs): metadata_names.append("field-sprites.json")
    for relative in metadata_names:
        target=destination(directory,relative)
        if str(target).casefold() in used or str(target).casefold() in source_paths: raise RecipeError("Generated metadata path conflicts with another file.")
        if target.exists() and not overwrite: raise RecipeError("Generated metadata already exists; choose a new directory or explicitly enable overwrite.")
    return {"recipe":recipe,"output_directory":directory,"sources":sources,"outputs":outputs,"overwrite":overwrite,"metadata_names":metadata_names}


def crop_filter(crop) -> list[str]:
    return [f"crop={crop['width']}:{crop['height']}:{crop['x']}:{crop['y']}:exact=1"] if crop else []


def fit_filter(width,height,fit,*,transparent=False,even=False) -> list[str]:
    divisible=":force_divisible_by=2" if even else ""
    if fit=="cover": return [f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos{divisible}",f"crop={width}:{height}:exact=1","setsar=1"]
    color="0x00000000" if transparent else "black"
    return [f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos{divisible}",*( ["format=rgba"] if transparent else []),f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color={color}","setsar=1"]


def frame_times(source: dict) -> list[float]:
    cache=CACHE/"frame-times"/(source["sha256"]+".json")
    if cache.is_file(): return json.loads(cache.read_text(encoding="utf-8"))
    raw=json.loads(command([FFPROBE,"-v","error","-select_streams","v:0","-show_frames","-show_entries","frame=best_effort_timestamp_time","-of","json",source["path"]]).stdout)
    times=[float(f["best_effort_timestamp_time"]) for f in raw.get("frames",[]) if "best_effort_timestamp_time" in f]
    if not times: raise RecipeError("Cannot read source frame timestamps.")
    offset=times[0];times=[t-offset for t in times]
    write_json(cache,times)
    return times


def build_atlas(item,source,target,temp) -> dict:
    times=frame_times(source);start,end=item["start_seconds"],item["end_seconds"]
    if "sample_frame_indices" in item:
        selected=item["sample_frame_indices"][:item["frame_count"]]
        if any(i>=len(times) or times[i]<start-1e-5 or times[i]>=end+1e-5 for i in selected): raise RecipeError("Atlas sample frame lies outside the selected source/time range.")
    else:
        selected=[]
        for k in range(item["frame_count"]):
            wanted=start+k/item["fps"]
            if wanted>=end-1e-7: break
            index=bisect.bisect_left(times,wanted-1e-7)
            if index>=len(times) or times[index]>=end+1e-7: break
            selected.append(index)
    if not selected: raise RecipeError("Selected atlas range contains no video frames.")
    unique=sorted(set(selected));select="+".join(f"eq(n\\,{i})" for i in unique)
    temp.mkdir(parents=True,exist_ok=True)
    filters=["select="+select,*crop_filter(item["crop"]),*fit_filter(item["tile_width"],item["tile_height"],item["fit"],transparent=True)]
    ffmpeg("-i",source["path"],"-map","0:v:0","-vf",",".join(filters),"-fps_mode","vfr","-frames:v",len(unique),temp/"frame-%05d.png")
    frames={index:temp/f"frame-{position:05d}.png" for position,index in enumerate(unique,1)}
    if not all(path.is_file() for path in frames.values()): raise RuntimeError("FFmpeg did not produce the expected atlas frames.")
    sheet=Image.new("RGBA",(item["columns"]*item["tile_width"],item["rows"]*item["tile_height"]),(0,0,0,0))
    for position,index in enumerate(selected):
        with Image.open(frames[index]) as image: frame=image.convert("RGBA")
        sheet.paste(frame,((position%item["columns"])*item["tile_width"],(position//item["columns"])*item["tile_height"]))
    if target.suffix.lower()==".png": sheet.save(target,"PNG")
    else: sheet.save(target,"WEBP",quality=item["quality"],method=item["method"])
    with Image.open(target) as decoded:
        decoded=decoded.convert("RGBA")
        assert decoded.size==sheet.size
        for index in range(len(selected),item["columns"]*item["rows"]):
            box=(index%item["columns"]*item["tile_width"],index//item["columns"]*item["tile_height"],(index%item["columns"]+1)*item["tile_width"],(index//item["columns"]+1)*item["tile_height"])
            if decoded.crop(box).getextrema()[3]!=(0,0): raise RuntimeError("Unused atlas cells are not transparent.")
    return {"id":Path(item["file"]).stem,"symbol_tier":item.get("symbol_tier","small"),"file":item["file"],"source_id":item["source_id"],"source_filename":source["filename"],"source_sha256":source["sha256"],"source_start":start,"source_end":end,"source_duration":end-start,"loop_duration":end-start,"source_original_duration":source["duration"],"source_fps":source["fps"],"fps":item["fps"],"frame_count":len(selected),"columns":item["columns"],"rows":item["rows"],"tile":item["tile_width"],"tile_width":item["tile_width"],"tile_height":item["tile_height"],"width":sheet.width,"height":sheet.height,"crop":item["crop"],"fit":item["fit"],"source_frame_indices":selected}


def encode_output(item,source,target,temp) -> dict | None:
    target.parent.mkdir(parents=True,exist_ok=True)
    kind=item["type"]
    if kind=="atlas": return build_atlas(item,source,target,temp)
    if kind=="poster":
        filters=crop_filter(item["crop"])
        if item["explicit_size"]: filters+=fit_filter(item["width"],item["height"],item["fit"],transparent=True)
        else: filters += [f"scale={item['max_width']}:{item['max_height']}:force_original_aspect_ratio=decrease:flags=lanczos","setsar=1"]
        codec=["-c:v","libwebp","-quality",item["quality"]] if target.suffix.lower()==".webp" else ["-c:v","png"]
        ffmpeg("-ss",item["at_seconds"],"-i",source["path"],"-frames:v","1","-vf",",".join(filters),*codec,target)
        return None
    filters=[*crop_filter(item["crop"]),*fit_filter(item["width"],item["height"],item["fit"],even=True),f"fps={item['fps']}"]
    audio=[]
    trimmed=item["start_seconds"]>0 or item["end_seconds"]<source["duration"]-1e-5
    if source["has_audio"] and item.get("audio","copy_if_present")!="none":
        audio=["-map","0:a?"]
        audio += ["-c:a","copy"] if not trimmed and source["audio_codec"]=="aac" and item.get("audio","copy_if_present")=="copy_if_present" else ["-c:a","aac","-b:a","128k"]
    ffmpeg("-ss",item["start_seconds"],"-i",source["path"],"-t",item["duration_seconds"],"-map","0:v:0",*audio,"-vf",",".join(filters),"-c:v","libx264","-threads","2","-preset",item["preset"],"-crf",item["crf"],"-pix_fmt","yuv420p","-movflags","+faststart",target)
    encoded=probe_media(target)
    if encoded["codec"]!="h264" or (encoded["width"],encoded["height"])!=(item["width"],item["height"]): raise RuntimeError("Encoded video dimensions/codec mismatch.")
    if abs(encoded["duration"]-item["duration_seconds"])>max(.12,2/item["fps"]): raise RuntimeError("Encoded video duration mismatch.")
    return None


def build_recipe(plan: dict, progress=lambda value,message: None) -> dict:
    directory=plan["output_directory"];directory.mkdir(parents=True,exist_ok=True)
    lock=directory/".media-tool.lock"
    try: descriptor=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    except FileExistsError as error: raise RecipeError("This output directory is already being built; choose another directory.") from error
    os.write(descriptor,str(os.getpid()).encode());os.close(descriptor)
    token=uuid.uuid4().hex;temporary=CACHE/"jobs"/token
    outputs=[];atlas_sources=[];source_records=[]
    try:
        for ident,source in plan["sources"].items():
            record={"id":ident,"original_filename":source["filename"],"source_path":source["path"],"sha256":source["sha256"],"media":{k:v for k,v in source.items() if k not in {"source_id","path","filename","sha256"}}}
            if plan["recipe"].get("preserve_originals",True):
                relative=f"sources/{ident}-original{Path(source['filename']).suffix.lower()}";copy=destination(directory,relative);copy.parent.mkdir(parents=True,exist_ok=True)
                if copy.exists() and digest(copy)!=source["sha256"] and not plan["overwrite"]: raise RecipeError("Preserved source copy already exists with different contents.")
                if not copy.exists() or digest(copy)!=source["sha256"]: shutil.copy2(source["path"],copy)
                if digest(copy)!=source["sha256"]: raise RuntimeError("Preserved original SHA256 mismatch.")
                record["copy"]=relative
            source_records.append(record)
        total=len(plan["outputs"])
        for index,item in enumerate(plan["outputs"]):
            progress(index/(total+1),"Generating "+item["file"])
            target=destination(directory,item["file"])
            staging=temporary/"outputs"/item["file"];staging.parent.mkdir(parents=True,exist_ok=True)
            source=plan["sources"][item["source_id"]]
            atlas=encode_output(item,source,staging,temporary/"frames"/str(index))
            if item["type"]=="video": ffmpeg("-i",staging,"-map","0:v:0","-map","0:a?","-f","null","-")
            target.parent.mkdir(parents=True,exist_ok=True);publish_file(staging,target)
            record={"file":item["file"],"type":item["type"],"source_id":item["source_id"],"sha256":digest(target),"bytes":target.stat().st_size,"path":str(target),"crop":item["crop"],"fit":item["fit"]}
            if item["type"]=="video": record["media"]=probe_media(target)
            elif item["type"]=="poster":
                with Image.open(target) as image: record["media"]={"width":image.width,"height":image.height}
                record["source_time"]=item["at_seconds"]
            if atlas: atlas["sha256"]=record["sha256"];atlas_sources.append(atlas);record["sprite_metadata"]="field-sprites.json";record["media"]={"width":atlas["width"],"height":atlas["height"],"frame_count":atlas["frame_count"]}
            outputs.append(record)
        recipe=plan["recipe"];created=datetime.now(timezone.utc).isoformat()
        source_manifest={"character":recipe.get("character_name",recipe.get("character_id","")),"character_id":recipe.get("character_id",""),"originals_preserved":recipe.get("preserve_originals",True),"clips":source_records,"created_at":created}
        write_json(directory/"source-manifest.json",source_manifest)
        write_json(directory/"recipe.snapshot.json",recipe)
        runtime={"character":source_manifest["character"],"character_id":source_manifest["character_id"],"source_manifest":"source-manifest.json","recipe":"recipe.snapshot.json","created_at":created,"cropped":any(o["crop"] or o["fit"]=="cover" for o in plan["outputs"]),"background_removed":False,"outputs":outputs}
        if atlas_sources:
            first=atlas_sources[0]
            for atlas in atlas_sources:
                preferred=str(PurePosixPath(atlas["file"]).with_suffix(""))+"-poster"
                poster=next((o["file"] for o in outputs if o["type"]=="poster" and str(PurePosixPath(o["file"]).with_suffix(""))==preferred),None)
                if poster is None:poster=next((o["file"] for o in outputs if o["type"]=="poster" and o["source_id"]==atlas["source_id"]),"")
                atlas["poster"]=poster
            field_meta={"character":source_manifest["character"],"character_id":source_manifest["character_id"],"field_mode":recipe.get("field_metadata",{}).get("field_mode","custom"),"fps":first["fps"],"frame_count":first["frame_count"],"columns":first["columns"],"rows":first["rows"],"tile":first["tile"],"tile_width":first["tile_width"],"tile_height":first["tile_height"],"width":first["width"],"height":first["height"],"order":"row-major","cropped":runtime["cropped"],"background_removed":False,"sources":atlas_sources}
            write_json(directory/"field-sprites.json",field_meta);runtime["field_atlases"]="field-sprites.json"
        write_json(directory/"runtime-manifest.json",runtime)
        result_outputs=[*outputs,*({"file":name,"type":"metadata","path":str(directory/name),"bytes":(directory/name).stat().st_size} for name in plan["metadata_names"])]
        progress(1,"Complete")
        return {"ok":True,"output_directory":str(directory),"outputs":result_outputs,"source_count":len(source_records),"media_count":len(outputs),"atlas_count":len(atlas_sources)}
    finally:
        # Only this exact lock file is removed; sources and partial outputs stay.
        if lock.is_file(): lock.unlink()


class Workbench:
    def __init__(self):
        self.lock=threading.RLock();self.sources={};self.authorized=set();self.jobs={};self.tasks=queue.Queue();self.proxy_locks={}
        threading.Thread(target=self.worker,daemon=True).start()

    def register(self,path: Path) -> dict:
        source=probe_media(path)
        with self.lock:
            self.authorized.add(str(Path(source["path"]).resolve()).casefold())
            gate=self.proxy_locks.setdefault(source["sha256"],threading.Lock())
        proxy=CACHE/"previews"/(source["sha256"]+"-720-v1.mp4")
        with gate:
            if not proxy.is_file():
                proxy.parent.mkdir(parents=True,exist_ok=True);temporary=proxy.with_name(uuid.uuid4().hex+".mp4")
                audio=["-map","0:a?","-c:a","copy"] if source["has_audio"] and source["audio_codec"]=="aac" else (["-map","0:a?","-c:a","aac","-b:a","128k"] if source["has_audio"] else [])
                ffmpeg("-i",source["path"],"-map","0:v:0",*audio,"-vf","scale=720:720:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1","-c:v","libx264","-threads","2","-preset","veryfast","-crf","24","-pix_fmt","yuv420p","-movflags","+faststart",temporary)
                temporary.replace(proxy)
        source["preview_url"]="/api/previews/"+source["source_id"]+".mp4"
        with self.lock: self.sources[source["source_id"]]={**source,"preview_path":str(proxy)}
        return source

    def example(self):
        recipe=json.loads((WORKSPACE/"assets/media/yeseul/recipe.json").read_text(encoding="utf-8"))
        directory=Path(recipe.get("source_directory") or WORKSPACE)
        with self.lock:
            for source in recipe["sources"]:
                path=Path(source["file"])
                if not path.is_absolute(): path=directory/path
                self.authorized.add(str(path.resolve()).casefold())
        return recipe

    def plan(self,payload):
        with self.lock: authorized=set(self.authorized)
        return validate_recipe(payload.get("recipe"),payload.get("output_directory"),http=True,overwrite=payload.get("overwrite") is True,authorized_sources=authorized)

    def enqueue(self,plan):
        directory=str(plan["output_directory"]).casefold()
        with self.lock:
            if any(j["status"] in {"queued","running"} and j["output_directory"].casefold()==directory for j in self.jobs.values()): raise RecipeError("An active job already owns this output directory.")
            ident=uuid.uuid4().hex
            self.jobs[ident]={"job_id":ident,"status":"queued","progress":0,"log":["Queued"],"outputs":[],"output_directory":str(plan["output_directory"]),"error":None}
            self.tasks.put((ident,plan))
        return ident

    def worker(self):
        while True:
            ident,plan=self.tasks.get()
            with self.lock: self.jobs[ident]["status"]="running"
            def progress(value,message):
                with self.lock:
                    job=self.jobs[ident];job["progress"]=value;job["log"].append(message)
            try:
                result=build_recipe(plan,progress)
                with self.lock:
                    job=self.jobs[ident];job["status"]="complete";job["outputs"]=result["outputs"]
                    for entry in job["outputs"]: entry["url"]="/api/file?"+urlencode({"job_id":ident,"file":entry["file"]})
            except Exception as error:
                with self.lock: self.jobs[ident].update(status="error",error=str(error));self.jobs[ident]["log"].append(str(error))
            finally: self.tasks.task_done()


def serve(host: str,port: int):
    state=Workbench()
    class Handler(http.server.BaseHTTPRequestHandler):
        server_version="HotChickMediaTool/1"
        def json_response(self,data,status=200):
            body=json.dumps(data,ensure_ascii=False).encode("utf-8")
            self.send_response(status);self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Content-Length",str(len(body)));self.send_header("Cache-Control","no-store");self.send_header("X-Content-Type-Options","nosniff");self.end_headers()
            if self.command!="HEAD": self.wfile.write(body)
        def check_origin(self):
            host_header=self.headers.get("Host","")
            parsed=urlsplit("http://"+host_header)
            allowed={"127.0.0.1","localhost","::1",host}
            if parsed.hostname not in allowed or parsed.port not in {None,self.server.server_port}: raise RecipeError("Host is not allowed.")
            origin=self.headers.get("Origin")
            if origin:
                supplied=urlsplit(origin)
                if supplied.scheme!="http" or supplied.netloc.lower()!=host_header.lower(): raise RecipeError("Cross-origin requests are not allowed.")
        def read_json(self):
            if self.headers.get("Content-Type","").split(";")[0].strip().lower()!="application/json": raise RecipeError("JSON content type is required.")
            length=int(self.headers.get("Content-Length",0))
            if not 0<length<=MAX_JSON: raise RecipeError("JSON request is empty or too large.")
            result=json.loads(self.rfile.read(length))
            if not isinstance(result,dict): raise RecipeError("JSON request must be an object.")
            return result
        def send_file(self,path: Path):
            size=path.stat().st_size;start=0;end=size-1;status=200
            supplied=self.headers.get("Range")
            if supplied:
                match=re.fullmatch(r"bytes=(\d*)-(\d*)",supplied.strip())
                if not match or (not match[1] and not match[2]): self.send_error(416);return
                if match[1]: start=int(match[1]);end=int(match[2]) if match[2] else end
                else: start=max(0,size-int(match[2]));end=size-1
                if start>=size or start>end: self.send_response(416);self.send_header("Content-Range",f"bytes */{size}");self.end_headers();return
                end=min(end,size-1);status=206
            mime=mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            if path.suffix==".js": mime="text/javascript"
            self.send_response(status);self.send_header("Content-Type",mime);self.send_header("Content-Length",str(end-start+1));self.send_header("Accept-Ranges","bytes");self.send_header("Cache-Control","no-store");self.send_header("X-Content-Type-Options","nosniff")
            if status==206:self.send_header("Content-Range",f"bytes {start}-{end}/{size}")
            self.end_headers()
            if self.command=="HEAD":return
            with path.open("rb") as stream:
                stream.seek(start);remaining=end-start+1
                while remaining:
                    chunk=stream.read(min(65536,remaining))
                    if not chunk:break
                    self.wfile.write(chunk);remaining-=len(chunk)
        def do_HEAD(self): self.do_GET()
        def do_GET(self):
            try:
                self.check_origin();parsed=urlsplit(self.path);path=parsed.path
                if path=="/api/info":return self.json_response({"workspace":str(WORKSPACE),"default_output_root":str(GENERATED),"ffmpeg_ready":FFMPEG.is_file() and FFPROBE.is_file(),"max_upload_bytes":MAX_UPLOAD,"schema":SCHEMA})
                if path=="/api/recipe/yeseul":return self.json_response(state.example())
                if path.startswith("/api/jobs/"):
                    ident=path.rsplit("/",1)[-1]
                    with state.lock:job=json.loads(json.dumps(state.jobs.get(ident)))
                    if job is None: return self.json_response({"error":"Unknown job"},404)
                    return self.json_response(job)
                if path.startswith("/api/previews/"):
                    ident=Path(path).stem
                    with state.lock:source=state.sources.get(ident)
                    if not source:return self.json_response({"error":"Unknown preview"},404)
                    return self.send_file(Path(source["preview_path"]))
                if path=="/api/file":
                    query=parse_qs(parsed.query);ident=query.get("job_id",[""])[0];relative=query.get("file",[""])[0]
                    with state.lock:job=state.jobs.get(ident);entry=next((x for x in job["outputs"] if x["file"]==relative),None) if job else None
                    if entry is None:return self.json_response({"error":"Unknown generated file"},404)
                    return self.send_file(destination(Path(job["output_directory"]),relative))
                relative="index.html" if path=="/" else path.lstrip("/")
                relative=safe_relative(relative,{".html",".js",".css",".svg",".png",".webp",".ico"});file=destination(TOOL_DIR,relative)
                if not file.is_file():return self.json_response({"error":"Not found"},404)
                return self.send_file(file)
            except (RecipeError,ValueError,json.JSONDecodeError) as error:self.json_response({"error":str(error)},400)
            except (BrokenPipeError,ConnectionResetError):pass
            except Exception as error:self.json_response({"error":str(error)},500)
        def do_POST(self):
            try:
                self.check_origin();parsed=urlsplit(self.path)
                if parsed.path=="/api/upload":
                    name=parse_qs(parsed.query).get("filename",[""])[0];name=safe_relative(name,VIDEO_EXTENSIONS)
                    if "/" in name:raise RecipeError("Upload filename cannot contain a directory.")
                    length=int(self.headers.get("Content-Length",0))
                    if not 0<length<=MAX_UPLOAD:raise RecipeError("Upload must be between 1 byte and 512 MiB.")
                    target=CACHE/"uploads"/(uuid.uuid4().hex+"-"+name);target.parent.mkdir(parents=True,exist_ok=True)
                    with target.open("xb") as stream:
                        remaining=length
                        while remaining:
                            chunk=self.rfile.read(min(65536,remaining))
                            if not chunk:raise RecipeError("Upload ended before its declared length.")
                            stream.write(chunk);remaining-=len(chunk)
                    return self.json_response(state.register(target))
                payload=self.read_json()
                if parsed.path=="/api/probe":
                    if not isinstance(payload.get("path"),str):raise RecipeError("probe requires a path.")
                    return self.json_response(state.register(Path(payload["path"])))
                if parsed.path=="/api/validate":
                    try:plan=state.plan(payload)
                    except RecipeError as error:return self.json_response({"ok":False,"errors":error.errors})
                    return self.json_response({"ok":True,"errors":[],"output_directory":str(plan["output_directory"]),"output_count":len(plan["outputs"])})
                if parsed.path=="/api/build":return self.json_response({"job_id":state.enqueue(state.plan(payload))},202)
                return self.json_response({"error":"Unknown endpoint"},404)
            except (RecipeError,ValueError,json.JSONDecodeError) as error:self.json_response({"error":str(error),"errors":getattr(error,"errors",[str(error)])},400)
            except (BrokenPipeError,ConnectionResetError):pass
            except Exception as error:self.json_response({"error":str(error)},500)
        def do_OPTIONS(self): self.json_response({"error":"Cross-origin requests are not allowed"},403)
        def log_message(self,fmt,*args):
            if self.command=="POST": print(fmt%args,flush=True)
    server=http.server.ThreadingHTTPServer((host,port),Handler)
    print(f"Media workbench: http://{host}:{port}/",flush=True)
    server.serve_forever()


def main(argv=None) -> int:
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    commands=parser.add_subparsers(dest="command",required=True)
    web=commands.add_parser("serve",help="Run the local browser workbench");web.add_argument("--host",default="127.0.0.1");web.add_argument("--port",type=int,default=8242)
    for name in ("build","validate"):
        item=commands.add_parser(name,help=("Generate media from a reusable recipe" if name=="build" else "Validate a reusable recipe without writing media"));item.add_argument("--recipe",required=True,type=Path);item.add_argument("--output-dir");item.add_argument("--overwrite",action="store_true");item.add_argument("--json",action="store_true")
    args=parser.parse_args(argv)
    try:
        if args.command=="serve":serve(args.host,args.port);return 0
        recipe=json.loads(args.recipe.read_text(encoding="utf-8-sig"));plan=validate_recipe(recipe,args.output_dir,overwrite=args.overwrite)
        if args.command=="validate":result={"ok":True,"output_directory":str(plan["output_directory"]),"source_count":len(plan["sources"]),"output_count":len(plan["outputs"])}
        else:
            def progress(value,message):print(f"{value:.0%} {message}",file=sys.stderr if args.json else sys.stdout,flush=True)
            result=build_recipe(plan,progress)
        print(json.dumps(result,ensure_ascii=False));return 0
    except Exception as error:
        print(json.dumps({"ok":False,"error":str(error),"errors":getattr(error,"errors",[str(error)])},ensure_ascii=False),file=sys.stderr);return 1


if __name__=="__main__":raise SystemExit(main())
