import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {verifiedExport,writePublication,dataRecord,fileRecord,json,encodeJson,sha,sourceFile,text} from './web-export-files.mjs';
import {assembleContent} from './web-export-content.mjs';
import {inspectHostSnapshot,resolveSystems,assembleHost,validateDependencies} from './web-export-host.mjs';
import {refreshOfficialWeb,inspectRuntime} from './refresh-official-web.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'unone-web-refresh-'));t.after(()=>{const absolute=path.resolve(root),parent=path.resolve(os.tmpdir());assert.equal(path.dirname(absolute),parent);assert(path.basename(absolute).startsWith('unone-web-refresh-'));fs.rmSync(absolute,{recursive:true,force:true});});return root;}
function write(root,name,value){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));return file;}
function base(root,assets=[]){const directory=path.join(root,'base'),files=new Map();for(const [name,value]of [['content/assets.json',{version:1,assets}],['content/project.json',{script:'old',script_bytecode:{source:'old.luaubc'}}],['content/presentation.json',{bloom:true}]])files.set(name,dataRecord(name,Buffer.from(JSON.stringify(value))));writePublication(directory,'<html><head></head></html>',files,{renderer_mode:'official'});return verifiedExport(directory);}
function project(root){const dir=path.join(root,'project');write(dir,'project.unone.json',{name:'Fresh',entry_script:'scripts/main.luau',main_scene:'scenes/main.json',asset_manifest:'assets.json',systems:{audio:false}});write(dir,'scripts/main.luau',"local x=require('./value');return {start=function()end,update=function()end}");write(dir,'scripts/value.luau','return 42');write(dir,'scenes/main.json',{entities:[]});write(dir,'assets.json',{version:1,assets:[]});return dir;}

