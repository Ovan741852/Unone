-- Game-owned art direction resolved by the official shared responsive package.
-- Retained models own all breakpoint selection and region arithmetic.
type VoidwakeUiValues = {
 compact:boolean,showComms:boolean,showVessel:boolean,showRoute:boolean,showTouch:boolean,
 titleSize:number,modalTitleSize:number,bodySize:number,buttonSize:number,statSize:number,
 footerSize:number,choiceNameSize:number,choiceBodySize:number,
 showcaseX:number,showcaseY:number,showcaseScale:number,
}
type VoidwakeUiModels = {[string]:UiResponsiveLayout<VoidwakeUiValues>}
local uiModels:VoidwakeUiModels?=nil
local abandonPrompt=false
local function slot(id:string,size:number?):UiLayoutNode return {id=id,kind="slot",size=size} end
local function uiValues(name:string):VoidwakeUiValues
 if name=="portrait" then return {
  compact=true,showComms=false,showVessel=false,showRoute=false,showTouch=true,
  titleSize=4.1,modalTitleSize=3,bodySize=1.4,buttonSize=1.4,statSize=.95,footerSize=.7,
  choiceNameSize=1.85,choiceBodySize=1.2,showcaseX=0,showcaseY=-65,showcaseScale=2.4,
 } elseif name=="intermediate" then return {
  compact=false,showComms=true,showVessel=true,showRoute=true,showTouch=false,
  titleSize=4.1,modalTitleSize=3.6,bodySize=1.3,buttonSize=1.2,statSize=.95,footerSize=.75,
  choiceNameSize=1.8,choiceBodySize=1.05,showcaseX=280,showcaseY=-50,showcaseScale=5.4,
 } end
 return {
  compact=false,showComms=true,showVessel=true,showRoute=true,showTouch=false,
  titleSize=5.7,modalTitleSize=4.3,bodySize=1.4,buttonSize=1.25,statSize=1.1,footerSize=.75,
  choiceNameSize=2.1,choiceBodySize=1.15,showcaseX=330,showcaseY=-50,showcaseScale=6.4,
 }
end
local function frameTree(p:boolean):UiLayoutNode
 local header:{UiLayoutNode}=p and {slot("brand",62),slot("header_air"),slot("sound",23)} or
  {slot("brand",22),slot("header_air"),slot("comms",37),slot("sound",9)}
 return {id="frame",kind="column",padding={left=3.1,right=3.1,top=2.8,bottom=1.5},children={
  {id="header",kind="row",size=4.8,gap=2,children=header},slot("header_gap",2.4),slot("header_rule",.08),
  slot("world_region"),slot("footer_rule",.08),slot("footer_gap",1.2),
  {id="footer_row",kind="row",size=2,gap=1,children={slot("footer",p and 62 or 55),slot("engine_mark")}},
 }}
end
local function introTree(p:boolean):UiLayoutNode
 if p then return {id="introduction",kind="column",children={
  slot("eyebrow",2.5),slot("intro_eyebrow_gap",1),slot("menu_title",6.5),slot("intro_title_gap",.1),slot("menu_title_accent",6.5),
  slot("intro_art_gap",.5),slot("menu_showcase"),slot("menu_story",7),slot("intro_rule_gap",1),slot("mission_rule",.08),
  slot("intro_mission_gap",1.5),slot("mission",2.8),slot("mission_meta",2.3),slot("intro_end_gap",1),slot("mission_end",.08),
  slot("intro_launch_gap",2),slot("launch",7),slot("menu_controls",2.5),
 }} end
 return {id="introduction",kind="column",children={
  slot("intro_top",1),slot("eyebrow",2.5),slot("intro_eyebrow_gap",2.5),
  slot("menu_title",8),slot("intro_title_gap",.5),slot("menu_title_accent",8),
  slot("intro_story_gap",2.9),slot("menu_story",10),slot("intro_rule_gap",2.72),
  slot("mission_rule",.08),slot("intro_mission_gap",4),slot("mission",3),
  slot("intro_meta_gap",1.3),slot("mission_meta",2.5),slot("intro_end_gap",2.52),
  slot("mission_end",.08),slot("intro_launch_gap",2.2),slot("launch",8.4),
  slot("intro_controls_gap",1.6),slot("menu_controls",2.7),
 }}
