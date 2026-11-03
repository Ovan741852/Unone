import fs from 'node:fs';
import {sourceFile,fileRecord,text,sha,order,requireThat,dataRecord,put} from './web-export-files.mjs';

export function inspectHostSnapshot(root){
 const exporter=text(sourceFile(root,'crates/unone-cli/src/export.rs'));
 const list=exporter.match(/pub\(crate\) const WEB_FILES: &\[&str\] = &\[([\s\S]*?)\];/);
 requireThat(list,'WEB_REFRESH_HOST_CONTRACT','Rust WEB_FILES not found');
 const names=[...list[1].matchAll(/"([^"\r\n]+)"/g)].map(m=>'web/'+m[1]);
 requireThat(names.length>80&&new Set(names).size===names.length,'WEB_REFRESH_HOST_CONTRACT','WEB_FILES inventory');
 const optional=['effekseer.js','effekseer.wasm','LICENSE'].map(name=>'web/vendor/effekseer/'+name).filter(name=>fs.existsSync(root+'/'+name));
 const all=[...names,...optional,'web/player/index.html','crates/unone-cli/src/export.rs','crates/unone-engine/src/systems.rs','crates/unone-cli/src/hosts.rs'].sort(order);
 const files=all.map(name=>fileRecord(sourceFile(root,name),name));
 return{sha256:sha(Buffer.from(JSON.stringify(files.map(f=>[f.path,f.sha256])))),files,web_files:names};
}
export function resolveSystems(root,declared={}){
 const source=text(sourceFile(root,'crates/unone-engine/src/systems.rs')),defaults=new Map();
 const expression=/descriptor\(\s*"([^"\r\n]+)",\s*"(?:[^"\\]|\\.)*",\s*SystemStatus::\w+,\s*(true|false),\s*(true|false),/g;
 for(const m of source.matchAll(expression))defaults.set(m[1],{enabled:m[2]==='true',optional:m[3]==='true'});
 requireThat(defaults.size>=15&&defaults.has('world')&&defaults.has('ui'),'WEB_REFRESH_SYSTEM_CONTRACT');
 requireThat(declared&&typeof declared==='object'&&!Array.isArray(declared),'WEB_REFRESH_SYSTEMS_INVALID');
 for(const [name,on]of Object.entries(declared)){const d=defaults.get(name);requireThat(d&&typeof on==='boolean'&&(on||d.optional),'WEB_REFRESH_SYSTEMS_INVALID',name);d.enabled=on;}
 return [...defaults].filter(([,d])=>d.enabled).map(([name])=>name).sort(order);
}
function replace(text,from,to){requireThat(text.split(from).length===2,'WEB_REFRESH_HOST_CONTRACT',from);return text.replace(from,to);}
const disabledUi=new Set(['shared/ui-tree.js','shared/canvas-ui.mjs','shared/ui-text-input.mjs','shared/ui-cursor.mjs','shared/ui-style.mjs','shared/ui-presentation.mjs','shared/ui-image-batch.mjs','shared/ui-scroll.mjs','shared/ui-contract.mjs','shared/ui-geometry.mjs','renderer/ui-gpu.js']);
const profileMarkers=['PROFILE_IMPORT','PROFILE_INIT','PROFILE_FRAME','PROFILE_INPUT','PROFILE_TICK_END','PROFILE_TICK','PROFILE_POST_TICK','PROFILE_WAKE','PROFILE_ERROR','DEVELOPER_IMPORT','DEVELOPER_CONNECT'];
function player(source,on){
 if(!on.has('ui')){
  source=replace(source,"import {createCanvasUi,loadPresentationFonts} from '../shared/canvas-ui.mjs';","const disabledUiCompleted=Object.freeze({status:'completed'});const createCanvasUi=()=>({draw:()=>disabledUiCompleted,ready:async()=>{},pointer(){return false},hitTest(){return null},releaseAll(){},setFont(){},setAssetObserver(){},assetDiagnostics:()=>null,report:()=>({backend:'disabled',nodes:0,render_regions:0,assets:[],diagnostics:[]})});const loadPresentationFonts=async()=>{};");
  source=replace(source,"import {createUiTextInputHost} from '../shared/ui-text-input.mjs';","const createUiTextInputHost=()=>({draw:s=>s,pointer:()=>false,routeKey:()=>false,setExternalInput(){},suspend(){},dispose(){}});");
  source=replace(source,"import {createUiCursorHost,loadCursorImage} from '../shared/ui-cursor.mjs';","const createUiCursorHost=()=>({update:()=>disabledUiCompleted,ready:async()=>{},dispose(){},report:()=>({kind:'default'})});const loadCursorImage=async()=>null;");
  source=replace(source,"import {createUiScrollHost} from '../shared/ui-scroll.mjs';","const createUiScrollHost=()=>({draw:s=>s,pointer:()=>false,routeKey:()=>false,routeWheel:()=>false,setExternalInput(){},cancel(){},dispose(){}});");
 }
 if(!on.has('audio'))source=replace(source,"import {createAudioPlayback} from '../shared/audio-playback.js';","const createAudioPlayback=async()=>null;");
 if(!on.has('save')){
  source=replace(source,'const next=serializedSavePayload(snapshot);if(next!==saved){localStorage.setItem(key,next);saved=next;}','');
  source=replace(source,"try{saved=localStorage.getItem(key);project.restored_save=JSON.parse(saved??'null');}catch(error){throw new Error(`SAVE_READ_FAILED: ${error.message}`);}", 'project.restored_save=null;');
 }
 for(const marker of profileMarkers)source=replace(source,`/* ${marker} */`,'');return source;
}
export function assembleHost(root,inspection,enabled,runtime,assets){
 const on=new Set(enabled),files=new Map(),pins=new Map(inspection.files.map(f=>[f.path,f]));
 for(const name of inspection.web_files){const short=name.slice(4);if(short==='shared/profile-window.js'||!on.has('audio')&&short==='shared/audio-playback.js'||!on.has('ui')&&disabledUi.has(short)||!on.has('effekseer')&&short==='renderer/effekseer.js'||short==='vendor/rapier/LICENSE'&&!runtime.compiled_systems.includes('physics3d'))continue;
  let bytes=fs.readFileSync(sourceFile(root,name));
  requireThat(sha(bytes)===pins.get(name)?.sha256&&bytes.length===pins.get(name)?.bytes,'WEB_REFRESH_HOST_CHANGED',name);
  if(short==='renderer/three.js'){let value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!on.has('particle'))value=replace(value,'import { createParticleRenderer } from "./particles.js?build=particle-texture-colorbins-v1";','const createParticleRenderer=()=>({draw(){},clear(){},contextLost(_retire){},dispose(){},count:0,debugBatches:[],metrics:()=>({groups:0,capacity:0,instance_buffer_bytes:0,compactions:0})});');if(!on.has('effekseer'))value=replace(value,"import {createEffects} from './effekseer.js';",'const createEffects=async()=>null;');if(!on.has('ui'))value=replace(value,"import {createGpuUi} from './ui-gpu.js';",'const createGpuUi=()=>null;');bytes=Buffer.from(value.replaceAll('../vendor/three/three.module.js','../vendor/three/three.player.min.js'));}
  if(short==='player/main.js')bytes=Buffer.from(player(new TextDecoder('utf-8',{fatal:true}).decode(bytes),on));
  put(files,dataRecord(name,bytes));
 }
 if(on.has('effekseer')||assets.assets.some(a=>a.kind==='effekseer'))for(const name of ['effekseer.js','effekseer.wasm','LICENSE']){const rel='web/vendor/effekseer/'+name;put(files,fileRecord(sourceFile(root,rel),rel));}
 let html=text(sourceFile(root,'web/player/index.html'));requireThat(!/<base\b/i.test(html)&&html.split('<head>').length===2&&html.split('</head>').length===2,'WEB_REFRESH_HTML_CONTRACT');html=replace(html,'__RUNTIME_JS__',runtime.javascript);
 return{files,html};
}

