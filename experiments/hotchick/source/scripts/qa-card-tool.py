"""Independent card workbench API, pixels, provenance and CLI acceptance."""
from __future__ import annotations
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request,urlopen
import uuid
import zipfile
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[1]


def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8243');args=parser.parse_args();base=args.url.rstrip('/')
    scratch=ROOT/'.cache/tmp'/('card-tool-qa-'+uuid.uuid4().hex);scratch.mkdir(parents=True);report_dir=ROOT/'artifacts/card-tool-qa';report_dir.mkdir(parents=True,exist_ok=True)
    image=Image.new('RGB',(360,270),'red');draw=ImageDraw.Draw(image);draw.rectangle((120,0,239,269),fill=(0,255,0));draw.rectangle((240,0,359,269),fill=(0,0,255));source=scratch/'three-stripes.png';image.save(source);original_hash=digest(source)
    def request(path,body=None,raw=None,headers=None):
        payload=raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        head={'Content-Type':'application/octet-stream' if raw is not None else 'application/json'} if payload is not None else {}
        head.update(headers or {})
        try:
            with urlopen(Request(base+path,data=payload,headers=head),timeout=30) as r:
                data=r.read();return r.status,dict(r.headers),json.loads(data) if r.headers.get_content_type()=='application/json' else data
        except HTTPError as e:
            data=e.read()
            try:data=json.loads(data)
            except ValueError:pass
            return e.code,dict(e.headers),data
    checks=[];evidence={}
    status,_,info=request('/api/info');assert status==200 and (info['width'],info['height'])==(600,900)
    status,_,probe=request('/api/probe',{'path':str(source)});assert status==200 and probe['width']==360 and probe['height']==270 and probe['sha256']==original_hash
    status,_,uploaded=request('/api/upload?'+urlencode({'filename':'卡片範例.png'}),raw=source.read_bytes());assert status==200 and uploaded['filename']=='卡片範例.png' and uploaded['sha256']==original_hash
    status,headers,data=request(uploaded['preview_url'],headers={'Range':'bytes=0-31'});assert status==206 and len(data)==32 and headers.get('Accept-Ranges')=='bytes';checks.append('local-path-upload-and-range-preview-preserve-source-name-hash-and-dimensions')
    recipe={'schema':'hotchick.cards.recipe.v1','output_directory':str(scratch/'output'),'preserve_originals':True,'sources':[{'id':'stripes','path':str(source),'sha256':original_hash}],'outputs':[{'id':'green','source':'stripes','filename':'green.webp','crop':{'x':120.25,'y':0,'width':119.5,'height':179.25},'width':600,'height':900,'quality':92},{'id':'blue','source':'stripes','filename':'blue.webp','crop':{'x':240,'y':30,'width':120,'height':180},'width':600,'height':900,'quality':92}]}
    status,_,valid=request('/api/validate',{'recipe':recipe});assert status==200 and valid['ok'] and valid['cards']==2
    invalid=[]
    for name,mutate in [('traversal',lambda r:r['outputs'][0].update(filename='../escape.webp')),('wrong-ratio',lambda r:r['outputs'][0]['crop'].update(width=100,height=100)),('outside-source',lambda r:r['outputs'][0]['crop'].update(x=500)),('mixed-size',lambda r:r['outputs'][0].update(width=400,height=600)),('wrong-hash',lambda r:r['sources'][0].update(sha256='0'*64)),('duplicate-card',lambda r:r['outputs'][1].update(id='green')),('outside-http-root',lambda r:r.update(output_directory=str(ROOT/'game/presentation/assets/unsafe-card-test'))),('reserved-filename',lambda r:r['outputs'][0].update(filename='CON.webp'))]:
        bad=copy.deepcopy(recipe);mutate(bad);_,_,result=request('/api/validate',{'recipe':bad});assert not result['ok'],name;invalid.append(name)
    webp_source=scratch/'original.webp';image.save(webp_source,'WEBP');status,_,webp_probe=request('/api/probe',{'path':str(webp_source)});assert status==200
    bad=copy.deepcopy(recipe);bad['output_directory']=str(scratch);bad['sources']=[{'id':'stripes','path':str(webp_source)}];bad['outputs'][0]['filename']='original.webp';_,_,result=request('/api/validate',{'recipe':bad,'overwrite':True});assert not result['ok'];invalid.append('source-overwrite')
    status,_,result=request('/api/probe',{'path':str(source)},headers={'Origin':'https://untrusted.invalid'});assert status>=400;invalid.append('untrusted-origin');checks.append('ten-invalid-crop-path-size-hash-overwrite-and-origin-cases-rejected')
    def build(overwrite=False):
        status,_,job=request('/api/build',{'recipe':recipe,'overwrite':overwrite});assert status==202,job;ident=job['job_id'];deadline=time.time()+30
        while time.time()<deadline:
            status,_,job=request('/api/jobs/'+ident);assert status==200
            if job['status'] in ('complete','error'):break
            time.sleep(.05)
        assert job['status']=='complete',job
        assert job['progress']==1 and len(job['outputs'])==5
        return job
    job=build();cards={item['id']:item for item in job['outputs'] if item['type']=='card'}
    for ident,color in [('green',(0,255,0)),('blue',(0,0,255))]:
        status,_,data=request(cards[ident]['url']);assert status==200
        with Image.open(io.BytesIO(data)) as im:
            assert im.size==(600,900);pixel=im.convert('RGB').getpixel((300,450));assert max(abs(a-b) for a,b in zip(pixel,color))<=10,(ident,pixel)
        assert hashlib.sha256(data).hexdigest()==cards[ident]['sha256']
    manifest=json.loads((scratch/'output/cards-manifest.json').read_text(encoding='utf-8'));assert manifest['outputs'][0]['crop']==recipe['outputs'][0]['crop'];checks.append('batch-WebP-cards-are-uniform-600x900-and-pixels-prove-fractional-crop-regions')
    preserved=json.loads((scratch/'output/source-manifest.json').read_text(encoding='utf-8'));assert digest(source)==original_hash==digest(scratch/'output'/preserved['sources'][0]['copy']);assert json.loads((scratch/'output/recipe.snapshot.json').read_text(encoding='utf-8'))==recipe;checks.append('recipe-snapshot-original-copy-and-source-sha-remain-exact')
    status,_,archive=request('/api/archive?'+urlencode({'job_id':job['job_id']}));assert status==200
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:assert set(bundle.namelist())=={'green.webp','blue.webp','cards-manifest.json','source-manifest.json','recipe.snapshot.json'}
    status,_,_=request('/api/file?'+urlencode({'job_id':job['job_id'],'file':'../original.webp'}));assert status==404;checks.append('completed-files-and-zip-downloads-are-registered-and-traversal-protected')
    _,_,exists=request('/api/validate',{'recipe':recipe});assert not exists['ok'];rebuilt=build(True);assert [o['sha256'] for o in rebuilt['outputs'] if o['type']=='card']==[o['sha256'] for o in job['outputs'] if o['type']=='card'];checks.append('explicit-overwrite-is-required-and-regeneration-is-deterministic')
    cli_recipe=copy.deepcopy(recipe);cli_recipe['output_directory']=str(scratch/'cli-output');path=scratch/'recipe.json';path.write_text(json.dumps(cli_recipe),encoding='utf-8');result=subprocess.run([sys.executable,str(ROOT/'scripts/card-tool/card_tool.py'),'build','--recipe',str(path),'--json'],capture_output=True,text=True,encoding='utf-8');assert result.returncode==0,result.stderr;assert json.loads(result.stdout)['cards']==2;checks.append('standalone-CLI-consumes-the-same-reusable-recipe')
    status,_,example=request('/api/recipe/cards');assert status==200 and example['schema']=='hotchick.cards.recipe.v1' and len(example['outputs'])==14;checks.append('read-only-fourteen-card-example-is-available')
    evidence={'probe':probe,'uploaded':uploaded,'invalid':invalid,'job':job,'scratch':str(scratch)}
    report={'ok':True,'url':base,'checks':checks,'evidence':evidence};(report_dir/'acceptance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'ok':True,'checks':checks,'report':str(report_dir/'acceptance.json')},ensure_ascii=False))


if __name__=='__main__':main()