end
local function menuTree(p:boolean,m:boolean):UiLayoutNode
 local intro=introTree(p)
 if p then return {id="menu",kind="column",padding={left=6.25,right=6.25,top=16,bottom=17.5},children={intro}} end
 intro.size=m and 43 or 34.7
 return {id="menu",kind="row",padding={left=6.25,right=4,top=16,bottom=13},children={
  intro,slot("menu_art_air"),{id="vessel_card",kind="column",size=m and 26 or 22,children={
   slot("vessel_air"),slot("ship_tag",2),slot("vessel_tag_gap",1.5),slot("ship_name",5),
   slot("vessel_name_gap",1),slot("ship_class",2.5),slot("vessel_rule_gap",2.92),
   slot("ship_rule",.08),slot("vessel_serial_gap",2),slot("ship_serial",2),
  }},
 }}
end
local function telemetryTree(p:boolean):UiLayoutNode
 local left:UiLayoutNode={id="mission_telemetry",kind="column",children={
  slot("sector",3),slot("telemetry_clock_gap",1.5),slot("clock",3),slot("telemetry_objective_gap",.5),slot("objective",2.5),slot("telemetry_air")}}
 if p then return {id="telemetry",kind="row",padding={left=4,right=4,top=13,bottom=73},gap=2,children={
  left,{id="flight_commands",kind="column",size=24,children={slot("command_air"),slot("pause",5)}},
 }} end
 left.size=31
 return {id="telemetry",kind="row",padding={left=4,right=4,top=13,bottom=73},children={
  left,slot("telemetry_space"),{id="navigation",kind="column",size=29,children={slot("route",3),slot("route_gap",1),slot("salvage",2.5),slot("navigation_air")}},
  {id="flight_commands",kind="column",size=10,children={slot("command_air"),slot("pause",5)}},
 }}
end
local function instrumentsTree(p:boolean):UiLayoutNode
 local stats:UiLayoutNode={id="vessel_stats",kind="column",size=p and 41 or 25,children={
  slot("vessel",2.4),slot("vessel_bar_gap",.6),slot("hull",3),slot("hull_shield_gap",.5),slot("shield",3),slot("shield_xp_gap",.5),slot("xp",2.3)}}
 local weapons:{UiLayoutNode}
 if p then
  local buttons:UiLayoutNode={id="weapon_buttons",kind="row",size=4,gap=2,children={slot("burst"),slot("dash")}}
  weapons={slot("salvage",2.5),slot("salvage_auto_gap",1),slot("auto",4),slot("auto_pulse_gap",1),buttons,slot("weapon_air")}
 else
  local buttons:UiLayoutNode={id="weapon_buttons",kind="row",size=4.3,gap=.7,children={slot("auto"),slot("burst"),{id="dash",kind="slot",grow=1.2}}}
  weapons={slot("weapon_status",2),slot("weapon_label_gap",1),slot("weapon",3),slot("weapon_action_gap",1.3),buttons,slot("weapon_air")}
 end
 return {id="instruments",kind="row",padding={left=5,right=4,top=79.8,bottom=6.5},children={
  stats,slot("instrument_air"),{id="weapons",kind="column",size=p and 43 or 30,children=weapons}}}
end
local function pauseTree(p:boolean):UiLayoutNode
 return {id="pause_dialog",kind="column",padding={left=p and 8 or 31,right=p and 8 or 31,top=30,bottom=31},children={
  slot("paused_title",8),slot("paused_title_gap",4),slot("paused_copy",8),slot("paused_copy_gap",3),
  slot("primary_action",7),slot("paused_action_gap",2),slot("secondary_action",7)}}
