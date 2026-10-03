// Per-screen composition in the same coordinate tree used by drawing and input.
// Keep game rules in Luau. Pixel floors only determine layout, never gameplay.
//
// One desktop system for every screen (2026-09-20 layout pass):
//   window      nineSlice at (4,4,92,92); usable content is x 8..92, y 16..93
//   title band  screen_title centred on x=50 at y 7.4; currency badges at y 6.2
//   controls    BH = 6.5 units = 70.2 design px, the height in UI-DESIGN-GUIDELINES
//   footer      FOOT = 93 - BH, so an action row always ends inside the window fill
//   close/back  one plated icon-close at the window's top-right corner
export function layoutScreens({map,set,frame,control,text,plateRect,width,height,game,route,phase}){
 const px=n=>n/height*100;
 // fitLabel reserves size*1.389 for one line, so a text slot is the ROW height,
 // not the font size. LINE/BODY/SMALL are the shared single-line rows.
 const BH=6.5,LINE=px(40),BODY=px(34),SMALL=px(31),FOOT=93-BH,GAP=px(14);
 const bh=BH,compact=false; // One desktop layout; scaling belongs to the complete stage.
 const hide=(...ids)=>ids.forEach(id=>{map.delete(id);for(const key of [...map.keys()])if(key.startsWith(id+'_'))map.delete(key)});
 const place=(id,x,y,w,h=BH)=>control(id,x,y,w,h);
 const label=(id,x,y,w,h=LINE)=>set(id,x,y,w,h);
 // A row of n equal cells filling [x0,x0+total]; every grid on every screen
 // comes from this, so rows above and below each other share their edges.
 const cells=(n,x0,total,gap)=>{const w=(total-gap*(n-1))/n;return {w,x:i=>x0+i*(w+gap)};};
 const shop=phase==='shop',battle=phase==='battle'&&!game.paused&&route!=='auto';
 // Common chrome: one title band, one currency band, one footer band.
 if(map.has('screen_title')){
  label('screen_title',38,7.4,24,Math.max(LINE,5));
  if(map.has('screen_gold_plate')){
   label('screen_gold_plate',64,6.2,10.5,BH);label('screen_gold_icon',65,7.5,3.2,3.9);label('screen_gold',68.7,7.65,5.3,3.5);
   label('screen_crystals_plate',75,6.2,10.5,BH);label('screen_crystals_icon',76,7.5,3.2,3.9);label('screen_crystals',79.7,7.65,5.3,3.5);
  }else for(const [id,x,w]of [['screen_gold_icon',66,3],['screen_gold',70,7],['screen_crystals_icon',78,3],['screen_crystals',82,6]])label(id,x,7.3,w,3.5);
 }
 for(const [id,n]of map){const p=plateRect(id);if(id!=='settings_back'&&p&&(n.kind==='button'||n.kind==='text'))control(id,p.x,100-p.y-p.height,p.width,Math.max(p.height,BH));}
 for(const id of ['ready','deploy','launch_expedition','next']){
  const p=plateRect(id);if(p)place(id,p.x,FOOT,p.width);
 }
 // Return/close is a single title-bar affordance on every screen, with its
 // plate and its icon kept together in the window's top-right corner.
 for(const id of ['loadout_return','town_back','back','profiles_back','result_home','defeat_town','guide_back','pause_close']){
  if(map.has(id)){place(id,87,6.2,5.5,5.8);if(map.has(id+'_icon'))label(id+'_icon',88.25,6.85,3,3.7);}
 }
 if(map.has('tab_gear')){
  place('tab_gear',7,30.5,7,11);place('tab_runes',7,43,7,11);
  for(const [id,y]of [['tab_gear',30.5],['tab_runes',43]]){
   label(id+'_plate',7,y,7,11);label(id+'_active',7,y,7,11);label(id+'_icon',8.65,y+1.15,3.7,4.2);label(id+'_label',7.5,y+6.4,6,px(36));
  }
 }
 if(shop){
  place('ready',65,FOOT,13);place('quick_deploy',79,FOOT,13);
  if(map.has('tab_home')){place('tab_home',8,16,22);place('tab_sell',32,16,22);}
  hide('shopkeeper_back');label('shopkeeper_portrait',9,26,23,29);
  label('shopkeeper_name',8,57,25,LINE);label('shopkeeper_line',8,63,25,px(96));
  // Status has its own rail; it never draws on top of a Buy button.
  label('shop_feedback',37,16,55,LINE);label('shop_receipt',37,16,55,LINE);
  if(map.has('tab_home')){label('shop_feedback',8,FOOT,50,BH);label('shop_receipt',8,FOOT,50,BH);}
 }
 if(phase==='menu'&&route==='home'){
  // The menu action group is an AI layout intent documented in
  // design-v1/AI-LAYOUT-CONTRACT.md. Runtime keeps only this resolved
  // composition; it does not infer groups from pixel proximity.
  // Optical offset compensates the logo artwork's heavier left leaf mass;
  // subtitle and actions remain on the shared x=9..43 alignment axis.
  set('title',10,25,34,19.1);label('subtitle',9,43,34,LINE);label('exit_message',48,87,44,LINE);
  place('start',9,60,34);place('settings',9,69,34);place('exit',9,78,34);
 }else if(route==='town'){
  label('town_lord',9,30,23,38);
  label('town_heading',37,17,55,px(42));label('town_subheading',37,22,55,px(36));
  label('town_material_icon',15,19,48/width*100,px(48));label('town_gold',15+60/width*100,19,7,px(48));text('town_gold',map.get('town_gold')?.text.replace('建材 ',''));
  label('town_record',9,71,23,px(64));
  {const g=cells(2,37,55,1);
   for(let i=1;i<=8;i++){const x=g.x((i-1)%2),w=g.w,y=28+Math.floor((i-1)/2)*13,h=11.5;
    place('town_'+i,x,y,w,h);
    const middle=y+h/2;
    label('town_icon_'+i,x+1.1,middle-px(50),72/width*100,px(72));
    label('town_name_'+i,x+5.7,middle-px(40),15,px(50));
    label('town_effect_'+i,x+5.7,middle+px(6),15,px(45));
    label('town_cost_icon_'+i,x+w-6.4,middle-px(25),36/width*100,px(50));label('town_cost_'+i,x+w-4.1,middle-px(31),3.4,px(44));
   }}
  if(map.has('town_upgrade_title')){
   // A modal owns the whole screen: the background action must not stay live.
   hide('launch_expedition','town_back');
   frame('town_upgrade_modal',22,14,56,64);
   label('town_upgrade_kicker',26,18,48,SMALL);label('town_upgrade_title',26,24,48,LINE);
   label('town_upgrade_level',26,31,48,BODY);label('town_upgrade_desc',26,38,48,px(48));
   label('town_upgrade_cost',26,48,48,BODY);label('town_upgrade_note',26,55,48,px(45));
   place('town_upgrade_confirm',26,69,24);place('town_upgrade_cancel',52,69,24);
  }
 }else if(route==='profiles'){
  label('profiles_hint',8,16,84,px(42));
  {const g=cells(3,13,74,4);
   for(let i=1;i<=3;i++){const x=g.x(i-1),w=g.w;frame('profile_card_'+i,x,25,w,45);
    label('profile_slot_'+i,x+2,30.2,w-4,px(34));label('profile_name_'+i,x+2,34.4,w-4,px(44));
    label('profile_detail_'+i,x+2,39.7,w-4,px(72));
    place('profile_load_'+i,x+2,49.4,w-4);place('profile_delete_'+i,x+w/4,58.9,w/2);
    place('profile_create_'+i,x+2,49.4,w-4);
   }}
  label('delete_warning',16,30,68,px(70));place('delete_cancel',24,55,22);place('delete_confirm',54,55,22);
 }else if(route==='settings'){
  // Settings (including close) keep their shared Luau drawing/input bounds.
 }else if(phase==='choice'){
  hide('screen_gold','screen_crystals');
  label('choice_hint',12,16,76,px(45));label('choice_quote',12,21,76,px(45));
  place('choice_loadout',29,FOOT,20);place('view_map',51,FOOT,20);
  {const g=cells(3,15,70,2);
   for(let i=1;i<=3;i++){const x=g.x(i-1),w=g.w;frame('choice_plate_'+i,x,28,w,52);
    label('choice_icon_'+i,x+3,38,w-6,19);label('choice_name_'+i,x+2,57.5,w-4,px(50));
    label('choice_desc_'+i,x+2,61.5,w-4,px(76));label('choice_action_'+i,x+2,69.2,w-4,px(44));
    label('choice_'+i,x,28,w,52);
   }}
 }else if(phase==='map'){
  // Preserve the painted atlas aspect, then transform its world markers together.
  const source=map.get('map_back').rect,sourceTop=100-source.y-source.height;
  const atlasW=Math.min(width*.61,height*.64*(1672/941))/width*100,atlasH=atlasW*width/height/(1672/941);
  const atlasX=7+(61-atlasW)/2,atlasY=18+(64-atlasH)/2;
  const centers=new Map([...map].filter(([id])=>/^map_(node_\d+|current_ring|cursor_icon)$/.test(id)).map(([id,n])=>[id,{
   x:atlasX+((n.rect.x+n.rect.width/2-source.x)/source.width)*atlasW,
   y:atlasY+((100-n.rect.y-n.rect.height/2-sourceTop)/source.height)*atlasH,
  }]));
  label('map_back',atlasX,atlasY,atlasW,atlasH);
  for(let i=1;i<=7;i++){
   label('map_link_'+i,atlasX,atlasY,atlasW,atlasH);
   const c=centers.get('map_node_'+i),size=i===game.round?60:46,w=size/width*100,h=px(size);
   label('map_node_'+i,c.x-w/2,c.y-h/2,w,h);label('map_number_'+i,c.x-w/2,c.y-px(12),w,px(30));
  }
  for(const [id,size,offset]of [['map_current_ring',74,0],['map_cursor_icon',32,36]]){
   const c=centers.get(id);if(c)label(id,c.x-size/width*50,c.y-px(size/2+offset),size/width*100,px(size));
  }
  // Right rail: portrait, place name, status and next stop all on x = 82.
  label('map_lord',76,22,12,18);label('map_stage',71,7.3,22,px(39));
  label('map_current_title',71,43,22,px(48));
  label('map_plan',71,52,22,px(48));label('map_next',71,64,22,px(48));
  // The legend belongs to the atlas, so it sits directly under it.
  label('map_progress',atlasX,atlasY+atlasH+1.6,atlasW,SMALL);place('visit_location',71,FOOT,22);
 }else if(route==='gear'){
  // Left: one board holding the roster tabs, the doll and its slot grid.
  label('loadout_board',14,31,38,46);
  // The active roster tab already names the unit and the screen title names
  // the task, so a third heading on the board's ornament is noise.
  hide('loadout_board_title');
  hide('troop_quote'); // the deploy cost already rides on each roster tab
  {const g=cells(3,14,38,1);
   for(let i=1;i<=3;i++){const x=g.x(i-1),w=g.w;place('roster_unit_'+i,x,24.5,w,BH);
    label('roster_unit_'+i+'_plate',x,24.5,w,BH);label('roster_unit_'+i+'_icon',x+1,25.6,2.6,3.4);
    label('roster_unit_'+i+'_label',x+4,25.1,w-5,px(60));
   }}
  // Slot columns are symmetric about the board centre (x = 33).
  for(const [i,[x,y]]of [[1,[17,35.4]],[2,[17,47.4]],[3,[17,59.4]],[4,[44.5,40.4]],[5,[44.5,54.4]]]){
    label('slot_frame_'+i,x-.35,y-.25,5.2,8.5);label('slot_part_'+i,x+1,y+2,2.5,3.5);label('worn_icon_'+i,x+.55,y+1.8,3.4,4.4);label('slot_'+i,x-.6,y+6.05,5.7,px(34));
   label('slot_hit_'+i,x,y,4.5,8);
  }
  frame('troop_stats_panel',14,85.5,38,6.5);label('troop_stats_title',15,87,7.5,px(35));
  for(let i=1;i<=5;i++){const x=23+(i-1)*5.6;label('troop_stat_icon_'+i,x,87.15,1.6,px(26));label('troop_stat_value_'+i,x+1.8,87.25,3.2,px(31));}
  hide('active_slot');place('unequip',25,78.5,16);place('deploy',70,FOOT,22);
  if(map.has('drawer_heading')){
   // Right: the drawer stays inside the window; its header uses its own axis.
   frame('drawer_frame',56,13.5,36,70);
   label('drawer_heading',59.5,15.5,29,LINE);label('drawer_subheading',59.5,19.8,29,px(31));
   place('drawer_close',86.5,15.5,4.5,5.4);label('drawer_close_icon',87.5,16.2,2.5,3.2);
   // The frame's center is x=60.5..87.5 and y=21.5..75.5. Keep every
   // inventory tile inside that authored content area; the previous 32-unit
   // grid crossed both ornamental side rails and the lower frame rail.
   {const g=cells(2,58.5,30,1.2);
    for(let i=1;i<=6;i++){const x=g.x((i-1)%2),w=g.w,y=23.5+Math.floor((i-1)/2)*21.5;
     frame('pack_tile_'+i,x,y,w,20.5);
     label('gear_rarity_'+i,x+.5,y+.5,4.3,5.2);label('gear_icon_'+i,x+1.05,y+1.05,3.2,4.0);label('gear_name_'+i,x+1,y+6.1,w-2,px(62));
     label('gear_summary_'+i,x+1,y+11.9,w-2,px(40));label('gear_cost_'+i,x+1,y+15.8,w-8,px(26));
     place('inspect_'+i,x,y,w,15.6);place('equip_'+i,x+9.2,y+15.8,w-10.2,4.2);label('equip_'+i+'_label',x+9.4,y+16.35,w-10.6,px(30));
     label('empty_pack_icon_'+i,x+1,y+1,3.4,4.2);label('empty_pack_'+i,x+1,y+6.6,w-2,px(46));
    }}
   if(map.has('gear_scroll_track')){label('gear_scroll_track',88.8,24,1.2,51.5);label('gear_scroll_thumb',88.7,24,1.8,10);place('gear_scroll_up',88.4,18,3,5);place('gear_scroll_down',88.4,76,3,5);}
  }else if(map.has('drawer_hint')){
   label('drawer_hint',59,38,30,px(56));place('drawer_open',62,50,24);
  }
  if(map.has('gear_detail_title')){
   // One modal, one axis, and no second close icon left live behind it.
   hide('drawer_close','loadout_return');
   frame('gear_detail_modal',20,10,60,80);
   label('gear_detail_acorn',47,11,6,7);label('gear_detail_rim',25,23,16,21);label('gear_detail_icon',28,27,10,14);
   label('gear_detail_title',44,23,30,LINE);label('gear_detail_quote',44,31,30,px(76));label('gear_detail_level',44,39,30,px(48));label('gear_detail_effect',25,49,50,px(68));label('gear_detail_recipe',25,66,50,px(40));
   place('gear_detail_equip',27,75,28);place('gear_detail_close',75,13,5.5,6);label('gear_detail_close_icon',76.2,13.8,3,3.7);
  }
 }else if(route==='runes'){
  label('loadout_board',14,31,38,46);
  label('rune_heading',57,22,30,LINE);label('rune_hint',57,26.3,30,px(31));
  label('rune_loadout_slot',17,64,32,9);label('rune_loadout_icon',18.5,65.5,5,5);label('rune_loadout_name',25,65.5,22,px(48));label('rune_loadout_state',25,69.5,22,px(39));
  hide('troop_quote');
  {const g=cells(3,14,38,1);
   for(let i=1;i<=3;i++){const x=g.x(i-1),w=g.w;place('unit_'+i,x,24.5,w,BH);
    label('unit_'+i+'_plate',x,24.5,w,BH);label('unit_'+i+'_icon',x+1,25.6,2.6,3.4);label('unit_'+i+'_label',x+4,25.1,w-5,px(60));
   }}
  // Rune cards stop at x = 88 so the scrollbar stays inside the window too.
  {const g=cells(2,56,32,1);
   for(let i=1;i<=4;i++){const x=g.x((i-1)%2),w=g.w,y=30.5+Math.floor((i-1)/2)*25;
    frame('rune_tile_'+i,x,y,w,24);label('rune_icon_'+i,x+1,y+.8,4.2,4.4);label('rune_name_'+i,x+1,y+5.8,w-2,px(45));
    label('rune_desc_'+i,x+1,y+10.3,w-2,px(64));label('rune_owned_'+i,x+1,y+16.5,w-2,px(28));place('rune_'+i,x+1,y+19.6,w-2,4.2);
   }}
  label('rune_help',59.5,80.6,29,px(31));place('rune_off',53.3,FOOT,15);
  if(map.has('rune_scroll_track')){label('rune_scroll_track',89.5,30.5,1.4,49);label('rune_scroll_thumb',89.2,30.5,2,11);place('rune_scroll_up',88.7,24,3,5);place('rune_scroll_down',88.7,80.5,3,5);}
  frame('troop_stats_panel',14,85.5,38,6.5);label('troop_stats_title',15,87,7.5,px(35));
  for(let i=1;i<=5;i++){const x=23+(i-1)*5.6;label('troop_stat_icon_'+i,x,87.15,1.6,px(32));label('troop_stat_value_'+i,x+1.8,87.25,3.2,px(31));}
  place('deploy',70,FOOT,22);
 }else if(route==='sell'){
  // Icon rail on the left of each row; the text block and its action share a width.
  {const g=cells(2,37,55,1);
   for(let i=1;i<=4;i++){
    if(game.location==='rune'){const y=31+(i-1)*15;label('sale_icon_'+i,37,y,7,10);label('sale_name_'+i,46,y,29,BODY);place('sale_'+i,76,y+1.5,16);}
    else{const x=g.x((i-1)%2),w=g.w,y=31+Math.floor((i-1)/2)*24;
     label('sale_icon_'+i,x+1,y,6,9);label('sale_name_'+i,x+8,y,w-9,BODY);label('sale_status_'+i,x+8,y+BODY+px(8),w-9,SMALL);place('sale_'+i,x+8,y+11,w-9);}
   }}
  place('sale_prev',37,FOOT,11);place('sale_next',49,FOOT,11);
 }else if(shop&&game.location==='enchant'){
  label('enchant_heading',37,16,55,BODY);
  // Both rows share the same left and right edge.
  {const g=cells(5,37,54.2,1);for(let i=1;i<=5;i++)place('enchant_slot_'+i,g.x(i-1),24,g.w);}
  {const g=cells(3,37,54.2,1);for(let i=1;i<=3;i++)place('unit_'+i,g.x(i-1),24+BH+px(14),g.w);}
  label('enchant_item_icon',38,52,10,17);label('enchant_item_name',50,52,41,BODY);
  label('enchant_current',50,52+BODY,41,px(48));label('enchant_cost',37,72,26,px(48));
  place('enchant_roll',65.2,71.5,26);label('enchant_chances',8,FOOT,46,BH);
  if(map.has('enchant_reveal_name')){
   frame('enchant_reveal_back',36,38,55.2,44);label('enchant_reveal_tier',40,41,47.2,BODY);
   label('enchant_reveal_icon',40,49,10,14);label('enchant_reveal_name',52,49,35,px(42));
   place('enchant_accept',37,74,26.2);place('enchant_keep',65,74,26.2);
  }
 }else if(shop&&game.location==='forge'){
  label('forge_heading',37,16,55,BODY);label('forge_recipe',37,20.5,55,SMALL);
  for(let i=1;i<=6;i++){
   const x=37+((i-1)%3)*18.5,y=26+Math.floor((i-1)/3)*22,w=17.2;
   frame('forge_item_panel_'+i,x,y,w,20.5);
   label('forge_item_icon_'+i,x+1.3,y+1.4,4.8,6.7);label('forge_item_name_'+i,x+6.4,y+1.5,9.7,px(70));
   label('forge_item_state_'+i,x+1.3,y+9.2,14.5,px(48));place('forge_select_'+i,x+1.3,y+14.2,14.5,4.6);
   label('forge_item_empty_'+i,x+2,y+8,13,px(52));
  }
  label('forge_selection',37,73.5,20,BODY);place('forge_ascend',57,73,16.5);place('forge_reroll',75,73,16.5);
  place('forge_prev',57,82,7,5);label('forge_page',65,82.5,10,SMALL);place('forge_next',76,82,7,5);
 }else if(shop){
  // Icon, name, effect, price and action all stack on the card's own centre.
  const contentTop=map.has('tab_home')?30:25,bottom=79;
  const g=cells(2,37,55,1);
  for(let i=1;i<=2;i++){const x=g.x(i-1),w=g.w;frame('stock_panel_'+i,x,contentTop,w,bottom-contentTop);
   label('stock_icon_'+i,x+w/2-3.5,contentTop+2,7,10);label('stock_name_'+i,x+2,contentTop+13.5,w-4,LINE);
   label('stock_desc_'+i,x+2,contentTop+19,w-4,Math.max(px(52),bottom-contentTop-19-BH-9));
   label('stock_cost_icon_'+i,x+w/2-4.5,bottom-BH-7.5,3,BODY);label('stock_cost_'+i,x+w/2-1,bottom-BH-7.5,6,BODY);
   place('buy_'+i,x+2,bottom-BH-2,w-4);
  }
  place('stock_prev',37,FOOT,9);label('stock_page',47,FOOT,7,BH);place('stock_next',55,FOOT,9);
 }else if(route==='auto'){
  frame('screen_back',4,4,92,92);label('auto_help',8,15,84,SMALL);
  // Presets are global actions, so their row deliberately does not share the
  // column grid below it — otherwise they read as per-column headers.
  {const g=cells(5,17.5,57,1.5);for(const [i,name]of ['all','none','small','boss','special'].entries())place('auto_preset_'+name,g.x(i),21,g.w);}
  const y0=21+BH+GAP,footer=FOOT,row=(footer-px(48)-y0)/2;
  {const g=cells(5,8,84,1.4);
   for(let i=1;i<=10;i++){const x=g.x((i-1)%5),w=g.w,y=y0+Math.floor((i-1)/5)*row,h=row-px(11);
    frame('auto_card_'+i,x,y,w,h);label('auto_icon_'+i,x+w/2-4.5,y,9,h-px(40));label('auto_tick_'+i,x+w-3.5,y+.6,2.5,px(22));
    label('auto_pick_'+i,x,y,w,h-px(46));label('auto_name_'+i,x,y+h-px(46),w,px(34));label('auto_info_'+i,x,y+h-px(31),w,px(31));
   }}
  // Each caption sits over the button it describes.
  label('auto_summary',8,footer-px(45),24,SMALL);label('auto_note',60,footer-px(45),32,SMALL);
  place('auto_cancel',8,footer,24);place('auto_stop',34,footer,24);place('auto_apply',60,footer,32);
 }else if(battle){
  const bottom=98-BH,unitH=BH;
  for(let i=1;i<=3;i++){const x=2+(i-1)*9.5,w=9;frame('hud_unit_plate_'+i,x,bottom,w,unitH);
   label('hud_unit_icon_'+i,x+.35,bottom+.9,3,4.7);label('hud_unit_'+i,x,bottom,3.4,unitH);label('hud_unit_caption_'+i,x+3.6,bottom+.5,w-3.8,5.5);
  }
  for(const [name,x]of [['lock',77],['auto',88]]){frame('mode_plate_'+name,x,bottom,10.4,unitH);label('mode_icon_'+name,x+.45,bottom+.9,3,4.7);label('mode_'+name,x,bottom,3.4,unitH);label('mode_label_'+name,x+3.6,bottom+.5,6.8,5.5);}
  place('auto_settings',77,98-unitH-BH-px(11),21.4);
  frame('target_plate',77,98-unitH-BH-px(63),21.4,px(48));label('target',78,98-unitH-BH-px(61),19.4,SMALL);label('target_guard',78,98-unitH-BH-px(38),19.4,SMALL);
  place('pause',93,2,Math.max(5.2,44/width*100));frame('pause_plate',93,2,Math.max(5.2,44/width*100),BH);label('pause_icon',94,2+px(10),3,px(30));
  for(const [id,x]of [['coins',35],['crystals',55]]){frame(id+'_plate',x,bottom,18,BH);label(id+'_icon',x+1,bottom+px(13),3,px(42));label(id,x+5,bottom,12,BH);}
  // Countdown has its own left rail; event markers own the progress track.
  // Round and boss timing sit just below the track and never cover event art.
  label('timeline_track',20,2,73,9);
  const trackWidth=map.get('timeline_track')?.rect.width??86,fillWidth=map.get('timeline_fill')?.rect.width??0;
  label('timeline_fill',20,2,73*fillWidth/trackWidth,9);
  label('timeline_time',7,4.5,12,4);
  label('timeline_round',8,11.5,18,2);label('timeline_goal',67,11.5,26,2);
  for(let i=1;i<=2;i++)place('potion_'+i,2,24+(i-1)*(BH+px(14)),12);
 }else if(game.paused){
  if(route==='guide'){
   // The heading sits on the same reading edge as the list it introduces.
   label('help_title',15,20,70,BODY);
   for(let i=1;i<=6;i++)label('help_'+i,15,29+(i-1)*6.6,70,px(36));
   place('resume',37.5,FOOT,25);
  }
  else if(route==='abandon'){label('abandon_warning',15,30,70,px(80));place('abandon_cancel',16,58,33);place('abandon_confirm',51,58,33);}
  else{const y0=33;for(const [i,id]of ['resume','guide','quit','mute'].entries())place(id,32,y0+i*(BH+GAP),36);}
 }else if(['clear','victory'].includes(phase)){
  // Three stat columns on one baseline, then the chest row, story and action.
  label('result_message',8,19,84,BODY);
  const g=cells(3,10,80,2);
  label('result_earned_label',g.x(0),30,g.w,SMALL);label('result_earned',g.x(0),35,g.w,px(48));
  label('result_refund',g.x(1),35,g.w,px(44));
  label('result_crystals',g.x(2),34,g.w,px(56));
  label('result_combat',8,47,84,BODY);
  place('chest',30,55,40);
  label('chest_result',34,55,24,BH);place('chest_done',60,55,14);
  label('result_story',8,67,84,SMALL);
 }else if(phase==='defeat'){
  label('defeat_crest',44,7,12,15);label('defeat_title',20,23,60,px(42));label('defeat_reason',8,35,84,BODY);label('defeat_route',8,42,84,SMALL);
  {const g=cells(3,8,84,0);
   for(let i=1;i<=6;i++){const x=g.x((i-1)%3),y=50+Math.floor((i-1)/3)*13;label('defeat_stat_label_'+i,x,y,g.w,SMALL);label('defeat_stat_value_'+i,x,y+SMALL,g.w,px(42));}}
  label('defeat_town_reward',8,77,84,SMALL);hide('defeat_save');place('defeat_retry',32,FOOT,36);
 }
 if(shop&&map.has('shop_detail_title')){
  frame('shop_detail_modal',22,14,56,64);
  label('shop_detail_kicker',26,18,48,SMALL);label('shop_detail_title',26,24,48,LINE);
  label('shop_detail_icon',26,31,11,15);label('shop_detail_story',39,32,35,px(44));
  label('shop_detail_price_icon',26,48,3,BODY);label('shop_detail_price',30,48,10,BODY);label('shop_detail_deploy',44,48,30,BODY);
  label('shop_detail_trigger',26,55,48,SMALL);label('shop_detail_effect',26,60,48,px(60));
  place('shop_detail_buy',38,69,24);place('shop_detail_close',71,16,5.5,BH);label('shop_detail_close_icon',72.25,17.15,3,3.7);
 }
 return {bh,compact};
}
