-- Game-owned view composition. Bundled into main.luau by build-formal-ui.mjs.
-- All purchases, combat and rewards still use existing game semantic actions.
local formalRoute="home"
local formalPage=1
local formalScroll=0
local formalPreviousPhase=""
local formalMuted=false
-- Authored core-effect summaries; full conditions remain in the skill book.
local skillSummaries:{[string]:string}={
 pierce="穿透 +1，用盡後消失",landing_spin="落地旋轉斬",critical="爆擊率 +10%",longlife="壽命 +15%",haste="移速 +15%",heavy="減速換取增傷",
 bounce_power="反彈後累積增傷",bounce_life="反彈延長壽命",momentum="速度加成轉穿透傷害",shock="命中擴散範圍傷害",crit_power="爆擊倍率 +0.25",finisher="穿透強化最後一撞",
 ember_burst="終結接觸後爆炸",king_hunter="對王傷害 +20%",frost_touch="命中緩速",frenzy="連殺累積增傷",last_stand="瀕死時強化下一撞",heat="每秒累積增傷",distance="行軍後強化下一撞",
 lightning="爆擊雷鏈兩怪",third_crit="第三次命中必爆擊",expire_burst="到期造成範圍傷害",wall_quake="首次反彈範圍傷害",short_fuse="縮短壽命換取增傷",wide_blade="擴大範圍、降低傷害",
 hit_echo="命中三怪觸發震波",fracture="高破防目標追加傷害",solo_hunt="孤立目標增傷",crowd_ring="群怪附近擴大旋轉",recruit="低金幣時限次半價",rally="累積派兵費強化全軍",
 rapid="派兵頻率 +25%",solitary="單兵存活時增傷",showdown="最後30秒增傷",sharp="基礎傷害 +10%",giant="基礎傷害 +25%",double_pierce="穿透 +2",deadly="爆擊倍率 +0.5",
 shatter="對緩速敵人碎冰增傷",ricochet_precision="反彈累積爆擊率",hunter_vigor="擊殺延長壽命",piercing_wave="每兩次穿透觸發旋斬",slow_force="減速加成轉為傷害",spin_master="強化已有旋轉斬",rebound_charge="反彈蓄勢後衝刺增傷",
 flame_cloak="詠唱後週期灼燒近敵",phoenix_fire="週期噴火灼燒三怪",plague_vial="行軍投下中毒霧",ember_trail="行軍留下灼燒火路",slick_oil="沾油緩速、遇火爆燃",rain_strike="潮濕留水池、可導雷",
 storm_touch="追加雷傷、潮濕連鎖",oil_legacy="死亡留油池、遇火燒",plunder="命中得金、壽命減半",firstborn="出生衝刺逐漸衰退",march_capacitor="行軍蓄力、命中釋放",delayed_bloom="存活2秒後範圍爆發",
 third_pulse="每三次命中觸發震波",battle_elegy="附近友軍死亡時增傷",grave_bloom="擊殺後範圍爆燃",last_echo="剩餘25%壽命放寒霜",necromancer="死亡機率召魂追敵",comrade_oath="友軍接觸互相增傷",
 resonant_debt="埋印後受多次傷害爆發",contact_mine="定時布雷、近敵引爆",step_orb="行軍留下延遲光雷",gravity_law="週期拉近周圍小怪",quick_chant="週期冷卻 -25%",overload_script="技能增傷、冷卻變慢",
 storm_payload="指定爆發轉雷傷",cinder_seal="命中埋下延遲爆印",chain_fuse="火種延遲接力爆炸",thunder_fan="每三次命中釋放雷羽",echo_blade="首次命中延遲返斬",starfall="出生後延遲落星追敵",
 soul_return="死亡沿舊路返斬",legacy_gift="死亡強化一名友軍",guard_bequest="死亡依破防值追傷",
}
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
-- Percent coordinates in the painted atlas; the first point is the departure.
-- The asset builder reads this literal for the matching curved route overlays.
local expeditionPoints={{5,82},{14,75},{27,48},{43,64},{51,37},{66,59},{79,41},{90,20}}
local placeLines:{[string]:string}={
 rune="刻印師只賣符文。買進背包後，再到部隊配置決定由誰攜帶。",
 market="榛姨把剛到貨的裝備排開。先看技能，再挑一件回去。",
 potion="藥師正看著爐火。金幣買下的這一瓶，也許能救回整隊人。",
 tech="學者攤開了新圖紙。研究強化兵種，不會加重派兵費。",
 enchant="鐵匠等你落槌。先穿好裝備；新詞綴不合意，也能保留舊的。",
 curse="荊棘正在低語。先承受兩輪代價，才能拿到後來的力量。",
}
local placePortraits:{[string]:string}={market="quartermaster-v1",rune="portrait-runesmith",potion="portrait-alchemist",tech="portrait-scholar",enchant="portrait-smith",curse="portrait-witch"}
local placeSpeakers:{[string]:string}={market="榛姨 · 商人",rune="刻印師 · 伊薇",potion="藥師 · 芙蘭",tech="軍械學者 · 瑟恩",enchant="鍛造師 · 布洛克",curse="林巫 · 莫拉"}
local formalReceipt=""
local formalReceiptUntil=0
local formalSeenStock:{[number]:boolean}={}
local formalShopDetail=0
local formalGearDetail=0
local formalDrawerOpen=true
local formalLoadoutWasActive=false
local formalDrawerClosed=false
local formalShopEnteredFrame=0
local function returnFromLoadout()
 if S.phase=="loadout" then S.phase=S.loadoutReturn;formalPreviousPhase=S.phase end
 formalRoute="home";formalPage=1;formalScroll=0;formalShopDetail=0
end
local function runePageForSelection():number
 local selected=S.runes[S.selected]
 if selected==0 then for i=1,#runeDefinitions do if (S.runeBag[i] or 0)>0 then selected=i;break end end end
 return max(1,math.ceil(selected/3))
