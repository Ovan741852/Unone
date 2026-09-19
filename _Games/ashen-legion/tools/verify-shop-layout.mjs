import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=join(root,'tests/shop-layout');mkdirSync(out,{recursive:true});
const exe='D:/Projects/Unone/target/debug/game.exe';
const overlap=(a,b)=>a.x<b.x+b.width-.001&&a.x+a.width>b.x+.001&&a.y<b.y+b.height-.001&&a.y+a.height>b.y+.001;
const contains=(a,b)=>a.x<=b.x+.001&&a.y<=b.y+.001&&a.x+a.width>=b.x+b.width-.001&&a.y+a.height>=b.y+b.height-.001;
const inputFor=choice=>{
 const frames=[];
 const action=a=>frames.push({actions:{[a]:true}});
 const wait=n=>{for(let i=0;i<n;i++)frames.push({actions:{}})};
 action('Start');wait(2);action('Profile1');wait(2);action('LaunchExpedition');wait(100);action('Choice'+choice);wait(2);
 return frames;
};
const run=(frames)=>{
 const input=join(out,'shop-input.json');writeFileSync(input,JSON.stringify(frames));
 const result=spawnSync(exe,['--project',root,'ui','preview','--json','--seed','42','--frames',String(frames.length),'--input-sequence',input],{encoding:'utf8',timeout:60000,maxBuffer:8e6});
 if(!result.stdout)throw Error(result.stderr||String(result.error));
 return JSON.parse(result.stdout);
};
const findMarket=()=>{
 for(let choice=1;choice<=3;choice++){
  const result=run(inputFor(choice));
  if(result.value?.nodes?.some(n=>n.id==='shop_window_title'))return {choice,result};
 }
 throw Error('seed 42 did not produce the equipment-shop window in any choice');
};
const nodeMap=nodes=>new Map(nodes.map(n=>[n.id,n]));
const rectFor=(by,id)=>{
 const direct=by.get(id);if(direct)return direct.rect;
 const parts=['tl','t','tr','l','c','r','bl','b','br'].map(part=>by.get(`${id}_${part}`)).filter(Boolean);
 if(parts.length!==9)return null;
 const left=Math.min(...parts.map(n=>n.rect.x)),top=Math.min(...parts.map(n=>n.rect.y));
 const right=Math.max(...parts.map(n=>n.rect.x+n.rect.width)),bottom=Math.max(...parts.map(n=>n.rect.y+n.rect.height));
 return {x:left,y:top,width:right-left,height:bottom-top};
};
const checkBase=(nodes)=>{
 const by=nodeMap(nodes),findings=[],allowed=[];
 const add=(kind,detail,nodes)=>findings.push({kind,detail,nodes});
 for(const n of nodes){const r=n.rect;if(r.x<-.001||r.y<-.001||r.x+r.width>100.001||r.y+r.height>100.001)add('bounds',`offscreen ${n.id}`,[n.id]);}
 for(let i=1;i<=4;i++){
  const cardRect=rectFor(by,`stock_panel_${i}`);if(!cardRect)add('missing',`missing stock_panel_${i}`,[`stock_panel_${i}`]);
  if(cardRect){
   const window=rectFor(by,'screen_back');if(!window||!contains(window,cardRect))add('window-containment',`stock_panel_${i} outside shop window`,[`stock_panel_${i}`]);
   for(const n of nodes.filter(n=>new RegExp(`^stock_(icon|name|desc|cost|deploy|detail|empty)_${i}($|_)`).test(n.id))){
    if(contains(cardRect,n.rect))allowed.push({behind:`stock_panel_${i}`,front:n.id,reason:'card owns its icon, copy and detail hit area'});
    else add('containment',`${n.id} outside stock_panel_${i}`,[`stock_panel_${i}`,n.id]);
   }
  }
 }
 for(let i=1;i<=4;i++)for(let j=i+1;j<=4;j++){
  const a=rectFor(by,`stock_panel_${i}`),b=rectFor(by,`stock_panel_${j}`);if(a&&b&&overlap(a,b))add('card-overlap',`stock_panel_${i} overlaps stock_panel_${j}`,[`stock_panel_${i}`,`stock_panel_${j}`]);
 }
 const independent=nodes.filter(n=>n.kind!=='image'&&!n.id.startsWith('stock_')&&!n.id.startsWith('shop_backdrop')&&!n.id.startsWith('screen_'));
 for(let i=0;i<independent.length;i++)for(let j=i+1;j<independent.length;j++){
  const a=independent[i],b=independent[j];if(overlap(a.rect,b.rect))add('sibling-overlap',`${a.id} overlaps ${b.id}`,[a.id,b.id]);
 }
 for(const id of ['refresh']){
  const n=by.get(id);const top=n&&100-n.rect.y-n.rect.height;if(n&&top<79-.001)add('footer-spacing',`${id} starts before the card rail ends`,[id]);
 }
 const cards=[1,2,3,4].map(i=>rectFor(by,`stock_panel_${i}`)).filter(Boolean);
 if(cards.length===4){
 for(let i=1;i<cards.length;i++){
   if(Math.abs(cards[i].height-cards[0].height)>.001)add('height','Unequal card heights',[]);
   const gap=cards[i].x-(cards[i-1].x+cards[i-1].width);
   if(gap<1-.001)add('spacing',`card gap ${i} is ${gap.toFixed(3)}, below s1`,[`stock_panel_${i}`,`stock_panel_${i+1}`]);
  }
 }
 return {findings,allowed};
};
const checkModal=(nodes)=>{
 const by=nodeMap(nodes),findings=[],allowed=[];
 const modalRect=rectFor(by,'shop_detail_modal'),scrim=by.get('shop_modal_scrim');
 if(!modalRect) findings.push({kind:'missing',detail:'missing shop_detail_modal',nodes:['shop_detail_modal']});
 if(!scrim) findings.push({kind:'missing',detail:'missing shop_modal_scrim',nodes:['shop_modal_scrim']});
 if(modalRect){
  for(const n of nodes.filter(n=>n.id.startsWith('shop_detail_')&&!n.id.startsWith('shop_detail_modal_')&&!['shop_detail_modal','shop_detail_shade'].includes(n.id))){
   if(contains(modalRect,n.rect))allowed.push({behind:'shop_detail_modal',front:n.id,reason:'detail modal owns its content and controls'});
   else findings.push({kind:'containment',detail:`${n.id} outside modal`,nodes:['shop_detail_modal',n.id]});
  }
 }
 for(const n of nodes.filter(n=>n.id==='shop_detail_close'||n.id==='shop_detail_buy'||n.id==='shop_detail_cancel')){
  for(const m of nodes.filter(m=>m.kind==='button'&&m.id!==n.id&&m.id.startsWith(n.id+'_hit_')))if(overlap(n.rect,m.rect))findings.push({kind:'button-overlap',detail:`${n.id} overlaps its hit extension`,nodes:[n.id,m.id]});
 }
 const controls=nodes.filter(n=>n.kind==='button'&&['shop_modal_scrim','shop_detail_close','shop_detail_buy','shop_detail_cancel'].includes(n.id));
 for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
  const a=controls[i],b=controls[j];if((a.id==='shop_modal_scrim'||b.id==='shop_modal_scrim'))continue;
  if(overlap(a.rect,b.rect))findings.push({kind:'button-overlap',detail:`${a.id} overlaps ${b.id}`,nodes:[a.id,b.id]});
 }
 return {findings,allowed};
};
const base=findMarket();
const baseCheck=checkBase(base.result.value.nodes);
const detailFrames=inputFor(base.choice);detailFrames.push({actions:{ShopDetail1:true}});detailFrames.push({actions:{}});
const detail=run(detailFrames);const detailCheck=checkModal(detail.value.nodes);
const report={ok:base.result.ok&&detail.ok&&baseCheck.findings.length===0&&detailCheck.findings.length===0,seed:42,choice:base.choice,base:{nodes:base.result.value.nodes.length,...baseCheck},detail:{nodes:detail.value.nodes.length,...detailCheck}};
writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({ok:report.ok,choice:report.choice,baseFindings:baseCheck.findings,detailFindings:detailCheck.findings}));
if(!report.ok)process.exitCode=1;
