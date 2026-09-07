"""Collect only manifest-declared public Creator resources; never account APIs.
Downloaded content is reference data, never executed by this collector.
"""
from pathlib import Path
import concurrent.futures, hashlib, json, re, urllib.request
ROOT=Path(__file__).resolve().parents[1]/'reference/creator'
BASE='https://prod-maxluck.slam777.com.tw/DragonTycoon3/'
ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

def uuid(value):
    parts=value.split('@');s=parts[0]
    if len(s)==22:
        h=s[:2]
        for i in range(2,22,2):
            a=ALPHABET.index(s[i]);b=ALPHABET.index(s[i+1]);h+=f'{a>>2:x}{((a&3)<<2)|(b>>4):x}{b&15:x}'
        s=f'{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}'
    return s+('@'+parts[1] if len(parts)>1 else '')

def fetch(relative):
    path=(ROOT/relative).resolve()
    if not path.is_relative_to(ROOT.resolve()): raise ValueError("resource escapes collection root")
    try:
        if not path.exists():
            data=urllib.request.urlopen(BASE+relative,timeout=45).read();path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        data=path.read_bytes()
        return {'path':relative,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    except Exception as error:return {'path':relative,'error':str(error)}

def batch(paths):
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for result in pool.map(fetch,sorted(set(paths))):results.append(result)
    return results

fetch('src/settings.40711.json')
settings=json.loads((ROOT/'src/settings.40711.json').read_text(encoding='utf8'))
configs={}
for name,version in settings['assets']['bundleVers'].items():
    path=f'assets/{name}/config.{version}.json';fetch(path);configs[name]=json.loads((ROOT/path).read_text(encoding='utf8'))
plans=[];imports={}
for name,c in configs.items():
    prefix=f'assets/{name}'
    if c.get('hasPreloadScript'):plans.append(f'{prefix}/index.{settings["assets"]["bundleVers"][name]}.js')
    extensions={idx:ext for ext,indices in c.get('extensionMap',{}).items() for idx in indices}
    versions=c.get('versions',{}).get('import',[])
    for idx,ver in zip(versions[::2],versions[1::2]):
        key=c['uuids'][idx] if isinstance(idx,int) else idx;u=uuid(key);ext=extensions.get(idx,'.json');relative=f'{prefix}/{c["importBase"]}/{u[:2]}/{u}.{ver}{ext}';plans.append(relative);imports[(name,key)]=relative
print(f'Collecting {len(plans)} declared import/script files',flush=True)
results=batch(plans)
(ROOT/'collection-imports.json').write_text(json.dumps(results,indent=2))
# Packed import data keeps each asset in config.packs order.
metadata={}
for (name,key),relative in imports.items():
    if not relative.endswith('.json') or not (ROOT/relative).exists():continue
    try:
        data=json.loads((ROOT/relative).read_text(encoding='utf8'));c=configs[name]
        if key in c.get('packs',{}):
            for idx,entry in zip(c['packs'][key],data[5]):metadata[(name,idx)]=entry
        else:
            idx=c['uuids'].index(key);metadata[(name,idx)]=data
    except (ValueError,KeyError,IndexError,TypeError):pass

def extensions(data):
    result=set()
    def walk(v):
        if isinstance(v,str) and re.fullmatch(r'\.[A-Za-z0-9]{1,16}',v):result.add(v)
        elif isinstance(v,dict):
            if 'fmt' in v:
                for fmt in str(v['fmt']).split('_'):
                    f=fmt.split('@')[0]
                    if f.isdigit() and int(f)<8:result.add(['.png','.jpg','.jpeg','.bmp','.webp','.pvr','.pkm','.astc'][int(f)])
                    elif re.fullmatch(r'[A-Za-z]+',f):result.add('.'+f)
            for value in v.values():walk(value)
        elif isinstance(v,list):
            for value in v:walk(value)
    walk(data);return result
native=[];unresolved=[];catalog=[]
for name,c in configs.items():
    versions=c.get('versions',{}).get('native',[])
    for idx,ver in zip(versions[::2],versions[1::2]):
        key=c['uuids'][idx] if isinstance(idx,int) else idx;u=uuid(key);exts=extensions(metadata.get((name,idx)))
        if not exts:unresolved.append({'bundle':name,'index':idx,'uuid':u,'version':ver})
        for ext in exts:
            relative=f'assets/{name}/{c["nativeBase"]}/{u[:2]}/{u}.{ver}{ext}';native.append(relative)
            catalog.append({'bundle':name,'index':idx,'uuid':u,'path':relative,'logical_path':c.get('paths',{}).get(str(idx))})
print(f'Collecting {len(native)} declared native variants; {len(unresolved)} need format decoding',flush=True)
results+=batch(native)
(ROOT/'collection.json').write_text(json.dumps({'source':BASE,'files':results,'unresolved_native':unresolved,'catalog':catalog},indent=2))
print(json.dumps({'downloaded':sum('error' not in r for r in results),'bytes':sum(r.get('bytes',0) for r in results),'failed':sum('error' in r for r in results),'unresolved':len(unresolved)}),flush=True)