end
local function formalInput(api:any)
 if pressed(api,"UI_mute")then formalMuted=not formalMuted end
 S.audioMuted=formalMuted
 if S.phase=="loadout" and not formalLoadoutWasActive then formalDrawerOpen=true;formalDrawerClosed=false;formalLoadoutWasActive=true
 elseif S.phase~="loadout" then formalLoadoutWasActive=false;formalDrawerClosed=false end
 if S.phase=="loadout" and not formalDrawerClosed then formalDrawerOpen=true end
 if formalPreviousPhase~=S.phase then
  formalPreviousPhase=S.phase;formalRoute=S.phase=="loadout" and "gear" or "home";formalPage=1;formalScroll=0
  formalReceipt="";formalReceiptUntil=0;formalSeenStock={};formalShopDetail=0;formalGearDetail=0;formalDrawerOpen=S.phase=="loadout"
  if S.phase=="shop" then formalShopEnteredFrame=frame end
 end
 if formalShopDetail>0 then
  if pressed(api,"ShopDetailClose") or pressed(api,"Escape") then formalShopDetail=0 end
  return
 end
 if formalGearDetail>0 then
  if pressed(api,"GearDetailClose") or pressed(api,"Escape") then formalGearDetail=0 end
  return
 end
 if pressed(api,"CloseDrawer") then formalDrawerOpen=false;formalDrawerClosed=true;return end
 if pressed(api,"OpenDrawer") then formalDrawerOpen=true;formalDrawerClosed=false end
 if pressed(api,"LoadoutScrollUp") then formalScroll=max(0,formalScroll-1) end
 if pressed(api,"LoadoutScrollDown") then formalScroll+=1 end
 if S.phase=="loadout" and formalRoute=="gear" then
  for i=1,5 do if pressed(api,"Slot"..i) then S.equipSlot=i;formalDrawerOpen=true;formalDrawerClosed=false end end
 end
 if S.phase~="battle" and S.phase~="celebration" and pressed(api,"Escape")then returnFromLoadout()end
 if pressed(api,"ReturnFromLoadout")then returnFromLoadout()end
 if pressed(api,"ReturnFromMap") and S.phase=="map" then
  S.phase="choice";S.mapMoving=false;formalRoute="home";formalPage=1
 end
 if pressed(api,"OpenLoadout") and openLoadout()then formalRoute="gear";formalPage=1;formalScroll=0 end
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
    if openLoadout()then formalRoute=route;formalPage=route=="runes" and runePageForSelection() or 1;formalScroll=0 end
   elseif route=="home" then returnFromLoadout()
   elseif route=="town" then if S.phase=="menu" then formalRoute="town" end
   elseif route~="sell" or (S.phase=="shop" and (S.location=="market" or S.location=="rune"))then formalRoute=route;formalPage=route=="sell" and S.location=="rune" and runePageForSelection() or 1 end
  end
 end
 if pressed(api,"UI_page_next")then formalPage+=1 end
 if pressed(api,"UI_page_prev")then formalPage=max(1,formalPage-1)end
 if S.phase=="shop" and formalRoute~="sell" then
  for i=1,#S.stock do if pressed(api,"ShopDetail"..i)then formalShopDetail=i end end
 end
 if S.phase=="loadout" and formalRoute=="gear" then
  for i=1,#S.items do if pressed(api,"GearDetail"..i)then formalGearDetail=i end end
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
 local supplyDetail:any=nil
 local hidden:{[string]:boolean}={}
 local function rect(x:number,y:number,w:number,h:number)return {x=x,y=100-y-h,width=w,height=h}end
 local nineSlice:any=nil
 local function img(id:string,asset:string,x:number,y:number,w:number,h:number)
  if nineSlice and string.match(id,"^auto_card_%d+$")then nineSlice(id,"texture://ui_control-quiet-v3",x,y,w,h);return end
  if nineSlice and (asset=="texture://ui_panel" or asset=="texture://ui_card") then
   if id=="screen_back" or string.find(id,"modal") then nineSlice(id,"texture://ui_shop-window-panel-v2",x,y,w,h);return end
   asset="texture://ui_shop-surface"
  end
  local preserve=string.find(id,"icon") or string.find(id,"crest") or string.find(id,"portrait") or id=="map_lord" or id=="map_back" or id=="map_current_ring" or string.find(id,"map_node_") or string.find(asset,"ui_portrait%-") or string.find(asset,"ui_building%-") or string.find(asset,"ui_icon%-") or string.find(asset,"ui_symbol%-")
  table.insert(nodes,{kind="image",id=id,asset=asset,fit=id=="menu_art" and "cover" or (preserve and "contain" or "stretch"),rect=rect(x,y,w,h)})
 end
 nineSlice=function(id:string,prefix:string,x:number,y:number,w:number,h:number,border:number?)
  -- Canonical 1440x900 layout; the shared presentation component preserves
  -- these skin borders in pixels at other aspect ratios.
  local window=string.find(prefix,"window")~=nil;local card=string.find(prefix,"card")~=nil
  if window then img(id.."_fill","texture://ui_shop-surface",x+.8,y+2,w-1.6,h-4)end
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
 local function skillSummary(id:string):string
  return skillSummaries[id] or string.split(skillDetail(id),"；")[1]
 end
 local function button(id:string,label:string,action:string,x:number,y:number,w:number,h:number,enabled:boolean?,skin:string?)
  local primary=({Start=true,QuickDeploy=true,Deploy=true,Next=true,LaunchExpedition=true,Auto_apply=true,Pause=true,OpenChest=true,ChestDone=true,AcceptEnchant=true})[action]==true
  local chosen=(string.sub(id,1,4)=="tab_" and action=="UI_"..formalRoute) or string.find(label,"✓") or (string.match(id,"^(unit|roster_unit)_") and string.sub(label,1,3)=="◆")
  if skin=="shop-button-secondary-v2" then skin="control-quiet-v3" end
  nineSlice(id.."_plate","texture://ui_"..(skin or (enabled~=false and (primary or chosen) and "shop-button-primary-v2" or "control-quiet-v3")),x,y,w,h,.2)
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
 local function compactButton(id:string,label:string,action:string,x:number,y:number,w:number,h:number,enabled:boolean?)
  img(id.."_plate","texture://ui_control-quiet-v3",x,y,w,h)
  if enabled==false then text(id,label,x+.4,y+.2,w-.8,h-.4)
  else
   text(id.."_label",label,x+.4,y+.2,w-.8,h-.4)
   table.insert(nodes,{kind="button",id=id,text="",action=action,rect=rect(x,y,w,h)})
  end
 end
 local function closeButton(id:string,action:string,x:number?,y:number?)
  local bx=x or 92;local by=y or 7;local bw=5.5;local bh=6
  img(id.."_plate","texture://ui_hud-key",bx,by,bw,bh)
  img(id.."_icon","texture://ui_icon-close",bx+1.25,by+1.15,3,3.7)
  table.insert(nodes,{kind="button",id=id,text="",action=action,rect=rect(bx,by,bw,bh)})
 end
 local function resourceBadge(id:string,plate:string,icon:string,value:any,x:number,y:number,w:number)
  img(id.."_plate","texture://ui_hud-"..plate,x,y,w,5.8)
  img(id.."_icon","texture://ui_icon-"..icon,x+1,y+.95,3.2,3.9)
  text(id,value,x+4.7,y+1.1,w-5.4,3.5)
 end
 local function panel(title:string)
  local shopWindow=S.phase=="shop" and S.location=="market" and formalRoute~="sell"
  -- One window rect, one title band and one currency band on every screen.
  -- The 4-unit outer margin is the shared safe area from UI-DESIGN-GUIDELINES.
  if shopWindow then
   img("shop_backdrop","texture://ui_shop-backdrop",0,0,100,100)
   img("shop_backdrop_shade","texture://ui_scene-shade",0,0,100,100)
  else
   img("screen_shade","texture://ui_scene-shade",0,0,100,100)
  end
  nineSlice("screen_back","texture://ui_shop-window-panel-v2",4,4,92,92)
  text("screen_title",title,38,7.4,24,5)
  if shopWindow then text("shop_window_title","森林領主 · 榛姨的商店",34,12.6,32,2.8)end
  -- These are run-only currencies, not balances belonging to a saved estate.
  if S.phase~="menu" then
   resourceBadge("screen_gold","gold","coin",floor(S.coins),64,6.2,10.5)
   resourceBadge("screen_crystals","crystal","crystal",S.crystals,75,6.2,10.5)
  end
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
   local function loadoutTab(id:string,label:string,action:string,x:number,y:number,active:boolean)
    img(id.."_plate","texture://ui_loadout-tab-v1",x,y,7,11)
    if active then img(id.."_active","texture://ui_loadout-tab-active-v1",x,y,7,11)end
    img(id.."_icon",action=="UI_gear" and "texture://ui_icon-weapon" or "texture://ui_icon-rune",x+1.65,y+1.15,3.7,4.2)
    text(id.."_label",label,x+.5,y+6.5,6,2.4)
    table.insert(nodes,{kind="button",id=id,text="",action=action,rect=rect(x,y,7,11)})
   end
   loadoutTab("tab_gear","裝備","UI_gear",7,30.5,formalRoute=="gear")
   loadoutTab("tab_runes","符文","UI_runes",7,43,formalRoute=="runes")
  elseif S.phase=="shop" and (S.location=="market" or S.location=="rune")then
   local noun=S.location=="market" and "裝備" or "符文"
   -- Same rect in both tab states; switching a tab must not move the row.
   button("tab_home","買入"..noun,"UI_home",8,16,22,6.5)
   button("tab_sell","出售"..noun,"UI_sell",32,16,22,6.5)
  end
 end
