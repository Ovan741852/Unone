// Game-owned composition of official image/text/button nodes. Canvas drawing
// and hit testing consume this exact tree; no DOM controls or simulation edits.
const put=(n,x,y,width,height)=>({...n,rect:{x,y:100-y-height,width,height}});
const top=r=>100-r.y-r.height;
export function fitFormalUI(snapshot,{width,height,insets={}}){
 const tree=snapshot?.world?.ui??snapshot?.ui;if(!tree)return snapshot;
 const game=snapshot?.world?.observations?.game??{},portrait=width/height<1.05;
 const battle=tree.node==='battle:home'&&!game.paused;
 const route=tree.node?.split(':')[1],phase=game.phase??tree.node?.split(':')[0];
 const map=new Map(tree.children.map(n=>[n.id,{...n,rect:{...n.rect}}]));
 const set=(id,x,y,w,h)=>{const n=map.get(id);if(n)map.set(id,put(n,x,y,w,h));};
 const control=(id,x,y,w,h,ch=Math.min(3,h-1))=>{const edge=(h-ch)/2;set(id+'_plate',x,y,w,h);
  if(map.has(id+'_hit_top')){set(id,x,y+edge,w,ch);set(id+'_hit_top',x,y,w,edge);set(id+'_hit_bottom',x,y+edge+ch,w,edge);}
  else if(map.get(id)?.kind==='button')set(id,x,y,w,h);else set(id,x+1,y+edge,w-2,ch);
 };
 const text=(id,value)=>{const n=map.get(id);if(n)map.set(id,{...n,text:value});};
 if(route==='auto'&&phase==='battle'){
  if(portrait){
   set('screen_back',2,2,96,96);set('screen_title',6,4,88,5);
   set('auto_help',7,11,86,5);
   for(const [i,p]of ['all','none','small','boss','special'].entries())control('auto_preset_'+p,6+i*17.8,18,16.8,5.5);
   for(let i=1;i<=10;i++){
    const x=6+45*((i-1)%2),y=26+10.5*Math.floor((i-1)/2);
    set('auto_card_'+i,x,y,43,9.5);set('auto_icon_'+i,x+.5,y+.5,15,8.5);set('auto_tick_'+i,x+.5,y+.2,4,2.8);
    set('auto_pick_'+i,x,y,16,9.5);set('auto_name_'+i,x+16,y,27,4.5);set('auto_info_'+i,x+16,y+4.5,27,5);
    const info=map.get('auto_info_'+i);if(info)text(info.id,info.text.replace(/ · (\d+ 隻)$/,'\n場上 $1'));
   }
   for(const [preset,label]of [['small','小怪'],['boss','王'],['special','奇遇']])text('auto_preset_'+preset,label);
   set('auto_summary',7,80,86,4);set('auto_note',7,85,86,3);
   control('auto_cancel',6,90,23,6);control('auto_stop',31,90,25,6);control('auto_apply',58,90,36,6);
  }
 }else if(battle){
  if(portrait){
   set('chapter_back',0,0,65,11);set('chapter_crest',2,1,10,7);set('chapter',14,1,48,4);set('round',14,5.5,46,3);
   set('objective_back',8,12,84,9);set('objective',12,13,76,3.5);set('boss_timing',12,17,76,2.8);
   set('timer_plate',66,1,18,8);set('time',67,2,16,5);set('pause_plate',86,1,12,8);set('pause_icon',88,2.5,8,4.5);set('pause',86,1,12,8);
   set('streak',2,22,24,3);set('shared_pool',26,22,72,3);set('horde',8,36,84,3.5);
   for(let i=1;i<=3;i++){const x=3+(i-1)*17;set('hud_unit_plate_'+i,x,82,16,11);set('hud_unit_icon_'+i,x+4,83,8,5);set('hud_unit_'+i,x,82,16,6.5);set('hud_unit_caption_'+i,x,88.5,16,4);}
   for(const [i,m]of ['lock','auto'].entries()){const x=56+i*21;set('mode_plate_'+m,x,84,20,9);set('mode_icon_'+m,x+6.5,84.5,7,4);set('mode_'+m,x,84,20,5);set('mode_label_'+m,x,89,20,3.5);}
   control('auto_settings',56,78,41,5);
   set('target_plate',54,70,44,7);set('target',55,70.5,42,3);set('target_guard',55,74,42,2.5);
   set('coins_plate',4,94,47,5);set('coins_icon',6,95,5,3);set('coins',12,94.5,37,4);
   set('crystals_plate',53,94,43,5);set('crystals_icon',55,95,5,3);set('crystals',61,94.5,33,4);
   for(let i=1;i<=3;i++)control('potion_'+i,2,30+(i-1)*6,23,5);
  }else if(height<600){
   const scale=1+Math.min(.5,Math.max(0,(600-height)/420));
   for(const [id,n]of map){let anchor;
    if(/^(hud_unit_|mode_|auto_settings|target)/.test(id))anchor=97;
    else if(/^(coins|crystals)/.test(id))anchor=99;
    else if(/^(chapter|round|objective|boss_timing|time|timer|pause|streak|shared_pool|horde)/.test(id))anchor=0;
    if(anchor!==undefined)set(id,n.rect.x,anchor+(top(n.rect)-anchor)*scale,n.rect.width,n.rect.height*scale);
   }
  }
 }else if(portrait){
  set('screen_back',2,2,96,96);set('screen_title',6,4,88,6);
  set('screen_gold',7,11,40,3.5);set('screen_crystals_plate',53,11,40,4);set('screen_crystals',53,11,40,4);
  for(const [i,r]of ['home','gear','runes','builds'].entries())control('tab_'+r,6+22*i,17,21,5.5);
  for(let i=1;i<=3;i++)control('unit_'+i,6+(i-1)*29.5,phase==='choice'?17:25,28.5,5.5);
  control('ready',43,90,51,7);control('back',55,90,39,7);
  set('story_plate',6,25,88,14);set('story_portrait',5,24,25,15);
  set('story_speaker',30,26,60,3);set('story_quote',30,30,60,7.5);
  if(phase==='menu'&&route==='home'){
   set('menu_art',0,0,100,width/height*100*941/1672);
   set('crest',39,31,22,11);set('title',8,44,84,9);set('subtitle',7,55,86,4);
   control('start',10,65,80,8);control('town',10,76,80,7);set('menu_prologue',8,88,84,4);
  }else if(phase==='map'){
   set('map_back',6,18,88,67);map.get('map_back').asset='texture://ui_route-map-portrait';set('map_journal',10,19,80,4);
   const points=[[23,76],[70,68],[25,60],[71,51],[25,43],[71,35],[45,28]];
   for(let i=1;i<=7;i++){const [x,y]=points[i-1];set('map_node_'+i,x-4,y-2.5,8,5);set('map_number_'+i,x-3,y-2,6,4);set('map_name_'+i,x<50?x+7:x-36,y-1.5,29,4);}
   const lord=map.get('map_lord'),round=game.round??1;
   if(lord){
    const t=Math.max(0,Math.min(1,(game.mapPosition??round)-(round-1))),from=round===1?[14,80]:points[round-2],to=points[round-1];
    const badge=p=>[p[0]+(p[0]>50?7:-15),p[1]-2.5],a=badge(from),b=badge(to);set('map_lord',Math.max(7,a[0]+(b[0]-a[0])*t),a[1]+(b[1]-a[1])*t,8,6);
   }
   set('map_progress',8,86,84,5);control('visit_location',12,92,76,5.5);
  }else if(phase==='choice'){
   control('view_map',66,91,28,6);
   for(let i=1;i<=3;i++){const y=40+(i-1)*16.5;set('choice_plate_'+i,6,y,88,15);set('choice_icon_'+i,8,y+2,17,10);set('choice_name_'+i,28,y+1,62,3.5);set('choice_desc_'+i,28,y+5,62,3.5);control('choice_'+i,64,y+9,27,5.5);}
  }else if(route==='town'){
   set('town_gold',8,20,84,5);
   for(let i=1;i<=4;i++){const x=8+45*((i-1)%2),y=29+28*Math.floor((i-1)/2);set('town_icon_'+i,x+10,y,23,10);control('town_'+i,x,y+10,39,5.5);set('town_cost_'+i,x,y+16,39,3);set('town_effect_'+i,x,y+20,39,6);}
   set('town_story',8,84,84,4.5);
  }else if(route==='gear'){
   for(let i=1;i<=5;i++)control('slot_'+i,6+(i-1)*14,32,13,5);control('unequip',77,32,17,5);
   for(let i=1;i<=4;i++){const x=6+45*((i-1)%2),y=39+24*Math.floor((i-1)/2);set('gear_icon_'+i,x+1,y,14,8);set('gear_name_'+i,x+16,y+1,26,6);set('gear_skill_'+i,x,y+8,42,9);control('equip_'+i,x,y+18,20,5.5);control('sell_'+i,x+22,y+18,20,5.5);}
   control('gear_prev',6,91,16,5.5);control('gear_next',24,91,16,5.5);set('empty',9,46,82,12);
  }else if(route==='runes'){
   for(let i=1;i<=3;i++){const y=35+(i-1)*15;set('rune_desc_'+i,9,y,82,5);control('rune_'+i,47,y+6,44,6);}
   control('rune_off',9,82,34,6);
  }else if(route==='builds'){
   const ids=[...map.keys()].filter(id=>/^build_name_\d+$/.test(id));
   for(const [j,id]of ids.entries()){const i=id.split('_').at(-1),y=26+j*20;set(id,9,y,82,5);set('build_desc_'+i,9,y+6,82,7);control('build_'+i,55,y+13,36,5.5);}
   control('build_prev',6,91,16,5);control('build_next',24,91,16,5);
  }else if(phase==='shop'){
   const count=[...map.keys()].filter(id=>/^stock_panel_\d+$/.test(id)).length;
   for(let i=1;i<=count;i++){const y=40+(i-1)*22;set('stock_panel_'+i,6,y,88,20);set('stock_icon_'+i,8,y+3,16,11);set('stock_name_'+i,27,y+1,63,3.5);set('stock_desc_'+i,27,y+5,63,5.5);set('stock_cost_'+i,27,y+11,63,2.8);control('buy_'+i,59,y+14,32,5.5);}
   control('stock_prev',6,91,16,5.5);control('stock_next',24,91,16,5.5);set('stock_page',49,84,42,4);
   control('refresh',6,84,33,5);control('enchant',9,43,56,7);set('enchant_help',9,52,82,9);set('enchant_offer',9,64,82,7);control('accept',9,74,39,7);control('keep',52,74,39,7);
  }
  if(['gear','runes','builds','town'].includes(route)||['defeat','clear','victory'].includes(phase)){
   set('story_portrait',3,2,19,14);set('screen_title',25,4,69,5);set('screen_gold',25,11,30,3.5);set('screen_crystals_plate',60,11,34,3.5);set('screen_crystals',60,11,34,3.5);map.delete('story_speaker');map.delete('story_quote');
  }
  if(game.paused&&phase==='battle'){
   if(route==='guide'){
    set('screen_back',5,12,90,78);set('screen_title',9,16,82,5);set('help_title',9,22,82,4);
    for(let i=1;i<=6;i++)set('help_'+i,10,30+(i-1)*7,80,5.5);control('guide_back',10,80,37,6);control('resume',51,80,39,6);
   }else if(route==='abandon'){
    set('screen_back',6,24,88,50);set('screen_title',10,29,80,5);set('abandon_warning',11,39,78,16);control('abandon_cancel',11,60,40,7);control('abandon_confirm',55,60,34,7);
   }else{
    set('screen_back',13,22,74,55);set('screen_title',20,27,60,5);control('resume',22,38,56,7);control('guide',22,47,56,6);control('mute',22,55,56,6);control('quit',22,65,56,6);
   }
  }
  if(phase==='defeat'){
   set('defeat_crest',37,5,26,14);set('defeat_title',9,21,82,8);set('defeat_reason',9,31,82,6);set('defeat_route',9,38,82,5);
   for(let i=1;i<=6;i++){const x=9+43*((i-1)%2),y=45+11*Math.floor((i-1)/2);set('defeat_stat_label_'+i,x,y,39,3.5);set('defeat_stat_value_'+i,x,y+4,39,6);}
   set('defeat_town_reward',9,79,82,4);set('defeat_save',9,84,82,4);control('defeat_town',8,91,39,6);control('defeat_retry',51,91,41,6);
  }
  if(phase==='clear'||phase==='victory'){
   set('result_message',9,23,82,4);set('result_earned_label',9,30,82,3);set('result_earned',9,34,82,9);set('result_refund',9,46,82,4);set('result_crystals',9,52,82,5);set('result_combat',9,59,82,3);control('chest',12,66,76,7);set('chest_result',9,79,59,6);control('chest_done',71,79,20,6);control('result_home',8,90,34,7);control('next',46,90,46,7);
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
  const target=/^enchant_/.test(id)?portrait?18:21:portrait?14:height<600?13:17,columns=Math.max(8,Math.floor(n.rect.width*width/100/target));
  let line='',size=0,lines=[];for(const c of (n.text??'').replace(/\n/g,/^enchant_/.test(id)?'\u2028':'')){if(c==='\u2028'){lines.push(line);line='';size=0;continue;}const w=/[\u0000-\u007f]/.test(c)?.55:1;if(size+w>columns&&line){lines.push(line);line='';size=0;}line+=c;size+=w;}if(line)lines.push(line);text(id,lines.join('\n'));
  const h=Math.min(n.rect.height,target*Math.max(lines.length*1.2,1/.72)/height*100);
  set(id,n.rect.x,top(n.rect)+(n.rect.height-h)/2,n.rect.width,h);
 }
 // Typography hierarchy is independent of hit target size. Captions are
 // native button labels with adjacent padding regions sharing the same action.
 for(const [id,n]of map){
  if((n.kind!=='text'&&!map.has(id+'_hit_top'))||!n.text||n.text.includes('\n'))continue;
  const target=id==='title'?portrait?40:62:/^(screen_title|defeat_title|help_title)$/.test(id)?portrait?25:32:/^(result_earned|defeat_stat_value_)/.test(id)&&id!=='result_earned_label'?portrait?44:56:/^(stock_name_|choice_name_|gear_name_|build_name_|town_gold|time$|coins$|crystals$)/.test(id)?portrait?18:23:map.has(id+'_hit_top')?portrait?16:19:portrait?14:18;
  const h=Math.min(n.rect.height,target/.72/height*100);if(map.has(id+'_hit_top')){const p=map.get(id+'_plate').rect,ch=height<600?Math.min(p.height*.82,14/.72/height*100):h;control(id,p.x,top(p),p.width,p.height,ch);}else set(id,n.rect.x,top(n.rect)+(n.rect.height-h)/2,n.rect.width,h);
 }
 if(!portrait&&height<600)for(const [id,n]of map){if(n.kind==='text'&&map.has(id+'_plate')&&!map.has(id+'_hit_top')&&!id.startsWith('screen_')){const p=map.get(id+'_plate').rect;const h=Math.min(p.height*.82,14/.72/height*100);set(id,p.x+1,top(p)+(p.height-h)/2,p.width-2,h);}}
 const l=Math.max(0,insets.left??0),r=Math.max(0,insets.right??0),u=Math.max(0,insets.top??0),b=Math.max(0,insets.bottom??0);
 const children=[...map.values()].map(n=>{if(n.id==='menu_art'||n.id==='screen_back')return n;const q=n.rect;return {...n,rect:{x:l/width*100+q.x*(1-(l+r)/width),y:b/height*100+q.y*(1-(u+b)/height),width:q.width*(1-(l+r)/width),height:q.height*(1-(u+b)/height)}};});
 const ui={...tree,children};return snapshot.world?{...snapshot,world:{...snapshot.world,ui}}:{...snapshot,ui};
}
