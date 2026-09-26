// Game-owned composition of official image/text/button nodes. Canvas drawing
// and hit testing consume this exact tree; no simulation edits.
import {fitNineSlice,fitLabel,isControl} from './ui-components.mjs';
import skinData from './ui-skin-data.mjs';
import {layoutScreens} from './screen-layouts.mjs';
import {DESKTOP_VIEWPORT} from './landscape-host.mjs';
const put=(n,x,y,width,height)=>({...n,rect:{x,y:100-y-height,width,height}});
const top=r=>100-r.y-r.height;
export function fitFormalUI(snapshot){
 const {width,height}=DESKTOP_VIEWPORT,insets={};
 const tree=snapshot?.world?.ui??snapshot?.ui;if(!tree)return snapshot;
 const game=snapshot?.world?.observations?.game??{};
 const battle=tree.node==='battle:home'&&!game.paused;
 const route=tree.node?.split(':')[1],phase=game.phase??tree.node?.split(':')[0];
 const flatten=(nodes,out=[])=>{for(const n of nodes??[])if(n.kind==='component')flatten(n.children,out);else out.push(n);return out;};
 const map=new Map(flatten(tree.children).map(n=>[n.id,{...n,rect:{...n.rect}}]));
 const set=(id,x,y,w,h)=>{const n=map.get(id);if(n)map.set(id,put(n,x,y,w,h));};
 const frameRect=id=>map.get(id)?.rect??null;
 const frame=(id,x,y,w,h)=>{const source=frameRect(id);if(!source)return;const fill=map.get(id+'_fill');set(id,x,y,w,h);if(fill){const q=fill.rect,sx=w/source.width,sy=h/source.height;map.set(fill.id,{...fill,rect:{x:x+(q.x-source.x)*sx,y:100-y-h+(q.y-source.y)*sy,width:q.width*sx,height:q.height*sy}});}};
 const plateRect=id=>frameRect(id+'_plate');
 const setPlate=(id,...args)=>frame(id+'_plate',...args);
 const control=(id,x,y,w,h,ch=Math.min(3,h-1))=>{const edge=(h-ch)/2;setPlate(id,x,y,w,h);
  // One button node owns the complete visible plate. Its label is centered by
  // the renderer, so splitting the remaining plate into duplicate hit nodes
  // only pollutes hierarchy and selection without improving the hit target.
  set(id,x,y,w,h);
 };
 const text=(id,value)=>{const n=map.get(id);if(n)map.set(id,{...n,text:value});};
 if(map.has('shop_window_title')){
  const px=n=>n/height*100,bh=6.5;
  // Keep the core effect on every card. Full rules belong in the detail dialog;
  // the whole card is the action, so it needs no nested button decoration.
  for(const id of ['tab_home','tab_sell','ready','quick_deploy','refresh',...Array.from({length:4},(_,i)=>'stock_detail_'+(i+1)), 'shop_detail_buy','shop_detail_cancel','shop_detail_close']){
   const p=plateRect(id);if(p)control(id,p.x,top(p),p.width,bh);
  }
  const footer=86.5;
  control('refresh',40,footer,14,bh);control('ready',56,footer,16,bh);control('quick_deploy',74,footer,16,bh);
  set('stock_hint',10,footer,28,bh);
  for(const [id,x,w]of [['refresh_icon',41.8,2.5],['refresh_currency_icon',45,2],['refresh_cost',48,4]]){
   set(id,x,footer+(bh-px(36))/2,w,px(36));
  }
  set('refresh_content_hit',40,footer,14,bh);
  // Shared shop components: fixed skin borders, equal-height controls and
  // measured typography. No generic short-screen overrides move their children.
  for(const [id,n]of map)if(n.slice)fitNineSlice(map,id,[width,height],skinData);
  const scale=1;
  for(const [id,n]of map){
   if(!n.text||!['text','button'].includes(n.kind))continue;
   const p=plateRect(id),button=isControl(n,map.get(id+'_plate'));
   const slot=button?p:n.rect;
   const slice=map.get(id+'_plate')?.slice;const corner=slice?slice.left/slice.pixels_per_unit*height/width:0;
   const padding=button?corner*width/100+3*scale:2*scale;
   const wrap=/^(stock_(name|desc)_|shopkeeper_line|shop_detail_(story|effect)|stock_hint)/.test(id);
   const primary=button||/^(stock_name_|stock_cost_|screen_gold$|screen_crystals$|shop_detail_title$|shop_detail_price$|refresh_cost$)/.test(id);
   const target=/^(screen_title|shop_detail_title)$/.test(id)?34:/^(stock_name_|stock_cost_|shopkeeper_name|screen_gold$|screen_crystals$|shop_detail_price$|refresh_cost$)/.test(id)?28:button?24:22;
   const maxLines=id.startsWith('stock_name_')?1:id.startsWith('stock_desc_')?2:Infinity;
   const fitted=fitLabel(n.text,{width:slot.width*width/100-padding*2,height:slot.height*height/100*(button?.74:1),size:target,minSize:primary?24:20,wrap,maxLines});
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
  // Newly composed decorative coin icons must stay below their card hit area
  // and below the modal scrim, not at the end of the drawing stack.
  const ordered=[...map.values()].filter(n=>!/^stock_deploy_icon_/.test(n.id));
  for(let i=1;i<=4;i++){const icon=map.get('stock_deploy_icon_'+i);if(icon)ordered.splice(ordered.findIndex(n=>n.id==='stock_hit_'+i),0,icon);}
  const children=ordered.map(n=>({...n,rect:{x:(insets.left??0)/width*100+n.rect.x*sx,y:(insets.bottom??0)/height*100+n.rect.y*sy,width:n.rect.width*sx,height:n.rect.height*sy}}));
  const ui={...tree,children};return snapshot.world?{...snapshot,world:{...snapshot.world,ui}}:{...snapshot,ui};
 }
 layoutScreens({map,set,frame,control,text,plateRect,width,height,game,route,phase});
 for(const [id,n]of map)if(n.slice)fitNineSlice(map,id,[width,height],skinData);
 for(const [id,n]of map){
  if(!n.text||!['text','button'].includes(n.kind))continue;
  const p=plateRect(id),button=isControl(n,map.get(id+'_plate'));
  const slot=button?p:n.rect,primary=button||/(_name_|^screen_title$|^title$|^town_\d+$|^coins$|^crystals$|^screen_gold$|^screen_crystals$)/.test(id);
  const heading=/^(title|screen_title|defeat_title|help_title|town_upgrade_title|map_current_title)$/.test(id);
  const refined=/^(town_(name|effect|cost|gold)|profile_|profiles_|choice_(name|desc|quote|action|hint))/.test(id);
  const size=heading?(id==='title'?56:34):refined?(/^(town_(cost|gold)|profile_name_|choice_name_)/.test(id)?28:24):/^(result_earned|defeat_stat_value_)/.test(id)&&id!=='result_earned_label'?34:primary?24:22;
  const min=refined?22:primary?24:20,padding=button?Math.min((map.get(id+'_plate')?.slice ? map.get(id+'_plate').slice.left/map.get(id+'_plate').slice.pixels_per_unit*height/width : 1)*width/100,slot.width*width/100*.18)+2:2;
  const availableHeight=slot.height*height/100;
  const slotLabel=/^slot_\d+$/.test(id);
  const wrap=slotLabel||(!button&&!/((town|profile|stock|choice|rune|sale)_name_|_value_|^title$|_cost_|_page$|^screen_)/.test(id));
  const maxLines=slotLabel?2:(button||!wrap?1:Math.max(1,Math.floor(availableHeight/(min*1.2))));
  const fitted=fitLabel(n.text,{width:slot.width*width/100-padding*2,height:availableHeight*(button?.8:1),size:slotLabel?18:Math.max(min,size*Math.min(1,width/1200)),minSize:slotLabel?16:min,wrap,maxLines});
  text(id,fitted.text);const h=fitted.height/height*100;
  if(button){
   // Keep the native hit rectangle equal to its visible plate for every
   // button; the button renderer centers its label within that rectangle.
   set(id,p.x,top(p),p.width,p.height);
  }
  else set(id,n.rect.x,top(n.rect)+(n.rect.height-h)/2,/^(town_(name|effect|cost)_|town_gold$)/.test(id)?Math.min(n.rect.width,(fitted.width+4)/width*100):n.rect.width,h);
 }
 const sx=1-((insets.left??0)+(insets.right??0))/width,sy=1-((insets.top??0)+(insets.bottom??0))/height;
 const children=[...map.values()].map(n=>({...n,rect:{x:(insets.left??0)/width*100+n.rect.x*sx,y:(insets.bottom??0)/height*100+n.rect.y*sy,width:n.rect.width*sx,height:n.rect.height*sy}}));
 const ui={...tree,children};return snapshot.world?{...snapshot,world:{...snapshot.world,ui}}:{...snapshot,ui};
}