test('publication matches canonical seal, indexed aliases and detects tampering/unindexed content',t=>{
 const root=temporary(t),b=base(root);assert.equal(b.generation_matches,true);assert.equal(b.logical.size,3);
 fs.appendFileSync(path.join(b.root,'content/project.json'),' ');assert.throws(()=>verifiedExport(b.root),/BASE_HASH/);
 const second=path.join(root,'second');writePublication(second,'<head></head>',new Map([['content/x',dataRecord('content/x',Buffer.from('x'))]]),{renderer_mode:'official'});write(second,'unlisted','x');assert.throws(()=>verifiedExport(second),/UNINDEXED/);
});
test('source refresh reconstructs fresh scene/config/data/modules and never retains old bytecode',t=>{
 const root=temporary(t),b=base(root),dir=project(root);write(dir,'data/new.json','{"answer":42}');write(dir,'assets.json',{version:1,assets:[{id:'data://new',kind:'data',source:'data/new.json',encoding:{format:'json',decoder:'json',mime:'application/json'}}]});write(dir,'scenes/main.json',{entities:[],shader_materials:{fresh:{fragment:'vec4 unoneShade(vec2 uv,vec4 c){return c;}',uniforms:{}}}});
 const c=assembleContent(dir,b);assert.equal(c.payload.config.name,'Fresh');assert(c.payload.scene.shader_materials.fresh);assert.equal(c.payload.script_modules['value.luau'],'return 42');assert.equal(c.payload.data_assets[0].id,'data://new');assert.equal(c.data[0].source,path.join(dir,'data/new.json'));assert(!('script_bytecode'in c.payload));assert.equal(c.files.has('content/old.luaubc'),false);assert.equal(c.presentation.bloom,false,'absent fresh presentation never inherits base settings');
});
test('new import/derived formats fail specifically; unchanged derived products require exact spec and bytes',t=>{
 const root=temporary(t),dir=project(root),mesh={id:'mesh://one',source:'one.mesh.json',kind:'mesh3d',encoding:{format:'unone-mesh-json',decoder:'mesh',mime:'application/json'}},bytes=Buffer.from('{"texture":"t"}');write(dir,'one.mesh.json',bytes);write(dir,'assets.json',{assets:[mesh]});const b=base(root,[mesh]);
 // Base product must be indexed; a matching path/spec alone is insufficient.
 assert.throws(()=>assembleContent(dir,b),/NEW_DERIVED_FORMAT_UNSUPPORTED/);
 const record=fileRecord(path.join(dir,'one.mesh.json'),'content/one.mesh.json');b.logical.set(record.path,record);assert.equal(assembleContent(dir,b).reused[0],'mesh://one');write(dir,'one.mesh.json','changed');assert.throws(()=>assembleContent(dir,b),/NEW_DERIVED_FORMAT_UNSUPPORTED/);
 write(dir,'assets.json',{assets:[{id:'new',source:'one.mesh.json',kind:'data',import:{node:'new'}}]});assert.throws(()=>assembleContent(dir,b),/NEW_IMPORT_UNSUPPORTED/);
});
test('fresh presentation/fonts/extensions are copied; unknown fields and unsupported renderer never pass',t=>{
 const root=temporary(t),dir=project(root),b=base(root);write(dir,'fonts/a.ttf','font');write(dir,'passes/custom.mjs','export function createPass(){}');write(dir,'player.presentation.json',{renderer_mode:'official',ui:{fonts:[{family:'A',source:'fonts/a.ttf'}]},render_extensions:[{kind:'studio.custom',module:'passes/custom.mjs'}]});
 const c=assembleContent(dir,b);assert(c.files.has('content/fonts/a.ttf'));assert(c.files.has('content/passes/custom.mjs'));assert.equal(c.presentation.ui.fonts[0].weight,400);
 write(dir,'player.presentation.json',{postprocessing:{}});assert.throws(()=>assembleContent(dir,b),/PRESENTATION_INVALID/);write(dir,'player.presentation.json',{renderer_mode:'custom'});assert.throws(()=>assembleContent(dir,b),/OFFICIAL_ONLY/);
});
test('closed asset shapes, traversal, duplicate ids and unsafe JSON integers fail before publication',t=>{
 const root=temporary(t),dir=project(root),b=base(root);write(dir,'outside.bin','x');
 for(const assets of [[null],[{id:'a',source:'../outside.bin',kind:'data'}],[{id:'a',source:'outside.bin',kind:'data',typo:1}],[{id:'a',source:'outside.bin',kind:'data'},{id:'a',source:'outside.bin',kind:'data'}]]){write(dir,'assets.json',{assets});assert.throws(()=>assembleContent(dir,b));}
 const file=write(root,'unsafe.json','{"n":9007199254740993}');assert.throws(()=>json(file),/JSON_INTEGER_PRECISION/);
});
test('JSON negative zero survives fresh payload generation and validation serialization',t=>{
 const root=temporary(t),dir=project(root),b=base(root);write(dir,'scenes/main.json','{"entities":[],"physics":{"gravity":{"x":-0.0,"y":0}}}');const c=assembleContent(dir,b);assert(Object.is(c.payload.scene.physics.gravity.x,-0));assert.match(c.files.get('content/project.json').data.toString(),/"x":-0.0/);assert(Object.is(JSON.parse(encodeJson({x:-0})).x,-0));
});
test('actual source host inventory is deterministic; disabled-system production shells retain complete closure',()=>{
 const snapshot=inspectHostSnapshot(repo);assert.equal(inspectHostSnapshot(repo).sha256,snapshot.sha256);assert(snapshot.files.some(f=>f.path==='web/renderer/sprite-resources.js'));
 const off={};for(const id of ['audio','ui','save','particle','spine','effekseer','jobs','physics2d','physics3d','camera3d','random'])off[id]=false;const enabled=resolveSystems(repo,off),host=assembleHost(repo,snapshot,enabled,{javascript:'engine.js',compiled_systems:enabled},{assets:[]});assert(!enabled.includes('audio'));assert(!host.files.has('web/shared/audio-playback.js'));assert(!host.files.has('web/shared/canvas-ui.mjs'));const main=host.files.get('web/player/main.js').data.toString();assert(!/\/\* (PROFILE_|DEVELOPER_)/.test(main));assert(!main.includes("from '../shared/audio-playback.js'"));assert(validateDependencies(host.files)>50);
 assert.throws(()=>resolveSystems(repo,{world:false}),/SYSTEMS_INVALID/);assert.throws(()=>resolveSystems(repo,{typo:true}),/SYSTEMS_INVALID/);
});
test('literal closure rejects missing dependencies while respecting comments, strings and worker queries',()=>{
 const source="import './a.mjs?v=1';export {x} from './a.mjs';const w=new Worker(new URL('./worker.js',import.meta.url));const sample=\"import './fake.js'\"; // import './fake.js'\nconst re=/['\"]/;";
 const files=new Map([['web/main.js',dataRecord('web/main.js',Buffer.from(source))],['web/a.mjs',dataRecord('web/a.mjs',Buffer.from('export const x=1;'))],['web/worker.js',dataRecord('web/worker.js',Buffer.from(''))]]);assert.equal(validateDependencies(files),3);files.delete('web/worker.js');assert.throws(()=>validateDependencies(files),/DEPENDENCY_MISSING/);
});
test('hash pin rejection cannot create output or execute the runtime',async t=>{
 const root=temporary(t),dir=project(root),b=base(root),out=path.join(root,'out');await assert.rejects(refreshOfficialWeb({project:dir,inputExport:b.root,hostRoot:repo,hostSha256:'0'.repeat(64),hostCommit:'1'.repeat(40),runtime:repo,runtimeSha256:'2'.repeat(64),output:out}),/HOST_PIN_MISMATCH/);assert(!fs.existsSync(out));
});

