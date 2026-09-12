// Original vector badge/particles, using existing authored outline lettering.
import {readFileSync,writeFileSync} from 'node:fs';
import {validateLottieDocument} from '../presentation/lottie/runtime/lottie.mjs';
const root=new URL('../',import.meta.url),v=k=>({a:0,k}),rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).concat(1);
const keys=rows=>({a:1,k:rows.map(([t,s],i)=>({t,s:Array.isArray(s)?s:[s],...(i<rows.length-1?{e:Array.isArray(rows[i+1][1])?rows[i+1][1]:[rows[i+1][1]],o:{x:.2,y:0},i:{x:.8,y:1}}:{})}))});
const path=points=>({ty:'sh',ks:v({i:points.map(()=>[0,0]),o:points.map(()=>[0,0]),v:points,c:true})});
const fill=color=>({ty:'fl',c:v(rgb(color)),o:v(100),r:1});
for(const [id,accent,body]of [['big-win','#e8ad5b','#34232a'],['mega-win','#ffc867','#521e2b'],['legendary-win','#fff0b2','#3f2448']]){
 const old=JSON.parse(readFileSync(new URL('presentation/lottie/'+id+'.json',root),'utf8'));
 const layers=[],base={o:keys([[0,0],[4,100]]),p:v([480,110,0]),a:v([0,0,0]),s:keys([[0,[94,94,100]],[6,[106,106,100]],[14,[100,100,100]]]),r:v(0)};
 const layer=(name,shapes,extra={})=>({ty:4,nm:name,sr:1,ks:{...structuredClone(base),...extra},ip:0,op:180,st:0,shapes});
 const title=structuredClone(old.layers.find(l=>l.nm==='Award lettering'));
 const points=title.shapes.filter(s=>s.ty==='sh').flatMap(s=>s.ks.k.v),span=Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])),size=Math.min(1.3,352/span);
 title.nm='Dock award lettering';title.ks={...structuredClone(base),p:v([247,143,0]),s:keys([[0,[94*size,94*size,100]],[6,[108*size,108*size,100]],[14,[100*size,100*size,100]]])};title.ip=0;title.op=180;
 title.shapes.filter(s=>s.ty==='fl').forEach(s=>s.c=v(rgb('#fff0c6')));layers.push(title);
 const bevel=structuredClone(title);bevel.nm='Letter bevel';bevel.ks.p=v([247,147,0]);bevel.shapes.filter(s=>s.ty==='fl').forEach(s=>s.c=v(rgb('#8e4933')));layers.push(bevel);
 layers.push(layer('Gold inset cuts',[path([[-398,-69],[-324,-69],[-426,-22]]),path([[398,69],[324,69],[426,22]]),path([[-15,-59],[-10,-69],[-5,-59],[-5,59],[-10,69],[-15,59]]),fill(accent)]));
 layers.push(layer('Obsidian plaque',[path([[-418,-79],[418,-79],[438,-55],[418,79],[-418,79],[-438,55]]),fill(body)]));
 layers.push(layer('Forged gold rim',[path([[-423,-85],[423,-85],[446,-57],[423,85],[-423,85],[-446,57]]),fill(accent)]));
 layers.push(layer('Crimson torn ribbon',[path([[-397,-65],[-472,-89],[-458,-13],[-478,60],[-400,69]]),path([[397,-65],[472,-89],[458,13],[478,60],[400,69]]),fill('#a44b3b')]));
 for(let i=0;i<12;i++){
  const a=i*Math.PI/6,x=Math.cos(a),y=Math.sin(a),r=90+i%3*25;
  layers.push(layer('Impact shard '+i,[path([[0,-14],[4,0],[0,14],[-3,0]]),fill(i%2?accent:'#fff5da')],{p:keys([[0,[480+x*80,110+y*15,0]],[20,[480+x*(380+r),110+y*110,0]]]),r:v(i*30),o:keys([[0,0],[3,100],[18,60],[28,0]]),s:v([100,100,100])}));
 }
 const document={v:'5.9.0',fr:60,ip:0,op:180,w:960,h:220,nm:id+' · HUD score badge',ddd:0,assets:[],layers,markers:[{tm:0,cm:'burst',dr:0},{tm:34,cm:'dock',dr:0},{tm:100,cm:'collect',dr:0}]};
 const issues=validateLottieDocument(document);if(issues.length)throw Error(JSON.stringify(issues));
 writeFileSync(new URL('presentation/lottie/'+id+'-dock.json',root),JSON.stringify(document));
 console.log('VALIDATED '+id+'-dock');
}
