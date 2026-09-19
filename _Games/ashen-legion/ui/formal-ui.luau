-- Game-owned view composition. Bundled into main.luau by build-formal-ui.mjs.
-- All purchases, combat and rewards still use existing game semantic actions.
local formalRoute="home"
local formalPage=1
local formalPreviousPhase=""
local formalMuted=false
-- Town upgrades are confirmed in a modal so a click can never spend the
-- save-scoped building material by accident. The index is kept in S because
-- the gameplay owner in main.luau performs the actual purchase.
local function townUpgradePrice(index:number):number?
 if index<=4 then return ({60,100,160,240,360})[(town.levels[index] or 0)+1] end
 local def=townNodeDefs[index]
 local level=town.nodes and (town.nodes[index] or 0) or 0
 return def and def.prices[level+1] or nil
end
local function townUpgradeLevel(index:number):number
 if index<=4 then return town.levels[index] or 0 end
 return town.nodes and (town.nodes[index] or 0) or 0
end
local function townRequirementText(index:number):string
 local def=townNodeDefs[index];local requirements=def and def.requires or {}
 if #requirements==0 then return "核心已連接 · 可研究" end
 local names={}
 for _,required in ipairs(requirements)do
  local parent=townNodeDefs[required];table.insert(names,(parent and parent.name or "前置節點").." Lv.1")
 end
 return "需要："..table.concat(names,"、")
end
local function profileReady(p:any):boolean
 return p~=nil and p.created==true
end
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
 rune="刻印師只賣符文。買進背包後，再到部隊配置決定由誰攜帶。",
 market="榛姨把剛到貨的裝備排開。先看技能，再挑一件回去。",
 potion="藥師正看著爐火。金幣買下的這一瓶，也許能救回整隊人。",
 tech="學者攤開了新圖紙。研究強化兵種，不會加重派兵費。",
 enchant="鐵匠等你落槌。先穿好裝備；新詞綴不合意，也能保留舊的。",
 curse="荊棘正在低語。先承受兩輪代價，才能拿到後來的力量。",
}
local placePortraits:{[string]:string}={market="quartermaster-v1",rune="portrait-scholar",potion="portrait-alchemist",tech="portrait-scholar",enchant="portrait-smith",curse="portrait-witch"}
local placeSpeakers:{[string]:string}={market="榛姨 · 商人",rune="刻印師 · 伊薇",potion="藥師 · 芙蘭",tech="軍械學者 · 瑟恩",enchant="鍛造師 · 布洛克",curse="林巫 · 莫拉"}
local formalReceipt=""
local formalReceiptUntil=0
local formalSeenStock:{[number]:boolean}={}
local formalShopDetail=0
local formalShopEnteredFrame=0
local function returnFromLoadout()
 if S.phase=="loadout" then S.phase=S.loadoutReturn;formalPreviousPhase=S.phase end
 formalRoute="home";formalPage=1;formalShopDetail=0
end
local function runePageForSelection():number
 local selected=S.runes[S.selected]
 if selected==0 then for i=1,#runeDefinitions do if (S.runeBag[i] or 0)>0 then selected=i;break end end end
 return max(1,math.ceil(selected/3))
end
local function formalInput(api:any)
 if pressed(api,"UI_mute")then formalMuted=not formalMuted end
 S.audioMuted=formalMuted
 if formalPreviousPhase~=S.phase then
  formalPreviousPhase=S.phase;formalRoute=S.phase=="loadout" and "gear" or "home";formalPage=1
  formalReceipt="";formalReceiptUntil=0;formalSeenStock={};formalShopDetail=0
  if S.phase=="shop" then formalShopEnteredFrame=frame end
 end
 if formalShopDetail>0 then
  if pressed(api,"ShopDetailClose") or pressed(api,"Escape") then formalShopDetail=0 end
  return
 end
 if S.phase~="battle" and S.phase~="celebration" and pressed(api,"Escape")then returnFromLoadout()end
 if pressed(api,"ReturnFromLoadout")then returnFromLoadout()end
 if pressed(api,"OpenLoadout") and openLoadout()then formalPreviousPhase="loadout";formalRoute="gear";formalPage=1 end
 -- Modal input is deliberately handled before route navigation. A pending
 -- upgrade captures the screen until the player confirms or cancels it.
 if S.phase=="menu" and formalRoute=="town" then
  if S.townUpgradePending then
   if pressed(api,"TownUpgradeCancel") then S.townUpgradePending=false;S.townUpgradeIndex=0 end
   if pressed(api,"TownUpgradeConfirm") then
    local i=S.townUpgradeIndex or 0
    if i>0 and townUpgradePrice(i) then S.townUpgradeConfirmRequested=true end
   end
   return
  end
  for i=1,4 do if pressed(api,"Town"..i) then S.townUpgradeIndex=i;S.townUpgradePending=true end end
  for i=5,#townNodeDefs do if pressed(api,"TownNode"..i) then S.townUpgradeIndex=i;S.townUpgradePending=true end end
 end
 for _,route in ipairs({"home","profiles","settings","gear","runes","town","guide","abandon","sell"})do
  if pressed(api,"UI_"..route)then
   if route=="gear" or route=="runes" then
    if openLoadout()then formalPreviousPhase="loadout";formalRoute=route;formalPage=route=="runes" and runePageForSelection() or 1 end
   elseif route=="home" then returnFromLoadout()
   elseif route=="town" then if S.phase=="menu" then formalRoute="town" end
   elseif route~="sell" or (S.phase=="shop" and (S.location=="market" or S.location=="rune"))then formalRoute=route;formalPage=route=="sell" and S.location=="rune" and runePageForSelection() or 1 end
  end
 end
 if pressed(api,"UI_page_next")then formalPage+=1 end
 if pressed(api,"UI_page_prev")then formalPage=max(1,formalPage-1)end
 if S.phase=="shop" and S.location=="market" and formalRoute~="sell" then
  for i=1,#S.stock do if pressed(api,"ShopDetail"..i)then formalShopDetail=i end end
 end
