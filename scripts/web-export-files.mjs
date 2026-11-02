// Offline official publication primitives. No subprocesses or input JS execution.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {portablePath,webGeneration} from './prepare-web-image-assets.mjs';
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const order=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
export function requireThat(value,code,detail=''){if(!value)throw Error(`${code}${detail?`: ${detail}`:''}`);}
export function inside(root,file){const r=path.relative(root,file);return r===''||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);}
export function checkedRoot(value){const result=path.resolve(value);let current=result;for(;;){requireThat(!fs.lstatSync(current).isSymbolicLink(),'WEB_REFRESH_LINK',current);const parent=path.dirname(current);if(parent===current)break;current=parent;}return fs.realpathSync(result);}
export function sourceFile(root,relative){portablePath(relative);const file=checkedRoot(path.join(root,...relative.split('/')));requireThat(inside(root,file)&&fs.statSync(file).isFile(),'WEB_REFRESH_PATH_ESCAPE',relative);return file;}
export function fileRecord(file,relative){const digest=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024),fd=fs.openSync(file,'r');let bytes=0;try{for(;;){const n=fs.readSync(fd,buffer);if(!n)break;bytes+=n;requireThat(Number.isSafeInteger(bytes),'WEB_REFRESH_FILE_LIMIT');digest.update(buffer.subarray(0,n));}}finally{fs.closeSync(fd);}return{path:relative,source:file,bytes,sha256:digest.digest('hex')};}
export function dataRecord(relative,data){return{path:relative,data,bytes:data.length,sha256:sha(data)};}
export function json(file,max=64*1024*1024){const stat=fs.statSync(file);requireThat(stat.size<=max,'WEB_REFRESH_JSON_LIMIT',file);return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file)),(_key,value,context)=>{if(typeof value==='number'){requireThat(Number.isFinite(value),'WEB_REFRESH_JSON_NUMBER',file);if(/^-?\d+$/.test(context?.source??'')&&!Number.isSafeInteger(value))requireThat(false,'WEB_REFRESH_JSON_INTEGER_PRECISION',file);}return value;});}
export function encodeJson(value){requireThat(typeof JSON.rawJSON==='function','WEB_REFRESH_NODE_CAPABILITY','Node with JSON.rawJSON is required');return Buffer.from(JSON.stringify(value,(_key,v)=>Object.is(v,-0)?JSON.rawJSON('-0.0'):v));}
export function text(file,max=256*1024*1024){requireThat(fs.statSync(file).size<=max,'WEB_REFRESH_SOURCE_LIMIT',file);return new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file));}
export function put(files,record){portablePath(record.path);const old=files.get(record.path);requireThat(!old||old.sha256===record.sha256&&old.bytes===record.bytes,'WEB_REFRESH_CONTENT_CONFLICT',record.path);files.set(record.path,record);}
function inventory(root){const result=[],pending=[''];while(pending.length){const dir=pending.pop();for(const item of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const name=dir?dir+'/'+item.name:item.name;portablePath(name);const actual=checkedRoot(path.join(root,name));requireThat(inside(root,actual),'WEB_REFRESH_PATH_ESCAPE',name);if(item.isDirectory())pending.push(name);else{requireThat(item.isFile(),'WEB_REFRESH_FILE_TYPE',name);result.push(name);}}}return result;}
export function verifiedExport(directory){
 const root=checkedRoot(directory),manifestFile=sourceFile(root,'export.json'),manifest=json(manifestFile),files=new Map(),folded=new Set();let total=0;
 requireThat(manifest.version===1&&manifest.renderer_mode==='official'&&Array.isArray(manifest.files)&&/^releases\/[a-f0-9]{64}\/$/.test(manifest.release_root),'WEB_REFRESH_BASE_INVALID');
 for(const declared of manifest.files){portablePath(declared.path);requireThat(declared.path!=='export.json'&&!folded.has(declared.path.toLowerCase()),'WEB_REFRESH_BASE_DUPLICATE',declared.path);folded.add(declared.path.toLowerCase());const actual=fileRecord(sourceFile(root,declared.path),declared.path);requireThat(actual.bytes===declared.bytes&&actual.sha256===declared.sha256,'WEB_REFRESH_BASE_HASH',declared.path);files.set(declared.path,actual);total+=actual.bytes;}
 requireThat(total===manifest.total_bytes&&files.has('index.html'),'WEB_REFRESH_BASE_INDEX');const disk=inventory(root);requireThat(disk.length===files.size+1&&disk.every(name=>name==='export.json'||files.has(name)),'WEB_REFRESH_BASE_UNINDEXED');
 const logical=new Map([...files].filter(([name])=>name!=='index.html'&&!name.startsWith('releases/')));
 for(const [name,record]of logical){const alias=files.get(manifest.release_root+name);requireThat(alias?.sha256===record.sha256&&alias.bytes===record.bytes,'WEB_REFRESH_BASE_ALIAS',name);}
 for(const name of files.keys())if(name.startsWith('releases/'))requireThat(name.startsWith(manifest.release_root)&&logical.has(name.slice(manifest.release_root.length)),'WEB_REFRESH_BASE_GENERATION',name);
 const html=text(files.get('index.html').source),needle=`<head><base href="${manifest.release_root}">`;requireThat(html.split(needle).length===2,'WEB_REFRESH_BASE_HTML');
 const template=html.replace(needle,'<head>');return{root,manifest,manifest_sha256:sha(fs.readFileSync(manifestFile)),logical,template,generation_matches:webGeneration(template,[...logical.values()])===manifest.release_root};
}
export function writePublication(output,template,files,report){
 requireThat(!fs.existsSync(output),'WEB_REFRESH_OUTPUT_NOT_FRESH',output);checkedRoot(path.dirname(output));
 const rows=[...files.values()].sort((a,b)=>order(a.path,b.path)),release=webGeneration(template,rows),html=Buffer.from(template.replace('<head>',`<head><base href="${release}">`));
 const all=new Map();for(const file of rows){all.set(file.path,file);all.set(release+file.path,file);}all.set('index.html',dataRecord('index.html',html));const keys=[...all.keys()].sort(order),seen=new Set();
 for(const key of keys){portablePath(key);requireThat(!seen.has(key.toLowerCase()),'WEB_REFRESH_OUTPUT_COLLISION',key);seen.add(key.toLowerCase());}
 const final={...report,version:1,release_root:release,total_bytes:keys.reduce((n,key)=>n+all.get(key).bytes,0),files:keys.map(key=>({path:key,bytes:all.get(key).bytes,sha256:all.get(key).sha256}))};
 fs.mkdirSync(output);try{for(const key of keys){const record=all.get(key),target=path.join(output,...key.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});requireThat(inside(output,checkedRoot(path.dirname(target))),'WEB_REFRESH_OUTPUT_ESCAPE');if(record.data)fs.writeFileSync(target,record.data,{flag:'wx'});else fs.copyFileSync(record.source,target,fs.constants.COPYFILE_EXCL);const actual=fileRecord(target,key);requireThat(actual.bytes===record.bytes&&actual.sha256===record.sha256,'WEB_REFRESH_COPY_CHANGED',key);}fs.writeFileSync(path.join(output,'export.json'),JSON.stringify(final,null,2)+'\n',{flag:'wx'});return final;}
 catch(error){error.message+=` (incomplete output preserved at ${output}; export.json is the final publication marker)`;throw error;}
}