// Independent boundary tests: no browser, native executable or imported base JS.
test('source paths reject traversal and linked ancestors',t=>{
 const root=temporary(t),dir=project(root);write(root,'outside.txt','outside');
 for(const name of ['../outside.txt','scripts/../main.luau','C:/outside.txt','scripts\\main.luau'])assert.throws(()=>sourceFile(dir,name),/PATH_INVALID/);
 const target=path.join(root,'target');write(target,'secret.txt','outside the project');const link=path.join(dir,'linked');
 try{fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.diagnostic('Link creation unavailable: '+error.code);return;}throw error;}
 assert.throws(()=>sourceFile(dir,'linked/secret.txt'),/WEB_REFRESH_LINK/);
 assert.equal(fs.readFileSync(path.join(target,'secret.txt'),'utf8'),'outside the project');
});

test('case-colliding output paths and index records fail before output publication',t=>{
 const root=temporary(t),out=path.join(root,'out'),files=new Map();
 for(const name of ['content/Art.png','content/art.png'])files.set(name,dataRecord(name,Buffer.from(name)));
 assert.throws(()=>writePublication(out,'<head></head>',files,{renderer_mode:'official'}),/OUTPUT_COLLISION/);assert(!fs.existsSync(out));
 const b=base(root),manifest=json(path.join(b.root,'export.json'));manifest.files.push({...manifest.files[0],path:manifest.files[0].path.toUpperCase()});
 // Duplicate admission must not depend on a case-sensitive filesystem.
 write(b.root,'export.json',manifest);
 assert.throws(()=>verifiedExport(b.root),/BASE_DUPLICATE/);
});

test('individually rehashed aliases still reject divergent logical and release bytes',t=>{
 const root=temporary(t),b=base(root),manifest=json(path.join(b.root,'export.json')),name='content/project.json';
 const changed=Buffer.from('{"script":"different but internally indexed"}');write(b.root,name,changed);
 const row=manifest.files.find(f=>f.path===name),oldSize=row.bytes;Object.assign(row,{bytes:changed.length,sha256:sha(changed)});manifest.total_bytes+=changed.length-oldSize;write(b.root,'export.json',manifest);
 assert.throws(()=>verifiedExport(b.root),/BASE_ALIAS/);
});