// Same bounded literal-specifier scope as the Rust exporter: not JS execution.
function tokens(source){const out=[];let i=0;while(i<source.length){const c=source[i];if(/\s/.test(c)){i++;continue;}if(source.startsWith('//',i)){i=source.indexOf('\n',i);if(i<0)break;continue;}if(source.startsWith('/*',i)){const end=source.indexOf('*/',i+2);i=end<0?source.length:end+2;continue;}if(c==='"'||c==="'"||c==='`'){let value='',quote=c;i++;while(i<source.length){const next=source[i++];if(next===quote)break;if(next==='\\'&&i<source.length)value+=source[i++];else value+=next;}if(quote!=='`')out.push({text:value});continue;}if(/[A-Za-z_$]/.test(c)){const start=i++;while(i<source.length&&/[A-Za-z0-9_$]/.test(source[i]))i++;out.push({name:source.slice(start,i)});continue;}if(c==='/'){const last=out.at(-1);if(!last||last.punct&&'(=:[,!;?{'.includes(last.punct)||['return','case','throw'].includes(last.name)){i++;let cls=false;while(i<source.length){const n=source[i++];if(n==='\\')i++;else if(n==='[')cls=true;else if(n===']')cls=false;else if(n==='/'&&!cls)break;}while(/[a-z]/i.test(source[i]??'')&&i<source.length)i++;out.push({punct:'/'});continue;}}out.push({punct:c});i++;}return out;}
export function validateDependencies(files){let edges=0;for(const [name,file]of files){if(!/\.m?js$/.test(name))continue;const source=file.data??fs.readFileSync(file.source),t=tokens(new TextDecoder('utf-8',{fatal:true}).decode(source)),specs=[];for(let i=0;i<t.length;i++){const v=t[i];if(v.name==='import'&&t[i-1]?.punct!=='.'||v.name==='export'&&['{','*'].includes(t[i+1]?.punct)){if(t[i+1]?.text)specs.push(t[i+1].text);else if(t[i+1]?.punct==='('&&t[i+2]?.text)specs.push(t[i+2].text);else if(t[i+1]?.punct!=='.')for(let j=i+1;j<t.length&&t[j].punct!==';';j++)if(t[j].name==='from'){if(t[j+1]?.text)specs.push(t[j+1].text);break;}}if(v.name==='new'&&t[i+1]?.name==='URL'&&t[i+2]?.punct==='('&&t[i+3]?.text&&t[i+4]?.punct===','&&t[i+5]?.name==='import'&&t[i+6]?.punct==='.'&&t[i+7]?.name==='meta'&&t[i+8]?.punct==='.'&&t[i+9]?.name==='url')specs.push(t[i+3].text);}
 for(const spec of specs){if(/^(?:https?|data|blob):/.test(spec))continue;requireThat(spec.startsWith('.')&&!/[\\%\x00]/.test(spec),'WEB_REFRESH_MODULE_SPECIFIER',name+' -> '+spec);const parts=name.split('/');parts.pop();for(const p of spec.split(/[?#]/)[0].split('/')){if(p==='.'||p==='')continue;if(p==='..')requireThat(parts.pop(),'WEB_REFRESH_MODULE_ESCAPE',spec);else parts.push(p);}const target=parts.join('/');requireThat(files.has(target),'WEB_MODULE_DEPENDENCY_MISSING',name+' -> '+spec);edges++;}}
 return edges;
}
