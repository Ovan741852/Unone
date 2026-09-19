// Per-screen composition in the same coordinate tree used by drawing and input.
// Keep game rules in Luau. Pixel floors only determine layout, never gameplay.
export function layoutScreens({map,set,frame,control,text,plateRect,width,height,game,route,phase}){
 const px=n=>n/height*100, bh=Math.max(6,px(44)), line=px(24), small=px(20), foot=94-bh;
 const hide=(...ids)=>ids.forEach(id=>{map.delete(id);for(const key of [...map.keys()])if(key.startsWith(id+'_'))map.delete(key)});
 const place=(id,x,y,w,h=bh)=>control(id,x,y,w,h);
 const label=(id,x,y,w,h=line)=>set(id,x,y,w,h);
 const compact=false; // One desktop layout; scaling belongs to the complete stage.
 const shop=phase==='shop',battle=phase==='battle'&&!game.paused&&route!=='auto';
 // Common chrome has a reserved header and a non-overlapping footer.
 if(map.has('screen_title')){
  label('screen_title',9,8,58,Math.max(line,5));
  if(phase==='menu')label('screen_title',9,8,82,5);
  for(const [id,x,w]of [['screen_gold_icon',71,3],['screen_gold',75,7],['screen_crystals_icon',83,3],['screen_crystals',87,6]])label(id,x,8,w);
 }
 for(const [id,n]of map){const p=plateRect(id);if(p&&(n.kind==='button'||n.kind==='text'))control(id,p.x,100-p.y-p.height,p.width,Math.max(p.height,bh));}
 for(const id of ['ready','deploy','loadout_return','town_back','launch_expedition','back','profiles_back','settings_back','next','result_home']){
  const p=plateRect(id);if(p)place(id,p.x,foot,p.width);
 }
 if(map.has('tab_gear')){place('tab_gear',8,17,22);place('tab_runes',32,17,22);}
 if(shop){
  place('ready',62,foot,14);place('quick_deploy',78,foot,15);
  if(map.has('tab_home')){place('tab_home',8,17,24);place('tab_sell',34,17,24);}
  hide('shopkeeper_back');label('shopkeeper_portrait',9,31,23,compact?24:29);
  label('shopkeeper_name',8,compact?56:62,25);label('shopkeeper_line',8,compact?64:69,25,compact?px(55):11);
  // Status has its own rail; it never draws on top of a Buy button.
  label('shop_feedback',37,17,56,line);label('shop_receipt',37,17,56,line);
  if(map.has('tab_home')){label('shop_feedback',8,foot,52,bh);label('shop_receipt',8,foot,52,bh);}
 }
 if(phase==='menu'&&route==='home'){
  place('start',9,60,34);place('settings',9,60+bh+px(10),34);place('exit',9,60+2*(bh+px(10)),34);
  label('title',8,34,34,px(70));label('subtitle',8,compact?51:48,36,line);label('exit_message',48,87,44,line);
 }else if(route==='town'){
  label('town_lord',9,31,23,39);
  label('town_heading',37,18,56,px(34));label('town_subheading',37,23,56,px(32));
  label('town_material_icon',15,20,48/width*100,px(48));label('town_gold',15+60/width*100,20,7,px(48));text('town_gold',map.get('town_gold')?.text.replace('建材 ',''));
  label('town_record',8,75,26,px(64));
  for(let i=1;i<=8;i++){const x=37+(i-1)%2*29,y=29+Math.floor((i-1)/2)*13,h=11.5;
   place('town_'+i,x,y,27,h);
   const middle=y+h/2;
   label('town_icon_'+i,x+1.1,middle-px(36),72/width*100,px(72));
   label('town_name_'+i,x+5.7,middle-px(38),14.5,px(36));
   label('town_effect_'+i,x+5.7,middle+px(5),14.5,px(32));
   label('town_cost_icon_'+i,x+21,middle-px(18),36/width*100,px(36));label('town_cost_'+i,x+23.3,middle-px(22),3,px(44));
  }
  if(map.has('town_upgrade_title')){
   frame('town_upgrade_modal',15,8,70,84);
   label('town_upgrade_kicker',23,14,54,small);label('town_upgrade_title',23,23,54,line);
   label('town_upgrade_level',23,32,54,line);label('town_upgrade_desc',23,41,54,px(44));
   label('town_upgrade_cost',23,56,54,line);label('town_upgrade_note',23,64,54,px(32));
   place('town_upgrade_confirm',25,89-bh,23);place('town_upgrade_cancel',52,89-bh,23);
  }
 }else if(route==='profiles'){
  label('profiles_hint',9,16,82,px(36));
  for(let i=1;i<=3;i++){const x=13+(i-1)*26;frame('profile_card_'+i,x,26,22,56);
   label('profile_slot_'+i,x+3,39,16,px(38));label('profile_name_'+i,x+3,44,16,px(42));
   label('profile_detail_'+i,x+3,51,16,px(82));place('profile_load_'+i,x+3,61,10,6.5);
   place('profile_delete_'+i,x+14,61,5,6.5);place('profile_create_'+i,x+3,61,16,6.5);
  }
  label('delete_warning',16,29,68,px(65));place('delete_confirm',25,57,22);place('delete_cancel',53,57,22);
 }else if(route==='settings'){
  label('settings_hint',9,18,82,line);
  for(const [i,name]of ['music','sfx','quality','language'].entries()){
   const y=29+i*13;label('settings_'+name+'_label',14,y,29,bh);label('settings_'+name+'_value',50,y,18,bh);
   place('settings_'+name+'_down',72,y,8);place('settings_'+name+'_up',83,y,8);place('settings_'+name,72,y,19);
  }
 }else if(phase==='choice'){
  label('screen_title',9,8,82,5);hide('screen_gold','screen_crystals');
  label('choice_hint',12,17,76,px(36));label('choice_quote',12,22,76,px(36));
  place('choice_loadout',30,87,20);place('view_map',53,87,17);
  for(let i=1;i<=3;i++){const x=15+(i-1)*24;frame('choice_plate_'+i,x,29,22,55);
   label('choice_icon_'+i,x+3,40.5,16,20.5);label('choice_name_'+i,x+3,61.8,16,px(36));
   label('choice_desc_'+i,x+3,66,16,px(56));label('choice_action_'+i,x+3,76,16,px(36));
   label('choice_'+i,x,29,22,55);
  }
 }else if(phase==='map'){
  // Preserve the painted atlas aspect, then transform its world markers together.
  const source=map.get('map_back').rect,sourceTop=100-source.y-source.height;
  const atlasW=Math.min(width*.61,height*.60*(1672/941))/width*100,atlasH=atlasW*width/height/(1672/941);
  const atlasX=7+(61-atlasW)/2,atlasY=20+(60-atlasH)/2;
  const centers=new Map([...map].filter(([id])=>/^map_(node_\d+|current_ring|cursor_icon)$/.test(id)).map(([id,n])=>[id,{
   x:atlasX+((n.rect.x+n.rect.width/2-source.x)/source.width)*atlasW,
   y:atlasY+((100-n.rect.y-n.rect.height/2-sourceTop)/source.height)*atlasH,
  }]));
  label('map_back',atlasX,atlasY,atlasW,atlasH);
  for(let i=1;i<=7;i++){
   label('map_link_'+i,atlasX,atlasY,atlasW,atlasH);
   const c=centers.get('map_node_'+i),size=i===game.round?(compact?46:60):(compact?36:46),w=size/width*100,h=px(size);
   label('map_node_'+i,c.x-w/2,c.y-h/2,w,h);label('map_number_'+i,c.x-w/2,c.y-px(12),w,px(24));
  }
  for(const [id,size,offset]of [['map_current_ring',compact?57:74,0],['map_cursor_icon',compact?26:32,compact?29:36]]){
   const c=centers.get(id);if(c)label(id,c.x-size/width*50,c.y-px(size/2+offset),size/width*100,px(size));
  }
  label('map_lord',76,compact?22:24,12,18);label('map_stage',77,8,16,line);
  label('map_current_title',71,compact?43:46,22,px(32));
  label('map_plan',71,compact?56:57,22,px(48));label('map_next',71,73,22,px(36));
  label('map_progress',8,foot,59,bh);place('visit_location',71,foot,22);
 }else if(route==='gear'){
  label('bag_heading',64,27,29,line);
  label('paper_doll_portrait',37,46,14,23);
  for(let i=1;i<=3;i++){const y=38+(i-1)*14;
   place('roster_unit_'+i,8,y,16);
  }
  label('troop_quote',8,77,16,line);text('troop_quote',map.get('troop_quote')?.text.replace('本次派兵\n','派兵 '));
  for(const [i,[x,y]]of [[1,[37,38]],[2,[27,51]],[3,[47,51]],[4,[27,65]],[5,[47,65]]]){
   frame('slot_frame_'+i,x,y,14,12);label('worn_icon_'+i,x+4.5,y,5,5.5);label('slot_'+i,x,y+5.5,14,6.5);
   label('slot_hit_'+i,x,y,14,12);
  }
  hide('active_slot');place('unequip',30,foot,29);place('loadout_return',8,foot,20);place('deploy',71,foot,22);
  for(let i=1;i<=2;i++){const y=34+(i-1)*24;frame('pack_card_'+i,64,y,29,23);
   label('gear_icon_'+i,65,y,4,px(23));label('gear_name_'+i,70,y,22,px(23));
   label('gear_summary_'+i,65,y+px(23),27,px(20));label('gear_cost_'+i,65,y+23-bh,8,bh);
   place('inspect_'+i,74,y+23-bh,8);place('equip_'+i,84,y+23-bh,8);label('empty_pack_icon_'+i,65,y+3,6,10);label('empty_pack_'+i,73,y+5,18,line);
  }
  place('gear_prev',62,17,6);place('gear_next',87,17,6);label('gear_page',71,17,13,bh);
  if(map.has('gear_detail_title')){
   frame('gear_detail_modal',15,8,70,84);label('gear_detail_icon',23,18,12,19);label('gear_detail_title',39,19,38,line);
   label('gear_detail_quote',39,29,38,px(44));label('gear_detail_effect',23,42,54,px(105));
   place('gear_detail_equip',25,89-bh,24);place('gear_detail_close',52,89-bh,24);
  }
 }else if(route==='runes'){
  for(let i=1;i<=3;i++)place('unit_'+i,8,33+(i-1)*16,24);
  for(let i=1;i<=3;i++){const y=31+(i-1)*17;
   label('rune_icon_'+i,36,y,6,10);label('rune_name_'+i,44,y,29,line);
   label('rune_desc_'+i,44,y+line,29,px(21));label('rune_owned_'+i,44,y+line+px(21),29,small);place('rune_'+i,76,y+1,17);
  }
  hide('rune_help');place('rune_off',8,foot,24);
  place('rune_prev',62,17,6);place('rune_next',87,17,6);text('rune_prev','‹');text('rune_next','›');label('rune_page',71,17,13,bh);
  place('loadout_return',45,foot,22);place('deploy',70,foot,23);
 }else if(route==='sell'){
  for(let i=1;i<=4;i++){
   if(game.location==='rune'){const y=33+(i-1)*16;label('sale_icon_'+i,37,y,7,10);label('sale_name_'+i,46,y,28,bh);place('sale_'+i,77,y,16);}
   else{const x=37+(i-1)%2*29,y=34+Math.floor((i-1)/2)*24;label('sale_icon_'+i,x,y,7,9);label('sale_name_'+i,x+8,y,19,line);label('sale_status_'+i,x+8,y+line,19,small);place('sale_'+i,x,y+11,27);}
  }
  place('sale_prev',37,foot,9);place('sale_next',48,foot,9);
 }else if(shop&&game.location==='enchant'){
  label('enchant_heading',37,17,56,line);
  for(let i=1;i<=5;i++)place('enchant_slot_'+i,37+(i-1)*11.2,25,10.4);
  for(let i=1;i<=3;i++)place('unit_'+i,37+(i-1)*19,25+bh+px(8),18);
  label('enchant_item_icon',38,54,10,17);label('enchant_item_name',50,54,41,line);
  label('enchant_current',50,54+line,41,px(36));label('enchant_cost',37,73,28,px(36));
  place('enchant_roll',67,73,26);label('enchant_chances',8,foot,50,bh);
  if(map.has('enchant_reveal_name')){
   frame('enchant_reveal_back',35,40,59,42);label('enchant_reveal_tier',39,43,51,line);
   label('enchant_reveal_icon',39,52,10,14);label('enchant_reveal_name',51,52,39,px(42));
   place('enchant_accept',38,80-bh,25);place('enchant_keep',66,80-bh,25);
  }
 }else if(shop){
  const contentTop=map.has('tab_home')?32:27,bottom=80;
  for(let i=1;i<=2;i++){const x=37+(i-1)*29;frame('stock_panel_'+i,x,contentTop,27,bottom-contentTop);
   label('stock_icon_'+i,x+2,contentTop+2,7,10);label('stock_name_'+i,x+10,contentTop+2,15,line*1.5);
   label('stock_desc_'+i,x+2,contentTop+14,23,Math.max(px(52),bottom-contentTop-14-bh-10));
   label('stock_cost_icon_'+i,x+7,bottom-bh-9,3,line);label('stock_cost_'+i,x+11,bottom-bh-9,9,line);
   place('buy_'+i,x+2,bottom-bh-2,23);
  }
  place('stock_prev',37,foot,6);label('stock_page',44,foot,7,bh);place('stock_next',52,foot,6);
 }else if(route==='auto'){
  // Undo the legacy 74% sheet shrink before a real short-screen composition.
  frame('screen_back',5,3,90,94);label('screen_title',9,7,82,line);label('auto_help',9,14,82,small);
  for(const [i,name]of ['all','none','small','boss','special'].entries())place('auto_preset_'+name,9+i*16.6,21,15.6);
  const y0=21+bh+px(8),footer=94-bh,row=(footer-px(32)-y0)/2;
  for(let i=1;i<=10;i++){const x=9+(i-1)%5*16.6,y=y0+Math.floor((i-1)/5)*row,h=row-px(6);
   frame('auto_card_'+i,x,y,15.6,h);label('auto_icon_'+i,x+3,y,9,h-px(36));label('auto_tick_'+i,x+12,y,2.5,px(16));
   label('auto_pick_'+i,x,y,15.6,h-px(42));label('auto_name_'+i,x,y+h-px(42),15.6,px(22));label('auto_info_'+i,x,y+h-px(20),15.6,px(20));
  }
  label('auto_summary',9,footer-px(27),34,small);label('auto_note',44,footer-px(27),47,small);
  place('auto_cancel',9,footer,20);place('auto_stop',31,footer,23);place('auto_apply',60,footer,31);
 }else if(battle){
  const bottom=98-bh,unitH=px(65);
  for(let i=1;i<=3;i++){const x=2+(i-1)*9;frame('hud_unit_plate_'+i,x,98-unitH,8.4,unitH);
   label('hud_unit_icon_'+i,x+1.7,98-unitH,5,px(30));label('hud_unit_'+i,x,98-unitH,8.4,px(30));label('hud_unit_caption_'+i,x,98-px(35),8.4,px(35));
  }
  for(const [name,x]of [['lock',77],['auto',88]]){frame('mode_plate_'+name,x,98-unitH,10.4,unitH);label('mode_icon_'+name,x+3.5,98-unitH,3.4,px(30));label('mode_'+name,x,98-unitH,10.4,px(30));label('mode_label_'+name,x,98-px(28),10.4,px(26));}
  place('auto_settings',77,98-unitH-bh-px(8),21.4);
  frame('target_plate',77,98-unitH-bh-px(63),21.4,px(48));label('target',78,98-unitH-bh-px(61),19.4,small);label('target_guard',78,98-unitH-bh-px(38),19.4,small);
  place('pause',93,2,Math.max(5.2,44/width*100));frame('pause_plate',93,2,Math.max(5.2,44/width*100),bh);label('pause_icon',94,2+px(8),3,px(28));
  for(const [id,x]of [['coins',35],['crystals',55]]){frame(id+'_plate',x,bottom,18,bh);label(id+'_icon',x+1,bottom+px(7),3,px(30));label(id,x+5,bottom,12,bh);}
  label('timeline_round',8,px(47),20,small);label('timeline_goal',60,px(47),31,small);label('timeline_time',42,px(10),16,px(28));
  for(let i=1;i<=2;i++)place('potion_'+i,2,24+(i-1)*(bh+px(8)),12);
 }else if(game.paused){
  if(route==='guide'){label('help_title',16,19,68,line);for(let i=1;i<=6;i++)label('help_'+i,15,29+(i-1)*8,70,px(28));place('guide_back',24,foot,22);place('resume',51,foot,25);}
  else if(route==='abandon'){label('abandon_warning',15,28,70,px(80));place('abandon_cancel',15,60,33);place('abandon_confirm',53,60,33);}
  else{place('resume',32,34,36);place('guide',32,34+bh+px(14),36);place('quit',32,34+2*(bh+px(14)),36);place('mute',73,18,20);}
 }else if(['clear','victory'].includes(phase)){
  label('result_message',9,20,82,line);label('result_earned_label',9,29,38,small);label('result_earned',9,35,38,px(52));
  label('result_refund',51,31,40,line);label('result_crystals',51,41,40,px(38));
  label('result_combat',9,53,82,line);place('chest',26,61,48);
  label('chest_result',12,61,61,bh);place('chest_done',78,61,13);label('result_story',9,76,82,small);
 }else if(phase==='defeat'){
  label('defeat_crest',44,7,12,15);label('defeat_title',20,23,60,px(42));label('defeat_reason',12,35,76,line);label('defeat_route',12,43,76,small);
  for(let i=1;i<=6;i++){const x=12+(i-1)%3*26,y=51+Math.floor((i-1)/3)*13;label('defeat_stat_label_'+i,x,y,24,small);label('defeat_stat_value_'+i,x,y+small,24,px(28));}
  label('defeat_town_reward',12,78,76,small);hide('defeat_save');place('defeat_town',12,foot,35);place('defeat_retry',53,foot,35);
 }
 if(shop&&map.has('shop_detail_title')){
  frame('shop_detail_modal',15,8,70,84);label('shop_detail_icon',23,18,12,19);label('shop_detail_title',39,19,38,line);
  label('shop_detail_price_icon',46,29,3,line);label('shop_detail_price',50,29,14,line);label('shop_detail_effect',23,42,54,px(105));
  place('shop_detail_buy',25,89-bh,24);place('shop_detail_close',52,89-bh,24);
 }
 return {bh,compact};
}