test('source-copy change preserves incomplete evidence without a final export marker',t=>{
 const root=temporary(t),file=write(root,'input.txt','before'),record=fileRecord(file,'content/input.txt'),out=path.join(root,'incomplete');
 write(root,'input.txt','after');
 assert.throws(()=>writePublication(out,'<head></head>',new Map([[record.path,record]]),{renderer_mode:'official'}),/COPY_CHANGED.*incomplete output preserved/);
 assert(fs.existsSync(out));assert(!fs.existsSync(path.join(out,'export.json')));assert.equal(fs.readFileSync(file,'utf8'),'after');
 assert.throws(()=>writePublication(out,'<head></head>',new Map(),{}),/OUTPUT_NOT_FRESH/);
});

test('fresh module/data deletion cannot inherit old payload or execute base JavaScript',t=>{
 const root=temporary(t),dir=project(root),baseDir=path.join(root,'untrusted-base'),marker='unoneRefreshBaseExecuted';delete globalThis[marker];
 const files=new Map();for(const [name,value]of [
  ['content/assets.json','{"assets":[]}'],
  ['content/project.json','{"script_modules":{"obsolete.luau":"return 1"},"data_assets":[{"id":"old","source":"old.json","loader":"json"}]}'],
  ['web/untrusted.mjs',`globalThis.${marker}=true;throw Error('input JavaScript must not execute');`]
 ])files.set(name,dataRecord(name,Buffer.from(value)));
 writePublication(baseDir,'<head></head>',files,{renderer_mode:'official'});const b=verifiedExport(baseDir);
 fs.unlinkSync(path.join(dir,'scripts/value.luau'));write(dir,'scripts/main.luau','return {start=function()end,update=function()end}');
 const c=assembleContent(dir,b);assert.equal(Object.hasOwn(c.payload,'script_modules'),false);assert.equal(Object.hasOwn(c.payload,'data_assets'),false);assert.deepEqual(c.data,[]);assert.equal(c.files.has('web/untrusted.mjs'),false);assert.equal(globalThis[marker],undefined);
});

test('UTF-8 and declared byte bounds reject malformed source before Core execution',t=>{
 const root=temporary(t),file=write(root,'invalid.luau',Buffer.from([0x61,0xc3,0x28]));assert.throws(()=>text(file),/encoded data|encoding|UTF-8/i);
 const jsonFile=write(root,'oversized.json','{"a":1}');assert.throws(()=>json(jsonFile,3),/JSON_LIMIT/);assert.throws(()=>text(jsonFile,3),/SOURCE_LIMIT/);
 write(root,'infinite.json','{"a":1e999}');assert.throws(()=>json(path.join(root,'infinite.json')),/JSON_NUMBER/);
});

test('local dependency admission rejects escapes, bare specifiers and ambiguous URL paths',()=>{
 for(const [specifier,code]of [['../../outside.js','MODULE_ESCAPE'],['package-name','MODULE_SPECIFIER'],['./a%2f.js','MODULE_SPECIFIER'],['.\\a.js','MODULE_SPECIFIER']]){
  const source=`import ${JSON.stringify(specifier)};`,files=new Map([['main.js',dataRecord('main.js',Buffer.from(source))]]);
  assert.throws(()=>validateDependencies(files),new RegExp(code),specifier);
 }
});