end
local function resultTree(p:boolean):UiLayoutNode
 return {id="result_dialog",kind="column",padding={left=p and 8 or 28,right=p and 8 or 28,top=28,bottom=26},children={
  slot("result_title",7),slot("result_title_gap",4),slot("result_copy",5),slot("result_copy_gap",3),slot("result_stats",8),
  slot("result_action_gap",4),slot("restart",7),slot("result_button_gap",2),slot("return_menu",6)}}
end
local function upgradesTree(p:boolean):UiLayoutNode
 return {id="upgrade_dialog",kind="column",padding={left=p and 8 or 11,right=p and 8 or 11,top=19,bottom=p and 15 or 27},children={
  slot("upgrade_title",7),slot("upgrade_heading_gap",2),slot("upgrade_copy",3),slot("upgrade_cards_gap",p and 4.5 or 6),
  {id="choices",kind="grid",columns=p and 1 or 3,gap=p and 1.5 or 3,children={slot("choice_1"),slot("choice_2"),slot("choice_3")}}}}
end
local function cardTree(p:boolean):UiLayoutNode
 if p then return {id="card",kind="column",padding={left=2,right=2,top=.8,bottom=.9},children={
  slot("rarity",1.6),slot("card_rarity_gap",.5),slot("choice_name",3),slot("card_name_gap",.5),
  slot("choice_desc",4),slot("card_action_gap",.6),slot("select",3)}} end
 return {id="card",kind="column",padding={left=2,right=2,top=2.5,bottom=1.2},children={
  slot("rarity",2.5),slot("card_rarity_gap",3),slot("choice_name",4),slot("card_name_gap",6),
  slot("choice_desc",8),slot("card_action_gap",3.6),slot("select",5.2)}}
end
local function makeModel(ui:UiComponentKit,tree:(boolean,boolean)->UiLayoutNode):UiResponsiveLayout<VoidwakeUiValues>
 return ui.createResponsiveLayout({variants={
  {name="portrait",minAspect=0,layout=tree(true,false),values=uiValues("portrait")},
  {name="intermediate",minAspect=.85,layout=tree(false,true),values=uiValues("intermediate")},
  {name="desktop",minAspect=1.4,layout=tree(false,false),values=uiValues("desktop")},
 }})
end
local function ensureUiModels(ui:UiComponentKit):VoidwakeUiModels
 if uiModels then return uiModels end
 uiModels={
  frame=makeModel(ui,function(p,_m) return frameTree(p) end),menu=makeModel(ui,menuTree),
  telemetry=makeModel(ui,function(p,_m) return telemetryTree(p) end),instruments=makeModel(ui,function(p,_m) return instrumentsTree(p) end),
  pause=makeModel(ui,function(p,_m) return pauseTree(p) end),result=makeModel(ui,function(p,_m) return resultTree(p) end),
  upgrades=makeModel(ui,function(p,_m) return upgradesTree(p) end),card=makeModel(ui,function(p,_m) return cardTree(p) end),
  touch=makeModel(ui,function(_p,_m) return {id="touch",kind="grid",columns=3,gap=1,padding={left=1,right=67,top=61,bottom=28},
   children={slot("touch_air_left"),slot("up"),slot("touch_air_right"),slot("left"),slot("down"),slot("right")}} end),
  boss=makeModel(ui,function(p,_m) return {id="boss_region",kind="column",padding={left=p and 8 or 32,right=p and 8 or 32,top=29,bottom=63},children={
   {id="boss_plate",kind="column",children={slot("boss_name",2.5),slot("boss_gap",.5),slot("boss_health",2.4),slot("boss_air")}}}} end),
  stat=makeModel(ui,function(_p,_m) return {id="stat",kind="row",children={
   {id="label",kind="slot",grow=16},{id="label_track_gap",kind="slot",grow=3},
   {id="bar",kind="column",grow=51,children={slot("bar_top",1.3),slot("track",.35),slot("bar_bottom")}},
   {id="track_value_gap",kind="slot",grow=3},{id="value",kind="slot",grow=27}}} end),
 }
 return assert(uiModels)