local unitNames={"劍兵","槍兵","騎兵"}
local slotNames={"頭","身","腳","手","武器"}
local unitIcons={"symbol-sword","symbol-spear","symbol-cavalry"}
local slotIcons={"icon-helmet","icon-body","icon-boots","icon-gloves","icon-weapon"}
local function unitButtons(y:number,x0:number?,w:number?,gap:number?)
 local ox=x0 or 7;local ww=w or 22;local gg=gap or 1
 for k=1,3 do button("unit_"..k,(S.selected==k and "◆ " or "")..unitNames[k].." · "..costs(k).." 金","Unit"..k,ox+(k-1)*(ww+gg),y,ww,6)end
end
local function loadoutUnitButtons(y:number,x0:number,w:number,gap:number,prefix:string)
 for k=1,3 do
  local x=x0+(k-1)*(w+gap);local id=prefix.."_"..k;local active=S.selected==k
  img(id.."_plate","texture://ui_"..(active and "hud-active" or "hud-key"),x,y,w,6)
  img(id.."_icon","texture://ui_"..unitIcons[k],x+1,y+1,2.6,3.4)
  text(id.."_label",unitNames[k].."\n"..costs(k).."金",x+3.8,y+1,w-4.3,4)
  table.insert(nodes,{kind="button",id=id,text="",action="Unit"..k,rect=rect(x,y,w,6)})
 end
end
local function troopStatsOverview()
 local stat=(S.unitStats and S.unitStats[S.selected]) or {}
 nineSlice("troop_stats_panel","texture://ui_control-quiet-v3",14,86,38,6)
 text("troop_stats_title","部隊屬性",15,87,7.5,2.5)
 local entries={{"icon-attack",floor((stat.damage or 0)+.5)},{"icon-life",floor((stat.life or 0)+.5)},{"icon-speed",floor((stat.speed or 0)+.5)},{"icon-crit",floor((stat.crit or 0)*100+.5).."%"},{"icon-pierce",stat.pierce or 0}}
 for i,e in ipairs(entries)do
  local x=23+(i-1)*5.6
  img("troop_stat_icon_"..i,"texture://ui_"..e[1],x,87.15,1.6,2.3)
  text("troop_stat_value_"..i,tostring(e[2]),x+1.8,87.25,3.2,2.2)
 end
