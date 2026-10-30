#!/usr/bin/env node
// Engine-owned, offline publication. Never executes code from the input export.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseArgs,isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';

const TOOL_FILE=fileURLToPath(import.meta.url),TOOL_ROOT=path.resolve(path.dirname(TOOL_FILE),'..');
const PLAN_PATH='content/image-assets.json',PLAN_META='<meta name="unone-image-assets" content="content/image-assets.json">';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const byteOrder=(a,b)=>Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8'));
const fail=(code,message)=>{throw Error(code+(message?': '+message:''));};
function requireThat(value,code,message){if(!value)fail(code,message);}
export function portablePath(value){
 requireThat(typeof value==='string'&&value.length>0&&Buffer.from(value,'utf8').toString('utf8')===value&&!/[<>:"\\|?*\x00-\x1f]/.test(value)&&!path.posix.isAbsolute(value)&&!path.win32.isAbsolute(value),'IMAGE_PRELOAD_PATH_INVALID',String(value));
 for(const part of value.split('/'))requireThat(part&&part!=='.'&&part!=='..'&&!/[. ]$/.test(part)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),'IMAGE_PRELOAD_PATH_INVALID',value);
 return value;
}
function inside(root,file){const relative=path.relative(root,file);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
function guardExisting(file,checks){
 const absolute=path.resolve(file),parts=[];let current=absolute;
 for(;;){parts.push(current);const parent=path.dirname(current);if(parent===current)break;current=parent;}
 for(const part of parts.reverse()){const stat=fs.lstatSync(part);requireThat(!stat.isSymbolicLink(),'IMAGE_PRELOAD_REPARSE_PATH',part);checks.add(part);}
 return fs.realpathSync(absolute);
}
function safeFile(root,relative,checks){
 portablePath(relative);const file=path.join(root,...relative.split('/')),actual=guardExisting(file,checks);
 requireThat(inside(root,actual)&&fs.statSync(actual).isFile(),'IMAGE_PRELOAD_SOURCE_ESCAPE',relative);return actual;
}
function windowsReparseCheck(checks){
 if(process.platform!=='win32')return;
 // Paths are JSON stdin, never interpolated into shell code. Node lstat covers
 // links/junctions; the Windows attribute check also rejects other reparse tags.
 const code="$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.Encoding]::UTF8;[Console]::OutputEncoding=[Text.Encoding]::UTF8;$items=ConvertFrom-Json ([Console]::In.ReadToEnd());$bad=@();foreach($item in $items){$value=Get-Item -LiteralPath $item -Force;if(($value.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){$bad+=$item}};ConvertTo-Json -InputObject @($bad) -Compress";
 const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',code],{input:JSON.stringify([...checks]),encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
 requireThat(!result.error&&result.status===0,'IMAGE_PRELOAD_REPARSE_CHECK_FAILED',String(result.error??result.stderr));
 const bad=JSON.parse(result.stdout.replace(/^\uFEFF/,''));requireThat(Array.isArray(bad)&&bad.length===0,'IMAGE_PRELOAD_REPARSE_PATH',JSON.stringify(bad));
}
function fileDigest(file){
 const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024),fd=fs.openSync(file,'r');let size=0;
 try{for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;size+=n;requireThat(Number.isSafeInteger(size),'IMAGE_PRELOAD_FILE_TOO_LARGE',file);hash.update(buffer.subarray(0,n));}}finally{fs.closeSync(fd);}
 return{bytes:size,sha256:hash.digest('hex')};
}
function utf8(bytes,preserveBom=false){return new TextDecoder('utf-8',{fatal:true,ignoreBOM:preserveBom}).decode(bytes);}
function jsonFile(file){return JSON.parse(utf8(fs.readFileSync(file)));}
function boundedPlan(file,maximum){
 const fd=fs.openSync(file,'r');try{
  const stat=fs.fstatSync(fd);requireThat(stat.isFile()&&stat.size<=maximum,'IMAGE_PRELOAD_PLAN_LIMIT');
  const bytes=Buffer.alloc(Math.min(stat.size+1,maximum+1));let length=0;
  while(length<bytes.length){const n=fs.readSync(fd,bytes,length,bytes.length-length,null);if(!n)break;length+=n;}
  // A growing file cannot turn a checked small size into an unbounded read.
  requireThat(length<=stat.size&&length<=maximum&&fs.fstatSync(fd).size===stat.size,'IMAGE_PRELOAD_PLAN_LIMIT','plan changed while reading');return bytes.subarray(0,length);
 }finally{fs.closeSync(fd);}
}
function indexedFile(root,record,checks){
 requireThat(record&&Number.isSafeInteger(record.bytes)&&record.bytes>=0&&typeof record.sha256==='string'&&/^[0-9a-f]{64}$/.test(record.sha256),'IMAGE_PRELOAD_INDEX_INVALID',String(record?.path));
 const source=safeFile(root,record.path,checks),actual=fileDigest(source);
 requireThat(actual.bytes===record.bytes&&actual.sha256===record.sha256,'IMAGE_PRELOAD_HASH_MISMATCH',record.path);return{path:record.path,bytes:record.bytes,sha256:record.sha256,source};
}
function walkFiles(root,checks){
 const found=new Set(),pending=[''];while(pending.length){const directory=pending.pop();for(const entry of fs.readdirSync(path.join(root,directory),{withFileTypes:true})){
  const relative=directory?directory+'/'+entry.name:entry.name;portablePath(relative);const file=path.join(root,...relative.split('/'));guardExisting(file,checks);
  if(entry.isDirectory())pending.push(relative);else{requireThat(entry.isFile(),'IMAGE_PRELOAD_FILE_TYPE',relative);found.add(relative);}
 }}return found;
}
function metadataTags(html,name){
 const tags=[];for(const match of html.matchAll(/<meta\b[^>]*>/gi)){
  const attributes=new Map();for(const a of match[0].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)){
   const key=a[1].toLowerCase();requireThat(!attributes.has(key),'IMAGE_PRELOAD_HTML_INVALID','duplicate meta attribute');attributes.set(key,a[2]??a[3]??a[4]);
  }
  if(attributes.get('name')===name)tags.push({text:match[0],content:attributes.get('content'),at:match.index});
 }return tags;
}
function unbase(html,release){
 const needle='<head><base href="'+release+'">';requireThat(html.split(needle).length===2,'IMAGE_PRELOAD_BASE_INVALID','expected one engine base');
 const result=html.replace(needle,'<head>');requireThat(!/<base\b/i.test(result)&&result.split('<head>').length===2&&result.split('</head>').length===2,'IMAGE_PRELOAD_BASE_INVALID');return result;
}
export function webGeneration(html,files){
 // Exact seal_web_generation primitive (export.rs): serde tuple -> JSON array,
 // UTF-8 String ordering, SHA-256. Files never include index/export/old releases.
 const inventory=files.map(file=>[file.path,file.sha256]).sort((a,b)=>byteOrder(a[0],b[0])||byteOrder(a[1],b[1]));
 return'releases/'+sha(Buffer.from(JSON.stringify([html,inventory]),'utf8'))+'/';
}
function assertConfigured(raw,actual,label){
 if(raw===null&&actual===undefined)return;
 if(Array.isArray(raw)){requireThat(Array.isArray(actual)&&raw.length===actual.length,'IMAGE_PRELOAD_PROJECT_STALE',label);raw.forEach((v,i)=>assertConfigured(v,actual[i],label+'/'+i));return;}
 if(raw&&typeof raw==='object'){requireThat(actual&&typeof actual==='object'&&!Array.isArray(actual),'IMAGE_PRELOAD_PROJECT_STALE',label);for(const [key,value]of Object.entries(raw)){requireThat(Object.hasOwn(actual,key)||value===null,'IMAGE_PRELOAD_PROJECT_STALE',label+'/'+key);assertConfigured(value,actual[key],label+'/'+key);}return;}
 requireThat(Object.is(raw,actual),'IMAGE_PRELOAD_PROJECT_STALE',label);
}
async function trustedValidator(checks){
 let relative='web/shared/asset-encoding.js',mode='repository';
 const sdkName=path.join(TOOL_ROOT,'sdk.json');
 if(fs.existsSync(sdkName)){
  mode='sdk';guardExisting(sdkName,checks);const sdk=jsonFile(sdkName);requireThat(sdk.version===1&&Array.isArray(sdk.files),'IMAGE_PRELOAD_SDK_INVALID');portablePath(sdk.templates);
  relative=sdk.templates+'/web/shared/asset-encoding.js';
  const own=path.relative(TOOL_ROOT,TOOL_FILE).split(path.sep).join('/');
  for(const name of [own,relative]){const records=sdk.files.filter(record=>record.path===name);requireThat(records.length===1,'IMAGE_PRELOAD_SDK_FILE_UNLISTED',name);indexedFile(TOOL_ROOT,records[0],checks);}
 }
 const sourceFile=safeFile(TOOL_ROOT,relative,checks),bytes=fs.readFileSync(sourceFile),source=utf8(bytes,true);
 windowsReparseCheck(checks);
 // This trusted SDK module is deliberately self-contained. A data module keeps
 // its ES-module semantics even in a relocated SDK without package.json/type.
 requireThat(!/^\s*(?:import\s|export\s+[^\n]*\sfrom\s)/m.test(source),'IMAGE_PRELOAD_VALIDATOR_IMPORTS_UNSUPPORTED');
 const module=await import('data:text/javascript;base64,'+bytes.toString('base64'));
 requireThat(module.IMAGE_PRELOAD_PLAN_VERSION===1&&module.IMAGE_PRELOAD_PLAN_MAX_BYTES===1048576&&typeof module.validateImagePreloadPlan==='function'&&typeof module.createAssetCatalog==='function','IMAGE_PRELOAD_HOST_UNSUPPORTED','SDK validator is missing');
 return{...module,sourceFile,sha256:sha(bytes),mode};
}
function validateProject(project,payload,assets,logical,checks){
 requireThat(payload&&payload.config&&typeof payload.config==='object'&&Array.isArray(assets?.assets),'IMAGE_PRELOAD_EXPORT_INVALID','project/catalog shape');
 const configFile=safeFile(project,'project.unone.json',checks),raw=jsonFile(configFile);
 // Mirror only ProjectConfig's explicit serde omissions, not arbitrary unknown
 // fields. UiPreviewSpec.save_fixture is tool-only and never exported.
 for(const name of ['job_scripts','runtime_packages'])if(raw[name]&&typeof raw[name]==='object'&&!Array.isArray(raw[name])&&Object.keys(raw[name]).length===0)delete raw[name];
 if(Array.isArray(raw.ui_previews))raw.ui_previews=raw.ui_previews.map(preview=>{const copy={...preview};delete copy.save_fixture;return copy;});
 assertConfigured(raw,payload.config,'config');
 const compareSource=(relative,text,label)=>{requireThat(typeof relative==='string'&&typeof text==='string','IMAGE_PRELOAD_PROJECT_STALE',label);const file=safeFile(project,relative,checks);requireThat(sha(fs.readFileSync(file))===sha(Buffer.from(text,'utf8')),'IMAGE_PRELOAD_PROJECT_STALE',label);};
 compareSource(payload.config.entry_script??'scripts/main.luau',payload.script,'entry script');
 for(const [id,relative]of Object.entries(payload.config.job_scripts??{}))compareSource(relative,payload.job_sources?.[id],'job '+id);
 const scene=payload.config.main_scene?jsonFile(safeFile(project,payload.config.main_scene,checks)):null;
 requireThat(isDeepStrictEqual(scene,payload.scene),'IMAGE_PRELOAD_PROJECT_STALE','main scene');
 if(payload.config.asset_manifest){const sourceAssets=jsonFile(safeFile(project,payload.config.asset_manifest,checks));assertConfigured(sourceAssets,assets,'asset manifest');}
 const ids=new Set();for(const asset of assets.assets){requireThat(asset&&typeof asset.id==='string'&&asset.id.length>0&&!ids.has(asset.id)&&typeof asset.source==='string'&&(asset.files===undefined||(Array.isArray(asset.files)&&asset.files.every(file=>typeof file==='string'))),'IMAGE_PRELOAD_ASSET_CATALOG_INVALID','duplicate/missing id or source');ids.add(asset.id);
  for(const relative of [asset.source,...(asset.files??[])]){portablePath(relative);const exported=logical.get('content/'+relative);requireThat(exported,'IMAGE_PRELOAD_ASSET_UNLISTED',relative);const actual=fileDigest(safeFile(project,relative,checks));requireThat(actual.bytes===exported.bytes&&actual.sha256===exported.sha256,'IMAGE_PRELOAD_PROJECT_STALE','asset '+relative);}
 }
 return{config_sha256:sha(fs.readFileSync(configFile)),script_sha256:sha(Buffer.from(payload.script,'utf8'))};
}
function requiredBudgetPreflight(plan,assets,logical){
 const byId=new Map(assets.assets.map(asset=>[asset.id,asset])),required=new Set(plan.startup.flatMap(group=>plan.groups[group]));
 requireThat(required.size<=plan.budget.max_entries,'IMAGE_PRELOAD_STARTUP_BUDGET','required unique entries exceed max_entries');
 let knownBytes=0;const unknown=[];
 for(const id of required){
  const asset=byId.get(id),file=logical.get('content/'+asset.source);
  const header=Buffer.alloc(24),fd=fs.openSync(file.source,'r');let read=0;try{read=fs.readSync(fd,header,0,header.length,0);}finally{fs.closeSync(fd);}
  if(read===24&&header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&header.readUInt32BE(8)===13&&header.toString('ascii',12,16)==='IHDR'){
   const width=header.readUInt32BE(16),height=header.readUInt32BE(20),bytes=width*height*4;
   requireThat(width>0&&height>0&&Number.isSafeInteger(bytes)&&Number.isSafeInteger(knownBytes+bytes),'IMAGE_PRELOAD_PNG_HEADER_INVALID',id);knownBytes+=bytes;
  }else unknown.push(id);
 }
 requireThat(knownBytes<=plan.budget.max_bytes,'IMAGE_PRELOAD_STARTUP_BUDGET','required PNG RGBA estimate exceeds max_bytes');
 requireThat(unknown.length===0,'IMAGE_PRELOAD_STARTUP_DIMENSIONS_UNSUPPORTED','required images need bounded PNG IHDR dimensions: '+unknown.join(', '));
 return{required_entries:required.size,known_rgba_bytes_estimate:knownBytes,unknown_dimension_assets:unknown,scope:'24-byte PNG IHDR estimate only; the official browser still validates decoding and admission before READY'};
}

