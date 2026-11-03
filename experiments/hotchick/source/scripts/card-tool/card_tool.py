"""Reusable 2:3 card crop workbench (600x900 WebP).

  python scripts/card-tool/card_tool.py serve --host 127.0.0.1 --port 8243
  python scripts/card-tool/card_tool.py validate --recipe assets/cards/recipe.json
  python scripts/card-tool/card_tool.py build --recipe recipe.json --output-dir assets/generated/cards-example --json
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
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
import threading
from urllib.parse import parse_qs, urlencode, urlsplit
import uuid
import warnings
import zipfile

from PIL import Image, ImageOps

WORKSPACE=Path(__file__).resolve().parents[2]
TOOL_DIR=Path(__file__).resolve().parent
CACHE=WORKSPACE/".cache/card-tool"
GENERATED=WORKSPACE/"assets/generated"
SCHEMA="hotchick.cards.recipe.v1"
WIDTH,HEIGHT,QUALITY=600,900,92
MAX_UPLOAD=64*1024*1024
IMAGE_EXTENSIONS={".png",".jpg",".jpeg",".webp"}
IDENTIFIER=re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,95}$")
RESERVED={"CON","PRN","AUX","NUL",*(f"COM{i}" for i in range(1,10)),*(f"LPT{i}" for i in range(1,10))}
Image.MAX_IMAGE_PIXELS=40_000_000


class CardError(ValueError):
    def __init__(self,errors):
        self.errors=errors if isinstance(errors,list) else [str(errors)]
        super().__init__("; ".join(self.errors))


def inside(path: Path,root: Path) -> bool:
    try:path.resolve().relative_to(root.resolve());return True
    except ValueError:return False


def sha256(path: Path) -> str:
    with path.open("rb") as stream:return hashlib.file_digest(stream,"sha256").hexdigest()


def write_json(path: Path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name("."+uuid.uuid4().hex+"-"+path.name)
    temporary.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    temporary.replace(path)


def safe_relative(value,extensions=None):
    if not isinstance(value,str) or not value:raise CardError("A safe relative filename is required.")
    value=value.replace("\\","/")
    if value.startswith("/") or any(c in '<>:"|?*' or ord(c)<32 for c in value):raise CardError("Unsafe filename.")
    parts=value.split("/")
    if any(p in {"",".",".."} or p.endswith((" ",".")) or p.split(".")[0].upper() in RESERVED for p in parts):raise CardError("Output traversal or reserved filename is not allowed.")
    if extensions and PurePosixPath(value).suffix.lower() not in extensions:raise CardError("Unsupported file extension.")
    return value


def destination(directory: Path,relative: str):
    result=(directory/safe_relative(relative)).resolve()
    if not inside(result,directory):raise CardError("Output path escapes its directory.")
    return result


def finite(value,label,minimum=0):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<minimum:raise CardError(label+" must be a finite number in range.")
    return float(value)


def load_image(path: Path):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error",Image.DecompressionBombWarning)
            with Image.open(path) as image:
                if getattr(image,"is_animated",False):raise CardError("Choose a static PNG, JPEG or WebP image.")
                image.load();result=ImageOps.exif_transpose(image)
                return result.convert("RGBA" if "A" in result.getbands() else "RGB")
    except CardError:raise
    except Exception as error:raise CardError("Cannot decode this image: "+str(error)) from error


def probe_image(path: Path):
    path=path.expanduser().resolve()
    if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:raise CardError("Choose an existing PNG, JPEG or WebP file.")
    if path.stat().st_size>MAX_UPLOAD:raise CardError("Images may not exceed 64 MiB.")
    image=load_image(path);digest=sha256(path)
    return {"source_id":"img-"+digest[:20],"path":str(path),"filename":path.name,"sha256":digest,"width":image.width,"height":image.height,"bytes":path.stat().st_size}


def validate_recipe(recipe,output_directory=None,*,http=False,overwrite=False,authorized=None):
    if not isinstance(recipe,dict) or recipe.get("schema")!=SCHEMA:raise CardError("Expected recipe schema "+SCHEMA)
    raw_directory=output_directory or recipe.get("output_directory")
    if not isinstance(raw_directory,str) or not raw_directory.strip():raise CardError("Choose an output directory.")
    directory=Path(raw_directory).expanduser()
    if not directory.is_absolute():directory=WORKSPACE/directory
    directory=directory.resolve()
    if http and not any(inside(directory,root) for root in (GENERATED,WORKSPACE/".cache")):raise CardError("Browser output must stay inside assets/generated or .cache.")
    if not http and output_directory is None and not inside(directory,WORKSPACE):raise CardError("Recipe output must stay in the workspace; use explicit --output-dir for another directory.")
    if directory.exists() and not directory.is_dir():raise CardError("Output directory points to a file.")
    items=recipe.get("sources")
    if not isinstance(items,list) or not 1<=len(items)<=200:raise CardError("Choose 1 to 200 source images.")
    sources={}
    for item in items:
        if not isinstance(item,dict) or not IDENTIFIER.fullmatch(str(item.get("id",""))):raise CardError("Source ids must be ASCII identifiers.")
        ident=item["id"]
        if ident in sources:raise CardError("Duplicate source id: "+ident)
        raw=item.get("path")
        if not isinstance(raw,str):raise CardError("Every source needs a path.")
        path=Path(raw).expanduser()
        if not path.is_absolute():path=WORKSPACE/path
        path=path.resolve()
        if http and authorized is not None and str(path).casefold() not in authorized:raise CardError("Probe or upload each image before building.")
        source=probe_image(path)
        expected=item.get("sha256")
        if expected is not None and (not isinstance(expected,str) or expected.lower()!=source["sha256"]):raise CardError("Source SHA256 changed: "+source["filename"])
        sources[ident]=source
    raw_outputs=recipe.get("outputs")
    if not isinstance(raw_outputs,list) or not 1<=len(raw_outputs)<=300:raise CardError("Queue 1 to 300 cards.")
    outputs=[];ids=set();paths=set();source_paths={str(Path(s["path"]).resolve()).casefold() for s in sources.values()}
    for raw in raw_outputs:
        if not isinstance(raw,dict) or not IDENTIFIER.fullmatch(str(raw.get("id",""))):raise CardError("Card ids must be ASCII identifiers.")
        ident=raw["id"]
        if ident in ids:raise CardError("Duplicate card id: "+ident)
        ids.add(ident)
        source=sources.get(raw.get("source")) if isinstance(raw.get("source"),str) else None
        if source is None:raise CardError("Card refers to an unknown source.")
        if raw.get("width",WIDTH)!=WIDTH or raw.get("height",HEIGHT)!=HEIGHT:raise CardError("All cards must be the same 600 x 900 size.")
        quality=finite(raw.get("quality",QUALITY),"quality",1)
        if quality>100 or int(quality)!=quality:raise CardError("WebP quality must be an integer from 1 to 100.")
        crop=raw.get("crop")
        if not isinstance(crop,dict):raise CardError("Every card requires a crop rectangle.")
        crop={key:finite(crop.get(key),"crop."+key,0 if key in {"x","y"} else .000001) for key in ("x","y","width","height")}
        if abs(crop["width"]/crop["height"]-2/3)>1e-6:raise CardError("Crop selection must keep a 2:3 ratio.")
        if crop["x"]+crop["width"]>source["width"]+1e-6 or crop["y"]+crop["height"]>source["height"]+1e-6:raise CardError("Crop selection extends outside the source image.")
        crop["width"]=min(crop["width"],source["width"]-crop["x"]);crop["height"]=min(crop["height"],source["height"]-crop["y"])
        filename=safe_relative(raw.get("filename",ident+".webp"),{".webp"});target=destination(directory,filename);folded=str(target).casefold()
        if folded in source_paths:raise CardError("A card cannot overwrite its source image.")
        if folded in paths:raise CardError("Duplicate output filename.")
        paths.add(folded)
        if target.exists() and not overwrite:raise CardError("Output already exists; choose a new directory or explicitly enable overwrite: "+filename)
        outputs.append({"id":ident,"source":raw["source"],"filename":filename,"width":WIDTH,"height":HEIGHT,"quality":int(quality),"crop":crop})
    for filename in ("cards-manifest.json","source-manifest.json","recipe.snapshot.json"):
        target=destination(directory,filename)
        if str(target).casefold() in paths or str(target).casefold() in source_paths:raise CardError("Metadata path conflicts with another file.")
        if target.exists() and not overwrite:raise CardError("Generated metadata exists; explicitly enable overwrite or choose a new directory.")
    return {"recipe":recipe,"directory":directory,"sources":sources,"outputs":outputs,"overwrite":overwrite}


def build_recipe(plan,progress=lambda value,message:None):
    directory=plan["directory"];directory.mkdir(parents=True,exist_ok=True);lock=directory/".card-tool.lock"
    try:fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    except FileExistsError as error:raise CardError("Another build owns this output directory.") from error
    os.write(fd,str(os.getpid()).encode());os.close(fd)
    try:
        source_records=[]
        for ident,source in plan["sources"].items():
            record={"id":ident,**source}
            if plan["recipe"].get("preserve_originals",True):
                relative="sources/"+ident+"-original"+Path(source["filename"]).suffix.lower();copy=destination(directory,relative);copy.parent.mkdir(parents=True,exist_ok=True)
                if copy.exists() and sha256(copy)!=source["sha256"] and not plan["overwrite"]:raise CardError("Preserved original exists with different contents.")
                if not copy.exists() or sha256(copy)!=source["sha256"]:shutil.copy2(source["path"],copy)
                if sha256(copy)!=source["sha256"]:raise RuntimeError("Source copy hash mismatch.")
                record["copy"]=relative
            source_records.append(record)
        outputs=[];last_source=None;image=None
        for index,item in enumerate(plan["outputs"]):
            progress(index/(len(plan["outputs"])+1),"裁切 "+item["filename"])
            if item["source"]!=last_source:
                if image is not None:image.close()
                image=load_image(Path(plan["sources"][item["source"]]["path"]));last_source=item["source"]
            crop=item["crop"];box=(crop["x"],crop["y"],crop["x"]+crop["width"],crop["y"]+crop["height"])
            result=image.resize((WIDTH,HEIGHT),Image.Resampling.LANCZOS,box=box)
            path=destination(directory,item["filename"]);path.parent.mkdir(parents=True,exist_ok=True);temporary=path.with_name("."+uuid.uuid4().hex+".webp")
            result.save(temporary,"WEBP",quality=item["quality"],method=6)
            with Image.open(temporary) as decoded:
                decoded.load()
                if decoded.size!=(WIDTH,HEIGHT):raise RuntimeError("Card dimensions do not match the uniform size.")
            temporary.replace(path)
            outputs.append({**item,"file":item["filename"],"path":str(path),"sha256":sha256(path),"bytes":path.stat().st_size,"type":"card"})
        created=datetime.now(timezone.utc).isoformat()
        write_json(directory/"source-manifest.json",{"schema":SCHEMA,"created_at":created,"preserved_originals":plan["recipe"].get("preserve_originals",True),"sources":source_records})
        write_json(directory/"recipe.snapshot.json",plan["recipe"])
        write_json(directory/"cards-manifest.json",{"schema":SCHEMA,"created_at":created,"width":WIDTH,"height":HEIGHT,"format":"webp","outputs":outputs})
        published=[*outputs,*({"file":name,"path":str(directory/name),"type":"metadata","bytes":(directory/name).stat().st_size} for name in ("cards-manifest.json","source-manifest.json","recipe.snapshot.json"))]
        progress(1,"完成")
        return {"ok":True,"output_directory":str(directory),"cards":len(outputs),"sources":len(source_records),"outputs":published}
    finally:
        if 'image' in locals() and image is not None:image.close()
        if lock.is_file():lock.unlink()


class Workbench:
    def __init__(self):
        self.lock=threading.RLock();self.authorized=set();self.images={};self.jobs={};self.tasks=queue.Queue()
        threading.Thread(target=self.worker,daemon=True).start()
    def register(self,path):
        source=probe_image(path);preview=CACHE/"previews"/(source["sha256"]+"-v1.png")
        if not preview.is_file():
            image=load_image(Path(source["path"]));image.thumbnail((1600,1600),Image.Resampling.LANCZOS);preview.parent.mkdir(parents=True,exist_ok=True);temporary=preview.with_name(uuid.uuid4().hex+".png");image.save(temporary,"PNG");temporary.replace(preview)
        source["preview_url"]="/api/preview/"+source["source_id"]+".png"
        with self.lock:self.authorized.add(str(Path(source["path"]).resolve()).casefold());self.images[source["source_id"]]={**source,"preview_path":str(preview)}
        return source
    def plan(self,payload):
        with self.lock:authorized=set(self.authorized)
        return validate_recipe(payload.get("recipe"),payload.get("output_directory"),http=True,overwrite=payload.get("overwrite") is True,authorized=authorized)
    def enqueue(self,plan):
        target=str(plan["directory"]).casefold()
        with self.lock:
            if any(j["status"] in {"queued","running"} and j["output_directory"].casefold()==target for j in self.jobs.values()):raise CardError("This output directory already has an active job.")
            ident=uuid.uuid4().hex;self.jobs[ident]={"job_id":ident,"status":"queued","progress":0,"log":["已排入"],"outputs":[],"output_directory":str(plan["directory"]),"error":None};self.tasks.put((ident,plan));return ident
    def worker(self):
        while True:
            ident,plan=self.tasks.get()
            with self.lock:self.jobs[ident]["status"]="running"
            def progress(value,message):
                with self.lock:self.jobs[ident]["progress"]=value;self.jobs[ident]["log"].append(message)
            try:
                result=build_recipe(plan,progress)
                with self.lock:
                    job=self.jobs[ident];job.update(status="complete",outputs=result["outputs"])
                    for item in job["outputs"]:item["url"]="/api/file?"+urlencode({"job_id":ident,"file":item["file"]})
            except Exception as error:
                with self.lock:self.jobs[ident].update(status="error",error=str(error));self.jobs[ident]["log"].append(str(error))
            finally:self.tasks.task_done()


def serve(host,port):
    state=Workbench()
    class Handler(http.server.BaseHTTPRequestHandler):
        server_version="HotChickCards/1"
        def respond(self,data,status=200):
            body=json.dumps(data,ensure_ascii=False).encode("utf-8");self.send_response(status);self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Content-Length",str(len(body)));self.send_header("Cache-Control","no-store");self.send_header("X-Content-Type-Options","nosniff");self.end_headers()
            if self.command!="HEAD":self.wfile.write(body)
        def origin(self):
            host_header=self.headers.get("Host","");parsed=urlsplit("http://"+host_header)
            if parsed.hostname not in {"127.0.0.1","localhost","::1",host} or parsed.port not in {None,self.server.server_port}:raise CardError("Host is not allowed.")
            supplied=self.headers.get("Origin")
            if supplied:
                origin=urlsplit(supplied)
                if origin.scheme!="http" or origin.netloc.lower()!=host_header.lower():raise CardError("Cross-origin requests are not allowed.")
        def read_json(self):
            if self.headers.get("Content-Type","").split(";")[0].lower().strip()!="application/json":raise CardError("JSON content type is required.")
            length=int(self.headers.get("Content-Length",0))
            if not 0<length<=4*1024*1024:raise CardError("JSON request is empty or too large.")
            value=json.loads(self.rfile.read(length))
            if not isinstance(value,dict):raise CardError("JSON request must be an object.")
            return value
        def send_file(self,path):
            size=path.stat().st_size;start,end,status=0,size-1,200;request=self.headers.get("Range")
            if request:
                match=re.fullmatch(r"bytes=(\d*)-(\d*)",request)
                if not match or not any(match.groups()):self.send_error(416);return
                if match[1]:start=int(match[1]);end=int(match[2]) if match[2] else end
                else:start=max(0,size-int(match[2]));end=size-1
                if start>=size or start>end:self.send_response(416);self.send_header("Content-Range",f"bytes */{size}");self.end_headers();return
                end=min(end,size-1);status=206
            self.send_response(status);self.send_header("Content-Type",mimetypes.guess_type(path.name)[0] or "application/octet-stream");self.send_header("Content-Length",str(end-start+1));self.send_header("Accept-Ranges","bytes");self.send_header("Cache-Control","no-store");self.send_header("X-Content-Type-Options","nosniff")
            if status==206:self.send_header("Content-Range",f"bytes {start}-{end}/{size}")
            self.end_headers()
            if self.command=="HEAD":return
            with path.open("rb") as stream:
                stream.seek(start);remaining=end-start+1
                while remaining:
                    chunk=stream.read(min(65536,remaining))
                    if not chunk:break
                    self.wfile.write(chunk);remaining-=len(chunk)
        def do_HEAD(self):self.do_GET()
        def do_GET(self):
            try:
                self.origin();parsed=urlsplit(self.path);path=parsed.path
                if path=="/api/info":return self.respond({"workspace":str(WORKSPACE),"default_output_root":str(GENERATED),"schema":SCHEMA,"width":WIDTH,"height":HEIGHT,"quality":QUALITY,"ratio":"2:3","max_upload_bytes":MAX_UPLOAD})
                if path=="/api/recipe/cards":
                    example=WORKSPACE/"assets/cards/recipe.json"
                    return self.respond(json.loads(example.read_text(encoding="utf-8-sig"))) if example.is_file() else self.respond({"error":"No example recipe is available."},404)
                if path.startswith("/api/preview/"):
                    with state.lock:item=state.images.get(Path(path).stem)
                    if not item:return self.respond({"error":"Unknown preview"},404)
                    return self.send_file(Path(item["preview_path"]))
                if path.startswith("/api/jobs/"):
                    with state.lock:job=json.loads(json.dumps(state.jobs.get(path.rsplit("/",1)[-1])))
                    return self.respond(job,200) if job else self.respond({"error":"Unknown job"},404)
                if path=="/api/file":
                    query=parse_qs(parsed.query);ident=query.get("job_id",[""])[0];name=query.get("file",[""])[0]
                    with state.lock:job=state.jobs.get(ident);item=next((o for o in job["outputs"] if o["file"]==name),None) if job else None
                    if item is None:return self.respond({"error":"Unknown generated file"},404)
                    return self.send_file(destination(Path(job["output_directory"]),name))
                if path=="/api/archive":
                    ident=parse_qs(parsed.query).get("job_id",[""])[0]
                    with state.lock:job=state.jobs.get(ident)
                    if not job or job["status"]!="complete":return self.respond({"error":"A completed job is required."},404)
                    archive=CACHE/"archives"/(ident+".zip")
                    if not archive.is_file():
                        archive.parent.mkdir(parents=True,exist_ok=True);temporary=archive.with_name(uuid.uuid4().hex+".zip")
                        with zipfile.ZipFile(temporary,"w",zipfile.ZIP_DEFLATED) as bundle:
                            for item in job["outputs"]:bundle.write(destination(Path(job["output_directory"]),item["file"]),item["file"])
                        temporary.replace(archive)
                    return self.send_file(archive)
                name="index.html" if path=="/" else path.lstrip("/");name=safe_relative(name,{".html",".js",".css",".svg",".png",".webp",".ico"});file=destination(TOOL_DIR,name)
                return self.send_file(file) if file.is_file() else self.respond({"error":"Not found"},404)
            except (CardError,ValueError,json.JSONDecodeError) as error:self.respond({"error":str(error)},400)
            except (BrokenPipeError,ConnectionResetError):pass
            except Exception as error:self.respond({"error":str(error)},500)
        def do_POST(self):
            try:
                self.origin();parsed=urlsplit(self.path)
                if parsed.path=="/api/upload":
                    name=safe_relative(parse_qs(parsed.query).get("filename",[""])[0],IMAGE_EXTENSIONS)
                    if "/" in name:raise CardError("Upload filename cannot contain a directory.")
                    length=int(self.headers.get("Content-Length",0))
                    if not 0<length<=MAX_UPLOAD:raise CardError("Upload must be between 1 byte and 64 MiB.")
                    target=CACHE/"uploads"/uuid.uuid4().hex/name;target.parent.mkdir(parents=True,exist_ok=True)
                    with target.open("xb") as stream:
                        remaining=length
                        while remaining:
                            chunk=self.rfile.read(min(65536,remaining))
                            if not chunk:raise CardError("Upload ended before its declared length.")
                            stream.write(chunk);remaining-=len(chunk)
                    return self.respond(state.register(target))
                payload=self.read_json()
                if parsed.path=="/api/probe":
                    if not isinstance(payload.get("path"),str):raise CardError("A local image path is required.")
                    return self.respond(state.register(Path(payload["path"])))
                if parsed.path=="/api/validate":
                    try:plan=state.plan(payload)
                    except CardError as error:return self.respond({"ok":False,"errors":error.errors})
                    return self.respond({"ok":True,"errors":[],"cards":len(plan["outputs"]),"output_directory":str(plan["directory"])})
                if parsed.path=="/api/build":return self.respond({"job_id":state.enqueue(state.plan(payload))},202)
                return self.respond({"error":"Unknown endpoint"},404)
            except (CardError,ValueError,json.JSONDecodeError) as error:self.respond({"error":str(error),"errors":getattr(error,"errors",[str(error)])},400)
            except (BrokenPipeError,ConnectionResetError):pass
            except Exception as error:self.respond({"error":str(error)},500)
        def do_OPTIONS(self):self.respond({"error":"Cross-origin requests are not allowed"},403)
        def log_message(self,fmt,*args):
            if self.command=="POST":print(fmt%args,flush=True)
    print(f"Card workbench: http://{host}:{port}/",flush=True)
    http.server.ThreadingHTTPServer((host,port),Handler).serve_forever()


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter);commands=parser.add_subparsers(dest="command",required=True)
    web=commands.add_parser("serve");web.add_argument("--host",default="127.0.0.1");web.add_argument("--port",type=int,default=8243)
    for name in ("validate","build"):
        item=commands.add_parser(name);item.add_argument("--recipe",required=True,type=Path);item.add_argument("--output-dir");item.add_argument("--overwrite",action="store_true");item.add_argument("--json",action="store_true")
    args=parser.parse_args(argv)
    try:
        if args.command=="serve":serve(args.host,args.port);return 0
        recipe=json.loads(args.recipe.read_text(encoding="utf-8-sig"));plan=validate_recipe(recipe,args.output_dir,overwrite=args.overwrite)
        if args.command=="validate":result={"ok":True,"cards":len(plan["outputs"]),"sources":len(plan["sources"]),"output_directory":str(plan["directory"])}
        else:
            def progress(value,message):print(f"{value:.0%} {message}",file=__import__('sys').stderr if args.json else __import__('sys').stdout,flush=True)
            result=build_recipe(plan,progress)
        print(json.dumps(result,ensure_ascii=False));return 0
    except Exception as error:
        print(json.dumps({"ok":False,"error":str(error),"errors":getattr(error,"errors",[str(error)])},ensure_ascii=False),file=__import__('sys').stderr);return 1


if __name__=="__main__":raise SystemExit(main())