end
 local function footer()
  if S.phase=="shop" then
   button("ready","部隊配置","LeaveShop",65,88,13,7,S.enchantPending==nil)
   button("quick_deploy","直接出戰","QuickDeploy",80,88,13,7,S.enchantPending==nil)
 elseif S.phase=="loadout" then
   closeButton("loadout_return","ReturnFromLoadout")
   if S.loadoutReturn=="shop" then button("deploy","整備完成 · 出戰","Deploy",70,88,23,7)end
 elseif S.phase=="menu" and formalRoute=="town" then
   closeButton("town_back","UI_home");button("launch_expedition","出發遠征","LaunchExpedition",71,88,22,7)
 elseif S.phase=="map" then
   closeButton("back","ReturnFromMap")
  else closeButton("back","UI_home")end
 end
 if S.phase=="map" then
  panel("森林王冠之路")
  hidden.screen_gold=true;hidden.screen_crystals=true;hidden.screen_gold_plate=true;hidden.screen_crystals_plate=true
  local bx,by,bw,bh=7,22,61,61*1.6/(1672/941)
  img("map_back","texture://ui_forest-map-v2",bx,by,bw,bh)
  for i=1,7 do
   local done=i<S.round or (i==S.round and not S.mapMoving)
   img("map_link_"..i,"texture://ui_map-link-"..i..(done and "-done" or "-future"),bx,by,bw,bh)
  end
  for i=1,7 do
   local p=expeditionPoints[i+1];local x=bx+p[1]*bw/100;local y=by+p[2]*bh/100
   if i==S.round then img("map_current_ring","texture://ui_map-current-ring",x-2.6,y-4.16,5.2,8.32)end
   img("map_node_"..i,"texture://ui_map-waypoint-v2",x-1.8,y-2.88,3.6,5.76)
   text("map_number_"..i,i,x-1.7,y-2,3.4,4)
  end
  if S.mapMoving then
   local from=expeditionPoints[S.mapFrom+1];local target=expeditionPoints[S.round+1]
   local t=min(1,max(0,S.mapElapsed/S.mapDuration));local u=1-t;local mid=(from[1]+target[1])/2
   local x=u*u*u*from[1]+3*u*u*t*mid+3*u*t*t*mid+t*t*t*target[1]
   local y=from[2]+(target[2]-from[2])*t*t*(3-2*t)
   img("map_cursor_icon","texture://ui_crest",bx+x*bw/100-1,by+y*bh/100-1.6,2,3.2)
  end
  img("map_lord","texture://ui_portrait-lord-v2",76,24,12,18)
  text("map_stage","第 "..S.round.." / 7 站",77,9,16,5)
  text("map_current_title",chapters[S.round],71,46,22,5)
  text("map_plan",S.mapMoving and "正在前往營地\n抵達後自動展開景點" or "已抵達營地\n選一處景點，為戰鬥整備",71,57,22,9)
  text("map_next",S.round<7 and "下一站 · "..chapters[S.round+1] or "最終站 · 奪回森林王座",71,74,22,7)
  text("map_progress","實線：已行經　點線：待前往",8,88,59,6)
  button("visit_location",S.mapMoving and "行軍中…" or "選擇景點","VisitLocation",71,88,22,6,not S.mapMoving,S.mapMoving and "shop-button-secondary-v2" or "shop-button-primary-v2")
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
   button(id,label,action,x,y,w,h,true,active and "shop-button-primary-v2" or "shop-button-secondary-v2")
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
  text("coins",floor(S.coins),38.5,94.7,12.5,3.2)
  img("crystals_plate","texture://ui_hud-crystal",54,94,15,4.8)
  img("crystals_icon","texture://ui_symbol-crystal",55.2,94.8,2,3)
  text("crystals",S.crystals,57.5,94.7,10,3.2)
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
   closeButton("guide_back","UI_home")
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
  img("crest","texture://ui_crest",18,12,16,20)
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
    nineSlice("profile_card_"..i,"texture://ui_shop-card-rare-v2",x,27,26,43)
    text("profile_slot_"..i,"札記 "..i,x+2,29,22,4)
    text("profile_name_"..i,ready and p.name or "尚未建立",x+2,36,22,5)
    local detail=ready and ("建材 "..p.materials.."\n遠征 "..p.runs.." 次 · 最遠 "..p.bestRound.." 站") or "沒有遠征紀錄\n建立後從第一站開始"
    text("profile_detail_"..i,detail,x+2,44,22,8)
    if ready then
     button("profile_load_"..i,"進入領地","Profile"..i,x+2,55,12,6,true,"shop-button-primary-v2")
     button("profile_delete_"..i,"刪除","DeleteProfile"..i,x+15,55,11,6)
    else
     button("profile_create_"..i,"建立新檔","Profile"..i,x+2,55,24,6)
    end
   end
  end
  closeButton("profiles_back","UI_home")
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
  closeButton("settings_back","UI_home")
 elseif S.phase=="choice" then
  panel(chapters[S.round].." · 選擇景點")
  button("view_map","查看地圖","ViewMap",77,17,16,6)
  button("choice_loadout","部隊配置","OpenLoadout",7,88,23,7)
  text("choice_hint","隨機景點 · 選一處拜訪",7,20,68,4)
  text("choice_quote",chapterLines[S.round],15,24,70,5)
  for i,c in ipairs(S.cards :: {any})do
   local x=12+(i-1)*27;local y=27
   nineSlice("choice_plate_"..i,"texture://ui_shop-card-rare-v2",x,y,24,59)
   img("choice_icon_"..i,"texture://ui_"..(placePortraits[c.id] or "quartermaster-v1"),x+3,y+8,18,24)
   text("choice_name_"..i,c.name,x+3,y+32,18,4)
   text("choice_desc_"..i,c.desc:gsub("；每支派兵 %+(%d+)","；標準加價 +%1（整筆半價）"),x+3,y+38,18,8)
   text("choice_action_"..i,"拜訪此處",x+3,y+46.5,18,4)
   table.insert(nodes,{kind="button",id="choice_"..i,text="",action="Choice"..i,rect=rect(x,y,24,59)})
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
  if elapsed>=1.2 then closeButton("defeat_town","ReturnTown") end
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
  else closeButton("result_home","ReturnTown")end
 else
  if formalRoute=="town" then img("town_scene","texture://ui_shop-backdrop",0,0,100,100)end
  panel(S.phase=="loadout" and "部隊裝備" or formalRoute=="town" and "領地建設" or ({market="裝備店",rune="符文店",potion="藥水工坊",tech="軍團研究",enchant="附魔鐵砧",curse="荊棘契約"})[S.location] or "領地與軍備")
  if formalRoute~="town" then tabs()end;footer()
 if formalRoute=="town" then
   hidden.screen_gold=true;hidden.screen_crystals=true;hidden.screen_gold_plate=true;hidden.screen_crystals_plate=true
   img("town_lord","texture://ui_portrait-lord-v2",8,53,26,29)
   text("town_heading","領地研究",37,18,56,4)
   text("town_subheading","選擇研究，查看效果、前置條件與花費",37,23,56,3)
   img("town_material_icon","texture://ui_symbol-material",37,30,3,4)
   text("town_gold","建材 "..town.materials,41,31,24,4)
   text("town_record","遠征 "..town.runs.." 次 · 最遠到第 "..town.bestRound.." 站",65,31,28,4)
   -- Eight equal research targets; effects and prerequisites live in the modal.
   for i,def in ipairs(townNodeDefs)do
    local nodeLevel=townUpgradeLevel(i);local unlocked=townNodePrereqsMet(i);local maxed=nodeLevel>=def.max
    local action=i<=4 and "Town"..i or "TownNode"..i
    local price=townUpgradePrice(i)
    local row=floor((i-1)/2);local col=(i-1)%2;local bx=37+col*29;local by=38+row*11
    nineSlice("town_"..i.."_plate","texture://ui_control-quiet-v3",bx,by,27,10)
    img("town_icon_"..i,"texture://ui_"..((maxed or unlocked) and def.icon or "icon-lock"),bx+1,by+1,3,4)
    text("town_name_"..i,def.name.." "..nodeLevel.."/"..def.max,bx+4,by+1,16,4)
    text("town_effect_"..i,({"爆擊率、碰撞傷害提升","旋轉半徑、傷害提升","壽命、移速提升","反彈蓄勢與傷害提升","穿透後終結傷害提升","命中追加鏈式範圍傷害","穿透與速度轉傷害提升","死亡時強化一名隊友"})[i],bx+1,by+5,25,4)
    img("town_cost_icon_"..i,"texture://ui_symbol-material",bx+20,by+1,2,4)
    text("town_cost_"..i,maxed and "完成" or price,bx+22,by+1,4,4)
    table.insert(nodes,{kind="button",id="town_"..i,text="",action=action,rect=rect(bx,by,27,10)})
   end
   if S.townUpgradePending then
    local i=S.townUpgradeIndex or 0;local def=townNodeDefs[i];local level=townUpgradeLevel(i);local price=townUpgradePrice(i);local affordable=price~=nil and town.materials>=price;local unlocked=townNodePrereqsMet(i);local maxed=def and level>=def.max
    img("town_upgrade_shade","texture://ui_scene-shade",0,0,100,100)
    table.insert(nodes,{kind="button",id="town_upgrade_scrim",text="",action="TownUpgradeCancel",rect=rect(0,0,100,100)})
    img("town_upgrade_modal","texture://ui_panel",22,21,56,59)
    text("town_upgrade_kicker","研究詳情",29,27,42,3)
    text("town_upgrade_title",def and def.name or "領地節點",29,32,42,6)
    text("town_upgrade_level",maxed and "Lv."..level.." · 已完成" or "Lv."..level.."  →  Lv."..(level+1),29,40,42,5)
    text("town_upgrade_desc",def and def.desc or "升級領地節點",29,47,42,6)
    text("town_upgrade_cost",price and ("建材 "..price.."　·　持有 "..town.materials) or "此節點已達最高等級",29,56,42,5)
    text("town_upgrade_note",maxed and "此節點已達最高等級。" or (not unlocked and townRequirementText(i) or (affordable and "確認後立即記入目前領地。" or "建材不足，先完成遠征取得建材。")),29,63,42,5)
    button("town_upgrade_confirm", "確認升級", "TownUpgradeConfirm",28,71,20,7,affordable and unlocked and not maxed)
    button("town_upgrade_cancel", "先不升級", "TownUpgradeCancel",52,71,20,7,true)
   end
  elseif formalRoute=="gear" then
   -- The loadout board is the stable task surface; the inventory is a
   -- closable drawer so choosing a slot never changes the page context.
   img("loadout_board","texture://ui_loadout-board-v2",14,31,38,54)
   loadoutUnitButtons(25.5,14,11.2,1,"roster_unit")
   text("troop_quote","本次派兵\n"..costs(S.selected).." 金",15,33,9,7)
   text("loadout_board_title",unitNames[S.selected].." · 裝備配置",26,33,16,3.5)
   -- Match the reference composition: three body slots on the left and two on the right.
   local slotPositions={{17,37},{17,51},{17,65},{45,43},{45,61}}
   for i,n in ipairs(slotNames)do
    local item=itemById(S.worn[S.selected][i]);local p=slotPositions[i];local x,y=p[1],p[2]
    img("slot_frame_"..i,"texture://ui_loadout-slot-square-v1",x,y,4.5,8)
    img("slot_part_"..i,"texture://ui_"..slotIcons[i],x+1,y+2,2.5,3.5)
    if item then img("worn_icon_"..i,"texture://ui_gear-"..item.skill,x+.55,y+1.8,3.4,4.4)end
    local shortName=item and truncate(item.name,5) or ""
    table.insert(nodes,{kind="button",id="slot_"..i,text=shortName,action="Slot"..i,rect=rect(x,y+6.2,4.5,2.2)})
    table.insert(nodes,{kind="button",id="slot_hit_"..i,text="",action="Slot"..i,rect=rect(x,y,4.5,8)})
   end
   local activeItem=itemById(S.worn[S.selected][S.equipSlot])
   if activeItem then button("unequip","卸下此裝備","Unequip",48,80.5,16,4.5,true)end
   troopStatsOverview()
   if formalDrawerOpen then
    nineSlice("drawer_frame","texture://ui_shop-window-panel-v2",54,19,42,61)
    text("drawer_heading","選擇裝備",57,22,26,4)
    text("drawer_subheading",slotNames[S.equipSlot].." > 可穿戴裝備",57,27,28,3)
    closeButton("drawer_close","CloseDrawer",89,22)
    local matching={};for i,item in ipairs(S.items)do if item.slot==S.equipSlot then table.insert(matching,i)end end
    local maxScroll=max(0,#matching-6);formalScroll=min(formalScroll,maxScroll)
    -- Keep the three-column inventory inside the drawer's authored content
    -- bounds. The old 12.1-unit step put the last 11.5-unit tile at 92.7,
    -- past the inner right edge (91.5) and underneath the frame ornament.
    local tileW=10.8;local tileStep=11.4
    for j=1,6 do
     local index=matching[formalScroll+j];local item=index and S.items[index];local x=57+((j-1)%3)*tileStep;local y=32+floor((j-1)/3)*15
     nineSlice("pack_tile_"..j,"texture://ui_control-quiet-v3",x,y,tileW,13.8,.2)
     if item then
      img("gear_icon_"..j,"texture://ui_gear-"..item.skill,x+1,y+1,3.2,4)
      local holder=nil;for k,worn in ipairs(S.worn)do if worn[item.slot]==item.id then holder=k end end
      local wearing=holder==S.selected
      -- The tile wraps to two lines now, so the holder disclosure is not cut.
      text("gear_name_"..j,(holder and not wearing and unitNames[holder].."持有 · " or "")..item.name,x+4.6,y+1,6.1,2.8)
      text("gear_summary_"..j,skillSummary(item.skill),x+1,y+5.2,9.5,2.6)
      text("gear_cost_"..j,"派兵 "..costs(S.selected,item).."金",x+1,y+8,9.5,1.5)
      table.insert(nodes,{kind="button",id="inspect_"..j,text="",action="GearDetail"..index,rect=rect(x,y,tileW,9.5)})
      compactButton("equip_"..j,wearing and "已裝" or "穿上","Equip"..index,x+5.5,y+9.6,4.5,4.2,not wearing)
     end
    end
    if maxScroll>0 then
     img("gear_scroll_track","texture://ui_loadout-scroll-track-v1",93.2,35,1.7,37)
     local thumbY=35+(formalScroll/maxScroll)*27
     img("gear_scroll_thumb","texture://ui_loadout-scroll-thumb-v1",92.8,thumbY,2.5,9)
     button("gear_scroll_up","▲","LoadoutScrollUp",93,30.5,3,4.5,formalScroll>0)
     button("gear_scroll_down","▼","LoadoutScrollDown",93,69.5,3,4.5,formalScroll<maxScroll)
    end
   else
    text("drawer_hint","點擊左側部位\n開啟裝備列表",60,38,27,8)
    button("drawer_open","選擇裝備","OpenDrawer",61,51,24,6,true,"shop-button-secondary-v2")
   end
  elseif formalRoute=="runes" then
   img("loadout_board","texture://ui_loadout-board-v2",14,31,38,54)
   loadoutUnitButtons(25.5,14,11.2,1,"unit")
   text("troop_quote","本次派兵\n"..costs(S.selected).." 金",15,33,9,7)
   text("rune_heading","可用符文",56,21,39,4)
   text("rune_hint","選一枚符文裝入目前部隊",56,26,39,3)
   local equippedRuneIndex=S.runes[S.selected];local equippedRune=equippedRuneIndex>0 and runeDefinitions[equippedRuneIndex] or nil
   img("rune_loadout_slot","texture://ui_loadout-slot-empty-v1",16,75,24,9)
   img("rune_loadout_icon","texture://ui_"..(equippedRune and "skill-"..equippedRune.icon or "icon-lock"),18,76,5,5)
   text("rune_loadout_name",equippedRune and equippedRune.name or "",25,76,14,3.5)
   text("rune_loadout_state",equippedRune and "目前已裝符文" or "",25,80,14,3)
   local runeMaxScroll=max(0,#runeDefinitions-4);formalScroll=min(formalScroll,runeMaxScroll)
    for j=1,4 do local i=formalScroll+j;local def=runeDefinitions[i]
    if def then
     local donor=runeHolder(i,S.selected);local active=S.runes[S.selected]==i
     local x=57+((j-1)%2)*19;local y=32+floor((j-1)/2)*20.5
     img("rune_tile_"..j,"texture://ui_loadout-item-tile-v2",x,y,18,18.5)
     img("rune_icon_"..j,"texture://ui_skill-"..def.icon,x+1,y+1,4.5,4.5)
     text("rune_name_"..j,def.name,x+6,y+1,11,3.5)
     text("rune_desc_"..j,def.effect,x+1,y+6,16,3)
     text("rune_owned_"..j,"背包 "..(S.runeBag[i] or 0).." 枚"..(donor and " · "..unitNames[donor].."已裝入" or ""),x+1,y+9,16,2)
     button("rune_"..j,active and "已裝入" or S.runeBag[i]>0 and "裝入" or donor and "轉交" or "尚未持有","Rune"..i,x+1,y+12,16,4.2,not active and ((S.runeBag[i] or 0)>0 or donor~=nil))
    end
   end
   text("rune_help","抬賞／細收只改開獎後的獎級分配；總開獎率、特獎不變。",56,75,39,3)
   button("rune_off","卸下符文","RuneOff",56,81,18,5,S.runes[S.selected]~=0)
   if runeMaxScroll>0 then
    img("rune_scroll_track","texture://ui_loadout-scroll-track-v1",93.2,35,1.7,37)
    local thumbY=35+(formalScroll/runeMaxScroll)*27
    img("rune_scroll_thumb","texture://ui_loadout-scroll-thumb-v1",92.8,thumbY,2.5,9)
    button("rune_scroll_up","▲","LoadoutScrollUp",93,30.5,3,4.5,formalScroll>0)
    button("rune_scroll_down","▼","LoadoutScrollDown",93,69.5,3,4.5,formalScroll<runeMaxScroll)
   end
   troopStatsOverview()
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
    -- The offer state owns the action row; no disabled plate may stay beneath it.
    if S.enchantPending==nil then button("enchant_roll","試附魔","Enchant",47,71,30,8,item~=nil and S.enchantUses<2)end
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
     for j=1,4 do
      local index=j;local item=S.stock[index];local x=28+(j-1)*15.75;local kind=item and rarity(item) or "rare";local y=29
      -- One card template and one rail grid; the host animates each whole card.
      nineSlice("stock_panel_"..j,"texture://ui_shop-card-"..kind.."-v2",x,y,14.75,51)
      if item then
       img("stock_icon_"..j,"texture://ui_gear-"..item.skill,x+3.25,y+8.5,8.25,12)
       text("stock_name_"..j,item.name,x+2,y+21,10.75,4)
       text("stock_desc_"..j,skillSummary(item.skill),x+2,y+26,10.75,8)
       img("stock_cost_icon_"..j,"texture://ui_icon-crystal",x+2,y+36.5,2,3.5)
       text("stock_cost_"..j,item.price,x+4.2,y+35,2.8,6.5)
       text("stock_deploy_"..j,"派兵費\n+"..(item.deployExtra or 0),x+7.75,y+35,5,6.5)
       text("stock_detail_"..j,item.sold and "已取得" or "查看詳情",x+1.75,y+42,11.25,5.5)
       -- One action across the entire card; added after its decorative nodes.
       table.insert(nodes,{kind="button",id="stock_hit_"..j,text="",action="ShopDetail"..index,rect=rect(x,y,14.75,51)})
      else
       text("stock_empty_"..j,"本頁沒有其他裝備",x+1,y+21,14,5)
      end
     end
     if formalShopDetail==0 then
      local notice=(formalReceipt~="" and frame<formalReceiptUntil) and formalReceipt or S.message
      text("stock_hint",notice~="" and notice or "買入後至配裝穿戴",10,84,40,5.5)
      local refreshCost=S.refreshCost or 2
      local refreshEnabled=S.crystals>=refreshCost
      button("refresh","","RefreshShop",52,84,16,5.5,refreshEnabled,"shop-button-secondary-v2")
      img("refresh_icon","texture://ui_icon-refresh",55.1,84.375,2.5,4.75)
      img("refresh_currency_icon","texture://ui_icon-crystal",58.4,84.375,2,4.75)
      text("refresh_cost",refreshCost,61,84.375,3.7,4.75)
      -- Decorative images must not swallow clicks on the same native action.
      if refreshEnabled then table.insert(nodes,{kind="button",id="refresh_content_hit",text="",action="RefreshShop",rect=rect(52,84,16,5.5)})end
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
       closeButton("shop_detail_close","ShopDetailClose",71,16)
       img("shop_detail_icon","texture://ui_gear-"..item.skill,28,28,10,16)
       text("shop_detail_story",slotNames[item.slot].."部位裝備 · 買入後至部隊配置穿戴",40,35,29,8)
       img("shop_detail_price_icon","texture://ui_icon-crystal",32,46,3,4)
       text("shop_detail_price",item.price,36,46,6,4)
       text("shop_detail_deploy","派兵費 +"..(item.deployExtra or 0),51,46,20,4)
       text("shop_detail_trigger","技能條件與效果",28,53,44,4)
       text("shop_detail_effect",detailEffect,28,59,44,10)
       local allowed=not item.sold and canStoreItem() and S.crystals>=item.price
       button("shop_detail_buy",item.sold and "已取得" or (S.crystals<item.price and "結晶不足" or "買入"),"Buy"..formalShopDetail,28,73,21,5.5,allowed,"shop-button-primary-v2")
      end
     end
    else
     for j=1,2 do
      local index=(formalPage-1)*2+j;local item=S.stock[index];local x=37+(j-1)*29;local y=29
      img("stock_panel_"..j,"texture://ui_card",x,y,27,51)
      if item then
       local icon="building-alchemy";local desc=""
       if item.kind=="gear" then icon="gear-"..item.skill;desc=skillDetail(item.skill).."\n"..slotNames[item.slot].."槽 · 部隊配置後穿戴"
       elseif item.kind=="rune" then local def=runeDefinitions[item.value];icon="skill-"..def.icon;desc=def.effect
       elseif item.kind=="tech" then local entry=S.skillBook[item.value];icon="skill-"..item.value;desc=(entry and skillDetail(item.value) or "隨機兵種能力").."\n指定部隊："..unitNames[item.unit]
       elseif item.kind=="potion" then icon=({"icon-potion-haste","icon-potion-life","icon-potion-recall"})[item.value] or "building-alchemy";desc=({"全軍移速提高 8 秒。","目前部隊壽命延長 1.5 秒。","召回目前倖存部隊並返還實付金幣。"})[item.value]
       elseif item.kind=="curse" then icon="icon-curse-debt";desc=curseDetails[item.value]end
       img("stock_icon_"..j,"texture://ui_"..icon,x+1,y+2,7,9)
       local displayName=item.kind=="tech" and S.skillBook[item.value] and S.skillBook[item.value].name or item.name
       text("stock_name_"..j,displayName,x+8.5,y+2,17.5,6)
       text("stock_desc_"..j,item.kind=="tech" and (unitNames[item.unit].."："..skillSummary(item.value)) or desc,x+1.5,y+13,24,17)
       local funds=item.currency=="crystal" and S.crystals or S.coins
       img("stock_cost_icon_"..j,"texture://ui_"..(item.currency=="crystal" and "icon-crystal" or "icon-coin"),x+8,y+33,3,4)
       text("stock_cost_"..j,item.price,x+12,y+33,8,4)
       local allowed=not item.sold and funds>=item.price and (item.kind~="gear" or #S.items<24) and (item.kind~="rune" or runeCopies(item.value)<3) and (item.kind~="potion" or #S.potions<2) and (item.kind~="tech" or not S.researchUsed)
       button("buy_"..j,item.sold and "已取得 · 詳情" or "查看詳情","ShopDetail"..index,x+2,y+40,23,7,true)
       if index==formalShopDetail then supplyDetail={item=item,name=displayName,index=index,description=desc,icon=icon,allowed=allowed}end
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
    local notice=(formalReceipt~="" and frame<formalReceiptUntil) and formalReceipt or S.message
    if notice~="" then for _,node in ipairs(nodes)do if node.id=="shopkeeper_line" then node.text=wrap(notice,13)end end end
   end
  end
 end
 if supplyDetail then
  local item=supplyDetail.item
  img("shop_detail_shade","texture://ui_scene-shade",0,0,100,100)
  table.insert(nodes,{kind="button",id="shop_modal_scrim",text="",action="ShopDetailClose",rect=rect(0,0,100,100)})
  nineSlice("shop_detail_modal","texture://ui_shop-window-panel-v2",18,12,64,76)
  img("shop_detail_icon","texture://ui_"..supplyDetail.icon,25,22,12,18)
  text("shop_detail_title",supplyDetail.name,40,22,34,5)
  img("shop_detail_price_icon","texture://ui_"..(item.currency=="crystal" and "icon-crystal" or "icon-coin"),46,32,3,4)
  text("shop_detail_price",item.price,50,32,10,4)
  text("shop_detail_effect",supplyDetail.description,25,45,50,23)
  button("shop_detail_buy",item.sold and "已取得" or supplyDetail.allowed and "確認買入" or "目前無法購買","Buy"..supplyDetail.index,26,74,23,7,supplyDetail.allowed)
  closeButton("shop_detail_close","ShopDetailClose",71,16)
 end
 if formalGearDetail>0 and S.phase=="loadout" then
  local item=S.items[formalGearDetail]
  if item then
   -- The covered controls are presentation-only while the dialog is open.
   -- Omit their empty hit bands to stay inside the engine's 256-node budget.
   local backdrop={}
   for _,node in ipairs(nodes)do
    if not string.find(node.id,"slot_frame_") and (node.kind~="button" or node.text~="") then
     if node.kind=="button" then node.kind="text";node.action=nil end
     table.insert(backdrop,node)
    end
   end
   nodes=backdrop
   img("gear_detail_shade","texture://ui_scene-shade",0,0,100,100)
   nineSlice("gear_detail_modal","texture://ui_shop-window-panel-v2",18,12,64,76)
   img("gear_detail_icon","texture://ui_gear-"..item.skill,25,24,12,20)
   text("gear_detail_title",item.name,40,24,34,5)
   local holder=nil;for k,worn in ipairs(S.worn)do if worn[item.slot]==item.id then holder=k end end
   text("gear_detail_quote",(holder and unitNames[holder].."穿戴中" or "存放在行囊").."\n穿戴後派兵費 "..costs(S.selected,item).." 金幣",40,33,34,5)
   text("gear_detail_effect",skillDetail(item.skill)..(item.enchant and "\n附魔："..skillDetail(item.enchant) or ""),25,47,50,19)
   button("gear_detail_equip",holder and holder~=S.selected and "轉交此裝備" or "穿戴此裝備","Equip"..formalGearDetail,26,74,23,7,S.worn[S.selected][item.slot]~=item.id)
   closeButton("gear_detail_close","GearDetailClose",71,16)
  end
 end
 if S.phase=="battle" and S.autoConfigOpen then
  hidden.screen_gold=true;hidden.screen_crystals=true;hidden.screen_gold_plate=true;hidden.screen_crystals_plate=true
  -- Compact centered sheet keeps the battlefield visible on a wide viewport.
  for _,n in ipairs(nodes)do local q=n.rect;n.rect={x=13+q.x*.74,y=6+q.y*.86,width=q.width*.74,height=q.height*.86}end
 elseif S.paused and S.phase=="battle" then
  hidden.screen_gold=true;hidden.screen_crystals=true;hidden.screen_gold_plate=true;hidden.screen_crystals_plate=true
 end
 if hidden.screen_gold then hidden.screen_gold_icon=true;hidden.screen_gold_plate=true;hidden.screen_crystals_icon=true;hidden.screen_crystals_plate=true end
 local visible:{any}={};for _,n in ipairs(nodes)do if not hidden[n.id] and not hidden[string.gsub(n.id,"_hit_[a-z]+$","")] then table.insert(visible,n)end end;nodes=visible
 S.uiRoute=formalRoute;S.uiPage=formalPage
 api.ui.setRoot({kind="screen",id="forest_lord",node=S.phase..":"..(S.autoConfigOpen and "auto" or formalRoute),children=nodes})
end
