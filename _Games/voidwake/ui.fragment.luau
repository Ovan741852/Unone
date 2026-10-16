-- Game-owned design tokens composed with the official @unone/ui package.
-- No host CSS, raw canvas calls, or game-specific engine branches.
local abandonPrompt = false
local function updateUi(api: EngineApi)
 local ui=api.ui.components.create()
 local nodes: {any} = {}
 local compact=api.ui.getViewport().aspect<1.4
 local mint={.74,.89,.84,1}
 local ivory={.88,.93,.89,1}
 local muted={.47,.62,.62,1}
 local edgeColor={.57,.72,.68,.23}
 local function rect(x:number,y:number,w:number,h:number):any return {x=x,y=y,width=w,height=h} end
 local function component(id:string,kind:string,x:number,y:number,w:number,h:number,build:()->())
  local parent=nodes;nodes={};build();local children=nodes;nodes=parent
  table.insert(nodes,(ui.component({id=id,component=kind,rect=rect(x,y,w,h),children=children})))
 end
 local function panel(name:string,x:number,y:number,w:number,h:number)
  table.insert(nodes,(ui.panel({id=name,rect=rect(x,y,w,h),style={
   background={.025,.065,.085,.72},border_color=edgeColor,border_width=.07,border_radius=.18}})))
 end
 local function rule(name:string,x:number,y:number,w:number,color:any?)
  table.insert(nodes,(ui.panel({id=name,rect=rect(x,y,w,.08),style={background=color or edgeColor}})))
 end
 local tokens:any={
  brand={font_family="Barlow Condensed",font_size=3.5,font_weight=700,letter_spacing=.38,color=ivory},
  comms={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=.8,letter_spacing=.18},
  eyebrow={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=1,letter_spacing=.25,color=mint},
  menu_title={font_size=5.7,font_weight=700,letter_spacing=.15,color=ivory},
  menu_title_accent={font_size=5.7,font_weight=700,letter_spacing=.15,color=mint},
  menu_story={font_size=1.4,line_height=2.0,color={.58,.68,.67,1}},
  mission={font_size=1.45,font_weight=600,letter_spacing=.12,color=ivory},
  mission_meta={font_size=1,letter_spacing=.08},
  menu_controls={font_size=.85},
  ship_tag={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=.8,letter_spacing=.18,color=mint},
  ship_name={font_family="Barlow Condensed",font_size=3.7,font_weight=600,letter_spacing=.3,color=ivory},
  ship_class={font_size=1.05,letter_spacing=.12},
  vessel={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=1.05,letter_spacing=.12,color=ivory},
  sector={font_size=1.6,font_weight=600,color=ivory},
  clock={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=1.6,color=ivory},
  route={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=1.1,letter_spacing=.1,color=mint},
  salvage={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=.9,letter_spacing=.08},
  paused_title={font_size=4.3,font_weight=600,color=ivory,text_align="center",letter_spacing=.3},
  paused_copy={font_size=1.3,text_align="center"},
  upgrade_title={font_size=4.1,font_weight=600,text_align="center",color=ivory,letter_spacing=.3},
  upgrade_copy={font_size=1.3,text_align="center"},
  result_title={font_size=4.3,font_weight=600,text_align="center",color=ivory,letter_spacing=.3},
  result_copy={font_size=1.3,text_align="center"},
  result_stats={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=1.6,text_align="center",color=mint},
  footer={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=.75,letter_spacing=.13},
  engine_mark={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=.75,letter_spacing=.13,text_align="end"},
  flight_hint={font_size=.8,text_align="center",color={.32,.47,.49,1}},
 }
 local function text(name:string,value:string,x:number,y:number,w:number,h:number)
  local style:any={font_family="Noto Sans TC, Noto Sans TC Supplemental",font_size=1.1,font_weight=400,color=muted,
   text_align="start",vertical_align="middle",line_height=1.5,letter_spacing=0,overflow="clip"}
  for k,v in pairs(tokens[name] or {}) do style[k]=v end
  if string.sub(name,1,7)=="rarity_" then style.font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental";style.font_size=.9;style.color=mint;style.letter_spacing=.18 end
  if string.sub(name,1,12)=="choice_name_" then style.font_size=2.1;style.font_weight=600;style.color=ivory end
  if string.sub(name,1,12)=="choice_desc_" then style.font_size=1.15;style.line_height=1.8 end
  if compact then
   if name=="menu_title" or name=="menu_title_accent" then style.font_size=4.1 end
   if name=="menu_story" then style.font_size=1.35 end
   if name=="paused_title" or name=="upgrade_title" or name=="result_title" then style.font_size=3.0 end
  end
  table.insert(nodes,(ui.text({id=name,text=value,rect=rect(x,y,w,h),style=style})))
 end
 local function button(name:string,label:string,action:string,x:number,y:number,w:number,h:number)
  local primary=action=="Start" or action=="Resume" or action=="Restart"
  component(name.."_component","ActionButton",x,y,w,h,function()
   table.insert(nodes,(ui.button({id=name,text=label,action=action,rect=rect(x,y,w,h),style={
    font_family="Noto Sans TC, Noto Sans TC Supplemental",font_size=primary and 1.55 or (compact and 1.2 or 1.25),font_weight=primary and 600 or 400,
    color=primary and {.035,.12,.14,1} or mint,background=primary and mint or {.025,.085,.105,.40},
    border_color=primary and mint or edgeColor,border_width=.07,border_radius=.1,
    padding={left=1.4,right=1.4,top=.3,bottom=.3},text_align="start",vertical_align="middle",letter_spacing=primary and .18 or .04}})))
  end)
 end
 local function statBar(name:string,title:string,current:number,maximum:number,x:number,y:number,w:number,color:any)
  component(name.."_component","StatBar",x,y,w,3,function()
   text(name.."_label",title,x,y,w*.16,3)
   table.insert(nodes,(ui.panel({id=name.."_track",rect=rect(x+w*.19,y+1.3,w*.51,.35),style={background={.4,.6,.6,.17}}})))
   if current>0 then table.insert(nodes,(ui.panel({id=name.."_fill",rect=rect(x+w*.19,y+1.3,math.max(.01,w*.51*clamp(current/math.max(1,maximum),0,1)),.35),style={background=color}}))) end
   table.insert(nodes,(ui.text({id=name.."_value",text=math.ceil(current).." / "..maximum,rect=rect(x+w*.73,y,w*.27,3),style={font_family="Share Tech Mono, Noto Sans TC, Noto Sans TC Supplemental",font_size=compact and .95 or 1.1,color=ivory,text_align="end"}})))
  end)
 end
 local function timer(t:number):string return string.format("%02d:%02d",math.floor(t/60),math.floor(t%60)) end
 local phase=S.phase
 if phase=="paused" or phase=="upgrade" or phase=="gameover" or phase=="victory" then
  table.insert(nodes,(ui.panel({id="modal_shade",rect=rect(0,0,100,100),style={background={.015,.04,.06,.82}}})))
 end
 text("brand","VOIDWAKE",compact and 5 or 3.1,92.4,compact and 48 or 16,4.8)
 if not compact then text("comms","SYSTEM ONLINE   /   FLIGHT SYSTEMS",43,94,37,1.7) end
 button("sound",soundEnabled and "SND ON" or "SND OFF","Sound",compact and 78 or 89,93,compact and 17 or 7,3)
 rule("header_rule",3.1,90,93.8)
 if phase=="menu" then
  local x=6.25;local w=compact and 87.5 or 34.7
  component("opening_component","MissionIntroduction",x,17,w,67,function()
   text("eyebrow","A DEEP SPACE ROGUELIKE",x,80,w,2.5)
   text("menu_title","在黑暗之中，",x,compact and 72 or 70,w,8)
   text("menu_title_accent","留下你的餘燼。",x,compact and 64 or 61.5,w,8)
   text("menu_story","訊號已消失。返航不在選項之中。\n駕駛最後一艘遊隼，穿越失落星區。\n每次躍遷，都是一場全新的遠征。",x,compact and 49 or 48.6,w,10)
   rule("mission_rule",x,45.8,w)
   text("mission","穿越寂靜邊境",x,38.8,w,3)
   text("mission_meta","4 個星區   ·   隨機強化   ·   永久死亡",x,35,w,2.5)
   rule("mission_end",x,32.4,w)
   button("launch","啟動遠征  ↗","Start",x,21.8,w,8.4)
   text("menu_controls","WASD 航行   ·   滑鼠射擊   ·   SPACE 閃避",x,17.5,w,2.7)
  end)
  if not compact then component("ship_component","VesselCard",74,9,22,23,function()
   text("ship_tag","YOUR VESSEL",74,30,22,2)
   text("ship_name","PEREGRINE  MK. IV",74,23.5,22,5)
   text("ship_class","遊隼級 · 深空攔截機",74,20,22,2.5)
   rule("ship_rule",74,17,22)
   text("ship_serial","REG. UN-0741  /  READY FOR DEPLOYMENT",74,13,22,2)
  end) end
 else
  if phase=="playing" then
  local sectors={"蒼白星環","回聲裂谷","失落之海","無聲王座"}
  text("sector",string.format("SECTOR %02d  /  %s",S.sector,sectors[math.min(4,S.sector)]),4,84,compact and 72 or 20,3)
  text("clock",timer(S.time).."   /   擊毀 "..string.format("%03d",S.kills),4,79.5,compact and 60 or 20,3)
  text("objective",S.sector==4 and "摧毀無聲君王" or ("躍遷窗口  "..math.max(0,math.ceil(SECTOR_DURATION-S.sectorTime)).."s"),4,76,compact and 60 or 20,2.5)
  if not compact then text("route","01 ─── 02 ─── 03 ─── 04",64,85,29,3) end
  text("salvage","SALVAGE  "..string.format("%04d",S.credits).."    /    LV. "..S.level,compact and 52 or 65,compact and 20 or 81,compact and 43 or 28,2.5)
  button("pause","Ⅱ  暫停","Pause",compact and 78 or 88,73,compact and 17 or 9,5)
  end
  if phase=="playing" then
  local vw=compact and 41 or 25
  text("vessel","PEREGRINE / MK. IV",5,17,vw,2.4)
  statBar("hull","船體",S.player.hp,S.player.maxHp,5,13.5,vw,{.70,.82,.70,1})
  statBar("shield","護盾",S.player.shield,S.player.maxShield,5,10,vw,{.40,.73,.79,1})
  text("xp","經驗 "..S.xp.." / "..S.xpNext.." · LV. "..S.level,5,6.5,vw,2.3)
  if compact then
   button("auto",S.autoFire and "F 自動 ON" or "F 自動 OFF","AutoFire",52,13,43,4)
   button("burst",S.burstCooldown>0 and ("Q 脈衝 "..math.ceil(S.burstCooldown).."s") or "Q 脈衝","Burst",52,7,21,4)
   button("dash",S.dashCooldown>0 and ("閃避 "..string.format("%.1f",S.dashCooldown).."s") or "閃避 READY","Dash",75,7,20,4)
  else
   text("weapon_status",S.autoFire and "AUTO TARGETING ONLINE" or "MANUAL TARGETING",66,19,30,2)
   text("weapon","雙聯電磁炮  /  MK. "..S.level,66,15,30,3)
   button("auto",S.autoFire and "F 自動 ON" or "F 自動 OFF","AutoFire",66,8.4,9,4.3)
   button("burst",S.burstCooldown>0 and ("Q 脈衝 "..math.ceil(S.burstCooldown).."s") or "Q 脈衝 READY","Burst",75.7,8.4,9,4.3)
   button("dash",S.dashCooldown>0 and ("SPACE "..string.format("%.1f",S.dashCooldown).."s") or "SPACE 閃避","Dash",85.4,8.4,10.6,4.3)
  end
  -- Desktop controls remain quiet; portrait uses the same semantic held input.
  if compact then
  button("up","↑","KeyW",12,34,10,5)
  button("left","←","KeyA",1,28,10,5)
  button("down","↓","KeyS",12,28,10,5)
  button("right","→","KeyD",23,28,10,5)
  end
  if not compact then text("flight_hint","WASD 航行 · 滑鼠射擊 · Q 脈衝 · SPACE 閃避 · ESC 暫停",30,5.5,36,2) end
  for _,enemy in ipairs(S.enemies) do if enemy.boss then
   panel("boss_plate",30,82,40,8)
   text("boss_name","無聲君王  /  THE SOVEREIGN",32,86,36,2.5)
   text("boss_health",math.ceil(enemy.hp/enemy.maxHp*100).."%",32,83,36,2.4)
  end end
  end
 end
 if phase=="paused" then
  text("paused_title",abandonPrompt and "放棄本次遠征？" or "航行已暫停",compact and 8 or 31,62,compact and 84 or 38,8)
  text("paused_copy",abandonPrompt and "目前的強化與進度將會失去。" or "深空可以等待。\n準備好，再點燃你的引擎。",compact and 8 or 32,50,compact and 84 or 36,8)
  if abandonPrompt then
   button("confirm_menu","確認放棄","Menu",33,40,34,7)
   button("cancel_abandon","返回遠征","CancelAbandon",33,31,34,7)
  else
   button("resume","繼 續 航 行     ↗","Resume",33,40,34,7)
   button("abandon","放棄遠征","Abandon",33,31,34,7)
  end
 elseif phase=="upgrade" then
  text("upgrade_title",S.sectorDraft and "躍遷窗口已開啟" or "選擇你的下一道餘燼",8,74,84,7)
  text("upgrade_copy","選擇一項科技，讓你的下一道餘燼更耀眼。",8,67,84,3)
  for i,choice in ipairs(S.choices) do
   local x=compact and 8 or (11+(i-1)*27)
   local y=compact and (49-(i-1)*17) or 27
   local w=compact and 84 or 24;local h=compact and 15.5 or 36
   component("choice_component_"..i,"UpgradeCard",x,y,w,h,function()
   panel("choice_plate_"..i,x,y,w,h)
   text("rarity_"..i,choice.rarity.." / 0"..i,x+2,y+h-(compact and 3 or 5),w-4,2.5)
   text("choice_name_"..i,choice.name,x+2,y+h-(compact and 6.6 or 12),w-4,4)
   -- These descriptions have a natural sentence break already authored above.
   local description=string.gsub(choice.description,"。","。\n")
   text("choice_desc_"..i,description,x+2,y+(compact and 3.9 or 10),w-4,compact and 4.4 or 8)
   button("select_"..i,"[ "..i.." ]  安裝科技","Select"..i,x+2,y+1.2,w-4,compact and 2.4 or 5.2)
   end)
  end
 elseif phase=="gameover" or phase=="victory" then
  text("result_title",phase=="victory" and "深 空 重 返 寂 靜" or "訊 號 已 中 斷",compact and 8 or 28,65,compact and 84 or 44,7)
  text("result_copy",phase=="victory" and "無聲君王已被擊毀。你的餘燼仍在。" or "每一次失落，都是下一次遠征的起點。",compact and 8 or 28,56,compact and 84 or 44,5)
  text("result_stats","航行  "..timer(S.time).."    /    擊毀  "..S.kills.."\n抵達星區  "..S.sector.."    /    安裝強化  "..S.upgradesInstalled,compact and 8 or 29,45,compact and 84 or 42,8)
  button("restart","重 新 遠 征     ↗","Restart",31,34,38,7)
  button("return_menu","返回主選單","Menu",31,26,38,6)
 end
 rule("footer_rule",3.1,4.8,93.8)
 text("footer","DEEP SPACE NETWORK  ·  CONNECTED",3.1,1.5,compact and 60 or 30,2)
 text("engine_mark","POWERED BY UNONE ↗",compact and 68 or 81,1.5,compact and 27 or 15,2)
 api.ui.setRoot({kind="screen",id=phase,node=phase,children=nodes})
end
