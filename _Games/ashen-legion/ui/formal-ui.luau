-- Game-owned view composition. Bundled into main.luau by build-formal-ui.mjs.
-- All purchases, combat and rewards still use existing game semantic actions.
local formalRoute="home"
local formalPage=1
local formalPreviousPhase=""
local formalMuted=false
-- Story and UI feedback are game-owned copy. They never consume combat RNG.
local chapterLines={
 "苔光照亮了舊路。領主，先讓每一枚金幣帶人回家。",
 "菇冠下傳來窸窣聲。別讓零散的敵人耗光軍糧。",
 "越過這條溪，就是舊王國。替下一場硬仗留下餘裕。",
 "古榕記得每一面軍旗。今日，它會記住我們的。",
 "琥珀封著過往的野心。力量越耀眼，代價越要看清。",
 "冠角守衛已聞到火藥味。這回，把最好的兵帶上。",
 "王座就在樹冠之上。七站的遠征，只差最後一戰。",
}
local placeLines:{[string]:string}={
 market="攤主留了好貨。裝備會提高派兵費，挑適合這支軍團的。",
 potion="藥師正看著爐火。金幣買下的這一瓶，也許能救回整隊人。",
 tech="學者攤開了新圖紙。研究強化兵種，不會加重派兵費。",
 enchant="鐵匠等你落槌。先穿好裝備；新詞綴不合意，也能保留舊的。",
 curse="荊棘正在低語。先承受兩輪代價，才能拿到後來的力量。",
}
local formalReceipt=""
local formalReceiptUntil=0
local formalSeenStock:{[number]:boolean}={}
local function formalInput(api:any)
 if pressed(api,"UI_mute")then formalMuted=not formalMuted end
 S.audioMuted=formalMuted
 if S.phase~="battle" and S.phase~="celebration" and pressed(api,"Escape") then formalRoute="home";formalPage=1 end
 if formalPreviousPhase~=S.phase then
  formalPreviousPhase=S.phase;formalRoute="home";formalPage=1
  formalReceipt="";formalReceiptUntil=0;formalSeenStock={}
 end
 for _,route in ipairs({"home","gear","runes","builds","town","guide","abandon"})do
  if pressed(api,"UI_"..route)then formalRoute=route;formalPage=1 end
 end
 if pressed(api,"UI_page_next")then formalPage+=1 end
 if pressed(api,"UI_page_prev")then formalPage=max(1,formalPage-1)end
