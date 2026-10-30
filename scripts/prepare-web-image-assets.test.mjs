import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {prepareWebImageAssets,portablePath,webGeneration} from './prepare-web-image-assets.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const encoding=fs.readFileSync(path.join(repo,'web/shared/asset-encoding.js'));
const png=(width=2,height=3)=>{const b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);return b;};
const write=(root,name,bytes)=>{const file=path.join(root,...name.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
function fixture(t,{html='<html><head><meta name="unone-image-preload-version" content="1"></head><body></body></html>',staleRoot=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'unone-image-plan-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const project=path.join(root,'project'),input=path.join(root,'input'),output=path.join(root,'output');fs.mkdirSync(project);fs.mkdirSync(input);
 const script='return {start=function(api) end,update=function(api,dt) end}\n';
 const config={name:'publisher fixture',entry_script:'scripts/main.luau',main_scene:'scenes/main.scene.json',asset_manifest:'assets/manifest.json'};
 const assets={version:1,assets:[{id:'image://fixture/a',kind:'texture2d',source:'assets/a.png',files:[],encoding:{decoder:'image',format:'png',mime:'image/png'}},{id:'image://fixture/b',kind:'texture2d',source:'assets/b.webp',files:[],encoding:{decoder:'image',format:'webp',mime:'image/webp'}}]};
 const plan={version:1,groups:{map:['image://fixture/a'],ui:['image://fixture/a','image://fixture/b']},startup:['map']};
 const logical=new Map([
  ['web/shared/asset-encoding.js',encoding],['web/player/main.js',Buffer.from('// authored wheel adapter stays intact\nfunction readImagePreloadPlan(){}\n')],
  ['runtime/runtime.wasm',Buffer.from([0,97,115,109,1,0,0,0])],['runtime/runtime.json',Buffer.from('{"variant":"production"}')],
  ['content/project.json',Buffer.from(JSON.stringify({config,script,scene:{version:1,entities:[]},job_sources:{}}))],
  ['content/assets.json',Buffer.from(JSON.stringify(assets))],['content/presentation.json',Buffer.from('{"renderer_mode":"official"}')],
  ['content/assets/a.png',png()],['content/assets/b.webp',Buffer.from('browser must inspect this format')],
  ['content/\uE000.bin',Buffer.from('bmp')],['content/\u{10000}.bin',Buffer.from('nonbmp')],
 ]);
 for(const [name,bytes]of [['project.unone.json',JSON.stringify(config)],['scripts/main.luau',script],['scenes/main.scene.json','{"version":1,"entities":[]}'],['assets/manifest.json',JSON.stringify(assets)],['assets/a.png',png()],['assets/b.webp',Buffer.from('browser must inspect this format')],['player.image-assets.json',JSON.stringify(plan)]])write(project,name,bytes);
 let release;
 const seal=()=>{
  release=staleRoot?'releases/'+'f'.repeat(64)+'/':webGeneration(html,[...logical].map(([name,bytes])=>({path:name,sha256:hash(bytes)})));
  fs.rmSync(input,{recursive:true,force:true});fs.mkdirSync(input);
  for(const [name,bytes]of logical){write(input,name,bytes);write(input,release+name,bytes);}
  write(input,'index.html',html.replace('<head>','<head><base href="'+release+'">'));
  reindex();
 };
 function reindex(){const files=[];const visit=(dir='')=>{for(const item of fs.readdirSync(path.join(input,dir),{withFileTypes:true})){const name=dir?dir+'/'+item.name:item.name;if(item.isDirectory())visit(name);else if(name!=='export.json'){const bytes=fs.readFileSync(path.join(input,name));files.push({path:name,bytes:bytes.length,sha256:hash(bytes)});}}};visit();files.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));write(input,'export.json',JSON.stringify({version:1,renderer_mode:'official',renderer:'three-webgl',release_root:release,module_dependencies_checked:5,total_bytes:files.reduce((n,f)=>n+f.bytes,0),files}));}
 seal();
 return{root,project,input,output,logical,assets,plan,seal,reindex,get release(){return release},args:()=>({project,inputExport:input,output})};
}
async function rejectsBeforeOutput(f,error){await assert.rejects(prepareWebImageAssets(f.args()),error);assert.equal(fs.existsSync(f.output),false);}

test('fresh publication preserves every source byte and uses the exact engine hash primitive',async t=>{
 const f=fixture(t),before=hash(fs.readFileSync(path.join(f.input,'export.json'))),report=await prepareWebImageAssets(f.args());
 assert.equal(hash(fs.readFileSync(path.join(f.input,'export.json'))),before);
 assert.notEqual(report.release_root,f.release);assert.equal(report.image_assets.input_generation_matches_content,true);
 const html=fs.readFileSync(path.join(f.output,'index.html'),'utf8'),unbased=html.replace('<head><base href="'+report.release_root+'">','<head>');
 assert.equal((html.match(/name="unone-image-assets"/g)||[]).length,1);assert.equal(fs.existsSync(path.join(f.output,report.release_root,'index.html')),false);
 const aliases=report.files.filter(file=>file.path!=='index.html'&&!file.path.startsWith('releases/'));
 // Independent expression of Rust's serde_json tuple, using bytewise Rust String ordering.
 const inventory=aliases.map(file=>[file.path,file.sha256]).sort((a,b)=>Buffer.compare(Buffer.from(a[0]),Buffer.from(b[0])));
 assert.equal(report.release_root,'releases/'+hash(Buffer.from(JSON.stringify([unbased,inventory])))+'/');
 for(const file of report.files){const bytes=fs.readFileSync(path.join(f.output,file.path));assert.equal(bytes.length,file.bytes);assert.equal(hash(bytes),file.sha256);}
 for(const [name,bytes]of f.logical){assert.deepEqual(fs.readFileSync(path.join(f.output,name)),bytes);assert.deepEqual(fs.readFileSync(path.join(f.output,report.release_root,name)),bytes);}
 assert.deepEqual(report.image_assets.startup_preflight,{required_entries:1,known_rgba_bytes_estimate:24,unknown_dimension_assets:[],scope:'24-byte PNG IHDR estimate only; the official browser still validates decoding and admission before READY'});
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.output,'content/image-assets.json'))),{...f.plan,budget:{max_bytes:67108864,max_entries:128}});
});
test('UTF-8 inventory ordering differs from UTF-16 and matches the explicit tuple',()=>{
 const a={path:'\uE000',sha256:'a'},b={path:'\u{10000}',sha256:'b'},html='<head>\n\u2028\\"</head>';
 assert.notEqual([a.path,b.path].sort()[0],a.path);
 assert.equal(webGeneration(html,[b,a]),'releases/'+hash(Buffer.from(JSON.stringify([html,[[a.path,'a'],[b.path,'b']]])))+'/');
});
test('validated old root mismatch is disclosed and resealed after host finalization',async t=>{
 const f=fixture(t,{staleRoot:true}),report=await prepareWebImageAssets(f.args());assert.equal(report.image_assets.input_generation_matches_content,false);assert.notEqual(report.release_root,f.release);
});
test('reapplying an owned sidecar is deterministic and creates no inner index',async t=>{
 const f=fixture(t),first=await prepareWebImageAssets(f.args()),second=await prepareWebImageAssets({project:f.project,inputExport:f.output,output:path.join(f.root,'second')});
 assert.equal(second.release_root,first.release_root);assert.equal(second.image_assets.input_generation_matches_content,true);assert.equal(second.files.filter(x=>x.path.endsWith('/index.html')).length,0);
});
test('stale script or asset project bytes fail before output',async t=>{
 for(const name of ['scripts/main.luau','assets/a.png']){const f=fixture(t);fs.appendFileSync(path.join(f.project,name),'changed');await rejectsBeforeOutput(f,/IMAGE_PRELOAD_PROJECT_STALE/);}
});
test('scene values must match while object key order and tool-only save fixtures do not matter',async t=>{
 const stale=fixture(t);write(stale.project,'scenes/main.scene.json','{"entities":[{"id":"changed"}],"version":1}');await rejectsBeforeOutput(stale,/PROJECT_STALE.*main scene/);
 const f=fixture(t);write(f.project,'scenes/main.scene.json','{"entities":[],"version":1}');
 const config=JSON.parse(fs.readFileSync(path.join(f.project,'project.unone.json')));config.ui_previews=[{name:'fixture',save_fixture:'tests/private-save.json'}];config.runtime_packages={};config.job_scripts={};write(f.project,'project.unone.json',JSON.stringify(config));
 const payload=JSON.parse(f.logical.get('content/project.json'));payload.config.ui_previews=[{name:'fixture'}];f.logical.set('content/project.json',Buffer.from(JSON.stringify(payload)));f.seal();assert.equal((await prepareWebImageAssets(f.args())).image_assets.startup_preflight.required_entries,1);
});
test('hash tampering and self-consistently indexed alias drift both fail',async t=>{
 const tamper=fixture(t);fs.appendFileSync(path.join(tamper.input,'runtime/runtime.wasm'),'bad');await rejectsBeforeOutput(tamper,/HASH_MISMATCH/);
 const drift=fixture(t);fs.appendFileSync(path.join(drift.input,'web/player/main.js'),'drift');drift.reindex();await rejectsBeforeOutput(drift,/ALIAS_MISMATCH/);
});
test('unindexed files and missing indexed files fail closed',async t=>{
 const extra=fixture(t);write(extra.input,'extra.txt','unindexed');await rejectsBeforeOutput(extra,/UNINDEXED_FILE/);
 const missing=fixture(t);fs.unlinkSync(path.join(missing.input,'runtime/runtime.wasm'));await rejectsBeforeOutput(missing,/ENOENT/);
});
test('custom renderer and unsupported or mismatched host capability are rejected',async t=>{
 for(const alter of [f=>{const m=JSON.parse(fs.readFileSync(path.join(f.input,'export.json')));m.renderer_mode='custom';write(f.input,'export.json',JSON.stringify(m));},f=>{f.logical.set('web/shared/asset-encoding.js',Buffer.from('throw Error("input code must NEVER execute")'));f.seal();},f=>{f.logical.set('web/player/main.js',Buffer.from('// old host'));f.seal();}]){const f=fixture(t);alter(f);await rejectsBeforeOutput(f,/EXPORT_INVALID|HOST_UNSUPPORTED/);}
 const noMarker=fixture(t,{html:'<html><head></head><body></body></html>'});await rejectsBeforeOutput(noMarker,/HOST_UNSUPPORTED/);
});
test('plan is bounded before parsing and strict UTF-8 rejects replacement decoding',async t=>{
 for(const [bytes,error]of [[Buffer.alloc(1048577,32),/PLAN_LIMIT/],[Buffer.from([123,34,97,34,58,34,0xc3,0x28,34,125]),/encoded data|encoding/i],[JSON.stringify({version:1,groups:{a:['missing']},startup:['a']}),/PLAN_INVALID/]]){const f=fixture(t);write(f.project,'player.image-assets.json',bytes);await rejectsBeforeOutput(f,error);}
 const bom=fixture(t);write(bom.project,'player.image-assets.json',Buffer.concat([Buffer.from([239,187,191]),Buffer.from(JSON.stringify(bom.plan))]));assert.equal((await prepareWebImageAssets(bom.args())).image_assets.startup_preflight.required_entries,1);
});
test('required unique entry and known PNG byte budgets fail before writing',async t=>{
 for(const budget of [{max_bytes:23,max_entries:128},{max_bytes:1024,max_entries:1}]){const f=fixture(t);write(f.project,'player.image-assets.json',JSON.stringify({...f.plan,startup:['ui'],budget}));await rejectsBeforeOutput(f,/STARTUP_BUDGET/);}
 const f=fixture(t);write(f.project,'player.image-assets.json',JSON.stringify({...f.plan,startup:['ui']}));await rejectsBeforeOutput(f,/STARTUP_DIMENSIONS_UNSUPPORTED/);
});
test('unquoted sidecar metadata is recognized rather than duplicated',async t=>{
 const missing=fixture(t,{html:'<head><meta name=unone-image-preload-version content=1><meta name=unone-image-assets content=content/image-assets.json></head>'});await rejectsBeforeOutput(missing,/CONTENT_MISSING/);
 const duplicate=fixture(t,{html:'<head><meta name=unone-image-preload-version content=1><meta name=unone-image-assets content=content/image-assets.json><meta name="unone-image-assets" content="content/image-assets.json"></head>'});await rejectsBeforeOutput(duplicate,/META_CONFLICT/);
 const f=fixture(t,{html:'<head><meta name=unone-image-preload-version content=1><meta name=unone-image-assets content=content/image-assets.json></head>'});f.logical.set('content/image-assets.json',Buffer.from(JSON.stringify(f.plan)));f.seal();await prepareWebImageAssets(f.args());const html=fs.readFileSync(path.join(f.output,'index.html'),'utf8');assert.equal((html.match(/name="unone-image-assets"/g)||[]).length,1);assert.equal(html.includes('name=unone-image-assets'),false);
});
test('duplicate or conflicting plan metadata and unowned content are rejected',async t=>{
 for(const html of ['<head><meta name="unone-image-preload-version" content="1"><meta name="unone-image-assets" content="elsewhere"></head>','<head><meta name="unone-image-preload-version" content="1"><meta name="unone-image-assets" content="content/image-assets.json"><meta name="unone-image-assets" content="content/image-assets.json"></head>']){const f=fixture(t,{html});await rejectsBeforeOutput(f,/META_CONFLICT/);}
 const f=fixture(t);f.logical.set('content/image-assets.json',Buffer.from('{}'));f.seal();await rejectsBeforeOutput(f,/CONTENT_CONFLICT/);
});
test('portable paths, fresh output and non-reparse roots are enforced',async t=>{
 for(const bad of ['../a','/a','C:/a','a\\b','a//b','a/./b','con.txt','a.','a:stream','\ud800'])assert.throws(()=>portablePath(bad),/PATH_INVALID/);
 const f=fixture(t);fs.mkdirSync(f.output);await assert.rejects(prepareWebImageAssets(f.args()),/OUTPUT_NOT_FRESH/);assert.deepEqual(fs.readdirSync(f.output),[]);
 const linked=fixture(t),junction=path.join(linked.root,'linked');try{fs.symlinkSync(linked.input,junction,process.platform==='win32'?'junction':'dir');}catch(error){t.diagnostic('symlink/junction unavailable: '+error.code);return;}
 await assert.rejects(prepareWebImageAssets({...linked.args(),inputExport:junction}),/REPARSE_PATH/);
});
test('an SDK relocation imports only its indexed trusted template and tool',async t=>{
 const f=fixture(t),sdk=path.join(f.root,'sdk'),script=fs.readFileSync(path.join(repo,'scripts/prepare-web-image-assets.mjs'));
 write(sdk,'scripts/prepare-web-image-assets.mjs',script);write(sdk,'templates/web/shared/asset-encoding.js',encoding);
 write(sdk,'sdk.json',JSON.stringify({version:1,templates:'templates',files:[{path:'scripts/prepare-web-image-assets.mjs',bytes:script.length,sha256:hash(script)},{path:'templates/web/shared/asset-encoding.js',bytes:encoding.length,sha256:hash(encoding)}]}));
 const run=spawnSync(process.execPath,[path.join(sdk,'scripts/prepare-web-image-assets.mjs'),'--project',f.project,'--input-export',f.input,'--output',f.output],{encoding:'utf8',windowsHide:true});assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(f.output,'export.json'))).image_assets.validator_origin,'sdk');
 write(sdk,'templates/web/shared/asset-encoding.js','throw Error("tampered trusted template")');const failed=spawnSync(process.execPath,[path.join(sdk,'scripts/prepare-web-image-assets.mjs'),'--project',f.project,'--input-export',f.input,'--output',path.join(f.root,'other')],{encoding:'utf8',windowsHide:true});assert.equal(failed.status,1);assert.match(failed.stderr,/HASH_MISMATCH/);
});