test('strict presentation rejects invalid worker policy and duplicate font faces',t=>{
 const root=temporary(t),dir=project(root),b=base(root);write(dir,'fonts/a.ttf','font');
 for(const [value,code]of [
  [{runtime_backend:'sometimes'},'PRESENTATION_INVALID'],
  [{job_policy:{mode:'workers',max_workers:5}},'JOB_POLICY_INVALID'],
  [{ui:{fonts:[{family:'A',source:'fonts/a.ttf'},{family:'A',source:'fonts/a.ttf',weight:400}]}},'UI_FONT_DUPLICATE']
 ]){write(dir,'player.presentation.json',value);assert.throws(()=>assembleContent(dir,b),new RegExp(code));}
});
test('existing font URL-changing filename rejects before publication',t=>{
 const root=temporary(t),dir=project(root),b=base(root);
 // Existing files distinguish URL identity validation from ENOENT.
 write(dir,'fonts/a%2ft.ttf','font');write(dir,'player.presentation.json',{ui:{fonts:[{family:'A',source:'fonts/a%2ft.ttf'}]}});
 assert.throws(()=>assembleContent(dir,b),/PATH|FONT/);
});
test('existing extension URL-fragment filename rejects before publication',t=>{
 const root=temporary(t),dir=project(root),b=base(root);
 write(dir,'passes/pass#x.mjs','export function createPass(){}');write(dir,'player.presentation.json',{render_extensions:[{kind:'studio.test',module:'passes/pass#x.mjs'}]});
 assert.throws(()=>assembleContent(dir,b),/PATH|EXTENSION/);
});

test('runtime preflight rejects development metadata, binary mismatch and missing actual ABI',t=>{
 const root=temporary(t),runtime=path.join(root,'runtime'),javascript=Buffer.from('throw Error("never execute this")'),wasm=Buffer.from([0,97,115,109,1,0,0,0]);
 write(runtime,'engine.js',javascript);write(runtime,'engine.wasm',wasm);
 const metadata={profile:'release',dev_tools:false,preview_tools:false,phase_profile:false,sampling_profile:false,source_dirty:false,source_commit:'1'.repeat(40),bytecode_optimization_level:2,compiled_systems:[],runtime_packages:{},javascript:'engine.js',javascript_sha256:sha(javascript),wasm:'engine.wasm',wasm_sha256:sha(wasm)};
 write(runtime,'runtime.json',{...metadata,preview_tools:true});assert.throws(()=>inspectRuntime(runtime),/RUNTIME_VARIANT/);
 write(runtime,'runtime.json',{...metadata,wasm_sha256:'0'.repeat(64)});assert.throws(()=>inspectRuntime(runtime),/RUNTIME_HASH/);
 for(const name of ['engine#tag.js','engine%2fpart.js','engine space.js']){
  write(runtime,name,javascript);write(runtime,'runtime.json',{...metadata,javascript:name});assert.throws(()=>inspectRuntime(runtime),/RUNTIME_NAME/);
 }
 write(runtime,'runtime.json',metadata);assert.throws(()=>inspectRuntime(runtime),/RUNTIME_ABI: alloc/);
});

