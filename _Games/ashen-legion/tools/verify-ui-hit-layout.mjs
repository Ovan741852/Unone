// Validate the actual fitted/moving tree used by the official browser hit router.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {createUiPointerRouter} from '../dist/web/web/shared/canvas-ui.mjs';
const root=resolve('_Games/ashen-legion/tests/ui-ux-20260912/after'),results=[],errors=[];
for(const dir of readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()))for(const name of readdirSync(join(root,dir.name)).filter(f=>f.endsWith('.json'))){
 const {ui}=JSON.parse(readFileSync(join(root,dir.name,name)));if(!ui)continue;
 const router=createUiPointerRouter(),map=new Map(ui.children.map(n=>[n.id,n]));router.setTree(ui);let points=0;
 const same=(a,b)=>a.replace(/_hit_(top|bottom)$/,'')===b.replace(/_hit_(top|bottom)$/,'');
 for(const n of ui.children){
  assert.ok(n.rect.x>=-.001&&n.rect.y>=-.001&&n.rect.x+n.rect.width<=100.001&&n.rect.y+n.rect.height<=100.001,dir.name+'/'+name+': bounds '+n.id);
  if(n.kind!=='button')continue;
  const plate=map.has(n.id+'_hit_top')?map.get(n.id+'_plate'):null,r=plate?.rect??n.rect;
  for(const [u,v]of [[.5,.5],[.08,.08],[.92,.08],[.08,.92],[.92,.92]]){
   const hit=router.hitTest(r.x+r.width*u,r.y+r.height*v);points++;
   if(!hit||hit.action!==n.action||!same(hit.nodeId,n.id))errors.push({screen:dir.name+'/'+name,node:n.id,point:[u,v],hit});
  }
 }
 // No button, label or copy may overlap an unrelated foreground control/text.
 const foreground=ui.children.filter(n=>n.kind!=='image');
 for(let i=0;i<foreground.length;i++)for(let j=i+1;j<foreground.length;j++){
  const a=foreground[i],b=foreground[j],p=a.rect,q=b.rect;
  const w=Math.min(p.x+p.width,q.x+q.width)-Math.max(p.x,q.x),h=Math.min(p.y+p.height,q.y+q.height)-Math.max(p.y,q.y);
  if(w>.01&&h>.01)errors.push({screen:dir.name+'/'+name,overlap:[a.id,b.id],area:w*h});
 }
 results.push({screen:dir.name+'/'+name,nodes:ui.children.length,hitPoints:points});
}
writeFileSync(join(root,'hit-layout-report.json'),JSON.stringify({ok:errors.length===0,results,errors},null,2));
console.log(JSON.stringify({screens:results.length,hitPoints:results.reduce((s,r)=>s+r.hitPoints,0),errors},null,2));assert.equal(errors.length,0);