end
publishFormalUI=function(api:any)
 if S.enchantPending then formalRoute="home" end
 if S.phase=="shop" then
  for i,item in ipairs(S.stock :: {any})do
   if item.sold and formalSeenStock[i]==false then
    formalReceipt="已取得「"..(item.name or "軍團強化").."」"..(item.kind=="gear" and "，可直接穿戴。" or "。")
    formalReceiptUntil=frame+210
   end
   formalSeenStock[i]=item.sold==true
  end
 end
 local nodes:{any}={}
 local function rect(x:number,y:number,w:number,h:number)return {x=x,y=100-y-h,width=w,height=h}end
 local function img(id:string,asset:string,x:number,y:number,w:number,h:number)
  local preserve=string.find(id,"icon") or string.find(id,"crest") or string.find(id,"portrait") or id=="map_lord"
  table.insert(nodes,{kind="image",id=id,asset=asset,fit=id=="menu_art" and "cover" or (preserve and "contain" or "stretch"),rect=rect(x,y,w,h)})
 end
 local function text(id:string,value:any,x:number,y:number,w:number,h:number)
  table.insert(nodes,{kind="text",id=id,text=tostring(value),rect=rect(x,y,w,h)})
 end
 local function wrap(value:string,columns:number):string
  local lines:{string}={};local line:string="";local count=0
  for _,code in utf8.codes(value)do
   if code==10 then table.insert(lines,line);line="";count=0
   else line..=utf8.char(code);count+=1;if count>=columns then table.insert(lines,line);line="";count=0 end end
  end
  if line~="" then table.insert(lines,line)end
  return table.concat(lines,"\n")
 end
 local function skillDetail(id:string):string
  local entry=S.skillBook[id]
  return entry and string.split(entry.desc,"；每支派兵")[1] or id
 end
 local function button(id:string,label:string,action:string,x:number,y:number,w:number,h:number,enabled:boolean?)
  local primary=({Start=true,LeaveShop=true,Next=true,Auto_apply=true,Pause=true,OpenChest=true,ChestDone=true,AcceptEnchant=true})[action]==true
  local chosen=(string.sub(id,1,4)=="tab_" and action=="UI_"..formalRoute) or string.find(label,"✓") or (string.sub(id,1,5)=="unit_" and string.sub(label,1,3)=="◆")
  img(id.."_plate","texture://ui_"..(enabled==false and "muted" or primary and "button" or chosen and "selected" or "secondary"),x,y,w,h)
  local ch=min(3,h-1);local edge=(h-ch)/2
  if enabled==false then text(id,label,x+1,y+edge,w-2,ch)
  else
   -- Adjacent regions share one action, as with the battle HUD. The label
   -- remains a native button; padding extends its target without overlapping it.
   table.insert(nodes,{kind="button",id=id,text=label,action=action,rect=rect(x,y+edge,w,ch)})
   table.insert(nodes,{kind="button",id=id.."_hit_top",text="",action=action,rect=rect(x,y,w,edge)})
   table.insert(nodes,{kind="button",id=id.."_hit_bottom",text="",action=action,rect=rect(x,y+edge+ch,w,edge)})
  end
 end
 local function panel(title:string)
  img("screen_back","texture://ui_panel",3,3,94,94)
  text("screen_title",title,7,6,67,5)
  text("screen_gold","金幣 "..floor(S.coins),76,7,17,3.5)
  img("screen_crystals_plate","texture://ui_hud-crystal",76,12,17,3.5)
  text("screen_crystals","◆ 結晶 "..S.crystals,76,12,17,3.5)
 end
 local function story(line:string)
  img("story_plate","texture://ui_panel",7,25,86,13)
  img("story_portrait","texture://ui_quartermaster-v1",8,25.5,10,12)
  text("story_speaker","司務長 · 榛姨",20,25.8,69,3.2)
  text("story_quote",line,20,30,69,6)
 end
 local function tabs()
  for i,route in ipairs({"home","gear","runes","builds"})do button("tab_"..route,({"補給","武庫","符文","流派"})[i]..(formalRoute==route and " ◆" or ""),"UI_"..route,7+(i-1)*18,16,17,6)end
 end
 local unitNames={"劍兵","槍兵","騎兵"}
 local slotNames={"頭","身","腳","手","武器"}
 local function unitButtons(y:number)
  for k=1,3 do button("unit_"..k,(S.selected==k and "◆ " or "")..unitNames[k].." · "..costs(k).." 金","Unit"..k,7+(k-1)*23,y,22,6)end
 end
 local function footer()
  if S.phase=="shop" then button("ready","出戰","LeaveShop",65,88,28,7,S.enchantPending==nil)
  else button("back","返回","UI_home",75,88,18,7)end
 end
 if S.phase=="map" then
  panel("遠征地圖 · 森林王冠之路")
  img("map_back","texture://ui_route-map",7,19,86,64)
  text("map_journal",chapterLines[S.round],12,20,68,5)
  local points={{12,69},{25,53},{38,66},{51,45},{65,56},{77,39},{88,29}}
  for i,p in ipairs(points)do
   img("map_node_"..i,"texture://ui_"..(i<S.round and "route-cleared" or i==S.round and "route-current" or "route-future"),p[1]-2.5,p[2]-3,5,6)
   text("map_number_"..i,i,p[1]-1.7,p[2]-2,3.4,4)
   text("map_name_"..i,chapters[i],max(8,min(81,p[1]-6)),p[2]+4,12,4)
  end
  local from=S.mapFrom==0 and {8,76} or points[S.mapFrom]
  local target=points[S.round];local t=S.mapMoving and min(1,S.mapElapsed/S.mapDuration) or 1
  t=t*t*(3-2*t)
  local x=from[1]+(target[1]-from[1])*t;local y=from[2]+(target[2]-from[2])*t
  img("map_lord","texture://ui_portrait-lord-v2",max(7,x-3.5),max(15,y-18),7,8)
  text("map_progress","第 "..S.round.." / 7 站 · "..(S.mapMoving and "軍旗向前 · 行軍中…" or "紮營 "..chapters[S.round].." · 挑一處景點整備"),12,85,76,5)
  if not S.mapMoving then button("visit_location","查看景點建築","VisitLocation",32,91,36,5)end
 elseif S.phase=="battle" and S.autoConfigOpen then
  panel("AUTO · 追擊目標")
  text("auto_help","勾選要打的怪物；沒有指定目標時等待。",7,16,86,4)
  for i,preset in ipairs({"all","none","small","boss","special"})do
   button("auto_preset_"..preset,({"全選","清空","只選小怪","只選王","只選奇遇"})[i],"Auto_"..preset,7+(i-1)*17.4,21,16.4,5.5)
  end
  local liveCounts:{[string]:number}={}
  for _,m in ipairs(monsters)do if m.alive then liveCounts[m.skin]=(liveCounts[m.skin]or 0)+1 end end
  for i,def in ipairs(autoSpecies)do
   local x=7+((i-1)%5)*17.4;local y=29+floor((i-1)/5)*24
   local selected=S.autoDraft[def.id];local action="Auto_target_"..def.id
   img("auto_card_"..i,"texture://ui_"..(selected and "target-selected" or "target-card"),x,y,16.4,22)
   img("auto_icon_"..i,"texture://ui_target-"..def.id,x+1,y+.5,14.4,15)
   if selected then img("auto_tick_"..i,"texture://ui_target-check",x+12.7,y+1,2.6,3.5)end
   table.insert(nodes,{kind="button",id="auto_pick_"..i,text="",action=action,rect=rect(x,y,16.4,15.5)})
   table.insert(nodes,{kind="button",id="auto_name_"..i,text=(selected and "✓ " or "○ ")..def.name,action=action,rect=rect(x,y+15.5,16.4,3.5)})
   table.insert(nodes,{kind="button",id="auto_info_"..i,text=def.label.." · "..(liveCounts[def.id]or 0).." 隻",action=action,rect=rect(x,y+19,16.4,2.5)})
  end
  local count=autoCount(S.autoDraft)
  text("auto_summary",count>0 and "已選 "..count.." 種" or "至少選擇一種怪物",7,78,86,4)
  text("auto_note",S.lockEnabled and "LOCK 開啟中 · 只傷害鎖定目標" or "設定期間暫停戰鬥",7,83,86,3)
  button("auto_cancel","取消","Auto_cancel",7,89,20,6)
  if S.autoEnabled then button("auto_stop","停止自動","Auto_stop",30,89,23,6)end
  button("auto_apply",S.autoEnabled and "套用目標" or "啟動 AUTO","Auto_apply",61,89,32,6,count>0)
 elseif S.phase=="battle" and not S.paused then
  local function hudButton(id:string,label:string,action:string,x:number,y:number,w:number,h:number,active:boolean?)
   img(id.."_plate","texture://ui_"..(active and "hud-active" or "hud-key"),x,y,w,h)
   table.insert(nodes,{kind="button",id=id,text=label,action=action,rect=rect(x,y,w,h)})
  end
  img("chapter_back","texture://ui_hud-heading",0,0,34,14)
  img("chapter_crest","texture://ui_crest",2,2,5,7)
  text("chapter",chapters[S.round],8,2,21,4)
  text("round","遠征  "..S.round.." / 7",8,6.6,18,2.6)
  img("objective_back","texture://ui_hud-objective",35,0,33,9)
  text("objective",S.bossPresent and "迎戰大王" or "積蓄軍力 · 準備迎戰大王",38,2,27,2.7)
  text("boss_timing",S.bossPresent and "開出大獎／特獎即可通關" or "大王於最後 30 秒登場",39,5,25,2.2)
  img("timer_plate","texture://ui_hud-target",84,1.5,9,7.5)
  text("time",string.format("%02d:%02d",floor(S.time/60),floor(S.time%60)),85,2.7,7,4)
  img("coins_plate","texture://ui_hud-gold",35,94,18,4.8)
  img("coins_icon","texture://ui_symbol-coin",36.2,94.8,2.1,3)
  text("coins","金幣 "..floor(S.coins),38.5,94.7,12.5,3.2)
  img("crystals_plate","texture://ui_hud-crystal",54,94,15,4.8)
  img("crystals_icon","texture://ui_symbol-crystal",55.2,94.8,2,3)
  text("crystals","結晶 "..S.crystals,57.5,94.7,10,3.2)
  -- Adjacent icon/caption controls share the action; no transparent hit area
  -- covers text, and the authored icon cannot eat its semantic button's input.
  for k=1,3 do
   local x=2+(k-1)*8.6
   img("hud_unit_plate_"..k,"texture://ui_"..(S.selected==k and "hud-active" or "hud-key"),x,82,8,15)
   img("hud_unit_icon_"..k,"texture://ui_symbol-"..({"sword","spear","cavalry"})[k],x+1.4,83,5.2,6.8)
   table.insert(nodes,{kind="button",id="hud_unit_"..k,text="",action="Unit"..k,rect=rect(x,82,8,8)})
   table.insert(nodes,{kind="button",id="hud_unit_caption_"..k,text=unitNames[k].."\n"..costs(k),action="Unit"..k,rect=rect(x,90,8,5)})
  end
  img("pause_plate","texture://ui_hud-key",94.5,1.5,4,7.5)
  img("pause_icon","texture://ui_symbol-pause",95.2,2.5,2.6,4.3)
  table.insert(nodes,{kind="button",id="pause",text="",action="Pause",rect=rect(94.5,1.5,4,7.5)})
  for i,mode in ipairs({"lock","auto"})do
   local x=77+(i-1)*11;local enabled=mode=="lock" and S.lockEnabled or mode=="auto" and S.autoEnabled
   img("mode_plate_"..mode,"texture://ui_"..(enabled and "hud-active" or "hud-key"),x,87,10.4,10)
   img("mode_icon_"..mode,"texture://ui_symbol-"..mode,x+3.5,88,3.4,4.6)
   table.insert(nodes,{kind="button",id="mode_"..mode,text="",action="Mode_"..mode,rect=rect(x,87,10.4,6.2)})
   table.insert(nodes,{kind="button",id="mode_label_"..mode,text=string.upper(mode)..(enabled and " · 開" or " · 關"),action="Mode_"..mode,rect=rect(x,93.2,10.4,2.6)})
  end
  hudButton("auto_settings","選擇目標 · "..autoCount(S.autoTargets).." 種","Auto_settings",77,81.5,21.4,4.5,S.autoEnabled)
  img("target_plate","texture://ui_hud-target",77,73,21.4,7.5)
  text("target",S.targetName~="" and S.targetName or (S.autoEnabled and "AUTO · 等待指定怪物" or (S.lockEnabled and "LOCK · 點選怪物" or "按住戰場 · 派遣部隊")),78,73.5,19.4,2.6)
  for _,m in ipairs(monsters)do
   if m.alive and m.id==S.targetId then text("target_guard",(m.damage/m.guard>=economyTuning.nearBreak and "即將破防 " or "破防 ")..floor(m.damage).." / "..m.guard,78,76.7,19.4,2.4)end
   if m.alive and m.special=="beetle" then text("shared_pool","聚寶甲蟲 · 共用獎池 "..floor(m.poolGold or 0),2,10,30,2.7)end
  end
  if S.hordeNotice>0 then text("horde","怪物潮來襲 · +"..S.hordeAdded.." 隻小怪",32,20,39,3.5)end
  if (S.streaks[S.seat].count or 0)>0 then text("streak","連殺  "..S.streaks[S.seat].count,2,14,12,2.7)end
  for i,p in ipairs(S.potions :: {any})do button("potion_"..i,({"疾風","續命","召回"})[p.kind],"Potion"..i,2,20+(i-1)*5.5,10,4.5)end
 elseif S.phase=="celebration" then
  -- The presentation owns the full-screen ceremony; result controls do not
  -- exist until the authoritative outro has finished.
  if S.paused then
   img("outro_pause_back","texture://ui_panel",17,34,66,31)
   text("outro_pause_title","榮耀暫歇",25,39,50,7)
   button("outro_resume","繼續大獎演出","Pause",30,51,40,9)
  else
   text("outro_wait","凱旋時刻 · 稍後清點戰利品",20,93,60,3)
  end
 elseif S.paused then
  panel("征途暫歇")
  if formalRoute=="abandon" then
   text("abandon_warning","結束這趟遠征？\n本局金幣、結晶與配裝不保留，城鎮建設保留。",15,28,70,17)
   button("abandon_cancel","繼續留在遠征","UI_home",15,59,33,9)
   button("abandon_confirm","結束遠征","Home",53,59,33,9)
  elseif formalRoute=="guide" then
   text("help_title","掌握這場狩獵",25,22,50,5)
   local tips={"按住戰場派兵，放開停止。","劍兵碰撞消失；槍兵落地旋斬；騎兵穿透。","碰牆反彈，壽命耗盡消失。","破防只代表一次抽獎，未中獎的怪物留場。","大王最後 30 秒登場，開出大獎才過關。","金幣派兵，結晶強化；倖存部隊返還實付金幣。"}
   for i,line in ipairs(tips)do text("help_"..i,line,24,31+(i-1)*7,52,5)end
   button("guide_back","返回暫停","UI_home",24,80,22,7)
   button("resume","繼續戰鬥","Pause",51,80,25,7)
  else
  button("resume","繼續征戰","Pause",32,37,36,9)
  button("guide","作戰指南","UI_guide",32,50,36,8)
  button("quit","結束這趟遠征","UI_abandon",32,63,36,8)
  button("mute",formalMuted and "音效：關" or "音效：開","UI_mute",76,17,16,6)
  end
 elseif S.phase=="menu" and formalRoute=="home" then
  img("menu_ground","texture://ui_panel",0,0,100,100)
  img("menu_art","texture://ui_expedition-keyart-v2",0,0,100,100)
  img("crest","texture://ui_crest",15,13,16,20)
  text("title","森林領主",8,35,32,12)
  text("subtitle","七輪遠征 · 奪回森林王冠",8,49,32,5)
  button("start","出征","Start",9,59,30,9)
  button("town","領地與城鎮","UI_town",9,71,30,7)
  text("menu_prologue","沿著七座營火，找回森林的王冠。",7,81,34,4)
 elseif S.phase=="choice" then
  panel(chapters[S.round].." · 選擇景點")
  button("view_map","查看地圖","ViewMap",77,17,16,6)
  story(chapterLines[S.round])
  for i,c in ipairs(S.cards :: {any})do
   local y=41+(i-1)*16
   img("choice_plate_"..i,"texture://ui_panel",7,y,86,14)
   local icon:string?=({market="building-market",potion="building-alchemy",tech="building-barracks",enchant="building-forge",curse="icon-curse-debt"} :: {[string]:string})[c.id]
   if icon then img("choice_icon_"..i,"texture://ui_"..icon,9,y+1,9,12)end
   text("choice_name_"..i,c.name,21,y+1,49,4)
   text("choice_desc_"..i,c.desc:gsub("；每支派兵 %+(%d+)","；標準加價 +%1（整筆半價）"),21,y+6,49,6)
   button("choice_"..i,"拜訪","Choice"..i,76,y+3,14,8)
  end
 elseif S.phase=="defeat" then
  img("screen_back","texture://ui_defeat-back",3,3,94,94)
  local elapsed=S.resultElapsed or 0
  img("defeat_crest","texture://ui_defeat-crest",43,6+max(0,1-elapsed*2)*3,14,17)
  text("defeat_title","遠 征 失 敗",20,25,60,9)
  text("defeat_reason",S.message,12,36,76,5)
  text("defeat_route","止步 "..chapters[S.round].."  ·  已通過 "..(S.round-1).." / 7 站",12,43,76,5)
  if elapsed>=.45 then
   local values={string.format("%02d:%02d",floor(S.battleSeconds/60),floor(S.battleSeconds%60)),tostring(S.kills),tostring(S.breaks),tostring(S.earned),tostring(S.spent),tostring(S.refunded)}
   local labels={"累計戰鬥時間","全軍擊殺","破防次數","累計開獎金幣","派兵花費","累計倖存返還"}
   for i=1,6 do
    local x=12+((i-1)%3)*26;local y=51+floor((i-1)/3)*13
    text("defeat_stat_label_"..i,labels[i],x,y,24,4)
    text("defeat_stat_value_"..i,values[i],x,y+4,24,7)
   end
  end
  text("defeat_town_reward","城鎮建設金 +"..(town.gold-S.townStartGold).." 已入庫 · 金庫 "..town.gold,12,76,76,4)
  text("defeat_save","榛姨：城鎮的燈還亮著。帶著這次經驗，再把軍旗舉起來。",12,81,76,3)
  button("defeat_town","返回城鎮","ReturnTown",12,86,35,8,elapsed>=1.2)
  button("defeat_retry","重整旗鼓 · 再次出征","Start",53,86,35,8,elapsed>=1.2)
 elseif S.phase=="clear" or S.phase=="victory" then
  panel(S.phase=="defeat" and "軍團暫退" or (S.phase=="victory" and "森林王冠 · 遠征完成" or "關卡凱旋"))
  text("result_message",S.phase=="victory" and "七站的營火，終於連成了歸途。" or "本關已完成，軍團準備繼續前行。",9,22,82,4)
  text("result_earned","+"..S.earned,9,34,82,9)
  text("result_earned_label","本次遠征累計獲獎金幣",9,29,82,3)
  text("result_combat","擊殺 "..S.kills.." · 破防 "..S.breaks,9,67,82,3)
  text("result_refund","倖存返還 "..(S.roundRefund or 0).." 金幣",9,44,82,6)
  text("result_crystals","◆ 本輪開獎結晶 "..S.roundCrystalEarned.." + 通關 "..S.roundCrystalBonus.." · 持有 "..S.crystals,9,51,82,4)
  text("result_story",S.phase=="victory" and "七處營火連成歸途。這一次，王冠與軍團一起回家。" or "榛姨：清點回來的士兵。下一處營火，等我們把勝利帶過去。",9,76,82,4)
  if S.chestCount>0 then button("chest","按住開啟寶箱 ×"..S.chestCount,"OpenChest",26,56,48,9)end
  if S.chestResult then text("chest_result",S.chestResult,12,68,64,6);button("chest_done","收下","ChestDone",78,68,13,6)end
  button("next",S.phase=="clear" and "前往下一站" or "再次出征",S.phase=="clear" and "Next" or "Start",50,83,40,9,S.phase~="clear" or S.presentationDelay<=0)
  button("result_home","返回領地","Home",9,83,35,9)
 else
  panel(({gear="軍團武庫",runes="符文工坊",builds="流派採購",town="領地建設"})[formalRoute] or tostring(S.phase=="shop" and ({market="林間集市",potion="藥水工坊",tech="軍團研究",enchant="附魔鐵砧",curse="荊棘契約"})[S.location] or "領地與軍備"))
  if formalRoute~="town" then tabs()end;footer()
  if formalRoute=="town" then
   text("town_gold","城鎮建設資源 "..town.gold.." · 跨局保留",8,28,80,6)
   for i,n in ipairs({"兵營","鐵匠舖","煉金房","市集"})do
    local x=8+(i-1)*22;img("town_icon_"..i,"texture://ui_"..({"building-barracks","building-forge","building-alchemy","building-market"})[i],x,39,18,25)
    local price=({60,100,160,240,360})[town.levels[i]+1]
    button("town_"..i,n.." Lv."..town.levels[i],"Town"..i,x,67,20,7,price~=nil and town.gold>=(price or 0))
    text("town_cost_"..i,price and (town.gold>=price and "升級 "..price.." 建設金" or "還差 "..(price-town.gold).." 建設金") or "已滿級",x,76,20,5)
    text("town_effect_"..i,({"每級傷害 +10%／壽命 +2%","每級稀有附魔機率 +1%","每級疾風藥水時長 +2%","每級裝備售價 -2%\nLv.3 多一件商品"})[i],x,82,20,6)
   end
   text("town_story","榛姨：遠征帶回的建設金，會讓下一次出發走得更遠。",8,82,80,4)
  elseif formalRoute=="gear" then
   unitButtons(26)
   for i,n in ipairs(slotNames)do button("slot_"..i,n..(S.equipSlot==i and " ✓" or ""),"Slot"..i,7+(i-1)*13,35,12,5)end
   button("unequip","卸下","Unequip",76,35,17,5,S.worn[S.selected][S.equipSlot]~=0)
   local pageCount=max(1,math.ceil(#S.items/4));formalPage=min(formalPage,pageCount)
   for j=1,4 do local index=(formalPage-1)*4+j;local item=S.items[index]
    if item then local x=7+(j-1)*22
     img("gear_icon_"..j,"texture://ui_gear-"..item.skill,x+4,44,12,16)
     text("gear_name_"..j,item.name,x,61,21,5)
     text("gear_skill_"..j,wrap(skillDetail(item.skill)..(item.enchant and " / 附魔："..skillDetail(item.enchant) or ""),13),x,67,21,12)
     local wearing=S.worn[S.selected][item.slot]==item.id
     button("equip_"..j,wearing and "已穿戴" or "穿戴","Equip"..index,x,81,10,5,not wearing)
     local equipped=false;for _,slots in ipairs(S.worn)do for _,id in ipairs(slots)do if id==item.id then equipped=true end end end
     if S.location=="market" then button("sell_"..j,equipped and "先卸下" or "售 ◆"..floor(item.paid*.5),"Sell"..index,x+11,81,10,5,not equipped)end
    end
   end
   if #S.items==0 then text("empty","背包尚無裝備。可先用基礎兵種出戰。",12,49,76,8)end
   if pageCount>1 then button("gear_prev","上一頁","UI_page_prev",7,88,14,7,formalPage>1)
   button("gear_next","下一頁","UI_page_next",23,88,14,7,formalPage<pageCount)end
  elseif formalRoute=="runes" then
   unitButtons(26)
   for i,n in ipairs({"燼火 · 傷害 +35%","迴響 · 一般獎金 +25%","凝霜 · 緩速兩秒"})do
    local owned=S.runeOwned[S.selected][i];text("rune_desc_"..i,n,10,39+(i-1)*13,51,6)
    button("rune_"..i,S.runes[S.selected]==i and "已裝入" or (owned and "裝入" or "◆ "..({6,9,7})[i].." 結晶"),"Rune"..i,65,39+(i-1)*13,25,7,S.runes[S.selected]~=i and (owned or (S.location=="market" and S.crystals>=({6,9,7})[i])))
   end
   button("rune_off","卸下符文","RuneOff",10,80,25,6,S.runes[S.selected]~=0)
  elseif formalRoute=="builds" then
   formalPage=min(formalPage,3)
   for j=1,3 do local i=(formalPage-1)*3+j;local b=buildDefinitions[i];local y=27+(j-1)*18
    text("build_name_"..i,b.name,9,y,58,5);text("build_desc_"..i,wrap(b.desc,30),9,y+6,59,10)
    button("build_"..i,S.buildIndex==i and "已指定" or "指定採購","Build"..i,74,y+3,17,7,S.buildIndex~=i)
   end
   button("build_prev","上一頁","UI_page_prev",7,88,14,7,formalPage>1)
   button("build_next","下一頁","UI_page_next",23,88,14,7,formalPage<3)
  else
   story(frame<formalReceiptUntil and formalReceipt or (placeLines[S.location] or "金幣留給派兵，結晶留給軍團的成長。"))
   local stockPages=max(1,math.ceil(#S.stock/2));formalPage=min(formalPage,stockPages)
   for j=1,2 do local index=(formalPage-1)*2+j;local item=S.stock[index]
    if item then
    local i=j;local cell=86/min(2,max(1,#S.stock));local x=7+(i-1)*cell;local w=cell-1
    img("stock_panel_"..i,"texture://ui_panel",x,41,w,39)
    local icon=item.kind=="gear" and "gear-"..item.skill or "building-alchemy"
    img("stock_icon_"..i,"texture://ui_"..icon,x+(w-10)/2,42,10,12)
    local label=item.kind=="tech" and unitNames[item.unit].." · "..S.skillBook[item.value].name or item.name
    text("stock_name_"..i,label,x+1,55,w-2,5)
    local short=string.split(skillDetail(item.skill or (item.kind=="tech" and item.value or "")),"；")[1]
    local desc=item.kind=="gear" and short
     or item.kind=="tech" and skillDetail(item.value).."\n研究不增加派兵費"
     or item.kind=="curse" and ({"兩輪派兵費 +15%\n之後全軍穿透 +1","兩輪壽命 -15%\n之後全軍傷害 +25%","兩輪速度 -15%\n之後全軍爆擊率 +10%"})[item.value]
     or ({"八秒加速派兵","場上部隊壽命 +1.5秒","召回己方部隊並退款"})[item.value]
    text("stock_desc_"..i,wrap(desc,14),x+1,61,w-2,10)
    if item.kind=="gear" then
     local def=gearCatalog[item.value];local proposal={id=0,skill=def.skill,slot=def.slot,paid=0}
     text("stock_cost_"..i,unitNames[S.selected].."派兵  "..costs(S.selected).." → "..costs(S.selected,proposal).." 金",x+1,69,w-2,3)
    end
    local funds=item.currency=="crystal" and S.crystals or S.coins
    local priceText=item.price==0 and "簽訂契約" or (item.currency=="crystal" and "◆ " or "金幣 ")..item.price
    local equipIndex=nil;for n,owned in ipairs(S.items)do if owned.id==item.itemId then equipIndex=n end end
    if item.sold and item.kind=="gear" and equipIndex then
     local owned=S.items[equipIndex];local wearing=S.worn[S.selected][owned.slot]==owned.id
     button("buy_"..i,wearing and "已穿戴" or "穿給"..unitNames[S.selected],"Equip"..equipIndex,x+1,73,w-2,6,not wearing)
    else
     local locked=item.kind=="tech" and S.researchUsed
     local caption=item.sold and "已取得" or locked and "本次已研究" or funds<item.price and "還差 "..(item.price-funds)..(item.currency=="crystal" and " 結晶" or " 金") or priceText
     button("buy_"..i,caption,"Buy"..index,x+1,73,w-2,6,not item.sold and funds>=item.price and not locked)
    end
    end
   end
   if stockPages>1 then
    button("stock_prev","上一批","UI_page_prev",31,81,14,6,formalPage>1)
    button("stock_next","下一批","UI_page_next",47,81,14,6,formalPage<stockPages)
    text("stock_page",formalPage.." / "..stockPages,65,81,26,5)
   end
   if S.location=="market" then button("refresh","刷新 · ◆ 2","RefreshShop",7,81,21,6,not S.refreshUsed and S.crystals>=2)end
   if S.location=="enchant" then
    local item=itemById(S.worn[S.selected][S.equipSlot])
    local canEnchant=item~=nil and S.enchantUses<2 and S.crystals>=8 and not S.enchantPending
    local label=not item and "前往武庫選裝備" or S.enchantPending and "請選擇詞綴" or S.enchantUses>=2 and "本次次數已用完" or S.crystals<8 and "還差 "..(8-S.crystals).." 結晶" or "附魔 · ◆ 8"
    button("enchant",label,item and "Enchant" or "UI_gear",7,41,28,8,not item or canEnchant)
    text("enchant_help",item and unitNames[S.selected].." · "..item.name.."\n原詞綴："..(item.enchant and S.skillBook[item.enchant].name or "無").." · 剩餘 "..max(0,2-S.enchantUses).." 次" or "先替部隊穿上裝備，再選擇要附魔的部位。",7,50,85,6)
    if S.enchantPending then
     text("enchant_offer","新詞綴："..S.skillBook[S.enchantPending.skill].name.."\n"..skillDetail(S.enchantPending.skill),7,57,85,9)
     button("accept","採用詞綴","AcceptEnchant",7,69,32,8);button("keep","保留原詞綴","KeepEnchant",44,69,32,8)
    end
   end
  end
 end
 -- Canonical game-owned compositions. The native layout inspector sees the
 -- same portrait/card/hit-area hierarchy; browser adapts only the viewport.
 local byId:{[string]:any}={};for _,n in ipairs(nodes)do byId[n.id]=n end
 local function move(id:string,x:number,y:number,w:number,h:number)
  if byId[id] then byId[id].rect=rect(x,y,w,h)end
 end
 local function control(id:string,x:number,y:number,w:number,h:number)
  local ch=min(3,h-1);local edge=(h-ch)/2
  move(id.."_plate",x,y,w,h)
  if byId[id.."_hit_top"] then
   move(id,x,y+edge,w,ch);move(id.."_hit_top",x,y,w,edge);move(id.."_hit_bottom",x,y+edge+ch,w,edge)
  elseif byId[id] and byId[id].kind=="button" then move(id,x,y,w,h)
  else move(id,x+1,y+edge,w-2,ch)end
 end
 local hidden:{[string]:boolean}={}
 if S.enchantPending then for _,route in ipairs({"home","gear","runes","builds"})do hidden["tab_"..route]=true;hidden["tab_"..route.."_plate"]=true end end
 local interior=S.phase=="shop" or S.phase=="choice" or (S.phase=="menu" and formalRoute~="home") or S.phase=="clear" or S.phase=="victory" or S.phase=="defeat"
 if interior then
  table.insert(nodes,1,{id="interior_shade",kind="image",asset="texture://ui_scene-shade",fit="stretch",rect=rect(0,0,100,100)})
  move("screen_back",33,7,64,87)
  move("screen_title",37,11,35,5);move("screen_gold",76,11,17,3);move("screen_crystals_plate",76,15,17,3);move("screen_crystals",76,15,17,3)
  if not byId.story_portrait then
   local line=({gear="選擇兵種，再換上裝備。每支派兵的花費，也會跟著改變。",runes="符文能卸下重裝。讓它配合部隊最擅長的工作。",builds="指定採購會影響下次商品，不會直接獲得技能。",town="城鎮建設跨遠征保留。為下一次出征，留下一點力量。"})[formalRoute] or (S.phase=="defeat" and "城鎮的燈還亮著。帶著這次經驗，再把軍旗舉起來。" or "清點回來的士兵。下一處營火，等我們把勝利帶過去。")
   story(line);for _,n in ipairs(nodes)do byId[n.id]=n end
  end
  hidden.story_plate=true;hidden.result_story=true;hidden.defeat_save=true;hidden.town_story=true
  move("story_portrait",2,24,29,45);move("story_speaker",5,17,24,4);move("story_quote",5,72,25,12)
  for i,route in ipairs({"home","gear","runes","builds"})do control("tab_"..route,37+(i-1)*14,22,13,6)end
  for k=1,3 do control("unit_"..k,37+(k-1)*19,31,18,6)end
  control("ready",76,84,17,7);control("back",76,84,17,7)
  if S.phase=="choice" then
   move("screen_title",37,11,56,6);hidden.screen_gold=true;hidden.screen_crystals=true;hidden.screen_crystals_plate=true
   control("view_map",77,84,16,7)
   for i=1,3 do local y=24+(i-1)*19
    move("choice_plate_"..i,37,y,56,17);byId["choice_plate_"..i].asset="texture://ui_card"
    move("choice_icon_"..i,39,y+2,9,12);move("choice_name_"..i,50,y+2,40,4);move("choice_desc_"..i,50,y+6,39,5)
    control("choice_"..i,76,y+11.5,14,4.5)
   end
  elseif formalRoute=="town" then
   if byId.screen_title then byId.screen_title.text="領地建設"end
   hidden.screen_gold=true;hidden.screen_crystals=true;hidden.screen_crystals_plate=true
   move("town_gold",37,19,56,4)
   for i=1,4 do local x=37+29*((i-1)%2);local y=27+27*floor((i-1)/2)
    move("town_icon_"..i,x,y,9,13);control("town_"..i,x+9,y+1,18,6);move("town_cost_"..i,x+9,y+8,18,3)
    move("town_effect_"..i,x,y+15,27,7)
   end
  elseif formalRoute=="gear" then
   for i=1,5 do control("slot_"..i,37+(i-1)*9.5,39,8.5,5)end;control("unequip",85,39,8,5)
   for j=1,4 do local x=37+29*((j-1)%2);local y=47+17*floor((j-1)/2)
    move("gear_icon_"..j,x,y,7,7);move("gear_name_"..j,x+8,y,19,4);move("gear_skill_"..j,x+8,y+4,19,7)
    control("equip_"..j,x,y+11.5,13,4.5);control("sell_"..j,x+14,y+11.5,13,4.5)
   end
   move("empty",39,52,52,8);control("gear_prev",37,84,12,7);control("gear_next",50,84,12,7)
  elseif formalRoute=="runes" then
   for i=1,3 do local y=42+(i-1)*12
    move("rune_desc_"..i,37,y,35,5);control("rune_"..i,74,y,19,6)
   end
   control("rune_off",37,80,20,6)
  elseif formalRoute=="builds" then
   for j=1,3 do local i=(formalPage-1)*3+j;local y=32+(j-1)*16
    move("build_name_"..i,37,y,36,4);move("build_desc_"..i,37,y+5,36,8);control("build_"..i,76,y+2,17,6)
   end
   control("build_prev",37,84,12,7);control("build_next",50,84,12,7)
  elseif S.phase=="shop" then
   for i=1,2 do local x=37+(i-1)*29
    move("stock_panel_"..i,x,32,27,46);if byId["stock_panel_"..i] then byId["stock_panel_"..i].asset="texture://ui_card" end
    move("stock_icon_"..i,x+8,35,11,13);move("stock_name_"..i,x+1,50,25,4.5);move("stock_desc_"..i,x+2,56,23,9)
    move("stock_cost_"..i,x+1,66,25,3);control("buy_"..i,x+2,71,23,6)
   end
   control("stock_prev",37,84,9,7);control("stock_next",47,84,9,7);move("stock_page",58,84,10,3)
   control("refresh",37,79,20,4);control("enchant",37,43,29,7);move("enchant_help",37,33,56,7);move("enchant_offer",37,55,56,12)
   control("accept",37,70,26,7);control("keep",66,70,27,7)
  elseif S.phase=="clear" or S.phase=="victory" then
   move("result_message",37,24,56,4);move("result_earned_label",37,32,56,3);move("result_earned",37,36,56,9)
   move("result_refund",37,48,56,4);move("result_crystals",37,54,56,4);move("result_combat",37,59,56,3)
   control("chest",50,65,30,7);move("chest_result",37,75,40,5);control("chest_done",81,75,12,5)
   control("result_home",37,84,20,7);control("next",66,84,27,7)
  elseif S.phase=="defeat" then
   move("defeat_crest",60,12,11,13);move("defeat_title",37,26,56,6);move("defeat_reason",37,34,56,4);move("defeat_route",37,40,56,4)
   for i=1,6 do local x=37+19*((i-1)%3);local y=48+13*floor((i-1)/3)
    move("defeat_stat_label_"..i,x,y,17,3);move("defeat_stat_value_"..i,x,y+4,17,6)
   end
   move("defeat_town_reward",37,75,56,4);control("defeat_town",37,84,24,7);control("defeat_retry",66,84,27,7)
  end
 end
 if S.phase=="battle" and S.autoConfigOpen then
  hidden.screen_gold=true;hidden.screen_crystals=true;hidden.screen_crystals_plate=true
  -- Compact centered sheet keeps the battlefield visible on a wide viewport.
  for _,n in ipairs(nodes)do local q=n.rect;n.rect={x=13+q.x*.74,y=6+q.y*.86,width=q.width*.74,height=q.height*.86}end
 elseif S.paused and S.phase=="battle" then
  hidden.screen_gold=true;hidden.screen_crystals=true;hidden.screen_crystals_plate=true
  if formalRoute=="guide" then move("screen_back",20,12,60,78);move("screen_title",25,15,50,5)
  elseif formalRoute=="abandon" then
   move("screen_back",24,24,52,52);move("screen_title",28,29,44,5);move("abandon_warning",28,39,44,15)
   control("abandon_cancel",28,61,25,7);control("abandon_confirm",56,61,16,7)
  else
   move("screen_back",32,21,36,59);move("screen_title",36,27,28,5)
   control("resume",37,38,26,7);control("guide",37,48,26,6);control("mute",37,57,26,6);control("quit",37,67,26,6)
  end
 end
 local visible:{any}={};for _,n in ipairs(nodes)do if not hidden[n.id] and not hidden[string.gsub(n.id,"_hit_[a-z]+$","")] then table.insert(visible,n)end end;nodes=visible
 S.uiPage=formalPage
 api.ui.setRoot({kind="screen",id="forest_lord",node=S.phase..":"..(S.autoConfigOpen and "auto" or formalRoute),children=nodes})
end