// Explicitly opt in to the emitted-WASM worker test; never substitute a fake Core.
const integration=process.env.UNONE_WEB_REFRESH_INTEGRATION==='1';
const integrationOptions={skip:!integration?'Set UNONE_WEB_REFRESH_INTEGRATION=1 plus exact runtime path/manifest SHA to run actual Core':false};
function integrationInput(t){
 const runtime=process.env.UNONE_WEB_REFRESH_RUNTIME,runtimeSha256=process.env.UNONE_WEB_REFRESH_RUNTIME_SHA256;
 assert(runtime&&/^[a-f0-9]{64}$/.test(runtimeSha256??''),'Explicit runtime directory and exact manifest SHA required');
 const root=temporary(t),dir=project(root),b=base(root),host=inspectHostSnapshot(repo);
 write(dir,'data/level.json','{"answer":42,"name":"new payload"}');write(dir,'data/notes.txt','binary-safe text\n世界');
 write(dir,'assets.json',{version:1,assets:[
  {id:'data://level',kind:'data',source:'data/level.json',encoding:{format:'json',mime:'application/json',decoder:'json'}},
  {id:'data://notes',kind:'data',source:'data/notes.txt',encoding:{format:'text',mime:'text/plain',decoder:'text'}}
 ]});
 write(dir,'scripts/main.luau',`local module=require('./value')
 return {start=function(api)
   assert(module==42, 'fresh module was not loaded')
   local data=api.assets.load('data://level')
   assert(data.answer==42 and data.name=='new payload', 'fresh JSON data was not staged')
   assert(api.assets.load('data://notes')=='binary-safe text\\n世界', 'fresh text data was not staged')
   api.observation.set('publisher_check', 'module/json/text passed')
 end,update=function()end}`);
 return{root,dir,args:{project:dir,inputExport:b.root,hostRoot:repo,hostSha256:host.sha256,hostCommit:process.env.UNONE_WEB_REFRESH_HOST_COMMIT??'1'.repeat(40),runtime,runtimeSha256,output:path.join(root,'output')}};
}
test('actual pinned WASM loads fresh source module plus JSON/text data before publishing',integrationOptions,async t=>{
 const {dir,args}=integrationInput(t),report=await refreshOfficialWeb(args),published=verifiedExport(args.output);
 assert.equal(report.preparation.validation.status,'passed');assert.equal(report.preparation.validation.initial_frame,0);assert.match(report.preparation.validation.initial_digest,/^sha256:[a-f0-9]{64}$/);
 assert.match(report.preparation.validation.scope,/Actual pinned production WASM/);assert.equal(report.preparation.mode,'source-ingestion-refresh');assert(report.preparation.limitations.some(v=>v.includes('SDK')));
 assert.equal(published.generation_matches,true);assert.equal(report.preparation.runtime_manifest_sha256,args.runtimeSha256);assert.equal(report.preparation.project.script_sha256,sha(fs.readFileSync(path.join(dir,'scripts/main.luau'))));
 const payload=json(path.join(args.output,'content/project.json'));assert.equal(payload.script_modules['value.luau'],'return 42');assert.deepEqual(payload.data_assets.map(v=>v.loader),['json','text']);assert(!Object.hasOwn(payload,'script_bytecode'));
 for(const name of ['data/level.json','data/notes.txt'])assert.deepEqual(fs.readFileSync(path.join(args.output,'content',name)),fs.readFileSync(path.join(dir,name)));
 t.diagnostic(JSON.stringify({actual_core_validation:report.preparation.validation,runtime_manifest_sha256:report.preparation.runtime_manifest_sha256,runtime_wasm_sha256:report.preparation.runtime_wasm_sha256,core_source_commit:report.preparation.core_source_commit,host_sha256:report.preparation.host_sha256,source_script_sha256:report.preparation.project.script_sha256,release_root:report.release_root,generation_matches:published.generation_matches,module_sources:report.preparation.project.module_sources,staged_data_loaders:payload.data_assets.map(v=>v.loader),indexed_files:report.files.length}));
});
test('actual Core JSON decoder rejection and entry compile failure never publish output',integrationOptions,async t=>{
 const {dir,args}=integrationInput(t);write(dir,'data/level.json','{"answer":');
 await assert.rejects(refreshOfficialWeb(args),error=>{t.diagnostic(JSON.stringify({actual_failure:'invalid_json_data',error:String(error)}));return /ASSET_JSON_INVALID/.test(String(error));});assert(!fs.existsSync(args.output));
 write(dir,'data/level.json','{"answer":42,"name":"new payload"}');write(dir,'scripts/main.luau','return {start=function( this is not valid Luau');
 await assert.rejects(refreshOfficialWeb(args),error=>{t.diagnostic(JSON.stringify({actual_failure:'entry_compile',error:String(error)}));return /HOST_PROJECT_REJECTED/.test(String(error));});assert(!fs.existsSync(args.output));
});