export async function prepareWebImageAssets({project,inputExport,output,plan}){
 requireThat(typeof project==='string'&&typeof inputExport==='string'&&typeof output==='string'&&(plan===undefined||typeof plan==='string'),'IMAGE_PRELOAD_ARGUMENTS','--project --input-export --output [--plan]');
 const checks=new Set(),projectRoot=guardExisting(path.resolve(project),checks),inputRoot=guardExisting(path.resolve(inputExport),checks),out=path.resolve(output);
 requireThat(fs.statSync(projectRoot).isDirectory()&&fs.statSync(inputRoot).isDirectory(),'IMAGE_PRELOAD_ROOT_INVALID');
 requireThat(!fs.existsSync(out)&&!inside(inputRoot,out),'IMAGE_PRELOAD_OUTPUT_NOT_FRESH',out);portablePath(path.basename(out));guardExisting(path.dirname(out),checks);
 const manifestFile=safeFile(inputRoot,'export.json',checks),manifestBytes=fs.readFileSync(manifestFile),manifest=JSON.parse(utf8(manifestBytes));
 requireThat(manifest.version===1&&manifest.renderer_mode==='official'&&Array.isArray(manifest.files)&&/^releases\/[0-9a-f]{64}\/$/.test(manifest.release_root),'IMAGE_PRELOAD_EXPORT_INVALID','official sealed export required');
 const indexed=new Map(),folded=new Set();let total=0;
 for(const record of manifest.files){portablePath(record.path);const key=record.path.toLowerCase();requireThat(!folded.has(key)&&record.path!=='export.json','IMAGE_PRELOAD_INDEX_DUPLICATE',record.path);folded.add(key);const verified=indexedFile(inputRoot,record,checks);indexed.set(record.path,verified);total+=record.bytes;requireThat(Number.isSafeInteger(total),'IMAGE_PRELOAD_INDEX_INVALID');}
 requireThat(total===manifest.total_bytes&&indexed.has('index.html'),'IMAGE_PRELOAD_INDEX_INVALID','total/index');
 const disk=walkFiles(inputRoot,checks);requireThat(disk.size===indexed.size+1&&[...disk].every(name=>name==='export.json'||indexed.has(name)),'IMAGE_PRELOAD_UNINDEXED_FILE');
 const release=manifest.release_root,logical=new Map([...indexed].filter(([name])=>name!=='index.html'&&!name.startsWith('releases/')));
 for(const [name,file]of logical){const copy=indexed.get(release+name);requireThat(copy&&copy.bytes===file.bytes&&copy.sha256===file.sha256,'IMAGE_PRELOAD_ALIAS_MISMATCH',name);}
 for(const name of indexed.keys())if(name.startsWith(release))requireThat(logical.has(name.slice(release.length)),'IMAGE_PRELOAD_GENERATION_UNPAIRED',name);
 const originalHtml=utf8(fs.readFileSync(indexed.get('index.html').source),true),htmlWithoutBase=unbase(originalHtml,release),oldGenerationMatches=webGeneration(htmlWithoutBase,[...logical.values()])===release;
 const validator=await trustedValidator(checks),hostEncoding=logical.get('web/shared/asset-encoding.js'),hostMain=logical.get('web/player/main.js');
 requireThat(hostEncoding?.sha256===validator.sha256&&hostMain,'IMAGE_PRELOAD_HOST_UNSUPPORTED','export must use matching SDK image-plan host');
 const version=metadataTags(htmlWithoutBase,'unone-image-preload-version'),headStart=htmlWithoutBase.indexOf('<head>'),headEnd=htmlWithoutBase.indexOf('</head>');
 requireThat(version.length===1&&version[0].content==='1'&&version[0].at>headStart&&version[0].at<headEnd&&utf8(fs.readFileSync(hostMain.source),true).includes('readImagePreloadPlan'),'IMAGE_PRELOAD_HOST_UNSUPPORTED','image-plan loader/version marker missing');
 const assetFile=logical.get('content/assets.json'),projectFile=logical.get('content/project.json'),presentationFile=logical.get('content/presentation.json');requireThat(assetFile&&projectFile&&presentationFile,'IMAGE_PRELOAD_EXPORT_INVALID','missing content');
 const assets=jsonFile(assetFile.source),payload=jsonFile(projectFile.source),presentation=jsonFile(presentationFile.source);requireThat((presentation.renderer_mode??'official')==='official'&&!presentation.renderer_module,'IMAGE_PRELOAD_OFFICIAL_ONLY');
 const projectIdentity=validateProject(projectRoot,payload,assets,logical,checks);
 const planFile=plan?guardExisting(path.resolve(plan),checks):safeFile(projectRoot,'player.image-assets.json',checks),rawPlan=boundedPlan(planFile,validator.IMAGE_PRELOAD_PLAN_MAX_BYTES);
 const canonicalPlan=validator.validateImagePreloadPlan(JSON.parse(utf8(rawPlan)),validator.createAssetCatalog(assets)),planBytes=Buffer.from(JSON.stringify(canonicalPlan),'utf8');
 requireThat(planBytes.length<=validator.IMAGE_PRELOAD_PLAN_MAX_BYTES,'IMAGE_PRELOAD_PLAN_LIMIT');
 const preflight=requiredBudgetPreflight(canonicalPlan,assets,logical);
 const oldPlan=metadataTags(htmlWithoutBase,'unone-image-assets');requireThat(oldPlan.length<=1&&oldPlan.every(tag=>tag.content===PLAN_PATH&&tag.at>headStart&&tag.at<headEnd),'IMAGE_PRELOAD_META_CONFLICT');
 requireThat(!logical.has(PLAN_PATH)||oldPlan.length===1,'IMAGE_PRELOAD_CONTENT_CONFLICT',PLAN_PATH);requireThat(oldPlan.length===0||logical.has(PLAN_PATH),'IMAGE_PRELOAD_CONTENT_MISSING',PLAN_PATH);
 let template=htmlWithoutBase;if(oldPlan.length)template=template.replace(oldPlan[0].text,'');template=template.replace('<head>','<head>'+PLAN_META);
 logical.set(PLAN_PATH,{path:PLAN_PATH,bytes:planBytes.length,sha256:sha(planBytes),data:planBytes});
 const files=[...logical.values()],newRelease=webGeneration(template,files),indexBytes=Buffer.from(template.replace('<head>','<head><base href="'+newRelease+'">'),'utf8');
 const destinations=new Map();for(const file of files){destinations.set(file.path,file);destinations.set(newRelease+file.path,file);}destinations.set('index.html',{bytes:indexBytes.length,sha256:sha(indexBytes),data:indexBytes});
 const paths=[...destinations.keys()].sort(byteOrder),seen=new Set();for(const name of paths){portablePath(name);requireThat(!seen.has(name.toLowerCase()),'IMAGE_PRELOAD_OUTPUT_COLLISION',name);seen.add(name.toLowerCase());}
 windowsReparseCheck(checks);
 const report={...manifest,release_root:newRelease,total_bytes:paths.reduce((n,name)=>n+destinations.get(name).bytes,0),files:paths.map(name=>({path:name,bytes:destinations.get(name).bytes,sha256:destinations.get(name).sha256})),image_assets:{version:1,path:PLAN_PATH,plan_sha256:sha(planBytes),input_manifest_sha256:sha(manifestBytes),input_generation_matches_content:oldGenerationMatches,validator_sha256:validator.sha256,validator_origin:validator.mode,project:projectIdentity,startup_preflight:preflight,tool_sha256:sha(fs.readFileSync(TOOL_FILE)),publication:'fresh export, exact Rust seal_web_generation hash primitive; input is unchanged'}};
 try{
  fs.mkdirSync(out);
  for(const name of paths){const file=destinations.get(name),target=path.join(out,...name.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});if(file.data)fs.writeFileSync(target,file.data,{flag:'wx'});else fs.copyFileSync(file.source,target,fs.constants.COPYFILE_EXCL);
   const actual=fileDigest(target);requireThat(actual.bytes===file.bytes&&actual.sha256===file.sha256,'IMAGE_PRELOAD_COPY_CHANGED',name);
  }
  fs.writeFileSync(path.join(out,'export.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return report;
 }catch(error){
  // export.json is the final publication marker. Preserve incomplete copy
  // evidence instead of recursively deleting a path after a filesystem race.
  error.message+=' (output is incomplete unless export.json was written: '+out+')';
  throw error;
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(TOOL_FILE)){
 try{const {values}=parseArgs({options:{project:{type:'string'},'input-export':{type:'string'},output:{type:'string'},plan:{type:'string'}}});requireThat(values.project&&values['input-export']&&values.output,'IMAGE_PRELOAD_ARGUMENTS','--project --input-export --output [--plan]');const report=await prepareWebImageAssets({project:values.project,inputExport:values['input-export'],output:values.output,plan:values.plan});console.log(JSON.stringify({ok:true,output:path.resolve(values.output),release_root:report.release_root,plan_sha256:report.image_assets.plan_sha256,files:report.files.length}));}
 catch(error){console.error(JSON.stringify({ok:false,error:String(error.message??error)}));process.exitCode=1;}
}
