// Restyle original vector animations, validated/staged by the installed Unone
// Lottie plugin. No renderer/runtime edits and no game rewards are manufactured.
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const clone=v=>structuredClone(v),value=k=>({a:0,k}),rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).concat(1);
const fill=color=>({ty:'fl',c:value(rgb(color)),o:value(100),r:1});
const path=v=>({ty:'sh',ks:value({i:v.map(()=>[0,0]),o:v.map(()=>[0,0]),v,c:true}),nm:'Authored banner polygon'});
for(const [id,body,accent]of [['big-win','#163b46','#e8bd66'],['mega-win','#7d3037','#ffd58b'],['legendary-win','#322943','#ffe8af']]){
 const filename=join(root,'design-v1/animations',id+'.json'),document=JSON.parse(readFileSync(filename));
 document.layers=document.layers.filter(l=>!l.nm.startsWith('Art:'));
 const title=document.layers.find(l=>l.nm==='Award lettering'),banner=document.layers.find(l=>l.nm==='Faceted dark banner');
 title.shapes.filter(s=>s.ty==='fl').forEach(s=>s.c=value(rgb('#ffe6ad')));
 banner.shapes.filter(s=>s.ty==='fl').forEach(s=>s.c=value(rgb(body)));
 const shadow=clone(title);shadow.nm='Art: Letter bevel';shadow.ks.p.k[1]+=5;shadow.shapes.filter(s=>s.ty==='fl').forEach(s=>s.c=value(rgb('#9a673f')));
 const border=clone(banner);border.nm='Art: Gold frame';border.shapes=[path([[-429,-56],[-395,-87],[400,-87],[431,-54],[407,66],[-406,66]]),fill(accent)];
 const fold=clone(banner);fold.nm='Art: Folded battle ribbons';fold.shapes=[path([[-350,-54],[-447,-84],[-434,-13],[-470,36],[-343,53]]),path([[350,-54],[447,-84],[434,-13],[470,36],[343,53]]),fill('#a7443a')];
 const cut=clone(banner);cut.nm='Art: Cut highlights';cut.shapes=[path([[-385,-70],[-332,-70],[-407,-15]]),path([[384,47],[323,47],[407,6]]),fill(accent)];
 for(const layer of document.layers){
  if(layer.nm.startsWith('Coin '))layer.shapes.filter(s=>s.ty==='fl').forEach((s,i)=>s.c=value(rgb(i?'#fff0c7':'#e6b351')));
  if(layer.nm==='Crown'||layer.nm==='Gold lower slash'||layer.nm.startsWith('Radial shard '))layer.shapes.filter(s=>s.ty==='fl').forEach(s=>s.c=value(rgb(accent)));
 }
 const rest=document.layers.filter(l=>l!==title&&l!==banner);
 document.layers=[title,shadow,cut,banner,border,fold,...rest];
 writeFileSync(filename,JSON.stringify(document));
 const processResult=spawnSync(process.execPath,['D:/Projects/Unone/plugins/org.unone.lottie/plugin.mjs'],{env:{...process.env,UNONE_PROJECT_ROOT:root},encoding:'utf8',input:JSON.stringify({tool:'lottie.install',input:{document,filename:id+'.json',force:true}})+'\n'});
 const result=JSON.parse(processResult.stdout);if(!result.ok)throw Error(processResult.stdout);
 copyFileSync(join(root,'.unone/staging/unone-lottie',id+'.json'),join(root,'presentation/lottie',id+'.json'));
 console.log('VALIDATED + STAGED '+id);
}
