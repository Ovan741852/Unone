import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {sourceFile,fileRecord,dataRecord,json,text,put,requireThat,order,encodeJson} from './web-export-files.mjs';

const assetFields=['id','source','kind','bundle','files','encoding','import'];
const knownImages={'.png':['png','image/png'],'.jpg':['jpeg','image/jpeg'],'.jpeg':['jpeg','image/jpeg'],'.webp':['webp','image/webp'],'.svg':['svg','image/svg+xml']};
const knownAudio={'.wav':['wav','audio/wav'],'.mp3':['mp3','audio/mpeg'],'.ogg':['ogg','audio/ogg']};
function closed(value,allowed,code){requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k)),code);}
function urlPath(value,code){requireThat(typeof value==='string'&&!/[\\:%?#\x00-\x1f\x7f]/.test(value),code,'expected a literal project-relative URL path');return value;}
function normalized(asset){return{id:asset.id,source:asset.source,kind:asset.kind??'texture2d',bundle:asset.bundle??'content',files:asset.files??[],encoding:asset.encoding??null,import:asset.import??null};}
function sameSourceSpec(a,b){return isDeepStrictEqual(normalized(a),normalized(b));}
function encodingFor(asset){
 if(asset.kind==='data')return asset.encoding;
 const pair=(asset.kind==='texture2d'?knownImages:knownAudio)[path.extname(asset.source).toLowerCase()];
 requireThat(pair,'WEB_REFRESH_NEW_DERIVED_FORMAT_UNSUPPORTED',asset.id);
 const [format,mime]=pair,decoder=asset.kind==='texture2d'?'image':'audio';
 if(asset.encoding!=null){closed(asset.encoding,['format','format_version','mime','decoder','companions'],'WEB_REFRESH_ENCODING_INVALID');requireThat(asset.encoding.format===format&&asset.encoding.mime===mime&&asset.encoding.decoder===decoder&&asset.encoding.format_version==null&&(asset.encoding.companions??[]).length===0,'WEB_REFRESH_ENCODING_UNSUPPORTED',asset.id);return asset.encoding;}
 return{format,mime,decoder,companions:[]};
}
function readModules(project,entry){
 const root=path.posix.dirname(entry),pending=[root==='.'?'':root],modules={};let count=0;
 while(pending.length){const dir=pending.pop();const actual=dir?path.join(project,...dir.split('/')):project;
  for(const item of fs.readdirSync(actual,{withFileTypes:true})){if(item.name.startsWith('.'))continue;const name=dir?dir+'/'+item.name:item.name;if(item.isDirectory()){sourceFileDirectory(project,name);pending.push(name);}else if(item.name.endsWith('.luau')&&name!==entry){const key=path.posix.relative(root,name);requireThat(++count<=4096,'SCRIPT_MODULE_LIMIT');Object.defineProperty(modules,key,{value:text(sourceFile(project,name)),enumerable:true});}}
 }
 return modules;
}
function sourceFileDirectory(root,relative){const probe=path.join(root,...relative.split('/'));requireThat(!fs.lstatSync(probe).isSymbolicLink()&&fs.realpathSync(probe).startsWith(root+path.sep),'WEB_REFRESH_LINK',relative);}
function assetRecord(project,base,raw,files,reused){
 closed(raw,assetFields,'WEB_REFRESH_ASSET_INVALID');requireThat(typeof raw.id==='string'&&raw.id&&raw.id.length<=1024&&typeof raw.source==='string','WEB_REFRESH_ASSET_INVALID');
 const asset={...raw,kind:raw.kind??'texture2d',bundle:raw.bundle??'content'};
 requireThat(['texture2d','audio','mesh3d','effekseer','data'].includes(asset.kind),'PLAYER_DECODER_UNAVAILABLE',asset.id);
 requireThat(asset.files===undefined||Array.isArray(asset.files)&&asset.files.every(f=>typeof f==='string'),'WEB_REFRESH_ASSET_INVALID',asset.id);
 if(asset.encoding!=null){closed(asset.encoding,['format','format_version','mime','decoder','companions'],'WEB_REFRESH_ENCODING_INVALID');for(const key of ['format','mime','decoder'])requireThat(typeof asset.encoding[key]==='string','WEB_REFRESH_ENCODING_INVALID',asset.id);requireThat(asset.encoding.format_version==null||typeof asset.encoding.format_version==='string','WEB_REFRESH_ENCODING_INVALID');requireThat(Array.isArray(asset.encoding.companions??[]),'WEB_REFRESH_ENCODING_INVALID');for(const c of asset.encoding.companions??[]){closed(c,['path','role','mime'],'WEB_REFRESH_ENCODING_INVALID');requireThat(['path','role','mime'].every(k=>typeof c[k]==='string'),'WEB_REFRESH_ENCODING_INVALID');}}
 requireThat([asset.source,...(asset.files??[])].every(name=>!/[#%]/.test(name)),'WEB_REFRESH_ASSET_PATH_UNSUPPORTED',asset.id);
 const records=[asset.source,...(asset.files??[])].map(name=>fileRecord(sourceFile(project,name),'content/'+name));
 const old=base.assets.find(a=>a.id===asset.id),matches=old&&sameSourceSpec(raw,old)&&records.every(r=>base.logical.get(r.path)?.sha256===r.sha256&&base.logical.get(r.path)?.bytes===r.bytes);
 if(matches){for(const r of records)put(files,r);reused.push(asset.id);return {...old};}
 requireThat(asset.import==null,'WEB_REFRESH_NEW_IMPORT_UNSUPPORTED',asset.id);
 requireThat(!['mesh3d','effekseer'].includes(asset.kind),'WEB_REFRESH_NEW_DERIVED_FORMAT_UNSUPPORTED',asset.id);
 requireThat((asset.files??[]).length===0,'WEB_REFRESH_NEW_COMPANIONS_UNSUPPORTED',asset.id);
 const encoding=encodingFor(asset);if(encoding!==undefined)asset.encoding=encoding;for(const r of records)put(files,r);return asset;
}
function validateFont(project,files,face,seen){
 closed(face,['family','source','weight'],'WEB_REFRESH_FONT_INVALID');const weight=face.weight??400;
 requireThat(typeof face.family==='string'&&Buffer.byteLength(face.family)>0&&Buffer.byteLength(face.family)<=128&&!/[\x00-\x1f\x7f]/.test(face.family)&&Number.isInteger(weight)&&weight>=100&&weight<=900&&typeof face.source==='string'&&/\.(ttf|otf)$/i.test(face.source),'WEB_REFRESH_FONT_INVALID');
 urlPath(face.source,'UI_FONT_PATH_INVALID');
 const key=JSON.stringify([face.family,weight]);requireThat(!seen.has(key),'UI_FONT_DUPLICATE');seen.add(key);put(files,fileRecord(sourceFile(project,face.source),'content/'+face.source));
 return{family:face.family,source:face.source,weight};
}
function presentationFor(project,files,base){
 const file=path.join(project,'player.presentation.json');const raw=fs.existsSync(file)?json(sourceFile(project,'player.presentation.json')):{};
 const allowed=['texture_cache','spatial_backend','renderer_mode','renderer_module','renderer_files','ui','bloom','antialias','projected_raster','projected_material_profile','physical_input','show_performance','runtime_backend','job_policy','interpolation','interpolate_instances','render_extensions'];closed(raw,allowed,'WEB_REFRESH_PRESENTATION_INVALID');
 requireThat((raw.renderer_mode??'official')==='official'&&raw.renderer_module==null&&(raw.renderer_files??[]).length===0,'WEB_REFRESH_OFFICIAL_ONLY');
 const result={spatial_backend:'cpu',renderer_mode:'official',renderer_module:null,renderer_files:[],ui:{font_source:null,font_family:null,fonts:[]},bloom:false,show_performance:false,runtime_backend:'main',job_policy:{mode:'auto',max_workers:2,memory_budget_mb:128},interpolation:false,interpolate_instances:[],...raw};
 for(const key of ['bloom','show_performance','interpolation'])requireThat(typeof result[key]==='boolean','WEB_REFRESH_PRESENTATION_INVALID',key);
 requireThat(['cpu','gpu','auto'].includes(result.spatial_backend)&&['main','worker'].includes(result.runtime_backend),'WEB_REFRESH_PRESENTATION_INVALID');
 closed(result.job_policy,['mode','max_workers','memory_budget_mb'],'WEB_REFRESH_JOB_POLICY_INVALID');result.job_policy={mode:'auto',max_workers:2,memory_budget_mb:128,...result.job_policy};requireThat(['auto','inline','workers'].includes(result.job_policy.mode)&&Number.isInteger(result.job_policy.max_workers)&&result.job_policy.max_workers>=0&&result.job_policy.max_workers<=4&&Number.isInteger(result.job_policy.memory_budget_mb)&&result.job_policy.memory_budget_mb>=0&&result.job_policy.memory_budget_mb<=1024,'WEB_REFRESH_JOB_POLICY_INVALID');
 closed(result.ui,['font_source','font_family','fonts'],'WEB_REFRESH_FONT_INVALID');result.ui={font_source:null,font_family:null,fonts:[],...result.ui};const seen=new Set();requireThat(Array.isArray(result.ui.fonts)&&result.ui.fonts.length+Number(result.ui.font_source!=null)<=32,'UI_FONT_LIMIT');result.ui.fonts=result.ui.fonts.map(face=>validateFont(project,files,face,seen));
 if(result.ui.font_source!=null){requireThat(typeof result.ui.font_family==='string','UI_FONT_FAMILY_REQUIRED');validateFont(project,files,{family:result.ui.font_family,source:result.ui.font_source,weight:400},seen);}
 requireThat(Array.isArray(result.render_extensions??[])&&Array.isArray(result.interpolate_instances),'WEB_REFRESH_PRESENTATION_INVALID');const kinds=new Set();
 for(const extension of result.render_extensions??[]){closed(extension,['kind','module','files'],'RENDER_EXTENSION_INVALID');requireThat(typeof extension.kind==='string'&&/^[a-z0-9._-]{1,64}$/.test(extension.kind)&&extension.kind.includes('.')&&!kinds.has(extension.kind)&&typeof extension.module==='string'&&/\.(mjs|js)$/.test(extension.module)&&Array.isArray(extension.files??[]),'RENDER_EXTENSION_INVALID');kinds.add(extension.kind);for(const name of new Set([extension.module,...(extension.files??[])]))put(files,fileRecord(sourceFile(project,urlPath(name,'RENDER_EXTENSION_PATH_INVALID')),'content/'+name));}
 return result;
}
export function assembleContent(project,base){
 const rawConfig=json(sourceFile(project,'project.unone.json')),config=structuredClone(rawConfig);
 requireThat(config&&typeof config==='object'&&!Array.isArray(config),'WEB_REFRESH_PROJECT_INVALID');
 requireThat(config.import==null,'WEB_REFRESH_IMPORT_PIPELINE_UNSUPPORTED','run/validate imports separately; this tool never executes importers');
 delete config.import;
 if(Array.isArray(config.ui_previews))for(const preview of config.ui_previews)delete preview.save_fixture;
 const files=new Map(),oldAssets=base.logical.get('content/assets.json');const baseAssets=oldAssets?json(oldAssets.source):{assets:[]};const oldPresentation=base.logical.get('content/presentation.json');
 const assetManifest=config.asset_manifest?json(sourceFile(project,config.asset_manifest)):{version:1,assets:[]};closed(assetManifest,['version','assets'],'WEB_REFRESH_ASSET_MANIFEST_INVALID');requireThat((assetManifest.version??1)===1&&Array.isArray(assetManifest.assets),'WEB_REFRESH_ASSET_MANIFEST_INVALID');
 const reused=[],ids=new Set(),assets={version:1,assets:assetManifest.assets.map(raw=>{closed(raw,assetFields,'WEB_REFRESH_ASSET_INVALID');requireThat(!ids.has(raw.id),'ASSET_MANIFEST_DUPLICATE_ID',raw.id);ids.add(raw.id);return assetRecord(project,{logical:base.logical,assets:baseAssets.assets??[]},raw,files,reused);})};
 const entry=config.entry_script??'scripts/main.luau',script=text(sourceFile(project,entry)),script_modules=readModules(project,entry),scene=config.main_scene?json(sourceFile(project,config.main_scene)):null,job_sources={};
 for(const [id,name]of Object.entries(config.job_scripts??{}))Object.defineProperty(job_sources,id,{value:text(sourceFile(project,name)),enumerable:true});
 const payload={config,job_sources,script,scene,...(Object.keys(script_modules).length?{script_modules}:{})};
 const data=assets.assets.filter(a=>a.kind==='data').map(a=>({id:a.id,source:a.source,loader:a.encoding?.decoder??'bytes'}));if(data.length)payload.data_assets=data;
 const declared=new Map(assets.assets.map(a=>[a.id,a]));for(const entity of scene?.entities??[]){if(entity.sprite)requireThat(declared.get(entity.sprite.asset)?.kind==='texture2d','WEB_REFRESH_SPRITE_ASSET_UNDECLARED',entity.sprite.asset);if(entity.mesh3d)requireThat(['mesh://primitive/box','mesh://primitive/sphere'].includes(entity.mesh3d.asset)||declared.get(entity.mesh3d.asset)?.kind==='mesh3d','WEB_REFRESH_MESH_ASSET_UNDECLARED',entity.mesh3d.asset);}
 const presentation=presentationFor(project,files,oldPresentation?json(oldPresentation.source):{});
 put(files,dataRecord('content/project.json',encodeJson(payload)));put(files,dataRecord('content/assets.json',encodeJson(assets)));put(files,dataRecord('content/presentation.json',encodeJson(presentation)));
 return{files,payload,assets,presentation,rawConfig,data:data.map(d=>({id:d.id,source:files.get('content/'+d.source).source})),reused,project_pins:{config_sha256:fileRecord(sourceFile(project,'project.unone.json'),'').sha256,script_sha256:fileRecord(sourceFile(project,entry),'').sha256,module_sources:Object.keys(script_modules).sort(order)}};
}
