// A rebuild must retain approved art and the route must follow the same anchors.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root));
const art=JSON.parse(read('design-v1/expedition-map-manifest.json'));
const assets=JSON.parse(read('assets.json')).assets;
const hash=b=>createHash('sha256').update(b).digest('hex');
const entries=art.entries.map(e=>{
 const raw=read(e.runtime),width=raw.readUInt32BE(16),height=raw.readUInt32BE(20);
 assert.equal(hash(raw),e.runtimeSha256,e.id+' approved bitmap');
 assert.equal(hash(read(e.original)),hash(raw),e.id+' lossless source');
 assert.equal(hash(read('dist/web/content/'+e.runtime)),hash(raw),e.id+' exported bitmap');
 assert.deepEqual([width,height],e.id==='forest-map-v2'?[1672,941]:[1254,1254]);
 for(const id of e.resources)assert.equal(assets.find(a=>a.id==='texture://ui_'+id)?.source,e.runtime,id+' runtime mapping');
 return {id:e.id,width,height,sha256:hash(raw),mappings:e.resources};
});
const source=read('ui/formal-ui.luau').toString(),literal=source.match(/local expeditionPoints=(\{\{[^\n]+\}\})/)[1];
const points=JSON.parse(literal.replace(/[{}]/g,c=>c==='{'?'[':']'));
assert.equal(points.length,8);
for(let i=1;i<points.length;i++){
 const [ax,ay]=points[i-1].map((v,j)=>v*(j?941:1672)/100),[bx,by]=points[i].map((v,j)=>v*(j?941:1672)/100),mx=(ax+bx)/2;
 const path=`M${ax} ${ay}C${mx} ${ay} ${mx} ${by} ${bx} ${by}`;
 for(const state of ['done','future'])assert.ok(read(`assets/formal-ui/map-link-${i}-${state}.svg`).toString().includes(path),'shared route '+i);
}
const payload=JSON.parse(read('dist/web/content/project.json'));
assert.ok(JSON.stringify(payload).includes('texture://ui_forest-map-v2'),'new map included in export');
const report={ok:true,entries,routeSegments:7,sharedLuauAnchors:true};
mkdirSync(new URL('tests/map-layout/',root),{recursive:true});
writeFileSync(new URL('tests/map-layout/assets-report.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