end
publishFormalUI=function(api:any)
 if S.enchantPending then formalRoute="home" end
 if S.phase=="shop" then
  for i,item in ipairs(S.stock :: {any})do
   if item.sold and formalSeenStock[i]==false then
    formalReceipt="已取得「"..(item.name or "軍團強化").."」"..((item.kind=="gear" or item.kind=="rune") and "，已放入背包。" or "。")
    formalReceiptUntil=frame+210
   end
   formalSeenStock[i]=item.sold==true
  end
 end
 local nodes:{any}={}
 local hidden:{[string]:boolean}={}
 local function rect(x:number,y:number,w:number,h:number)return {x=x,y=100-y-h,width=w,height=h}end
 local function img(id:string,asset:string,x:number,y:number,w:number,h:number)
  local preserve=string.find(id,"icon") or string.find(id,"crest") or string.find(id,"portrait") or id=="map_lord"
  table.insert(nodes,{kind="image",id=id,asset=asset,fit=id=="menu_art" and "cover" or (preserve and "contain" or "stretch"),rect=rect(x,y,w,h)})
 end
 local function nineSlice(id:string,prefix:string,x:number,y:number,w:number,h:number,border:number?)
  -- Canonical 1440x900 layout; the shared presentation component preserves
  -- these skin borders in pixels at other aspect ratios.
  local window=string.find(prefix,"window")~=nil;local card=string.find(prefix,"card")~=nil
  local left=min(window and 5 or card and w*210/940 or 2.1,w/2-.1);local right=left
  local top=min(window and 12 or card and w*1440/900*360/940 or 1.1,h/2-.1)
  local bottom=min(window and 8 or card and top or 1.1,h/2-.1)
  local middleWidth=w-left-right;local middleHeight=h-top-bottom
  local function tile(part:string,tx:number,ty:number,tw:number,th:number)
   img(id.."_"..part,prefix.."-"..part,tx,ty,tw,th)
  end
  tile("tl",x,y,left,top);tile("t",x+left,y,middleWidth,top);tile("tr",x+w-right,y,right,top)
  tile("l",x,y+top,left,middleHeight);tile("c",x+left,y+top,middleWidth,middleHeight);tile("r",x+w-right,y+top,right,middleHeight)
  tile("bl",x,y+h-bottom,left,bottom);tile("b",x+left,y+h-bottom,middleWidth,bottom);tile("br",x+w-right,y+h-bottom,right,bottom)
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
 local function truncate(value:string,limit:number):string
  local count=0
  for position in utf8.codes(value)do count+=1;if count>limit then return string.sub(value,1,position-1).."…"end end
  return value
 end
 local function skillDetail(id:string):string
  local entry=S.skillBook[id]
  return entry and string.split(entry.desc,"；每支派兵")[1] or id
 end
 local function button(id:string,label:string,action:string,x:number,y:number,w:number,h:number,enabled:boolean?,skin:string?)
  local primary=({Start=true,LeaveShop=true,Deploy=true,Next=true,Auto_apply=true,Pause=true,OpenChest=true,ChestDone=true,AcceptEnchant=true})[action]==true
  local chosen=(string.sub(id,1,4)=="tab_" and action=="UI_"..formalRoute) or string.find(label,"✓") or (string.sub(id,1,5)=="unit_" and string.sub(label,1,3)=="◆")
  if skin then nineSlice(id.."_plate","texture://ui_"..skin,x,y,w,h,.2)
  else img(id.."_plate","texture://ui_"..(enabled==false and "muted" or primary and "button" or chosen and "selected" or "secondary"),x,y,w,h)end
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
  local shopWindow=S.phase=="shop" and S.location=="market" and formalRoute~="sell"
  if shopWindow then
   img("shop_backdrop","texture://ui_shop-backdrop",0,0,100,100)
   img("shop_backdrop_shade","texture://ui_scene-shade",0,0,100,100)
   img("shop_window_fill","texture://ui_shop-surface",7,8,86,83)
   nineSlice("screen_back","texture://ui_shop-window-panel-v2",6,6,88,88)
   text("shop_window_title","森林領主 · 榛姨的商店",32,11,36,4)
   text("screen_title",title,10,15,24,5)
   text("screen_gold","金幣 "..floor(S.coins),72,15,17,4)
   text("screen_crystals","◆ 結晶 "..S.crystals,72,19,17,4)
  else
   img("screen_back","texture://ui_panel",3,3,94,94)
   text("screen_title",title,7,6,67,5)
   text("screen_gold","金幣 "..floor(S.coins),76,7,17,3.5)
   img("screen_crystals_plate","texture://ui_hud-crystal",76,12,17,3.5)
   text("screen_crystals","◆ 結晶 "..S.crystals,76,12,17,3.5)
  end
 end
 local function story(line:string,portrait:string?,speaker:string?)
  img("story_plate","texture://ui_panel",7,25,86,13)
  img("story_portrait","texture://ui_"..(portrait or "portrait-lord"),8,25.5,10,12)
  text("story_speaker",speaker or "遠征行記",20,25.8,69,3.2)
  text("story_quote",line,20,30,69,6)
 end
 local function shopkeeper(line:string,portrait:string?,speaker:string?)
  local marketShop=S.phase=="shop" and S.location=="market" and formalRoute~="sell"
  if marketShop then
   img("shopkeeper_portrait","texture://ui_"..(portrait or "portrait-merchant"),10,31,16,28)
   text("shopkeeper_name",speaker or "商旅",10,61,16,4)
   text("shopkeeper_line",line,10,67,16,11)
   return
  end
  local width=marketShop and 23 or 27
  img("shopkeeper_back","texture://ui_card",7,25,width,55)
  img("shopkeeper_portrait","texture://ui_"..(portrait or "portrait-merchant"),marketShop and 9 or 10,28,marketShop and 18 or 21,marketShop and 25 or 27)
  text("shopkeeper_name",speaker or "商旅",8,56,marketShop and 21 or 25,4)
  text("shopkeeper_line",wrap(line,marketShop and 11 or 13),8,61,marketShop and 21 or 25,16)
 end
 local function tabs()
  if S.phase=="loadout" then
   button("tab_gear","裝備","UI_gear",7,16,22,6)
   button("tab_runes","符文","UI_runes",31,16,22,6)
  elseif S.phase=="shop" and (S.location=="market" or S.location=="rune")then
   local noun=S.location=="market" and "裝備" or "符文"
   if S.location=="market" and formalRoute~="sell" then
    button("tab_home","買入裝備","UI_home",10,22,16,5.5,true,"shop-button-primary-v2")
    button("tab_sell","出售裝備","UI_sell",28,22,16,5.5,true,"shop-button-secondary-v2")
   else
    button("tab_home","買入"..noun,"UI_home",7,16,25,6)
    button("tab_sell","出售"..noun,"UI_sell",34,16,25,6)
   end
  end
 end
 local unitNames={"劍兵","槍兵","騎兵"}
 local slotNames={"頭","身","腳","手","武器"}
 local function unitButtons(y:number)
  for k=1,3 do button("unit_"..k,(S.selected==k and "◆ " or "")..unitNames[k].." · "..costs(k).." 金","Unit"..k,7+(k-1)*23,y,22,6)end
 end
 local function footer()
  if S.phase=="shop" then
   if S.location=="market" and formalRoute~="sell" then button("ready","前往部隊配置","LeaveShop",70,84,20,5.5,true,"shop-button-primary-v2")
   else button("ready","前往部隊配置","LeaveShop",65,88,28,7,S.enchantPending==nil)end
  elseif S.phase=="loadout" then
   button("loadout_return",({shop="返回商店",choice="返回景點",clear="返回結算"})[S.loadoutReturn] or "返回","ReturnFromLoadout",45,88,22,7)
   if S.loadoutReturn=="shop" then button("deploy","整備完成 · 出戰","Deploy",70,88,23,7)end
  elseif S.phase=="menu" and formalRoute=="town" then
   button("town_back","返回標題","UI_home",48,88,20,7);button("launch_expedition","出發遠征","LaunchExpedition",71,88,22,7)
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
  -- The top HUD is one timeline: elapsed time, the current countdown, and
  -- the next wave/boss markers share the same visual track.
  local elapsed=1-S.time/max(1,S.roundDuration)
  img("timeline_track","texture://ui_timeline-track",7,2,86,9)
  img("timeline_fill","texture://ui_timeline-fill",7,2,86*max(.02,elapsed),9)
  text("timeline_time",string.format("%02d:%02d",floor(S.time/60),floor(S.time%60)),43,4.5,14,4)
  text("timeline_round","第 "..S.round.." / 7 輪",8,10.5,18,2.5)
  text("timeline_goal",S.bossPresent and "大王已現身 · 大獎／特獎通關" or "大王最後 30 秒登場",67,10.5,26,2.5)
  local function timelineMarker(id:string,asset:string,at:number,active:boolean)
   if at>=0 and at<=1 then
    local x=7+86*at-2
    if active then img(id.."_glow","texture://ui_mote",x-.5,.5,5,5)end
    img(id,"texture://ui_"..asset,x,1.2,4,4.5)
   end
  end
  timelineMarker("timeline_wave","icon-attack",S.hordeAt>=0 and S.hordeAt/max(1,S.roundDuration) or -1,S.hordeCount>0)
  timelineMarker("timeline_wheel","icon-refresh",(S.roundDuration-80)/max(1,S.roundDuration),S.wheelSpawned)
  timelineMarker("timeline_beetle","icon-coin",(S.roundDuration-45)/max(1,S.roundDuration),S.specialSpawned)
  timelineMarker("timeline_boss","icon-crown",(S.roundDuration-30)/max(1,S.roundDuration),S.bossSpawned)
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
  local fireHint=S.fired==0 and (S.battleSeconds or 0)<6
  text("target",S.targetName~="" and S.targetName or (S.autoEnabled and "AUTO · 等待指定怪物" or (S.lockEnabled and "LOCK · 點選怪物" or (fireHint and "按住戰場 · 派遣部隊" or "瞄準場內目標"))),78,73.5,19.4,2.6)
  for _,m in ipairs(monsters)do
   if m.alive and m.id==S.targetId then text("target_guard","破防 "..floor(m.damage).." / "..m.guard,78,76.7,19.4,2.4)end
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
  button("start","讀取進度","Start",9,61,34,9)
  button("settings","系統設定","UI_settings",9,72,34,7)
  button("exit","離開","ExitGame",9,81,34,7)
  if S.exitRequested then text("exit_message","進度已儲存，請關閉遊戲視窗。",8,91,38,4)end
 elseif S.phase=="menu" and formalRoute=="profiles" then
  panel("讀取進度")
  text("profiles_hint","選擇一個札記繼續；空白欄位可建立新進度。",9,17,82,4)
  if S.deleteCandidate and S.deleteCandidate>0 then
   local p=S.profiles[S.deleteCandidate]
   text("delete_warning","確定刪除「"..(p and p.name or "這份進度").."」？\n這會清除城鎮等級與遠征紀錄。",18,29,64,13)
   button("delete_confirm","確認刪除","ConfirmDelete",25,54,22,8)
   button("delete_cancel","保留進度","CancelDelete",53,54,22,8)
  else
   for i=1,3 do
    local x=8+(i-1)*29;local p=S.profiles[i];local ready=profileReady(p)
    img("profile_card_"..i,"texture://ui_card",x,27,26,43)
    text("profile_slot_"..i,"札記 "..i,x+2,29,22,4)
    text("profile_name_"..i,ready and p.name or "尚未建立",x+2,36,22,5)
    local detail=ready and ("建材 "..p.materials.."\n遠征 "..p.runs.." 次 · 最遠 "..p.bestRound.." 站") or "沒有遠征紀錄\n建立後從第一站開始"
    text("profile_detail_"..i,detail,x+2,44,22,8)
    if ready then
     button("profile_load_"..i,"進入","Profile"..i,x+2,55,12,6)
     button("profile_delete_"..i,"刪除","DeleteProfile"..i,x+15,55,11,6)
    else
     button("profile_create_"..i,"建立新檔","Profile"..i,x+2,55,24,6)
    end
   end
  end
  button("profiles_back","返回主選單","UI_home",32,86,36,7)
 elseif S.phase=="menu" and formalRoute=="settings" then
  panel("系統設定")
  text("settings_hint","設定會儲存在目前裝置，下次開啟仍會保留。",9,17,82,4)
  text("settings_music_label","音樂音量",16,30,28,5)
  text("settings_music_value",floor((S.settings.music or .7)*100).."%",53,30,17,5)
  button("settings_music_down","−","Setting_music_down",72,29,8,7)
  button("settings_music_up","＋","Setting_music_up",82,29,8,7)
  text("settings_sfx_label","音效音量",16,42,28,5)
  text("settings_sfx_value",floor((S.settings.sfx or .85)*100).."%",53,42,17,5)
  button("settings_sfx_down","−","Setting_sfx_down",72,41,8,7)
  button("settings_sfx_up","＋","Setting_sfx_up",82,41,8,7)
  text("settings_quality_label","畫質",16,54,28,5)
  text("settings_quality_value",({low="低",medium="中",high="高"})[S.settings.quality] or "高",53,54,17,5)
  button("settings_quality","切換","Setting_quality",72,53,18,7)
  text("settings_language_label","語系",16,66,28,5)
  text("settings_language_value",S.settings.language or "繁中",53,66,17,5)
  button("settings_language","切換","Setting_language",72,65,18,7)
  button("settings_back","返回主選單","UI_home",32,84,36,7)
 elseif S.phase=="choice" then
  panel(chapters[S.round].." · 選擇景點")
  button("view_map","查看地圖","ViewMap",77,17,16,6)
  button("choice_loadout","部隊配置","OpenLoadout",7,88,23,7)
  text("choice_hint","隨機景點 · 選一處拜訪",7,20,68,4)
  story(chapterLines[S.round])
  for i,c in ipairs(S.cards :: {any})do
   local y=41+(i-1)*16
   img("choice_plate_"..i,"texture://ui_panel",7,y,86,14)
   local icon:string?=({market="building-market",potion="building-alchemy",tech="building-barracks",enchant="building-forge",curse="building-curse",rune="icon-rune"} :: {[string]:string})[c.id]
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
  text("defeat_town_reward","建材 +"..(town.materials-S.townStartMaterials).." 已入庫 · 庫存 "..town.materials,12,76,76,4)
  text("defeat_save","戰利與建材已記入目前札記；本局金幣與結晶不會帶出。",12,81,76,3)
  button("defeat_town","返回領主札記","ReturnTown",12,86,35,8,elapsed>=1.2)
  button("defeat_retry","重整旗鼓 · 再次出征","Start",53,86,35,8,elapsed>=1.2)
 elseif S.phase=="clear" or S.phase=="victory" then
  panel(S.phase=="defeat" and "軍團暫退" or (S.phase=="victory" and "森林王冠 · 遠征完成" or "關卡凱旋"))
  text("result_message",S.phase=="victory" and "七站的營火，終於連成了歸途。" or "本關已完成，軍團準備繼續前行。",9,22,82,4)
  text("result_earned","+"..S.earned,9,34,82,9)
  text("result_earned_label","本次遠征累計獲獎金幣",9,29,82,3)
  text("result_combat","擊殺 "..S.kills.." · 破防 "..S.breaks,9,67,82,3)
  text("result_refund","倖存返還 "..(S.roundRefund or 0).." 金幣",9,44,82,6)
  text("result_crystals","◆ 本輪開獎結晶 "..S.roundCrystalEarned.." + 通關 "..S.roundCrystalBonus.." · 持有 "..S.crystals,9,51,82,4)
  text("result_story",S.phase=="victory" and "七處營火連成歸途。王冠與軍團一起回家。" or "清點回來的士兵。下一處營火已在地圖上等候。",9,76,82,4)
  if S.chestCount>0 then button("chest","按住開啟寶箱 ×"..S.chestCount,"OpenChest",26,56,48,9)end
  if S.chestResult then text("chest_result",S.chestResult,12,68,64,6);button("chest_done","收下","ChestDone",78,68,13,6)end
  if S.phase=="clear" then button("next","前往下一站","Next",32,83,36,9,S.presentationDelay<=0)
  else button("result_home","返回領主札記","ReturnTown",32,83,36,9)end
 else
  if formalRoute=="town" then img("town_scene","texture://ui_scene-town",0,0,100,100)end
  panel(S.phase=="loadout" and "部隊裝備" or formalRoute=="town" and "領地建設" or ({market="裝備店",rune="符文店",potion="藥水工坊",tech="軍團研究",enchant="附魔鐵砧",curse="荊棘契約"})[S.location] or "領地與軍備")
  if formalRoute~="town" then tabs()end;footer()
 if formalRoute=="town" then
   hidden.screen_gold=true;hidden.screen_crystals=true;hidden.screen_crystals_plate=true
   img("town_keep","texture://ui_building-keep",8,24,26,28)
   img("town_lord","texture://ui_portrait-lord-v2",8,53,26,29)
   text("town_heading","領地星雲",37,18,56,4)
   text("town_subheading","目前領地 · 從王冠核心向外拓展",37,23,56,3)
   img("town_material_icon","texture://ui_symbol-material",37,30,3,4)
   text("town_gold","建材 "..town.materials,41,31,24,4)
   text("town_record","遠征 "..town.runs.." 次 · 最遠到第 "..town.bestRound.." 站",65,31,28,4)
   img("town_constellation","texture://ui_town-constellation",36,35,60,50)
   text("town_constellation_title","星雲技能 · 核心向外生長",40,35,52,3)
   text("town_core","◆ 王冠核心",60,61,12,2.5)
   -- One point is one skill. Four inner skills touch the core; four outer
   -- skills grow from their matching inner point. Details live in the modal
   -- so the constellation stays readable at a glance.
   local nodePositions={{66,49},{80,59},{66,70},{52,59},{50,43},{80,43},{80,74},{50,74}}
   local labelPositions={{58,44},{70,56},{58,72},{54,56},{40,40},{80,40},{80,77},{40,77}}
   for i,def in ipairs(townNodeDefs)do
    local pos=nodePositions[i];local x=pos[1];local y=pos[2];local nodeLevel=townUpgradeLevel(i);local unlocked=townNodePrereqsMet(i);local maxed=nodeLevel>=def.max
    local label=labelPositions[i];local lx=label[1];local ly=label[2]
    local action=i<=4 and "Town"..i or "TownNode"..i
    local price=townUpgradePrice(i)
    img("town_icon_"..i,"texture://ui_"..((maxed or unlocked) and def.icon or "icon-lock"),x,y,4,5)
    text("town_building_"..i,def.name.." Lv."..nodeLevel,lx,ly,10,3)
    button("town_"..i,maxed and "完成" or (not unlocked and "鎖定" or "研究"),action,lx,ly+3,8,3,price~=nil)
   end
   text("town_scope","點選節點查看技能效果與研究花費 · 建材只在目前領地流動",8,84,34,4)
   if S.townUpgradePending then
    local i=S.townUpgradeIndex or 0;local def=townNodeDefs[i];local level=townUpgradeLevel(i);local price=townUpgradePrice(i);local affordable=price~=nil and town.materials>=price;local unlocked=townNodePrereqsMet(i);local maxed=def and level>=def.max
    img("town_upgrade_modal","texture://ui_panel",22,21,56,59)
    text("town_upgrade_kicker","星雲節點升級",29,27,42,3)
    text("town_upgrade_title",def and def.name or "領地節點",29,32,42,6)
    text("town_upgrade_level","Lv."..level.."  →  Lv."..(level+1),29,40,42,5)
    text("town_upgrade_desc",def and def.desc or "升級領地節點",29,47,42,6)
    text("town_upgrade_cost",price and ("建材 "..price.."　·　持有 "..town.materials) or "此節點已達最高等級",29,56,42,5)
    text("town_upgrade_note",maxed and "此節點已達最高等級。" or (not unlocked and townRequirementText(i) or (affordable and "確認後立即記入目前領地。" or "建材不足，先完成遠征取得建材。")),29,63,42,5)
    button("town_upgrade_confirm", "確認升級", "TownUpgradeConfirm",28,71,20,7,affordable and unlocked and not maxed)
    button("town_upgrade_cancel", "先不升級", "TownUpgradeCancel",52,71,20,7,true)
   end
  elseif formalRoute=="gear" then
   -- A troop-first fitting view: roster, paper doll, and shared pack are
   -- visibly separate. Every placement edits this run's equipment assignment.
   text("roster_heading","部隊",7,21,17,4)
   for k=1,3 do
    local y=27+(k-1)*14
    img("roster_portrait_"..k,"texture://ui_portrait-"..({"sword","spear","cavalry"})[k],8,y,7,10)
    button("roster_unit_"..k,(S.selected==k and "◆ " or "")..unitNames[k],"Unit"..k,7,y+9,17,5)
   end
   text("troop_quote","本次派兵\n"..costs(S.selected).." 金",7,72,17,8)
   text("doll_heading",unitNames[S.selected].." · 紙娃娃",25,21,36,4)
   img("paper_doll_frame","texture://ui_card",25,26,36,55)
   img("paper_doll_portrait","texture://ui_portrait-"..({"sword","spear","cavalry"})[S.selected],34,37,17,24)
   local slotPositions={{36,26},{26,39},{46,39},{26,57},{46,57}}
   for i,n in ipairs(slotNames)do
    local item=itemById(S.worn[S.selected][i]);local p=slotPositions[i];local x,y=p[1],p[2]
    img("slot_frame_"..i,"texture://ui_"..(S.equipSlot==i and "selected" or "secondary"),x,y,14,12)
    img("worn_icon_"..i,"texture://ui_"..(item and "gear-"..item.skill or "icon-"..({"helmet","body","boots","gloves","weapon"})[i]),x+4.3,y+.5,5.4,5.5)
    local shortName=item and truncate(item.name,5) or n
    table.insert(nodes,{kind="button",id="slot_"..i,text=(S.equipSlot==i and "◆ " or "")..shortName,action="Slot"..i,rect=rect(x,y+6,14,5)})
   end
   local activeItem=itemById(S.worn[S.selected][S.equipSlot])
   text("active_slot",slotNames[S.equipSlot].."槽 · "..(activeItem and activeItem.name or "空槽"),25,77,36,3)
   button("unequip",activeItem and "卸下此裝備" or "目前空置","Unequip",34,81,20,5,activeItem~=nil)
   text("bag_heading","行囊 · "..slotNames[S.equipSlot],63,21,30,4)
   local matching={};for i,item in ipairs(S.items)do if item.slot==S.equipSlot then table.insert(matching,i)end end
   local pageCount=max(1,math.ceil(#matching/3));formalPage=min(formalPage,pageCount)
   for j=1,3 do local index=matching[(formalPage-1)*3+j];local item=index and S.items[index];local y=26+(j-1)*17
    img("pack_card_"..j,"texture://ui_card",63,y,30,16)
    if item then
     img("gear_icon_"..j,"texture://ui_gear-"..item.skill,64,y+1.5,7,9)
     text("gear_name_"..j,item.name..(item.enchant and " ◆" or ""),72,y+1,20,3.5)
     text("gear_skill_"..j,wrap(skillDetail(item.skill),15),72,y+4.5,20,4)
     local holder=nil;for k,worn in ipairs(S.worn)do if worn[item.slot]==item.id then holder=k end end
     local wearing=holder==S.selected
     text("gear_owner_"..j,holder and unitNames[holder] or "行囊",64,y+11.5,10,3)
     text("gear_cost_"..j,costs(S.selected,item).."金",74,y+11.5,8,3)
     button("equip_"..j,wearing and "已裝" or "穿上","Equip"..index,83,y+10,9,5,not wearing)
    else
     img("empty_pack_icon_"..j,"texture://ui_icon-"..({"helmet","body","boots","gloves","weapon"})[S.equipSlot],65,y+3,6,8)
     text("empty_pack_"..j,"空的行囊",73,y+4,18,4)
    end
   end
   button("gear_prev","‹","UI_page_prev",73,82,7,5,pageCount>1 and formalPage>1)
   text("gear_page",formalPage.." / "..pageCount,81,82,12,4)
   button("gear_next","›","UI_page_next",87,82,6,5,pageCount>1 and formalPage<pageCount)
  elseif formalRoute=="runes" then
   unitButtons(26)
   local pages=math.ceil(#runeDefinitions/3);formalPage=min(formalPage,pages)
   for j=1,3 do local i=(formalPage-1)*3+j;local def=runeDefinitions[i]
    if def then
     local donor=runeHolder(i,S.selected);local active=S.runes[S.selected]==i
     local y=39+(j-1)*13
     img("rune_icon_"..j,"texture://ui_skill-"..def.icon,37,y,5,8)
     text("rune_name_"..j,def.name,43,y,29,4)
     text("rune_desc_"..j,def.effect,43,y+4,29,4.4)
     text("rune_owned_"..j,"背包 "..(S.runeBag[i] or 0).." 枚"..(donor and " · "..unitNames[donor].."已裝入" or ""),43,y+8.5,29,3)
     button("rune_"..j,active and "已裝入" or S.runeBag[i]>0 and "裝入" or donor and "轉交此部隊" or "尚未持有","Rune"..i,74,y+1,19,6,not active and ((S.runeBag[i] or 0)>0 or donor~=nil))
    end
   end
   text("rune_help","抬賞／細收只改開獎後的獎級分配；總開獎率、特獎不變。",37,77,56,3)
   button("rune_off","卸下符文","RuneOff",74,81,19,4,S.runes[S.selected]~=0)
   button("rune_prev","上一頁","UI_page_prev",37,86,11,5,formalPage>1);button("rune_next","下一頁","UI_page_next",49,86,11,5,formalPage<pages)
   text("rune_page",formalPage.." / "..pages,37,81,20,3)
  elseif formalRoute=="sell" then
   shopkeeper("不需要的物資，可以換回一半購入結晶。裝備先從部隊卸下。",placePortraits[S.location],placeSpeakers[S.location])
   if S.location=="rune" then
    local pages=math.ceil(#runeDefinitions/3);formalPage=min(formalPage,pages)
    for j=1,3 do local i=(formalPage-1)*3+j;local def=runeDefinitions[i];local y=34+(j-1)*15
     if def then
      img("sale_icon_"..j,"texture://ui_skill-"..def.icon,38,y,7,10)
      text("sale_name_"..j,def.name.." · 背包 "..(S.runeBag[i] or 0).." 枚",47,y+2,28,5)
      button("sale_"..j,"售 ◆ "..floor(def.price*.5),"SellRune"..i,77,y+2,16,6,(S.runeBag[i] or 0)>0)
     end
    end
    button("sale_prev","上一頁","UI_page_prev",37,84,12,7,formalPage>1);button("sale_next","下一頁","UI_page_next",50,84,12,7,formalPage<pages)
   else
    local pages=max(1,math.ceil(#S.items/4));formalPage=min(formalPage,pages)
    for j=1,4 do local index=(formalPage-1)*4+j;local item=S.items[index]
     if item then local x=37+29*((j-1)%2);local y=34+23*floor((j-1)/2)
      img("sale_icon_"..j,"texture://ui_gear-"..item.skill,x,y,8,10)
      text("sale_name_"..j,item.name,x+9,y,18,4)
      local holder=nil;for k,worn in ipairs(S.worn)do if worn[item.slot]==item.id then holder=k end end
      text("sale_status_"..j,holder and unitNames[holder].."穿戴中" or "可出售",x+9,y+5,18,3)
      button("sale_"..j,holder and "請先卸下" or "售 ◆ "..floor(item.paid*.5),"Sell"..index,x,y+12,27,6,holder==nil)
     end
    end
    if #S.items==0 then text("sale_empty","背包目前沒有裝備。",39,43,50,6)end
    if pages>1 then button("sale_prev","上一頁","UI_page_prev",37,84,12,7,formalPage>1);button("sale_next","下一頁","UI_page_next",50,84,12,7,formalPage<pages)end
   end
  elseif S.phase=="shop" and formalRoute~="sell" then
   shopkeeper(placeLines[S.location] or "這裡只賣專門的軍需品。",placePortraits[S.location],placeSpeakers[S.location])
   if S.location=="enchant" then
    text("enchant_heading","選擇已穿戴的部位",37,20,56,4)
    for i,n in ipairs(slotNames)do button("enchant_slot_"..i,n,"Slot"..i,37+(i-1)*11.2,25,10.4,6,S.worn[S.selected][i]~=0)end
    unitButtons(34)
    local item=itemById(S.worn[S.selected][S.equipSlot])
    img("enchant_item_icon","texture://ui_"..(item and "gear-"..item.skill or "icon-"..({"helmet","body","boots","gloves","weapon"})[S.equipSlot]),39,45,12,16)
    text("enchant_item_name",item and item.name or "此部位尚未裝備",52,46,39,5)
    text("enchant_current",item and ("目前詞綴 · "..(item.enchant and skillDetail(item.enchant) or "無")) or "先在部隊配置穿上裝備，再回來附魔。",52,52,39,7)
    text("enchant_cost","每次消耗 8 結晶 · 每處最多兩次",39,64,52,4)
    button("enchant_roll","試附魔","Enchant",47,71,30,8,item~=nil and S.enchantPending==nil and S.enchantUses<2)
    text("enchant_chances","普通 70% · 精良 25% · 史詩 5%",39,81,52,3)
    if S.enchantPending then
     img("enchant_reveal_back","texture://ui_card",36,37,57,39)
     text("enchant_reveal_tier",({"普通附魔","精良附魔","史詩附魔"})[S.enchantPending.tier],42,41,46,5)
     img("enchant_reveal_icon","texture://ui_skill-"..S.enchantPending.skill,39,49,10,13)
     text("enchant_reveal_name",skillDetail(S.enchantPending.skill),51,49,38,8)
     button("enchant_accept","採用新詞綴","AcceptEnchant",40,65,23,7)
     button("enchant_keep","保留原詞綴","KeepEnchant",66,65,23,7)
    end
   else
    local isMarket=S.location=="market"
    local pageCount=isMarket and 1 or max(1,math.ceil(#S.stock/2));formalPage=math.min(formalPage,pageCount)
    local curseNames={"負債誓約","脆弱誓約","遲緩誓約"}
    local curseDetails={"未來兩輪派兵費增加 15%，結束後獲得一層強化。","未來兩輪壽命降低 15%，結束後獲得一層強化。","未來兩輪移速降低 15%，結束後獲得一層強化。"}
    if isMarket then
     local function rarity(item:any):string
      return item.price>=16 and "legendary" or item.price>=12 and "epic" or "rare"
     end
     local function entryText(item:any):string
      local entry=S.skillBook[item.skill]
      return entry and skillDetail(item.skill) or "裝備後提供對應技能效果。"
     end
     for j=1,4 do
      local index=j;local item=S.stock[index];local x=28+(j-1)*15.75;local kind=item and rarity(item) or "rare";local y=29
      -- One card template and one rail grid; the host animates each whole card.
      nineSlice("stock_panel_"..j,"texture://ui_shop-card-"..kind.."-v2",x,y,14.75,51)
      if item then
       local effect=entryText(item)
       img("stock_icon_"..j,"texture://ui_gear-"..item.skill,x+3.25,y+8.5,8.25,12)
       text("stock_name_"..j,item.name,x+2,y+21,10.75,4)
       text("stock_desc_"..j,slotNames[item.slot].."部位 · "..effect,x+2,y+26,10.75,8)
       text("stock_cost_"..j,"售價\n◆ "..item.price,x+2,y+35,5,6.5)
       text("stock_deploy_"..j,"派兵費\n+"..(item.deployExtra or 0),x+7.75,y+35,5,6.5)
       button("stock_detail_"..j,item.sold and "已取得" or "查看詳情","ShopDetail"..index,x+1.75,y+42,11.25,5.5,true,"shop-button-secondary-v2")
      else
       text("stock_empty_"..j,"本頁沒有其他裝備",x+1,y+21,14,5)
      end
     end
     if formalShopDetail==0 then
      local notice=(formalReceipt~="" and frame<formalReceiptUntil) and formalReceipt or S.message
      text("stock_hint",notice~="" and notice or "點選卡片查看技能 · 每個部位只裝一件",10,84,40,5.5)
      button("refresh","重骰 2◆","RefreshShop",52,84,16,5.5,not S.refreshUsed and S.crystals>=2,"shop-button-secondary-v2")
     end
     if formalShopDetail>0 then
      local item=S.stock[formalShopDetail]
      if item then
       local detailEntry=S.skillBook[item.skill];local detailEffect=detailEntry and skillDetail(item.skill) or "裝備後提供對應技能效果。";local detailKind=rarity(item)
       img("shop_detail_shade","texture://ui_scene-shade",0,0,100,100)
       table.insert(nodes,{kind="button",id="shop_modal_scrim",text="",action="ShopDetailClose",rect=rect(0,0,100,100)})
       img("shop_detail_fill","texture://ui_shop-surface",23,16,54,68)
       nineSlice("shop_detail_modal","texture://ui_shop-window-panel-v2",22,14,56,72)
       text("shop_detail_kicker","裝備詳情 · "..(detailKind=="legendary" and "傳奇" or detailKind=="epic" and "史詩" or "稀有"),28,20,31,4)
       text("shop_detail_title",item.name,39,28,29,5)
       button("shop_detail_close","關閉","ShopDetailClose",64,20,9,5.5,true,"shop-button-secondary-v2")
       img("shop_detail_icon","texture://ui_gear-"..item.skill,28,28,10,16)
       text("shop_detail_story",slotNames[item.slot].."部位裝備 · 買入後至部隊配置穿戴",40,35,29,8)
       text("shop_detail_price","售價 ◆ "..item.price,28,46,20,4)
       text("shop_detail_deploy","派兵費 +"..(item.deployExtra or 0),51,46,20,4)
       text("shop_detail_trigger","技能條件與效果",28,53,44,4)
       text("shop_detail_effect",detailEffect,28,59,44,10)
       local allowed=not item.sold and canStoreItem()
       button("shop_detail_buy",item.sold and "已取得" or "買入","Buy"..formalShopDetail,28,73,21,5.5,allowed,"shop-button-primary-v2")
       button("shop_detail_cancel","先不買","ShopDetailClose",51,73,21,5.5,true,"shop-button-secondary-v2")
      end
     end
    else
     for j=1,2 do
      local index=(formalPage-1)*2+j;local item=S.stock[index];local x=37+(j-1)*29;local y=29
      img("stock_panel_"..j,"texture://ui_card",x,y,27,51)
      if item then
       local icon="building-alchemy";local desc=""
       if item.kind=="gear" then icon="gear-"..item.skill;desc=skillDetail(item.skill).."\n"..slotNames[item.slot].."槽 · 部隊配置後穿戴"
       elseif item.kind=="rune" then local def=runeDefinitions[item.value];icon="skill-"..def.icon;desc=def.effect.."\n買入後放入符文背包，再到整備時裝入部隊。"
       elseif item.kind=="tech" then local entry=S.skillBook[item.value];icon="skill-"..item.value;desc=(entry and skillDetail(item.value) or "隨機兵種能力").."\n指定部隊："..unitNames[item.unit]
       elseif item.kind=="potion" then icon="building-alchemy";desc=({"全軍移速提高 8 秒。","目前部隊壽命延長 1.5 秒。","召回目前倖存部隊並返還實付金幣。"})[item.value]
       elseif item.kind=="curse" then icon="icon-curse-debt";desc=curseDetails[item.value]end
       img("stock_icon_"..j,"texture://ui_"..icon,x+1,y+2,7,9)
       text("stock_name_"..j,item.name,x+8.5,y+2,17.5,6)
       text("stock_desc_"..j,wrap(desc,14),x+1.5,y+13,24,17)
       local currency=item.currency=="crystal" and "◆ " or "金 "
       local funds=item.currency=="crystal" and S.crystals or S.coins
       text("stock_cost_"..j,currency..item.price.." · 持有 "..funds,x+1.5,y+33,24,4)
       local allowed=not item.sold and (item.kind~="gear" or #S.items<24) and (item.kind~="rune" or runeCopies(item.value)<3) and (item.kind~="potion" or #S.potions<2) and (item.kind~="tech" or not S.researchUsed)
       button("buy_"..j,item.sold and "已取得" or "買入","Buy"..index,x+2,y+40,23,7,allowed)
      else
       text("stock_empty_"..j,"本頁沒有其他物資",x+3,y+20,21,5)
      end
     end
     button("stock_prev","‹","UI_page_prev",43,82,9,5,formalPage>1)
     text("stock_page",formalPage.." / "..pageCount,53,83,15,3)
     button("stock_next","›","UI_page_next",70,82,9,5,formalPage<pageCount)
    end
    -- Keep reroll outside the first product card's expanded hit area, especially on phone widths.
   end
   if S.location~="market" then
    if formalReceipt~="" and frame<formalReceiptUntil then text("shop_receipt",formalReceipt,38,79,54,3)end
    if S.message~="" then text("shop_feedback",S.message,38,75,54,3)end
   end
  end
 end
 if S.phase=="battle" and S.autoConfigOpen then
  hidden.screen_gold=true;hidden.screen_crystals=true;hidden.screen_crystals_plate=true
  -- Compact centered sheet keeps the battlefield visible on a wide viewport.
  for _,n in ipairs(nodes)do local q=n.rect;n.rect={x=13+q.x*.74,y=6+q.y*.86,width=q.width*.74,height=q.height*.86}end
 elseif S.paused and S.phase=="battle" then
  hidden.screen_gold=true;hidden.screen_crystals=true;hidden.screen_crystals_plate=true
 end
 local visible:{any}={};for _,n in ipairs(nodes)do if not hidden[n.id] and not hidden[string.gsub(n.id,"_hit_[a-z]+$","")] then table.insert(visible,n)end end;nodes=visible
 S.uiRoute=formalRoute;S.uiPage=formalPage
 api.ui.setRoot({kind="screen",id="forest_lord",node=S.phase..":"..(S.autoConfigOpen and "auto" or formalRoute),children=nodes})
end