end
-- Presentation uses this same pure selection for the authored menu showcase.
local function resolveVoidwakeUi(api:EngineApi):UiResponsiveLayoutResult<VoidwakeUiValues>
 return ensureUiModels(api.ui.components).frame.resolve(api.ui.getViewport())
end

local function updateUi(api:EngineApi)
 local ui:UiComponentKit=api.ui.components
 local models=ensureUiModels(ui)
 local viewport=api.ui.getViewport()
 local layout=resolveVoidwakeUi(api)
 local design=layout.values
 local nodes:{UiNode}={}
 local mint:UiColor={.74,.89,.84,1}
 local ivory:UiColor={.88,.93,.89,1}
 local muted:UiColor={.47,.62,.62,1}
 local edgeColor:UiColor={.57,.72,.68,.23}
 local function component(id:string,kind:string,bounds:UiRect,build:()->())
  local parent=nodes;nodes={};build();local children=nodes;nodes=parent
  table.insert(nodes,(ui.component({id=id,component=kind,rect=bounds,children=children})))
 end
 local function panel(name:string,bounds:UiRect)
  table.insert(nodes,(ui.panel({id=name,rect=bounds,style={background={.025,.065,.085,.72},border_color=edgeColor,border_width=.07,border_radius=.18}})))
 end
 local function rule(name:string,bounds:UiRect)
  table.insert(nodes,(ui.panel({id=name,rect=bounds,style={background=edgeColor}})))
 end
 local tokens:{[string]:UiStyle}={
  brand={font_family="Barlow Condensed",font_size=3.5,font_weight=700,letter_spacing=.38,color=ivory},
  comms={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=.8,letter_spacing=.18},
  eyebrow={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=design.compact and 1.1 or 1,letter_spacing=.25,color=mint},
  menu_title={font_size=design.titleSize,font_weight=700,letter_spacing=.15,color=ivory},
  menu_title_accent={font_size=design.titleSize,font_weight=700,letter_spacing=.15,color=mint},
  menu_story={font_size=design.bodySize,line_height=2,color={.58,.68,.67,1}},
  mission={font_size=1.45,font_weight=600,letter_spacing=.12,color=ivory},
  mission_meta={font_size=1,letter_spacing=.08},menu_controls={font_size=.85},
  ship_tag={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=.8,letter_spacing=.18,color=mint},
  ship_name={font_family="Barlow Condensed",font_size=3.7,font_weight=600,letter_spacing=.3,color=ivory},
  ship_class={font_size=1.05,letter_spacing=.12},
  vessel={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=1.05,letter_spacing=.12,color=ivory},
  sector={font_size=1.6,font_weight=600,color=ivory},
  clock={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=1.6,color=ivory},
  route={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=1.1,letter_spacing=.1,color=mint},
  salvage={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=design.compact and 1.05 or .9,letter_spacing=.08},
  paused_title={font_size=design.modalTitleSize,font_weight=600,color=ivory,text_align="center",letter_spacing=.3},
  paused_copy={font_size=1.3,text_align="center"},
  upgrade_title={font_size=design.modalTitleSize,font_weight=600,text_align="center",color=ivory,letter_spacing=.3},
  upgrade_copy={font_size=design.compact and 1.1 or 1.3,text_align="center"},
  result_title={font_size=design.modalTitleSize,font_weight=600,text_align="center",color=ivory,letter_spacing=.3},
  result_copy={font_size=design.compact and 1.2 or 1.3,text_align="center"},
  result_stats={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=design.compact and 1.25 or 1.6,text_align="center",color=mint},
  footer={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=design.footerSize,letter_spacing=.13},
  engine_mark={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=design.footerSize,letter_spacing=.13,text_align="end"},
 }
 local function text(name:string,value:string,bounds:UiRect)
  local style:UiStyle=ui.composeStyle({font_family="Noto Sans TC, Noto Sans TC Supplemental",font_size=1.1,font_weight=400,color=muted,
   text_align="start",vertical_align="middle",line_height=1.5,letter_spacing=0,overflow="clip"},tokens[name])
  -- @unone/ui 0.6 returns frozen styles: compose a new one instead of mutating.
  if string.sub(name,1,7)=="rarity_" then style=ui.composeStyle(style,{font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=.9,color=mint,letter_spacing=.18}) end
  if string.sub(name,1,12)=="choice_name_" then style=ui.composeStyle(style,{font_size=design.choiceNameSize,font_weight=600,color=ivory}) end
  if string.sub(name,1,12)=="choice_desc_" then style=ui.composeStyle(style,{font_size=design.choiceBodySize,line_height=design.compact and 1.6 or 1.8}) end
  table.insert(nodes,(ui.text({id=name,text=value,rect=bounds,style=style})))
 end
 local function button(name:string,label:string,action:string,bounds:UiRect)
  local primary=action=="Start" or action=="Resume" or action=="Restart"
  component(name.."_component","ActionButton",bounds,function()
   table.insert(nodes,(ui.button({id=name,text=label,action=action,rect=bounds,style={
    font_family="Noto Sans TC, Noto Sans TC Supplemental",font_size=primary and 1.55 or design.buttonSize,font_weight=primary and 600 or 400,
    color=primary and {.035,.12,.14,1} or mint,background=primary and mint or {.025,.085,.105,.40},
    border_color=primary and mint or edgeColor,border_width=.07,border_radius=.1,
    padding={left=1.4,right=1.4,top=.3,bottom=.3},text_align="start",vertical_align="middle",letter_spacing=primary and .18 or .04}})))
  end)
 end
 local function statBar(name:string,title:string,current:number,maximum:number,bounds:UiRect,color:UiColor)
  local bar=models.stat.resolve(viewport,{left=bounds.x,top=100-bounds.y-bounds.height,width=bounds.width,height=bounds.height})
  component(name.."_component","StatBar",bounds,function()
   text(name.."_label",title,bar.rect("label"))
   local track=bar.rect("track")
   table.insert(nodes,(ui.panel({id=name.."_track",rect=track,style={background={.4,.6,.6,.17}}})))
   if current>0 then
    local fill:UiRect={x=track.x,y=track.y,width=math.max(.01,track.width*clamp(current/math.max(1,maximum),0,1)),height=track.height}
    table.insert(nodes,(ui.panel({id=name.."_fill",rect=fill,style={background=color}})))
   end
   table.insert(nodes,(ui.text({id=name.."_value",text=math.ceil(current).." / "..maximum,rect=bar.rect("value"),style={
    font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=design.statSize,color=ivory,text_align="end"}})))
  end)
 end
 local function timer(t:number):string return string.format("%02d:%02d",math.floor(t/60),math.floor(t%60)) end
 local phase=S.phase
 if phase=="paused" or phase=="upgrade" or phase=="gameover" or phase=="victory" then
  table.insert(nodes,(ui.panel({id="modal_shade",rect={x=0,y=0,width=100,height=100},style={background={.015,.04,.06,.82}}})))
 end
 text("brand","VOIDWAKE",layout.rect("brand"))
 if design.showComms then text("comms","SYSTEM ONLINE   /   FLIGHT SYSTEMS",layout.rect("comms")) end
 button("sound",soundEnabled and "SND ON" or "SND OFF","Sound",layout.rect("sound"))
 rule("header_rule",layout.rect("header_rule"))
 if phase=="menu" then
  local menu=models.menu.resolve(viewport)
  component("opening_component","MissionIntroduction",menu.rect("introduction"),function()
   text("eyebrow","A DEEP SPACE ROGUELIKE",menu.rect("eyebrow"))
   text("menu_title","在黑暗之中，",menu.rect("menu_title"))
   text("menu_title_accent","留下你的餘燼。",menu.rect("menu_title_accent"))
   text("menu_story","訊號已消失。返航不在選項之中。\n駕駛最後一艘遊隼，穿越失落星區。\n每次躍遷，都是一場全新的遠征。",menu.rect("menu_story"))
   rule("mission_rule",menu.rect("mission_rule"));text("mission","穿越寂靜邊境",menu.rect("mission"))
   text("mission_meta","4 個星區   ·   隨機強化   ·   永久死亡",menu.rect("mission_meta"));rule("mission_end",menu.rect("mission_end"))
   button("launch","啟動遠征  ↗","Start",menu.rect("launch"))
   text("menu_controls",design.showTouch and "觸控方向鍵航行   ·   自動索敵射擊" or "WASD 航行   ·   滑鼠射擊   ·   SPACE 閃避",menu.rect("menu_controls"))
  end)
  if design.showVessel then component("ship_component","VesselCard",menu.rect("vessel_card"),function()
   text("ship_tag","YOUR VESSEL",menu.rect("ship_tag"));text("ship_name","PEREGRINE  MK. IV",menu.rect("ship_name"))
   text("ship_class","遊隼級 · 深空攔截機",menu.rect("ship_class"));rule("ship_rule",menu.rect("ship_rule"))
   text("ship_serial","REG. UN-0741  /  READY FOR DEPLOYMENT",menu.rect("ship_serial"))
  end) end
 elseif phase=="playing" then
  local telemetry=models.telemetry.resolve(viewport)
  local instruments=models.instruments.resolve(viewport)
  local sectors={"蒼白星環","回聲裂谷","失落之海","無聲王座"}
  text("sector",string.format("SECTOR %02d  /  %s",S.sector,sectors[math.min(4,S.sector)]),telemetry.rect("sector"))
  text("clock",timer(S.time).."   /   擊毀 "..string.format("%03d",S.kills),telemetry.rect("clock"))
  text("objective",S.sector==4 and "摧毀無聲君王" or ("躍遷窗口  "..math.max(0,math.ceil(SECTOR_DURATION-S.sectorTime)).."s"),telemetry.rect("objective"))
  if design.showRoute then text("route","01 ─── 02 ─── 03 ─── 04",telemetry.rect("route")) end
  text("salvage","SALVAGE  "..string.format("%04d",S.credits).."    /    LV. "..S.level,(design.compact and instruments or telemetry).rect("salvage"))
  button("pause","Ⅱ  暫停","Pause",telemetry.rect("pause"))
  text("vessel","PEREGRINE / MK. IV",instruments.rect("vessel"))
  statBar("hull","船體",S.player.hp,S.player.maxHp,instruments.rect("hull"),{.70,.82,.70,1})
  statBar("shield","護盾",S.player.shield,S.player.maxShield,instruments.rect("shield"),{.40,.73,.79,1})
  text("xp","經驗 "..S.xp.." / "..S.xpNext.." · LV. "..S.level,instruments.rect("xp"))
  if not design.compact then
   text("weapon_status",S.autoFire and "AUTO TARGETING ONLINE" or "MANUAL TARGETING",instruments.rect("weapon_status"))
   text("weapon","雙聯電磁炮  /  MK. "..S.level,instruments.rect("weapon"))
  end
  button("auto",S.autoFire and "F 自動 ON" or "F 自動 OFF","AutoFire",instruments.rect("auto"))
  local pulseLabel=design.compact and "脈衝" or "Q 脈衝"
  button("burst",S.burstCooldown>0 and (pulseLabel.." "..math.ceil(S.burstCooldown).."s") or pulseLabel,"Burst",instruments.rect("burst"))
  button("dash",S.dashCooldown>0 and ("閃避 "..string.format("%.1f",S.dashCooldown).."s") or (design.compact and "閃避" or "閃避 READY"),"Dash",instruments.rect("dash"))
  if design.showTouch then
   local touch=models.touch.resolve(viewport)
   button("up","↑","KeyW",touch.rect("up"));button("left","←","KeyA",touch.rect("left"))
   button("down","↓","KeyS",touch.rect("down"));button("right","→","KeyD",touch.rect("right"))
  end
  for _,enemy in ipairs(S.enemies) do if enemy.boss then
   local boss=models.boss.resolve(viewport)
   panel("boss_plate",boss.rect("boss_plate"));text("boss_name","無聲君王  /  THE SOVEREIGN",boss.rect("boss_name"))
   text("boss_health",math.ceil(enemy.hp/enemy.maxHp*100).."%",boss.rect("boss_health"))
  end end
 end
 if phase=="paused" then
  local dialog=models.pause.resolve(viewport)
  text("paused_title",abandonPrompt and "放棄本次遠征？" or "航行已暫停",dialog.rect("paused_title"))
  text("paused_copy",abandonPrompt and "目前的強化與進度將會失去。" or "深空可以等待。\n準備好，再點燃你的引擎。",dialog.rect("paused_copy"))
  if abandonPrompt then
   button("confirm_menu","確認放棄","Menu",dialog.rect("primary_action"));button("cancel_abandon","返回遠征","CancelAbandon",dialog.rect("secondary_action"))
  else
   button("resume","繼 續 航 行     ↗","Resume",dialog.rect("primary_action"));button("abandon","放棄遠征","Abandon",dialog.rect("secondary_action"))
  end
 elseif phase=="upgrade" then
  local upgrades=models.upgrades.resolve(viewport)
  text("upgrade_title",S.sectorDraft and "躍遷窗口已開啟" or "選擇你的下一道餘燼",upgrades.rect("upgrade_title"))
  text("upgrade_copy","選擇一項科技，讓你的下一道餘燼更耀眼。",upgrades.rect("upgrade_copy"))
  for i,choice in ipairs(S.choices) do
   local region="choice_"..i
   local card=models.card.resolve(viewport,upgrades.viewport(region))
   component("choice_component_"..i,"UpgradeCard",upgrades.rect(region),function()
    panel("choice_plate_"..i,upgrades.rect(region))
    text("rarity_"..i,choice.rarity.." / 0"..i,card.rect("rarity"));text("choice_name_"..i,choice.name,card.rect("choice_name"))
    local description=string.gsub(choice.description,"。","。\n")
    description=string.gsub(description,"\n$","")
    text("choice_desc_"..i,description,card.rect("choice_desc"))
    button("select_"..i,"[ "..i.." ]  安裝科技","Select"..i,card.rect("select"))
   end)
  end
 elseif phase=="gameover" or phase=="victory" then
  local result=models.result.resolve(viewport)
  text("result_title",phase=="victory" and "深 空 重 返 寂 靜" or "訊 號 已 中 斷",result.rect("result_title"))
  text("result_copy",phase=="victory" and "無聲君王已被擊毀。你的餘燼仍在。" or "每一次失落，都是下一次遠征的起點。",result.rect("result_copy"))
  text("result_stats","航行  "..timer(S.time).."    /    擊毀  "..S.kills.."\n抵達星區  "..S.sector.."    /    安裝強化  "..S.upgradesInstalled,result.rect("result_stats"))
  button("restart","重 新 遠 征     ↗","Restart",result.rect("restart"));button("return_menu","返回主選單","Menu",result.rect("return_menu"))
 end
 rule("footer_rule",layout.rect("footer_rule"));text("footer","DEEP SPACE NETWORK  ·  CONNECTED",layout.rect("footer"))
 text("engine_mark","POWERED BY UNONE ↗",layout.rect("engine_mark"))
 local worldBounds=layout.rect("world_region")
 api.observation.set("ui_layout",{variant=layout.variant,aspect=viewport.aspect,phase=phase,showTouch=design.showTouch,
  world={x=worldBounds.x,y=worldBounds.y,width=worldBounds.width,height=worldBounds.height}})
 api.ui.setRoot(ui.screen({id=phase,node=phase,children=nodes}))
end
