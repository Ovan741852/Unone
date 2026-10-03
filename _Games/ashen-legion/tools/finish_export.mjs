import {existsSync,readFileSync,writeFileSync,copyFileSync,cpSync,mkdirSync,readdirSync,statSync} from 'node:fs';
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
// Keep the pinned Canvas UI adapter and its validation helpers together. The
// adapter imports ui-geometry, which in turn imports ui-contract; copying only
// canvas-ui.mjs leaves the exported player with a runtime 404.
// The pinned player's shared modules. UNONE_WEB_SHARED overrides the path;
// when the checkout is absent the previously exported copies are kept.
const sharedDir=process.env.UNONE_WEB_SHARED??'D:/Projects/Unone/web/shared';
// Keep the development panel in sync with the engine checkout. The panel is
// a reusable developer primitive, not game logic; exported dev builds need the
// same hierarchy interactions that the source host provides.
const developerDir=process.env.UNONE_WEB_DEVELOPER??'D:/Projects/Unone/web/developer';
if(existsSync(developerDir))cpSync(developerDir,join(out,'web/developer'),{recursive:true});
for(const f of ['canvas-ui.mjs','host-input.js','ui-geometry.mjs','ui-contract.mjs']){
 const source=join(sharedDir,f);
 if(existsSync(source))copyFileSync(source,join(out,'web/shared',f));
 else if(!existsSync(join(out,'web/shared',f)))throw Error('Missing shared module '+f+'; set UNONE_WEB_SHARED');
}
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
// Text alignment and line height for the pinned Canvas UI. The shared player
// centres every line and hard-codes 1.2 line spacing, which makes the Xbox /
// Game Accessibility rule "long text is aligned to the reading direction, at
// least 1.5 line height" impossible to satisfy from the game layer. This adds
// optional node.align ('start' | 'center' | 'end') and node.lineHeight; both
// default to the previous behaviour, so untouched screens render identically.
// Drop this block once the upstream renderer carries the same two fields.
const uiPath=join(out,'web/shared/canvas-ui.mjs');let uiSource=readFileSync(uiPath,'utf8');
if(!/node\.align/.test(uiSource)){
 const textAnchor="function text(node,x,y,w,h){if(!node.text)return;const lines=String(node.text).split('\\n');let size=Math.max(1,Math.min(h/(lines.length*1.2),h*0.72));";
 if(!uiSource.includes(textAnchor))throw Error('Pinned renderer text() anchor changed');
 uiSource=uiSource.replace(textAnchor,
  "function text(node,x,y,w,h){if(!node.text)return;const lines=String(node.text).split('\\n');"
  +"const lh=Number.isFinite(node.lineHeight)&&node.lineHeight>0?node.lineHeight:1.2;"
  +"const align=node.align==='start'||node.align==='end'?node.align:'center';"
  +"const pad=align==='center'?0:Math.min(w*0.05,14);"
  +"let size=Math.max(1,Math.min(h/(lines.length*lh),h*0.72));");
 const drawAnchor="ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.fillStyle=textColor;ctx.textAlign='center';ctx.textBaseline='middle';";
 if(!uiSource.includes(drawAnchor))throw Error('Pinned renderer text() draw anchor changed');
 uiSource=uiSource.replace(drawAnchor,
  "ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.fillStyle=textColor;ctx.textAlign=align==='start'?'left':align==='end'?'right':'center';ctx.textBaseline='middle';");
 const fitAnchor="ctx.font=`${size}px ${fontFamily}`;const longest=Math.max(...lines.map(l=>ctx.measureText(l).width),1);size*=Math.min(1,w/longest);ctx.font=`${size}px ${fontFamily}`;";
 if(!uiSource.includes(fitAnchor))throw Error('Pinned renderer text() fit anchor changed');
 uiSource=uiSource.replace(fitAnchor,
  "ctx.font=`${size}px ${fontFamily}`;const longest=Math.max(...lines.map(l=>ctx.measureText(l).width),1);size*=Math.min(1,(w-pad*2)/longest);ctx.font=`${size}px ${fontFamily}`;");
 const lineAnchor="lines.forEach((line,i)=>ctx.fillText(line,x+w/2,y+h/2+(i-(lines.length-1)/2)*size*1.2));ctx.restore();";
 if(!uiSource.includes(lineAnchor))throw Error('Pinned renderer text() line anchor changed');
 uiSource=uiSource.replace(lineAnchor,
  "const anchorX=align==='start'?x+pad:align==='end'?x+w-pad:x+w/2;"
  +"lines.forEach((line,i)=>ctx.fillText(line,anchorX,y+h/2+(i-(lines.length-1)/2)*size*lh));ctx.restore();");
 writeFileSync(uiPath,uiSource);
}
const path=join(out,'export.json'),manifest=JSON.parse(readFileSync(path));
const files=[];function walk(dir,prefix=''){for(const f of readdirSync(dir)){const rel=prefix+f;if(f==='export.json')continue;const p=join(dir,f);if(statSync(p).isDirectory())walk(p,rel+'/');else{const b=readFileSync(p);files.push({path:rel,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')})}}}walk(out);
manifest.files=files;manifest.total_bytes=files.reduce((n,f)=>n+f.bytes,0);writeFileSync(path,JSON.stringify(manifest,null,2));
console.log('Game presentation and inventory ready: '+out);
