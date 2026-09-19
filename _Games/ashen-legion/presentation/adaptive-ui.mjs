// Game-owned composition of official image/text/button nodes. Canvas drawing
// and hit testing consume this exact tree; no DOM controls or simulation edits.
import {fitNineSlice,fitLabel} from './ui-components.mjs';
import skinData from './ui-skin-data.mjs';
const put=(n,x,y,width,height)=>({...n,rect:{x,y:100-y-height,width,height}});
const top=r=>100-r.y-r.height;
export function fitFormalUI(snapshot,{width,height,insets={}}){
 const tree=snapshot?.world?.ui??snapshot?.ui;if(!tree)return snapshot;
 const game=snapshot?.world?.observations?.game??{};
 const battle=tree.node==='battle:home'&&!game.paused;
 const route=tree.node?.split(':')[1],phase=game.phase??tree.node?.split(':')[0];
 const map=new Map(tree.children.map(n=>[n.id,{...n,rect:{...n.rect}}]));
 const set=(id,x,y,w,h)=>{const n=map.get(id);if(n)map.set(id,put(n,x,y,w,h));};
 const sliceParts=id=>['tl','t','tr','l','c','r','bl','b','br'].map(part=>map.get(id+'_plate_'+part)).filter(Boolean);
 const plateRect=id=>{const direct=map.get(id+'_plate');if(direct)return direct.rect;const parts=sliceParts(id);if(!parts.length)return null;const x=Math.min(...parts.map(n=>n.rect.x)),y=Math.min(...parts.map(n=>n.rect.y)),right=Math.max(...parts.map(n=>n.rect.x+n.rect.width)),bottom=Math.max(...parts.map(n=>n.rect.y+n.rect.height));return {x,y,width:right-x,height:bottom-y};};
 const setPlate=(id,x,y,w,h)=>{const direct=map.get(id+'_plate');if(direct){set(id+'_plate',x,y,w,h);return;}const parts=sliceParts(id),source=plateRect(id);if(!source)return;const target={x,y:100-y-h,width:w,height:h},sx=w/source.width,sy=h/source.height;for(const part of parts){const q=part.rect;map.set(part.id,{...part,rect:{x:target.x+(q.x-source.x)*sx,y:target.y+(q.y-source.y)*sy,width:q.width*sx,height:q.height*sy}});}};
 const control=(id,x,y,w,h,ch=Math.min(3,h-1))=>{const edge=(h-ch)/2;setPlate(id,x,y,w,h);
  if(map.has(id+'_hit_top')){set(id,x,y+edge,w,ch);set(id+'_hit_top',x,y,w,edge);set(id+'_hit_bottom',x,y+edge+ch,w,edge);}
  else if(map.get(id)?.kind==='button')set(id,x,y,w,h);else set(id,x+1,y+edge,w-2,ch);
 };
 const text=(id,value)=>{const n=map.get(id);if(n)map.set(id,{...n,text:value});};
 if(map.has('shop_window_title')){
  // Shared shop components: fixed skin borders, equal-height controls and
  // measured typography. No generic short-screen overrides move their children.
  for(const id of [...map.keys()])if(id.endsWith('_tl'))fitNineSlice(map,id.slice(0,-3),[width,height],skinData);
  const scale=Math.max(.64,Math.min(1,width/1440,height/800));
  for(const [id,n]of map){
   if(!n.text||!['text','button'].includes(n.kind))continue;
   const p=plateRect(id),button=!!p;
   const slot=button?p:n.rect;
   const corner=map.get(id+'_plate_tl')?.rect.width??0;
   const padding=button?corner*width/100+3*scale:2*scale;
   const wrap=/^(stock_(name|desc)_|shopkeeper_line|shop_detail_(story|effect)|stock_hint)/.test(id);
   const target=/^(screen_title|shop_detail_title)$/.test(id)?28:/^(stock_name_|shopkeeper_name)/.test(id)?21:button?17:/^stock_(cost|deploy)_/.test(id)?16:17;
   const maxLines=id.startsWith('stock_name_')?1:id.startsWith('stock_desc_')?(height<500?2:3):Infinity;
   const fitted=fitLabel(n.text,{width:slot.width*width/100-padding*2,height:slot.height*height/100*(button?.74:1),size:target*scale,wrap,maxLines});
   text(id,fitted.text);
   const h=fitted.height/height*100;
   if(button){
    // The glyph uses the inner width, but the native hit band still spans the
    // full plate. Padding is clickable and cannot expose a control underneath.
    const edge=(p.height-h)/2;
    set(id,p.x,top(p)+edge,p.width,h);
    set(id+'_hit_top',p.x,top(p),p.width,edge);
    set(id+'_hit_bottom',p.x,top(p)+edge+h,p.width,edge);
   }else set(id,n.rect.x,top(n.rect)+(n.rect.height-h)/2,n.rect.width,h);
  }
  const sx=1-((insets.left??0)+(insets.right??0))/width,sy=1-((insets.top??0)+(insets.bottom??0))/height;
  const children=[...map.values()].map(n=>({...n,rect:{x:(insets.left??0)/width*100+n.rect.x*sx,y:(insets.bottom??0)/height*100+n.rect.y*sy,width:n.rect.width*sx,height:n.rect.height*sy}}));
  const ui={...tree,children};return snapshot.world?{...snapshot,world:{...snapshot.world,ui}}:{...snapshot,ui};
 }
 if(route==='auto'&&phase==='battle'){
  // Keep the authored landscape target grid.
 }else if(battle){
  if(height<600){
   const scale=1+Math.min(.5,Math.max(0,(600-height)/420));
   for(const [id,n]of map){let anchor;
    if(/^(hud_unit_|mode_|auto_settings|target)/.test(id))anchor=97;
    else if(/^(coins|crystals)/.test(id))anchor=99;
    else if(/^(chapter|round|objective|boss_timing|time|timer|pause|streak|shared_pool|horde)/.test(id))anchor=0;
    if(anchor!==undefined)set(id,n.rect.x,anchor+(top(n.rect)-anchor)*scale,n.rect.width,n.rect.height*scale);
   }
  }
 }else if(height<600){
  // Wide but short screens retain the two-column book composition.
  set('screen_title',37,9.5,37,7);set('screen_gold',76,9.5,17,5);set('screen_crystals_plate',76,15,17,5);set('screen_crystals',76,15,17,5);
  set('story_speaker',3,17,27,4);
  for(let i=1;i<=2;i++){const n=map.get('stock_panel_'+i);if(!n)continue;const x=n.rect.x,w=n.rect.width;set('stock_icon_'+i,x+(w-8)/2,34,8,10);set('stock_name_'+i,x+1,46,w-2,5);set('stock_desc_'+i,x+1,53,w-2,12);set('stock_cost_'+i,x+1,66,w-2,4);control('buy_'+i,x+1,71,w-2,7);}
 }
 // Reflow authored descriptions at a pixel-aware width, without changing any
 // semantic labels or numbers. Explicit line wrapping in Luau remains the CLI default.
 for(const [id,n]of map){
  if(n.kind!=='text'||!/^(auto_help|auto_summary|auto_note|story_quote|map_journal|menu_prologue|stock_desc_|gear_skill_|build_desc_|choice_desc_|enchant_help|enchant_offer|help_\d|abandon_warning|town_effect_|town_story|result_story|defeat_save)/.test(id))continue;
  const target=/^enchant_/.test(id)?21:height<600?13:17,columns=Math.max(8,Math.floor(n.rect.width*width/100/target));
  let line='',size=0,lines=[];for(const c of (n.text??'').replace(/\n/g,/^enchant_/.test(id)?'\u2028':'')){if(c==='\u2028'){lines.push(line);line='';size=0;continue;}const w=/[\u0000-\u007f]/.test(c)?.55:1;if(size+w>columns&&line){lines.push(line);line='';size=0;}line+=c;size+=w;}if(line)lines.push(line);text(id,lines.join('\n'));
  const h=Math.min(n.rect.height,target*Math.max(lines.length*1.2,1/.72)/height*100);
  set(id,n.rect.x,top(n.rect)+(n.rect.height-h)/2,n.rect.width,h);
 }
 // Typography hierarchy is independent of hit target size. Captions are
 // native button labels with adjacent padding regions sharing the same action.
 for(const [id,n]of map){
  if((n.kind!=='text'&&!map.has(id+'_hit_top'))||!n.text||n.text.includes('\n'))continue;
  const target=id==='title'?62:/^(screen_title|defeat_title|help_title)$/.test(id)?32:/^(result_earned|defeat_stat_value_)/.test(id)&&id!=='result_earned_label'?56:/^(stock_name_|choice_name_|gear_name_|build_name_|town_gold|time$|coins$|crystals$)/.test(id)?23:map.has(id+'_hit_top')?19:18;
  const h=Math.min(n.rect.height,target/.72/height*100);if(map.has(id+'_hit_top')){const p=plateRect(id);if(!p)continue;const ch=height<600?Math.min(p.height*.82,14/.72/height*100):h;control(id,p.x,top(p),p.width,p.height,ch);}else set(id,n.rect.x,top(n.rect)+(n.rect.height-h)/2,n.rect.width,h);
 }
 if(height<600)for(const [id,n]of map){if(n.kind==='text'&&map.has(id+'_plate')&&!map.has(id+'_hit_top')&&!id.startsWith('screen_')){const p=map.get(id+'_plate').rect;const h=Math.min(p.height*.82,14/.72/height*100);set(id,p.x+1,top(p)+(p.height-h)/2,p.width-2,h);}}
 const l=Math.max(0,insets.left??0),r=Math.max(0,insets.right??0),u=Math.max(0,insets.top??0),b=Math.max(0,insets.bottom??0);
 const children=[...map.values()].map(n=>{
  if(n.id==='menu_art'||n.id==='screen_back'||n.id==='town_scene')return n;
  const q=n.rect,scaleX=1-(l+r)/width,scaleY=1-(u+b)/height;
  const raw={x:l/width*100+q.x*scaleX,y:b/height*100+q.y*scaleY,width:q.width*scaleX,height:q.height*scaleY};
  // Keep authored controls and labels inside a small safe frame. Backgrounds
  // remain edge-to-edge; foreground nodes never get clipped by a device inset.
  const margin=route==='battle'?0.45:1;
  const widthBound=Math.max(0,100-margin*2),heightBound=Math.max(0,100-margin*2);
  const bounded={width:Math.min(raw.width,widthBound),height:Math.min(raw.height,heightBound)};
  bounded.x=Math.min(Math.max(raw.x,margin),100-margin-bounded.width);
  bounded.y=Math.min(Math.max(raw.y,margin),100-margin-bounded.height);
  return {...n,rect:bounded};
 });
 const ui={...tree,children};return snapshot.world?{...snapshot,world:{...snapshot.world,ui}}:{...snapshot,ui};
}
