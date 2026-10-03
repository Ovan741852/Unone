// Game-owned composition of official image/text/button nodes. Canvas drawing
// and hit testing consume this exact tree; no simulation edits.
import {fitNineSlice,fitLabel} from './ui-components.mjs';
import skinData from './ui-skin-data.mjs';
import {layoutScreens} from './screen-layouts.mjs';
import {DESKTOP_VIEWPORT} from './landscape-host.mjs';
const put=(n,x,y,width,height)=>({...n,rect:{x,y:100-y-height,width,height}});
const top=r=>100-r.y-r.height;
const CENTRED=/^(screen_title$|shop_window_title$|title$|subtitle$|defeat_title$|help_title$|result_message$|result_earned|result_combat$|defeat_stat_|timeline_|stock_page$|hud_unit_|mode_|slot_\d|auto_name_|auto_info_|auto_tick_|map_number_|map_stage$|screen_gold|screen_crystals|coins$|crystals$|troop_stat_|_cost_|_price$|_page$|_value$|profile_slot_|town_cost_|gear_cost_|sale_status_|rune_owned_|empty_pack_|stock_empty_|chest_result$|enchant_cost$|shop_detail_price)/;
// Reading-direction alignment for anything that wraps: Xbox and the Game
// Accessibility Guidelines both put long text on a fixed left edge at >=1.5
// line height. Single-line headings, values and CTAs stay centred.
// Bands inside a content card all start on the card's own reading edge;
// mixing centred and left text inside one card is what multiplies axes.
const CARD_BODY=/^(gear_(name|summary|cost)_|rune_(name|desc|owned)_|town_(name|effect)_|stock_(name|desc)_|sale_(name|status)_|choice_(name|desc|action)_|profile_(name|detail)_|empty_pack_|drawer_(heading|subheading)$|rune_(heading|hint)$|loadout_board_title$|troop_stats_title$|shopkeeper_(name|line)$|enchant_heading$|town_(heading|subheading)$|help_\d+$|abandon_warning$|delete_warning$|result_story$|settings_hint$|profiles_hint$|choice_(hint|quote)$|auto_help$|stock_hint$|enchant_chances$|rune_help$|map_(plan|progress)$|help_title$)/;
const bodyText=(id,button,wrap)=>!button&&(CARD_BODY.test(id)||(wrap&&!CENTRED.test(id)));
// Shared semantic type scale, in 1920x1080 design pixels. A control's hit-box
// dimensions never select its text size; only available space may shrink it.
export const TEXT_STYLES=Object.freeze({
 display:Object.freeze({size:56,minSize:40}),
 title:Object.freeze({size:34,minSize:24}),
 button:Object.freeze({size:24,minSize:18}),
 emphasis:Object.freeze({size:24,minSize:18}),
 value:Object.freeze({size:28,minSize:20}),
 body:Object.freeze({size:22,minSize:18}),
 helper:Object.freeze({size:20,minSize:16}),
 reward:Object.freeze({size:34,minSize:22}),
});
const textStyle=(id,{button=false,heading=false,primary=false,refined=false}={})=>{
 if(id==='settings_title')return {size:42,minSize:34};
 if(id==='settings_hint')return TEXT_STYLES.helper;
 if(/^settings_.*_(label|value)$/.test(id))return {size:30,minSize:26};
 if(button)return TEXT_STYLES.button;
 if(id==='title')return TEXT_STYLES.display;
 if(heading||/^(screen_title|shop_detail_title)$/.test(id))return TEXT_STYLES.title;
 if((/^(result_earned|defeat_stat_value_)/.test(id)&&id!=='result_earned_label'))return TEXT_STYLES.reward;
 if(/^(stock_(name|cost)_|shopkeeper_name|screen_gold$|screen_crystals$|shop_detail_price$|refresh_cost$|town_(cost|gold)_|profile_name_|choice_name_)/.test(id))return TEXT_STYLES.value;
 if(refined||primary)return TEXT_STYLES.emphasis;
 if(/(_hint|_help|_info|_desc_|_summary_|_line$|_warning$|_quote$|_story$|_subheading$|_effect_)/.test(id))return TEXT_STYLES.helper;
 return TEXT_STYLES.body;
};
export function fitFormalUI(snapshot,{width:viewportWidth=DESKTOP_VIEWPORT.width,height:viewportHeight=DESKTOP_VIEWPORT.height}={}){
 const {width,height}=DESKTOP_VIEWPORT,insets={};
 const fontScale=Math.min(viewportWidth/width,viewportHeight/height);
 const tree=snapshot?.world?.ui??snapshot?.ui;if(!tree)return snapshot;
 const game=snapshot?.world?.observations?.game??{};
 const battle=tree.node==='battle:home'&&!game.paused;
 const route=tree.node?.split(':')[1],phase=game.phase??tree.node?.split(':')[0];
 const flatten=(nodes,out=[])=>{for(const n of nodes??[])if(n.kind==='component')flatten(n.children,out);else out.push(n);return out;};
 const map=new Map(flatten(tree.children).map(n=>[n.id,{...n,rect:{...n.rect}}]));
 const set=(id,x,y,w,h)=>{const n=map.get(id);if(n)map.set(id,put(n,x,y,w,h));};
 const sliceParts=id=>['tl','t','tr','l','c','r','bl','b','br'].map(part=>map.get(id+'_'+part)).filter(Boolean);
 const frameRect=id=>{const direct=map.get(id);if(direct)return direct.rect;const parts=sliceParts(id);if(!parts.length)return null;const x=Math.min(...parts.map(n=>n.rect.x)),y=Math.min(...parts.map(n=>n.rect.y)),right=Math.max(...parts.map(n=>n.rect.x+n.rect.width)),bottom=Math.max(...parts.map(n=>n.rect.y+n.rect.height));return {x,y,width:right-x,height:bottom-y};};
 const frame=(id,x,y,w,h)=>{if(map.has(id)){set(id,x,y,w,h);return;}const parts=sliceParts(id),source=frameRect(id);if(!source)return;const fill=map.get(id+'_fill');if(fill)parts.push(fill);const target={x,y:100-y-h,width:w,height:h},sx=w/source.width,sy=h/source.height;for(const part of parts){const q=part.rect;map.set(part.id,{...part,rect:{x:target.x+(q.x-source.x)*sx,y:target.y+(q.y-source.y)*sy,width:q.width*sx,height:q.height*sy}});}};
 const plateRect=id=>frameRect(id+'_plate');
 const platePadding=id=>{const slice=map.get(id+'_plate')?.slice;if(slice)return slice.left*height/100/slice.pixels_per_unit;const legacy=map.get(id+'_plate_tl');return legacy?legacy.rect.width*width/100:0;};
 const setPlate=(id,...args)=>frame(id+'_plate',...args);
 const control=(id,x,y,w,h,ch=Math.min(3,h-1))=>{const edge=(h-ch)/2;setPlate(id,x,y,w,h);
  // One button node owns the complete visible plate. Its label is centered by
  // the renderer, so splitting the remaining plate into duplicate hit nodes
  // only pollutes hierarchy and selection without improving the hit target.
  set(id,x,y,w,h);
 };
 const text=(id,value,fontSize)=>{const n=map.get(id);if(n)map.set(id,{...n,text:value,...(Number.isFinite(fontSize)?{fontSize}:{})});};
 if(map.has('shop_window_title')){
  const px=n=>n/height*100,bh=6.5;
  // Keep the core effect on every card. Full rules belong in the detail dialog;
  // the whole card is the action, so it needs no nested button decoration.
  for(const id of ['tab_home','tab_sell','ready','quick_deploy','refresh',...Array.from({length:4},(_,i)=>'stock_detail_'+(i+1)), 'shop_detail_buy','shop_detail_cancel','shop_detail_close']){
   const p=plateRect(id);if(p)control(id,p.x,top(p),p.width,bh);
  }
  const footer=86.5;
  control('refresh',40,footer,14,bh);control('ready',65,footer,13,bh);control('quick_deploy',79,footer,13,bh);
  set('stock_hint',10,footer,28,bh);
  for(const [id,x,w]of [['refresh_icon',41.8,2.5],['refresh_currency_icon',45,2],['refresh_cost',48,4]]){
   set(id,x,footer+(bh-px(36))/2,w,px(36));
  }
  set('refresh_content_hit',40,footer,14,bh);
  // Shared shop components: fixed skin borders, equal-height controls and
  // measured typography. No generic short-screen overrides move their children.
  for(const id of [...map.keys()])if(id.endsWith('_tl'))fitNineSlice(map,id.slice(0,-3),[width,height],skinData);
  const scale=1;
  for(const [id,n]of map){
   if(!n.text||!['text','button'].includes(n.kind))continue;
   const p=plateRect(id),button=!!p;
   const slot=button?p:n.rect;
   const padding=button?platePadding(id)+3*scale:2*scale;
   const wrap=/^(stock_(name|desc)_|shopkeeper_line|shop_detail_(story|effect)|stock_hint)/.test(id);
   const primary=button||/^(stock_name_|stock_cost_|screen_gold$|screen_crystals$|shop_detail_title$|shop_detail_price$|refresh_cost$)/.test(id);
   const style=textStyle(id,{button,primary});
   const maxLines=id.startsWith('stock_name_')?1:id.startsWith('stock_desc_')?2:Infinity;
   const long=bodyText(id,button,wrap);
   const fitted=fitLabel(n.text,{width:slot.width*width/100-padding*2,height:slot.height*height/100*(button?.74:1),...style,wrap,maxLines,lineHeight:long?1.5:1.2});
   text(id,fitted.text,fitted.fontSize*fontScale);
   if(/^settings_.*_(label|value)$/.test(id))map.set(id,{...map.get(id),align:'start'});
   if(long&&(CARD_BODY.test(id)||fitted.lines>1))map.set(id,{...map.get(id),align:'start',...(fitted.lines>1?{lineHeight:1.5}:{})});
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
 for(const id of [...map.keys()])if(id.endsWith('_tl'))fitNineSlice(map,id.slice(0,-3),[width,height],skinData);
 for(const [id,n]of map){
  if(!n.text||!['text','button'].includes(n.kind))continue;
  const p=plateRect(id),button=!!p&&(n.kind==='button'||map.has(id+'_hit_top')||!id.endsWith('_icon'));
  const slot=button?p:n.rect,primary=button||/(_name_|^screen_title$|^title$|^town_\d+$|^coins$|^crystals$|^screen_gold$|^screen_crystals$)/.test(id);
  const heading=/^(title|screen_title|defeat_title|help_title|town_upgrade_title|map_current_title)$/.test(id);
  const refined=/^(town_(name|effect|cost|gold)|profile_|profiles_|choice_(name|desc|quote|action|hint))/.test(id);
  const style=textStyle(id,{button,heading,primary,refined}),padding=button?Math.min(platePadding(id),slot.width*width/100*.18)+2:2;
  const availableHeight=slot.height*height/100;
  const slotLabel=/^slot_\d+$/.test(id);
  const wrap=slotLabel||(!button&&!/((town|profile|stock|choice|rune|sale)_name_|_value_|^title$|_cost_|_page$|^screen_)/.test(id));
  const maxLines=slotLabel?2:(button||!wrap?1:Math.max(1,Math.floor(availableHeight/(style.minSize*1.2))));
  const long=bodyText(id,button,wrap);
  const fitted=fitLabel(n.text,{width:slot.width*width/100-padding*2,height:availableHeight*(button?.8:1),...(slotLabel?TEXT_STYLES.body:style),wrap,maxLines,lineHeight:long?1.5:1.2});
  text(id,fitted.text,fitted.fontSize*fontScale);
  if(/^settings_.*_(label|value)$/.test(id))map.set(id,{...map.get(id),align:'start'});
  if(long&&(CARD_BODY.test(id)||fitted.lines>1))map.set(id,{...map.get(id),align:'start',...(fitted.lines>1?{lineHeight:1.5}:{})});const h=fitted.height/height*100;
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
