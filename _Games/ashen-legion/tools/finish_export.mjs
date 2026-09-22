import {readFileSync,writeFileSync,copyFileSync,cpSync,mkdirSync,readdirSync,statSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(process.argv[2]??join(root,'dist/web'));
const runtime=JSON.parse(readFileSync(join(out,'runtime/runtime.json')));
const version=runtime.wasm_sha256+'-'+runtime.javascript_sha256;
if(!/^[a-f0-9]{64}-[a-f0-9]{64}$/.test(version))throw Error('Runtime content hashes are required');
const runtimeVersionDir=join(out,'runtime',version);mkdirSync(runtimeVersionDir,{recursive:true});
for(const [name,expected]of [[runtime.javascript,runtime.javascript_sha256],[runtime.wasm,runtime.wasm_sha256]]){
 const bytes=readFileSync(join(out,'runtime',name));
 if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Runtime hash mismatch: '+name);
 writeFileSync(join(runtimeVersionDir,name),bytes);
}
for(const f of ['index.html','web-overlay.html','style.css','art-direction.css','host.mjs','ui.mjs','rpg-ui.mjs','environments.json'])copyFileSync(join(root,f),join(out,f));
const hostVersion=createHash('sha256').update(readFileSync(join(root,'host.mjs'))).digest('hex');
const entryPath=join(out,'index.html');
writeFileSync(entryPath,readFileSync(entryPath,'utf8').replace('src="host.mjs"','src="host.mjs?v='+hostVersion+'"'));
cpSync(join(root,'assets/equipment'),join(out,'assets/equipment'),{recursive:true,filter:p=>!p.endsWith('.blend')&&!p.endsWith('.blend1')});
cpSync(join(root,'presentation'),join(out,'presentation'),{recursive:true});cpSync(join(root,'assets/creatures'),join(out,'assets/creatures'),{recursive:true,filter:p=>!p.endsWith('.blend')&&!p.endsWith('.blend1')});
mkdirSync(join(out,'assets'),{recursive:true});cpSync(join(root,'design-v1/svg'),join(out,'assets/ui'),{recursive:true});copyFileSync(join(root,'assets/key-art.png'),join(out,'assets/key-art.png'));
// Keep generated game mesh/texture assets synchronized with the game manifest.
mkdirSync(join(out,'content/assets'),{recursive:true});
for(const f of readdirSync(join(root,'assets')))if(statSync(join(root,'assets',f)).isFile())copyFileSync(join(root,'assets',f),join(out,'content/assets',f));
const gameAssets=JSON.parse(readFileSync(join(root,'assets.json')));
writeFileSync(join(out,'content/assets.json'),JSON.stringify({assets:gameAssets.assets.map(a=>({bundle:'content',...a}))}));
cpSync(join(root,'assets/formal-ui'),join(out,'content/assets/formal-ui'),{recursive:true});
// Refresh only the game payload when iterating; the CLI assembled schema is preserved.
const payloadPath=join(out,'content/project.json'),payload=JSON.parse(readFileSync(payloadPath));
payload.config=JSON.parse(readFileSync(join(root,'project.unone.json')));
payload.scene=JSON.parse(readFileSync(join(root,'scene.json')));
const script=readFileSync(join(root,'main.luau'),'utf8');
if(typeof payload.script==='string')payload.script=script;
else if(typeof payload.entry_script_source==='string')payload.entry_script_source=script;
else if(typeof payload.scripts==='object')payload.scripts['main.luau']=script;
else throw Error('Unknown HostProject source field: '+Object.keys(payload));
writeFileSync(payloadPath,JSON.stringify(payload));
for(const f of ['canvas-ui.mjs','ui-contract.mjs','ui-geometry.mjs','host-input.js'])copyFileSync('D:/Projects/Unone/web/shared/'+f,join(out,'web/shared',f));
// Compatibility wiring for the pinned official player: its existing SSAO module
// exposes setAO, but this renderer revision omitted forwarding it. No new effect
// implementation or gameplay rules. Stop applying once upstream exports setAO.
const rendererPath=join(out,'web/renderer/three.js');let rendererSource=readFileSync(rendererPath,'utf8');
if(!/setAO\s*:/.test(rendererSource)){
 const anchor='setBloom:enabled=>bloom?.setEnabled(enabled),';
 if(!rendererSource.includes(anchor))throw Error('Pinned renderer AO forwarding anchor changed');
 rendererSource=rendererSource.replace(anchor,anchor+'\n    setAO:enabled=>bloom?.setAO(enabled),');
 writeFileSync(rendererPath,rendererSource);
}
const path=join(out,'export.json'),manifest=JSON.parse(readFileSync(path));
const files=[];function walk(dir,prefix=''){for(const f of readdirSync(dir)){const rel=prefix+f;if(f==='export.json')continue;const p=join(dir,f);if(statSync(p).isDirectory())walk(p,rel+'/');else{const b=readFileSync(p);files.push({path:rel,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')})}}}walk(out);
manifest.files=files;manifest.total_bytes=files.reduce((n,f)=>n+f.bytes,0);writeFileSync(path,JSON.stringify(manifest,null,2));
console.log('Game presentation and inventory ready: '+out);
