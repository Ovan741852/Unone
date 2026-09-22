--!strict
-- All economy, roguelike choices, movement, damage and lotteries run in Unone Luau.
type SkillSource = {id: string, stacks: number?}
type Item = {id: number, skill: string, enchant: string?, slot: number, paid: number, [string]: any}
type Curse = {kind: number, remaining: number}
type Choice = {id: string, name: string, type: string, desc: string, apply: () -> ()}
local publishFormalUI:((any)->())?=nil
local Game={}
local S:any={};local monsters:{any}={};local troops:{any}={};local effects:{any}={};local catalog:{Choice}={}
local coinsFX:{any}={};local rewardEvents:{any}={};local pointerHeld=false
local sparks:{any}={};local fxSerial=0
local frame=0;local serial=0;local apiRef:any=nil;local held:{[string]:boolean}={};local cooldown=0
local corners={{x=0,z=12.2},{x=12.2,z=0},{x=0,z=-12.2},{x=-12.2,z=0}} -- Midpoints of the square battlefield edges.
local kinds={"sword","spear","cavalry"}
local baseCosts={8,20,40};local baseDamage={24,48,90}
-- Trial economy: apply to the complete deployment quote, including equipment.
-- These gameplay parameters never live in the renderer or the engine.
local economyTuning={version="2026-09-12-nearwin-v1",deployScale=.5,awardScale=.5,nearBreak=.7}
local baseAwardChances={.65,.65,.55,.50,.45}
local baseLife={5,5,8}
local WALL_X,WALL_Z=12.5,12.5
local chapters={"苔光林口","菇冠小徑","橡木渡溪","古榕回廊","琥珀石庭","冠角聖林","森林王座"}
local floor,min,max,sin,cos,sqrt,abs=math.floor,math.min,math.max,math.sin,math.cos,math.sqrt,math.abs
local function rng()return apiRef.random.nextFloat()end
local sourcePrices:{[string]:number}={pierce=4,critical=3,landing_spin=6,longlife=2,haste=2,heavy=3,bounce_power=4,bounce_life=3,momentum=4,shock=6}
-- Town upgrades are save-scoped.  The first four legacy levels remain in the
-- save for compatibility; `nodes` is the finer constellation progression.
-- These are business rules, so they stay in Luau rather than the renderer.
local townNodeDefs={
 -- Each town point is a skill.  The first ring touches the crown core;
 -- the outer ring grows from its matching inner skill.
 {id="star_sword_soul",name="劍魂·命門",icon="skill-critical",branch="核心",tier=1,requires={},max=3,prices={60,100,160},desc="劍兵爆擊率 +5%、碰撞傷害 +4%／級"},
 {id="star_spear_fall",name="槍陣·落星",icon="skill-landing_spin",branch="核心",tier=1,requires={},max=3,prices={70,120,190},desc="槍兵旋轉半徑 +0.3、旋轉傷害 +10%／級"},
 {id="star_cavalry_march",name="騎獵·長征",icon="skill-haste",branch="核心",tier=1,requires={},max=3,prices={80,140,220},desc="騎兵壽命 +12%、移動速度 +8%／級"},
 {id="star_rebound",name="折光·蓄勢",icon="skill-rebound_charge",branch="核心",tier=1,requires={},max=3,prices={90,150,240},desc="撞牆後蓄勢更快，反彈傷害 +8%／級"},
 {id="star_sword_finisher",name="劍魂·斬首",icon="skill-finisher",branch="外環",tier=2,requires={1},max=3,prices={80,130,210},desc="劍兵穿透後的終結撞擊 +12%／級"},
 {id="star_spear_thunder",name="槍陣·雷鳴",icon="skill-thunder_fan",branch="外環",tier=2,requires={2},max=3,prices={90,150,230},desc="槍兵命中追加鏈式範圍傷害 +10%／級"},
 {id="star_cavalry_breaker",name="騎獵·穿陣",icon="skill-double_pierce",branch="外環",tier=2,requires={3},max=3,prices={100,170,260},desc="騎兵穿透 +2、速度轉傷害 +20%／級"},
 {id="star_last_oath",name="軍魂·遺贈",icon="skill-legacy_gift",branch="外環",tier=2,requires={4},max=3,prices={100,180,280},desc="友軍死亡時隨機強化一名隊友，遺贈上限隨等級增加"},
}
local function newProfile(index:number):any
 return {name="林地札記 "..index,materials=0,gold=0,levels={0,0,0,0},nodes={0,0,0,0,0,0,0,0},runs=0,bestRound=0,created=false}
end
local function validProfile(value:any,index:number):any?
 local materials=type(value)=="table" and (type(value.materials)=="number" and value.materials or value.gold) or nil
 if type(value)~="table" or type(materials)~="number" or materials<0 or materials>=1e12 or materials~=floor(materials) or type(value.levels)~="table" or #value.levels~=4 then return nil end
 local levels={};for i=1,4 do local level=value.levels[i];if type(level)~="number" or level<0 or level>5 or level~=floor(level)then return nil end;levels[i]=level end
 local nodes={};local savedNodes=type(value.nodes)=="table" and value.nodes or {}
 for i,def in ipairs(townNodeDefs)do local level=savedNodes[i];if type(level)~="number" then level=(i<=4 and min(levels[i],def.max) or 0) end;if level<0 or level>def.max or level~=floor(level)then return nil end;nodes[i]=level end
 local runs=type(value.runs)=="number" and math.max(0,floor(value.runs)) or 0
 local bestRound=type(value.bestRound)=="number" and math.clamp(floor(value.bestRound),0,7) or 0
 local progressed=materials>0 or runs>0 or bestRound>0
 for _,level in ipairs(levels)do progressed=progressed or level>0 end
 for _,level in ipairs(nodes)do progressed=progressed or level>0 end
 return {name=type(value.name)=="string" and string.sub(value.name,1,24) or "林地札記 "..index,materials=materials,gold=materials,levels=levels,nodes=nodes,runs=runs,bestRound=bestRound,created=value.created==true or progressed}
end
local profiles:any={newProfile(1),newProfile(2),newProfile(3)}
local activeProfile=1
local town:any=profiles[1]
local settings:any={music=.70,sfx=.85,quality="high",language="繁中"}
local function validSettings(value:any):any
 if type(value)~="table" then return {music=.70,sfx=.85,quality="high",language="繁中"} end
 local quality=table.find({"low","medium","high"},value.quality) and value.quality or "high"
 local language=table.find({"繁中","简中","English"},value.language) and value.language or "繁中"
 local music=type(value.music)=="number" and math.clamp(value.music,0,1) or .70
 local sfx=type(value.sfx)=="number" and math.clamp(value.sfx,0,1) or .85
 return {music=music,sfx=sfx,quality=quality,language=language}
end
local function persistProfiles()
 if not apiRef then return end
 town.gold=town.materials -- legacy save alias; all game rules use materials.
 town.nodes=town.nodes or {0,0,0,0,0,0,0,0}
 profiles[activeProfile]=town
 apiRef.save.set({version=3,active=activeProfile,profiles=profiles,settings=settings})
end
local function townNodeLevel(index:number):number
 if not townNodeDefs[index] then return 0 end
 return town.nodes and (town.nodes[index] or 0) or 0
end
local function townNodePrereqsMet(index:number):boolean
 local def=townNodeDefs[index];if not def then return false end
 for _,required in ipairs(def.requires or {})do if townNodeLevel(required)<1 then return false end end
 return true
end
local function itemById(id:number): Item?
 for _,item in ipairs((S.items or {}) :: {Item})do if item.id==id then return item end end
 return nil
end
local function runeCopies(id:number):number
 local count=(S.runeBag and S.runeBag[id])or 0
 for k=1,3 do if S.runes and S.runes[k]==id then count+=1 end end
 return count
end
local function runeHolder(id:number,except:number?):number?
 for k=1,3 do if k~=except and S.runes and S.runes[k]==id then return k end end
 return nil
end
local function wornSources(k:number,replacement:Item?): {SkillSource}
 local list:{SkillSource}={}
 for slot,id in ipairs((S.worn and S.worn[k] or {}) :: {number})do
  local item=replacement and replacement.slot==slot and replacement or itemById(id)
  if item then table.insert(list,{id=item.skill});if item.enchant then table.insert(list,{id=item.enchant})end end
 end
 return list
end
local function sourceCount(k:number,id:string,replacement:Item?)
 local count=0
 for _,list in ipairs({S.skillSources and S.skillSources[k] or {},wornSources(k,replacement),S.tech and S.tech[k] or {}} :: {{SkillSource}})do
  for _,source in ipairs(list)do if source.id==id then count+=source.stacks or 1 end end
 end
 return count
end
local function costs(k:number,replacement:Item?)
 local extra=3*((S.equipment and S.equipment[k] or 1)-1)+(S.runes and S.runes[k]~=0 and 2 or 0)
 for _,source in ipairs((S.skillSources and S.skillSources[k] or {}) :: {SkillSource})do extra+=(sourcePrices[source.id] or 0)*(source.stacks or 1)end
 for _,source in ipairs(wornSources(k,replacement))do extra+=sourcePrices[source.id] or 0 end
 local penalty=0;for _,curse in ipairs((S.curses or {}) :: {Curse})do if curse.kind==1 then penalty+=.15 end end
 local rescue=S.coins and S.coins<80 and S.recruitUses and S.recruitUses[S.seat]<3 and sourceCount(k,"recruit",replacement)>0
 local standard=max(2,floor((baseCosts[k]+extra)*(1-S.discount)*(1+penalty)*(rescue and .5 or 1)))
 return max(1,math.ceil(standard*economyTuning.deployScale))
end
local function changeGold(playerId:number,amount:number)
 if playerId==S.seat then S.coins+=amount else S.playerGold[playerId]+=amount end
end
-- Skill sources are declarative: innate, equipment and rune sources compose
-- identically. Recompose on deployment so later equipment cannot alter a live troop.
-- BEGIN AWARD AFFIXES
-- Game-owned award modifiers. Probabilities here are conditional on winning;
-- the guard-break success gate, payout amounts and special encounters are separate.
local awardAffixes={
 {id="minor_bounty",name="小王抬賞",target={ranks={3}},delta=.12,price=2,icon="showdown",desc="對小王：開獎後小獎 -12、大獎 +12 百分點"},
 {id="minor_harvest",name="小王細收",target={ranks={3}},delta=-.12,price=1,icon="recruit",desc="對小王：開獎後小獎 +12、大獎 -12 百分點"},
 {id="elder_bounty",name="中王抬賞",target={ranks={4}},delta=.12,price=2,icon="king_hunter",desc="對中王：開獎後小獎 -12、大獎 +12 百分點"},
 {id="elder_harvest",name="中王細收",target={ranks={4}},delta=-.12,price=1,icon="hunter_vigor",desc="對中王：開獎後小獎 +12、大獎 -12 百分點"},
 {id="crown_bounty",name="大王抬賞",target={ranks={5}},delta=.12,price=2,icon="deadly",desc="對大王：開獎後小獎 -12、大獎 +12 百分點"},
 {id="crown_harvest",name="大王細收",target={ranks={5}},delta=-.12,price=1,icon="longlife",desc="對大王：開獎後小獎 +12、大獎 -12 百分點"},
}
local runeDefinitions={
 {name="燼火符文",price=6,icon="ember_burst",effect="傷害 +35%"},
 {name="迴響符文",price=9,icon="plunder",effect="一般獎金 +25%"},
 {name="凝霜符文",price=7,icon="frost_touch",effect="命中緩速兩秒"},
}
for _,def in ipairs(awardAffixes)do
 table.insert(runeDefinitions,{name=def.name.."符文",price=def.delta>0 and 8 or 5,icon=def.icon,effect=def.desc:gsub("開獎後",""),skill=def.id})
end
local runeNames={};local runePrices={}
for i,def in ipairs(runeDefinitions)do runeNames[i]=def.name;runePrices[i]=def.price end
local function awardTargetMatches(target:any,m:any):boolean
 if m.special or m.rank<3 then return false end
 if target.ranks and not table.find(target.ranks,m.rank)then return false end
 if target.species and not table.find(target.species,m.skin)then return false end
 return true
end
local function awardWeights(m:any,skills:any,luck:number):any
 local w={1,0,0,0}
 if m.rank==3 then w[3]=math.clamp(.34+luck,0,1);w[1]=1-w[3]
 elseif m.rank==4 then w[3]=math.clamp(.23+luck,0,1);w[2]=math.max(0,.65-w[3]);w[1]=1-w[3]-w[2]
 elseif m.rank==5 then
  w[4]=math.clamp(.06+luck*.25,0,1)
  local upper=math.max(w[4],math.clamp(.26+luck,0,1));w[3]=upper-w[4];w[2]=math.max(0,.65-upper);w[1]=1-upper-w[2]
 end
 -- Aggregate first: opposing sources cancel irrespective of equipment order.
 -- At most 24 conditional percentage points; no absent tier or negative weight.
 local delta=0
 for _,shift in ipairs(skills and skills.awardShifts or {})do if awardTargetMatches(shift.target,m)then delta+=shift.delta end end
 delta=math.clamp(delta,-.24,.24)
 local applied=delta>=0 and math.min(delta,w[1]) or -math.min(-delta,w[3])
 if m.rank<3 or m.special then applied=0 end
 w[1]-=applied;w[3]+=applied
 return {weights=w,shift=applied}
end
local function selectAwardTier(weights:any,roll:number):number
 local sum=0
 -- Descending order preserves the existing seeded lottery mapping at zero shift.
 for tier=4,1,-1 do sum+=weights[tier];if roll<sum then return tier end end
 return 1
end

-- END AWARD AFFIXES
local skillDefinitions={
 legacy_gift={legacyGift=1},guard_bequest={guardBequest=1},
 comrade_oath={comradeOath=1},resonant_debt={resonantDebt=1},contact_mine={contactMine=1},step_orb={stepOrb=1},gravity_law={gravityLaw=1},quick_chant={quickChant=1},overload_script={overloadScript=1},storm_payload={stormPayload=1},
 critical={critChance=.10,critMultiplier=1.5},
 pierce={pierce=1},
 landing_spin={landingSpin=true,spinRadius=2.9,spinDuration=.55,spinDamage=1.0,flightSpeed=16},
 flame_cloak={flameCloak=1},phoenix_fire={phoenixFire=1},plague_vial={plagueVial=1},
 cinder_seal={cinderSeal=1},chain_fuse={chainFuse=1},thunder_fan={thunderFan=1},echo_blade={echoBlade=1},starfall={starfall=1},soul_return={soulReturn=1},
 plunder={plunder=1},firstborn={firstborn=1},march_capacitor={marchCapacitor=1},delayed_bloom={delayedBloom=1},third_pulse={thirdPulse=1},battle_elegy={battleElegy=1},grave_bloom={graveBloom=1},last_echo={lastEcho=1},necromancer={necromancer=1},
 ember_trail={emberTrail=1},slick_oil={slickOil=1},rain_strike={rainStrike=1},storm_touch={stormTouch=1},oil_legacy={oilLegacy=1},
 longlife={lifeBonus=.15},haste={speedBonus=.15},heavy={speedBonus=-.20,damageBonus=.35},
 bounce_power={bouncePower=.12},bounce_life={bounceLife=.2},momentum={momentum=.6},shock={shock=.2},
 crit_power={critAdd=.25},finisher={finisher=.1},ember_burst={deathBurst=.35},king_hunter={kingDamage=.2},
 frost_touch={frost=1},frenzy={frenzy=1},last_stand={lastStand=.4},heat={heat=.05},distance={distance=.3},
 wall_quake={wallQuake=.3},short_fuse={lifeBonus=-.2,damageBonus=.45},wide_blade={areaBonus=.2,areaPenalty=.1},hit_echo={hitEcho=.2},fracture={fracture=.2},solo_hunt={soloHunt=.25},crowd_ring={crowdRing=.2},recruit={recruit=1},rally={rally=1},rapid={rapid=.25},solitary={solitary=.3},showdown={showdown=.25},sharp={damageBonus=.1},giant={damageBonus=.25},double_pierce={pierce=2},deadly={critAdd=.5},
 shatter={shatter=.3},ricochet_precision={bounceCrit=.15},hunter_vigor={killLife=.25},piercing_wave={pierceWave=.2},slow_force={slowForce=.75},spin_master={spinMaster=.2},
 lightning={lightning=.25},third_crit={thirdCrit=1},expire_burst={expireBurst=.25},rebound_charge={reboundCharge=.2},

}
for _,def in ipairs(awardAffixes)do skillDefinitions[def.id]={awardShift={target=def.target,delta=def.delta}};sourcePrices[def.id]=def.price end
local modifierKeys={"lifeBonus","speedBonus","damageBonus","bouncePower","bounceLife","momentum","shock","critAdd","finisher","deathBurst","kingDamage","frost","frenzy","lastStand","heat","distance","lightning","thirdCrit","expireBurst","reboundCharge","shatter","bounceCrit","killLife","pierceWave","slowForce","spinMaster","wallQuake","areaBonus","areaPenalty","hitEcho","fracture","soloHunt","crowdRing","recruit","rally","rapid","solitary","showdown","swordCrit","swordContact","spearSpin","spearSpinDamage","cavalryLife","cavalrySpeed"}
local innateSkills:{{SkillSource}}={{{id="critical"}},{{id="landing_spin"}},{{id="pierce",stacks=20}}}
table.insert(modifierKeys,"legacyGift")
table.insert(modifierKeys,"guardBequest")
for _,key in ipairs({"comradeOath","resonantDebt","contactMine","stepOrb","gravityLaw","quickChant","overloadScript","stormPayload","cinderSeal","chainFuse","thunderFan","echoBlade","starfall","soulReturn","plunder","firstborn","marchCapacitor","delayedBloom","thirdPulse","battleElegy","graveBloom","lastEcho","necromancer","flameCloak","phoenixFire","plagueVial","emberTrail","slickOil","rainStrike","stormTouch","oilLegacy"})do table.insert(modifierKeys,key)end
local function composeSkills(k:number)
 local result:any={awardShifts={},vfxSkills={},_vfxSeen={},pierce=0,critChance=0,critMultiplier=1,landingSpin=false,spinRadius=0,spinDuration=0,spinDamage=0,flightSpeed=0}
 for _,key in ipairs(modifierKeys)do result[key]=0 end
  local function add(source:any)
   local definition=skillDefinitions[source.id];assert(definition,"Unknown skill: "..source.id)
   if not result._vfxSeen[source.id] then result._vfxSeen[source.id]=true;table.insert(result.vfxSkills,source.id)end
  local stacks=source.stacks or 1
  if definition.awardShift then local shift=definition.awardShift;table.insert(result.awardShifts,{target=shift.target,delta=shift.delta*stacks})end
  for _,key in ipairs(modifierKeys)do result[key]+=(definition[key] or 0)*stacks end
  result.pierce+=(definition.pierce or 0)*stacks
  result.critChance+=(definition.critChance or 0)*stacks
  result.critMultiplier=max(result.critMultiplier,definition.critMultiplier or 1)
  if definition.landingSpin then
   result.landingSpin=true
   -- Repeated grants unlock one spin; numeric upgrades are separate modifiers.
   result.spinRadius=max(result.spinRadius,definition.spinRadius)
   result.spinDuration=max(result.spinDuration,definition.spinDuration)
   result.spinDamage=max(result.spinDamage,definition.spinDamage)
   result.flightSpeed=max(result.flightSpeed,definition.flightSpeed)
  end
 end
 for _,source in ipairs(innateSkills[k])do add(source)end
 for _,source in ipairs(S.skillSources[k])do add(source)end
 for _,source in ipairs(wornSources(k))do add(source)end
  for _,source in ipairs(S.tech and S.tech[k] or {})do add(source)end
  local rune=runeDefinitions[S.runes and S.runes[k] or 0];if rune and rune.skill then add({id=rune.skill})end
 local nodes=town.nodes or {}
 -- Legacy four-slot town levels remain valid for old saves. New constellation
 -- points are real troop-specific skill grants, still composed in Luau.
 local n1,n2,n3,n4=nodes[1] or 0,nodes[2] or 0,nodes[3] or 0,nodes[4] or 0
 local n5,n6,n7,n8=nodes[5] or 0,nodes[6] or 0,nodes[7] or 0,nodes[8] or 0
 if k==1 then
  result.swordCrit+=n1*.05;result.swordContact+=n1*.04;result.finisher+=n5*.12
 elseif k==2 then
  result.spearSpin+=n2*.3;result.spearSpinDamage+=n2*.10;result.shock+=n6*.10
 elseif k==3 then
  result.lifeBonus+=n3*.12;result.speedBonus+=n3*.08;result.pierce+=n7*2;result.momentum+=n7*.2
 end
 result.bouncePower+=n4*.08;result.reboundCharge+=n4*.2;result.legacyGift+=n8
 for _,curse in ipairs((S.curses or {}) :: {Curse})do if curse.kind==2 then result.lifeBonus-=.15 elseif curse.kind==3 then result.speedBonus-=.15 end end
 if S.curseRewards then result.pierce+=S.curseRewards[1];result.damageBonus+=S.curseRewards[2]*.25;result.critChance+=S.curseRewards[3]*.1 end
 result.critMultiplier=max(1.5,result.critMultiplier)+result.critAdd
 result.pierce=max(0,floor(result.pierce));result.critChance=max(0,min(1,result.critChance))
 if result.landingSpin then result.spinRadius+=S.radius-2.9+min(.8,result.spinMaster*2);result.spinDamage*=1+min(.6,result.spinMaster);if k==2 then result.spinRadius+=result.spearSpin;result.spinDamage*=1+min(.6,result.spearSpinDamage)end;result.spinRadius*=1+min(.6,result.areaBonus);result.spinDamage*=max(.5,1-result.areaPenalty) end
  result._vfxSeen=nil
  return result
end
local pendingProcs:{any}={}
local skillRuntime:any=nil
-- AUTO targets are creature IDs shared by the encounter, UI and simulation.
local autoSpecies={
 {id="acorn",name="橡果蹦蹦",group="small",label="小怪"},
 {id="moth",name="苔羽蛾",group="small",label="小怪"},
 {id="piglet",name="菇背幼豬",group="small",label="小怪"},
 {id="turtle",name="苔殼龜",group="small",label="小怪"},
 {id="boar",name="獠牙搬木王",group="boss",label="小王"},
 {id="treant",name="花冠樹靈",group="boss",label="小王"},
 {id="elder",name="古榕守衛",group="boss",label="中王"},
 {id="stag",name="冠角白鹿",group="boss",label="大王 · 最後 30 秒"},
 {id="beetle",name="聚寶甲蟲",group="special",label="共用獎池"},
 {id="wheel",name="金鈴狸",group="special",label="奇遇輪盤"},
}
local function autoPreset(group:string)
 local selected:{[string]:boolean}={}
 for _,def in ipairs(autoSpecies)do selected[def.id]=group=="all" or def.group==group end
 return selected
end
local function autoCount(selected:any):number
 local count=0;for _,def in ipairs(autoSpecies)do if selected[def.id]then count+=1 end end;return count
end

local function reset()
 if skillRuntime then skillRuntime:reset()end
 pendingProcs={}
 local nodes=town.nodes or {}
 local startingCoins=320
 S={phase="menu",round=1,coins=startingCoins,earned=0,spent=0,kills=0,breaks=0,seat=1,selected=1,time=180,roundDuration=180,paused=false,damage=1,discount=0,luck=0,radius=2.9,lifetime=1,equipment={1,1,1},runes={0,0,0},inventory={},offer={},message="",event=0,prize=0,prizeTier=0,lastMonster="",fired=0,won=false,aimX=0,aimZ=0}
 monsters={};troops={};effects={};cooldown=0
 S.refunded=0;S.roundRefund=0;S.returnedUnits=0;S.bounces=0;S.expired=0;S.contactDeaths=0
 S.crystalStart=18;S.crystals=S.crystalStart;S.crystalEarned=0;S.crystalSpent=0;S.crystalSold=0
 S.roundCrystalEarned=0;S.crystalProgress=0;S.roundCrystalBonus=0;S.lastCrystalGain=0
 S.arenaHalfExtent=12.5;S.returnedTotal=0;S.lostPaid=0;S.resultElapsed=0;S.townStartMaterials=town.materials
 S.mapElapsed=0;S.mapDuration=1.5;S.mapMoving=false;S.mapFrom=0;S.mapPosition=0
 S.playerGold={startingCoins,startingCoins,startingCoins,startingCoins};S.lotteryMisses=0;S.lotteryResults={};S.poolContributed=0;S.poolPaidOut=0;S.procHits=0;S.streaks={{count=0,time=0},{count=0,time=0},{count=0,time=0},{count=0,time=0}}
 S.plunderEarned=0;S.plunderEvents={};S.plunderSerial=0
 S.skillSources={{},{},{}};S.criticalHits=0;S.contactHits=0;S.piercesUsed=0;S.spinHits=0
 S.damageEvents={};S.damageEvent=0
 S.fireMode="manual";S.targetFilter="all";S.targetId=0;S.targetName="";S.lockViolations=0;S.rewardClock=0;S.presentationDelay=0
 S.autoTargets=autoPreset("all");S.autoDraft={};S.autoConfigOpen=false;S.fireRearm=false
 S.lockEnabled=false;S.autoEnabled=false
 coinsFX={};rewardEvents={};pointerHeld=false
 sparks={};fxSerial=0
 S.hordeCount=0;S.hordeNotice=0;S.hordeAdded=0;S.hordeAt=-1;S.runRecorded=false
 S.specialSpawned=false;S.poolWinner=0
 S.runeOwned={{},{},{} };for k=1,3 do for i=1,#runeDefinitions do S.runeOwned[k][i]=false end end;S.balanceVersion=economyTuning.version;S.economyTuning=table.clone(economyTuning);S.awardChances={};for i,p in ipairs(baseAwardChances)do S.awardChances[i]=p*economyTuning.awardScale end;S.beetleAwardChance=.25*economyTuning.awardScale;S.items={};S.worn={{0,0,0,0,0},{0,0,0,0,0},{0,0,0,0,0}};S.itemSerial=0;S.equipSlot=5
 S.tech={{},{},{}};S.potions={};S.curses={};S.curseRewards={0,0,0};S.shopSpent=0;S.sold=0;S.stock={};S.location="";S.enchantPending=nil
 S.runeBag={};for i=1,#runeDefinitions do S.runeBag[i]=0 end;S.loadoutReturn="menu"
 S.pendingWheel={};S.chestCount=0;S.chests={};S.chestHold=0;S.chestResult=nil;S.hasteUntil=0;S.critUntil=0;S.roulette=nil;S.freeFired=0;S.wheelSpawned=false;S.playerBuffs={{haste=0,critical=0,pierce=0},{haste=0,critical=0,pierce=0},{haste=0,critical=0,pierce=0},{haste=0,critical=0,pierce=0}}
 S.recruitUses={0,0,0,0};S.roundSpent={0,0,0,0};S.rallyUsed={false,false,false,false};S.rallyUntil={0,0,0,0};S.skillTriggers={};S.vfx={};S.visualSerial=0;S.rankEconomy={{damage=0,attempts=0,earned=0},{damage=0,attempts=0,earned=0},{damage=0,attempts=0,earned=0},{damage=0,attempts=0,earned=0},{damage=0,attempts=0,earned=0}}
 S.town=town;S.profiles=profiles;S.activeProfile=activeProfile;S.settings=settings;S.deleteCandidate=0;S.exitRequested=false;S.townUpgradePending=false;S.townUpgradeIndex=0;S.townUpgradeConfirmRequested=false;S.battleSeconds=0;S.choiceSeconds=0;S.shopVisits=0;S.roundSettled=false
end
catalog={
 {id="edge",name="獵神之刃",type="裝備",desc="全軍傷害 +25%",apply=function()S.damage+=.25 end},
 {id="purse",name="渡魂者的贈禮",type="補給",desc="立即獲得 180 金幣",apply=function()S.coins+=180;S.earned+=180 end},
 {id="oath",name="軍團誓約",type="契約",desc="派兵費用降低 12%（最多 48%）",apply=function()S.discount=min(.48,S.discount+.12)end},
 {id="fortune",name="命運金枝",type="符文",desc="王的大獎機率 +8%（最多 +32%）",apply=function()S.luck=min(.32,S.luck+.08)end},
 {id="storm",name="風暴槍環",type="裝備",desc="全軍旋轉技能半徑 +0.8，傷害 +10%",apply=function()S.radius+=.8;S.damage+=.1 end},
 {id="march",name="永夜馬蹄",type="裝備",desc="騎兵存活時間 +30%，傷害 +10%",apply=function()S.lifetime+=.3;S.damage+=.1 end},
 {id="sword",name="赤鋼戰刃",type="換裝",desc="劍兵裝備升一階，兵種傷害 +30%",apply=function()S.equipment[1]+=1 end},
 {id="spear",name="弒神長槍",type="換裝",desc="槍兵裝備升一階，兵種傷害 +30%",apply=function()S.equipment[2]+=1 end},
 {id="cavalry",name="黑曜騎鎧",type="換裝",desc="騎兵裝備升一階，兵種傷害 +30%",apply=function()S.equipment[3]+=1 end},
 {id="ember",name="燼火符文",type="符文",desc="裝入目前兵種：命中追加 35% 傷害",apply=function()S.runes[S.selected]=1 end},
 {id="echo",name="迴響符文",type="符文",desc="裝入目前兵種：開獎收入 +25%",apply=function()S.runes[S.selected]=2 end},
 {id="frost",name="凝霜符文",type="符文",desc="裝入目前兵種：命中緩速怪物 2 秒",apply=function()S.runes[S.selected]=3 end},
 {id="pierce",name="穿軍尖鋒",type="技能裝備",desc="目前兵種穿透 +1，可累加；穿透用完後，下次撞擊造成傷害並消失",apply=function()table.insert(S.skillSources[S.selected],{id="pierce"})end},
 {id="landing_spin",name="旋風戰技",type="技能裝備",desc="目前兵種獲得落地旋轉斬，之後繼續前進；不消耗穿透次數",apply=function()table.insert(S.skillSources[S.selected],{id="landing_spin"})end},
 {id="critical",name="精準戰技",type="技能裝備",desc="目前兵種爆擊率 +10%，爆擊傷害至少 1.5 倍；每次傷害獨立判定",apply=function()table.insert(S.skillSources[S.selected],{id="critical"})end}
}
for _,entry in ipairs({
 {"longlife","長征","壽命 +15%",2},{"haste","疾行","移速 +15%",2},{"heavy","沉重","速度 -20%，傷害 +35%",3},
 {"bounce_power","越彈越猛","每反彈傷害 +12%，上限 +60%",4},{"bounce_life","回春折返","反彈延命 0.2 秒，每兵上限 1 秒",3},
 {"momentum","勢能穿刺","正向速度加成轉穿透傷害",4},{"shock","震盪","主要命中向其他怪擴散 20% 範圍傷害",6},
 {"crit_power","猛擊","爆擊倍率 +0.25",3},{"finisher","破陣","穿透累積最後一撞傷害",4},{"ember_burst","餘燼","終結接觸後範圍爆炸",5},
 {"king_hunter","獵王","對王主要傷害 +20%",3},{"frost_touch","凝霜之握","主要命中緩速",3},{"frenzy","狂獵戰旗","連殺 5/10/15 層增傷",4},
 {"last_stand","最後一搏","剩餘壽命低於25%時下一撞 +40%",3},{"heat","熱機","每秒主要傷害 +5%，上限25%",3},
 {"distance","遠征","地面移動12單位後下一撞 +30%",3},{"lightning","雷枝","爆擊雷鏈其他兩怪，每兵最多兩次",6},
 {"third_crit","決勝","每第三次主要命中必定爆擊",4},{"expire_burst","不屈","到期產生25%範圍傷害",4},
 {"wall_quake","震地","第一次反彈：30%範圍傷害，最多四怪",4},
 {"short_fuse","燃命","壽命-20%，傷害+45%",3},
 {"wide_blade","寬刃","範圍半徑+20%，範圍傷害-10%",3},
 {"hit_echo","三重回響","同兵命中三個不同主要目標後，追加20%範圍傷害，每兵一次",4},
 {"fracture","裂甲","命中前破防進度達70%，主要接觸傷害+20%",3},
 {"solo_hunt","孤獵","目標2單位內無其他活怪，主要傷害+25%",3},
 {"crowd_ring","聚獵","落地時附近至少三怪，旋轉半徑+20%，每兵一次",3},
 {"recruit","徵募","少於80金幣時派兵半價，每玩家每輪最多三次",1},
 {"rally","集結","本輪實付派兵400金幣後，全軍主要增傷15%持續10秒，每輪一次",3},
 {"rapid","急募","裝備此技能派兵頻率+25%，照價付費",3},
 {"solitary","孤軍","自己只有一支付費活兵時，該兵主要傷害+30%",3},
 {"showdown","決戰","最後30秒主要傷害+25%",4},
 {"sharp","鋒利","基礎傷害+10%",2},{"giant","巨力","基礎傷害+25%",3},
 {"double_pierce","雙重貫穿","穿透+2",7},{"deadly","致命","爆擊倍率+0.5",5},
 {"shatter","碎冰","命中已緩速目標 +30% 傷害；每兵一次碎冰波",4},
 {"ricochet_precision","鏡面準星","每反彈爆擊率 +15%，上限 +45%",4},
 {"hunter_vigor","狩獵續航","擊殺延命 0.25 秒，每兵上限 1 秒；不復活",3},
 {"piercing_wave","穿陣旋斬","每第二次成功穿透，對其他最多四怪造成20%範圍傷害",5},
 {"slow_force","重步碾壓","負向移速加成的75%轉為主要傷害，上限30%",3},
 {"spin_master","旋風擴張","旋轉半徑 +0.4、旋轉傷害 +20%；需要落地旋轉斬",4},
 {"rebound_charge","折光蓄勢","反彈後集氣 0.8 秒，隨機朝場內衝刺並提高速度與傷害；蓄勢期間撞擊額外 +45%，每次反彈仍會累積下一擊傷害",4},
 {"flame_cloak","火焰斗篷","詠唱0.28秒後，半徑2內每0.8秒造成18%基礎傷害；死亡停止",4},
 {"phoenix_fire","鳳凰之火","每1.8秒詠唱，向6範圍內隨機三怪噴火；灼燒3秒、每0.75秒16%基礎傷害",5},
 {"plague_vial","魔藥瓶","地面每走6單位投毒瓶；半徑1.8毒霧3秒，沾染中毒2秒、每0.5秒10%基礎傷害；不疊加",4},
 {"ember_trail","燎原步","地面每走1單位留下3秒火路；經過的怪物灼燒2秒，每0.6秒12%基礎傷害",4},
 {"slick_oil","滑溜黑油","主要傷害沾油3秒、移速-25%；遇火消耗黑油，爆燃並強化灼燒",3},
 {"rain_strike","喚雨擊","主要傷害使目標潮濕3秒，留下半徑1.2的3秒水池；遇雷傳導",3},
 {"storm_touch","掌心雷","主要傷害追加20%基礎雷傷；潮濕可引發感電與最多四怪的連鎖",5},
 {"oil_legacy","油甕遺贈","接觸死亡或壽命結束留下半徑2.2油池4秒；沾油減速、遇火燃燒，召回不觸發",3},
 {"plunder","掠奪","每次主要命中必得1金幣，總壽命與延命效果減半；持續傷害與追加傷害不領錢",2},
 {"firstborn","初生之犢","出生時移速+180%，3秒內線性衰退至0；重複來源增加衝刺強度，最多+270%",2},
 {"march_capacitor","蓄步雷匣","地面每走8單位蓄1層，最多2層；下次主要命中每層+30%傷害，並消耗蓄力",2},
 {"delayed_bloom","遲放焰心","出生2秒後釋放一次半徑2.2的火爆，最多4怪、50%基礎傷害；提前死亡取消",3},
 {"third_pulse","三拍震擊","每第3次主要命中釋放半徑1.8震波，最多4怪、40%基礎傷害；次級傷害不計次",3},
 {"battle_elegy","薪火相傳","4單位內同玩家部隊真正死亡時，自身主要傷害+25%持續2秒；刷新不疊加",2},
 {"grave_bloom","焰葬","造成敵人真正死亡時，在屍體半徑2.4內爆燃，最多4怪、40%基礎傷害；觸發爆發不再連鎖",4},
 {"last_echo","暮霜迴響","存活到剩25%壽命時釋放一次半徑2.3寒霜，最多4怪、35%基礎傷害並緩速1.5秒",2},
 {"necromancer","死靈法師","部隊真正死亡時有38%機率化成鬼魂，0.34秒內衝向5.8範圍最近敵人；半徑1.25內最多3怪，首擊34%、波及16%基礎傷害；每名玩家最多同時6魂，召回不觸發",4},
 {"comrade_oath","交鋒戰誓","己方士兵接觸互授2.5秒主要傷害+25%；需離開再碰觸，同對冷卻1.2秒，出生0.35秒內不觸發",3},
 {"resonant_debt","共鳴債印","主要命中埋印；4秒內再受己方5次傷害，半徑1.8爆發70%基傷、最多4怪；同種爆發不自連鎖",4},
 {"contact_mine","獵星伏雷","每2秒擺雷，0.35秒武裝後感應0.9內敵人；爆炸半徑2、50%基傷、最多5怪；5秒熄滅",4},
 {"step_orb","流明步雷","每走6單位留下光球，1.4秒後半徑1.8爆炸、45%基傷、最多4怪；每兵最多16顆",4},
 {"gravity_law","引力法則","每2.4秒蓄力0.25秒，將4.2內最多8隻小怪拉向自己，最多拉2單位；小王與大王免疫",4},
 {"quick_chant","迅咒齒輪","週期技能冷卻-25%，同能力疊加上限-50%；不改引信、持續時間、出生門檻或步數",3},
 {"overload_script","過載秘法","追加技能傷害×2，週期技能冷卻×1.5；不翻倍主要撞擊、BUFF或獎金；重複不疊加",5},
 {"storm_payload","雷紋接枝","伏雷、步雷與債印爆發轉成雷傷，可接現有潮濕感電；不增加引爆次數",2},
 {"cinder_seal","燼刻時印","主要命中留下1.2秒時印，爆炸半徑1.8、60%基礎傷害、最多4怪；重複命中不延後",3},
 {"chain_fuse","紅蓮導火","主要命中埋下1.8秒火種，半徑2.1爆炸造成50%基礎傷害；鄰近己方火種每隔0.12秒接力，最多六顆",4},
 {"thunder_fan","雷羽開屏","每第3次主要命中，蓄雷0.18秒後向前展開100度、4.8距離的五道雷羽；每道最多1怪、45%基礎傷害",4},
 {"echo_blade","斷界回斬","首次主要命中留下固定4.4單位斬線，0.55秒後返斬；寬1.1、55%基礎傷害、最多4怪",3},
 {"starfall","星隕追獵","出生2.8秒後鎖定最近三怪的位置；0.65秒起依序落星，半徑1.5、40%基礎傷害、每星最多3怪",4},
 {"soul_return","英魂返刃","真正死亡後，英魂沿最後12單位地面路徑以20速度返斬；40%基礎傷害、最多4個不同敵人，召回不觸發",3},
 {"legacy_gift","英魂託付","真正死亡時，隨機一名未滿層的己方活兵獲主要傷害+20%，直到其死亡；最多3層，召回不觸發",3},
 {"guard_bequest","碎甲遺願","真正死亡時，半徑2.8內最近3怪各受其破防值20%的追加傷害，單怪最多自身基傷；破防仍要抽獎，召回不觸發",3},
})do
 local id,name,description,price=entry[1] :: string,entry[2] :: string,entry[3] :: string,entry[4] :: number
 sourcePrices[id]=price
 table.insert(catalog,{id=id,name=name,type="技能裝備",desc=description.."；每支派兵 +"..price,apply=function()table.insert(S.skillSources[S.selected],{id=id})end})
end

for _,def in ipairs(awardAffixes)do
 local id=def.id
 table.insert(catalog,{id=id,name=def.name,type="獎級詞綴",desc=def.desc.."；同向上限24，反向抵銷；總開獎率與特獎不變",apply=function()table.insert(S.skillSources[S.selected],{id=id})end})
end
-- Balance v2: utility effects should not bankrupt a basic troop before their condition is useful.
local tunedPrices:{[string]:number}={pierce=2,critical=1,landing_spin=6,longlife=1,haste=1,heavy=2,bounce_power=1,bounce_life=1,momentum=2,shock=4,crit_power=1,finisher=2,ember_burst=4,king_hunter=2,frost_touch=1,frenzy=1,last_stand=1,heat=1,distance=1,lightning=3,third_crit=2,expire_burst=2,rebound_charge=1,shatter=2,ricochet_precision=1,hunter_vigor=1,piercing_wave=3,slow_force=1,spin_master=2,wall_quake=2,short_fuse=2,wide_blade=1,hit_echo=2,fracture=1,solo_hunt=1,crowd_ring=1,recruit=1,rally=1,rapid=2,solitary=1,showdown=2,sharp=1,giant=2,double_pierce=4,deadly=2}
for id,price in pairs(tunedPrices)do sourcePrices[id]=price end
for _,entry in ipairs(catalog)do if sourcePrices[entry.id] then entry.desc=entry.desc:gsub("；每支派兵 %+%d+","").."；每支派兵 +"..sourcePrices[entry.id]end end

local gearCatalog={
 {name="穿軍刃",slot=5,skill="pierce",price=96},{name="旋風長柄",slot=5,skill="landing_spin",price=120},{name="雷枝戰槍",slot=5,skill="lightning",price=144},
 {name="鷹眼盔",slot=1,skill="critical",price=72},{name="決勝冠",slot=1,skill="third_crit",price=112},{name="獵王面甲",slot=1,skill="king_hunter",price=96},
 {name="餘燼鎧",slot=2,skill="ember_burst",price=104},{name="長征甲",slot=2,skill="longlife",price=80},{name="不屈戰衣",slot=2,skill="expire_burst",price=120},
 {name="折光靴",slot=3,skill="rebound_charge",price=88},{name="疾行靴",slot=3,skill="haste",price=64},{name="回春靴",slot=3,skill="bounce_life",price=88},
 {name="猛擊護手",slot=4,skill="crit_power",price=80},{name="破陣護手",slot=4,skill="finisher",price=112},{name="凝霜護手",slot=4,skill="frost_touch",price=88},
 {name="狂獵戰旗",slot=2,skill="frenzy",price=104},{name="勢能戰槍",slot=5,skill="momentum",price=96},{name="震盪護手",slot=4,skill="shock",price=112},
 {name="碎冰刃",slot=5,skill="shatter",price=104},{name="鏡面盔",slot=1,skill="ricochet_precision",price=96},
 {name="獵命護手",slot=4,skill="hunter_vigor",price=80},{name="穿陣護手",slot=4,skill="piercing_wave",price=120},
 {name="磐石靴",slot=3,skill="slow_force",price=80},{name="風環冠",slot=1,skill="spin_master",price=96},
 {name="背水頭帶",slot=1,skill="last_stand",price=72},{name="熱機護手",slot=4,skill="heat",price=72},{name="遠征靴",slot=3,skill="distance",price=72},
 {name="重鋼甲",slot=2,skill="heavy",price=80},{name="折返頭冠",slot=1,skill="bounce_power",price=96},
 {name="火焰斗篷",slot=2,skill="flame_cloak",price=112},{name="鳳凰法杖",slot=5,skill="phoenix_fire",price=136},{name="鍊金藥匣",slot=4,skill="plague_vial",price=104},
 {name="交鋒誓旗",slot=2,skill="comrade_oath",price=88},
 {name="共鳴契印",slot=4,skill="resonant_debt",price=112},
 {name="伏雷腰匣",slot=2,skill="contact_mine",price=112},
 {name="流明行靴",slot=3,skill="step_orb",price=104},
 {name="引力星冠",slot=1,skill="gravity_law",price=120},
 {name="迅咒指環",slot=4,skill="quick_chant",price=96},
 {name="過載法典",slot=5,skill="overload_script",price=128},
 {name="雷紋護符",slot=1,skill="storm_payload",price=80},
 {name="燼刻指環",slot=4,skill="cinder_seal",price=104},{name="紅蓮火種匣",slot=2,skill="chain_fuse",price=120},{name="雷羽王冠",slot=1,skill="thunder_fan",price=120},{name="斷界雙刃",slot=5,skill="echo_blade",price=112},{name="星隕肩甲",slot=2,skill="starfall",price=120},{name="英魂戰靴",slot=3,skill="soul_return",price=104},
 {name="掠奪護手",slot=4,skill="plunder",price=80},{name="犢角疾行靴",slot=3,skill="firstborn",price=96},{name="蓄步雷匣",slot=2,skill="march_capacitor",price=96},{name="遲放焰心冠",slot=1,skill="delayed_bloom",price=112},{name="三拍戰錘",slot=5,skill="third_pulse",price=112},{name="薪火戰旗",slot=2,skill="battle_elegy",price=88},{name="送葬火刃",slot=5,skill="grave_bloom",price=120},{name="暮霜面甲",slot=1,skill="last_echo",price=96},
 {name="燎原戰靴",slot=3,skill="ember_trail",price=112},{name="黑油刃",slot=5,skill="slick_oil",price=88},{name="喚雨手環",slot=4,skill="rain_strike",price=96},{name="雷核冠",slot=1,skill="storm_touch",price=128},{name="油甕背甲",slot=2,skill="oil_legacy",price=88},
 {name="傳承魂燈",slot=4,skill="legacy_gift",price=96},
 {name="遺願裂甲盔",slot=1,skill="guard_bequest",price=104},
 {name="招魂骨冠",slot=1,skill="necromancer",price=116},
}
-- Every skill has a concrete equipment source, even optional numerical modifiers.
for _,entry in ipairs({
 {"震地靴",3,"wall_quake",96},{"燃命鎧",2,"short_fuse",80},{"寬刃戰斧",5,"wide_blade",88},
 {"回響護手",4,"hit_echo",104},{"裂甲面具",1,"fracture",80},{"孤獵冠",1,"solo_hunt",80},
 {"聚獵長柄",5,"crowd_ring",88},{"徵募印記",1,"recruit",48},{"集結戰旗",2,"rally",88},
 {"急募護手",4,"rapid",80},{"孤軍甲",2,"solitary",80},{"決戰冠",1,"showdown",104},
 {"鋒利短劍",5,"sharp",64},{"巨力護手",4,"giant",88},{"雙鋒戰槍",5,"double_pierce",144},{"致命冠",1,"deadly",120}
})do table.insert(gearCatalog,{name=entry[1] :: string,slot=entry[2] :: number,skill=entry[3] :: string,price=entry[4] :: number})end
local function canStoreItem()
 local equipped={};for _,worn in ipairs(S.worn :: {{number}})do for _,id in ipairs(worn)do if id~=0 then equipped[id]=true end end end
 local stored=0;for _,item in ipairs(S.items)do if not equipped[item.id] then stored+=1 end end
 return stored<12
end
local function addItem(def:any,paid:number)
 if not canStoreItem() then S.message="裝備庫已滿";return false end
 S.itemSerial+=1;table.insert(S.items,{id=S.itemSerial,name=def.name,slot=def.slot,skill=def.skill,paid=paid})
 return true
end
local function pay(amount:number)
 if S.coins<amount then S.message="金幣不足：需要 "..amount;return false end
 S.coins-=amount;S.shopSpent+=amount;return true
end
local function payCrystals(amount:number)
 if S.crystals<amount then S.message="強化結晶不足：需要 "..amount;return false end
 S.crystals-=amount;S.crystalSpent+=amount;return true
end
local function grantCrystals(amount:number)
 S.crystals+=amount;S.crystalEarned+=amount;S.lastCrystalGain=amount
end
local function awardCrystals(rank:number,tier:number,winner:number):number
 -- Only a successful prize contributes. No new RNG and no miss compensation.
 if winner~=S.seat then return 0 end
 local cap=12+(S.round-1)*4
 if S.roundCrystalEarned>=cap then return 0 end
 S.crystalProgress+=({.25,.5,1,2,4})[rank]*({1,1.5,2,3})[tier]
 local amount=min(cap-S.roundCrystalEarned,floor(S.crystalProgress))
 S.crystalProgress-=amount;S.roundCrystalEarned+=amount
 if amount>0 then grantCrystals(amount)end
 return amount
end
local function stockShop(keepRefresh:boolean?)
 if not keepRefresh then S.refreshCount=0 end
 S.refreshCost=2*((S.refreshCount or 0)+1)
 S.stock={};S.researchUsed=false;S.enchantUses=0;S.enchantPending=nil
 if S.location=="potion" then
  for i,name in ipairs({"疾風藥水","續命藥水","召回藥水"})do table.insert(S.stock,{kind="potion",value=i,name=name,price=({32,48,40})[i]})end
 elseif S.location=="rune" then
  local pool={};for i=1,#runeDefinitions do pool[i]=i end
  for _=1,4 do local i=table.remove(pool,1+floor(rng()*#pool));table.insert(S.stock,{kind="rune",value=i,name=runeNames[i],price=runePrices[i]})end
 elseif S.location=="tech" then
  local pool={};for _,entry in ipairs(catalog)do if skillDefinitions[entry.id] then table.insert(pool,entry.id)end end
  for i=1,3 do local pick=table.remove(pool,1+floor(rng()*#pool));table.insert(S.stock,{kind="tech",value=pick,name=pick,unit=1+floor(rng()*3),price=7})end
 elseif S.location=="curse" then
  for i,name in ipairs({"負債誓約","脆弱誓約","遲緩誓約"})do table.insert(S.stock,{kind="curse",value=i,name=name,price=0})end
 elseif S.location=="market" then
  local pool={};for index=1,#gearCatalog do pool[index]=index end
   local marketDiscount=0
   for i=1,4 do local index=table.remove(pool,1+floor(rng()*#pool));assert(index, "Equipment stock pool exhausted");local def=gearCatalog[index];table.insert(S.stock,{kind="gear",value=index,name=def.name,slot=def.slot,skill=def.skill,deployExtra=sourcePrices[def.skill] or 0,price=math.ceil(def.price*(1-marketDiscount)/8)})end
 end
 for _,item in ipairs(S.stock)do item.currency=(item.kind=="gear" or item.kind=="rune" or item.kind=="tech")and "crystal" or "gold" end
end
local locationEntries={}
for _,entry in ipairs({{"market","裝備店","結晶買賣裝備；購入後放進背包"},{"potion","藥水攤","花金幣購買，最多攜帶兩瓶"},{"tech","科技研究","7 結晶研究隨機兵種能力；本局生效"},{"enchant","附魔坊","8 結晶試附魔，可保留原詞綴"},{"curse","詛咒契約","承受兩輪代價，之後獲得強化"},{"rune","符文店","結晶買賣符文；整備時再分配給部隊"}})do
 local id,name,description=entry[1],entry[2],entry[3]
 table.insert(catalog,{id=id,name=name,type="地點",desc=description,apply=function()S.location=id;S.phase="shop";S.shopVisits+=1;stockShop()end})
 locationEntries[#locationEntries+1]=#catalog
end
local function offers()
 S.offer={};local pool={}
 for _,id in ipairs(locationEntries)do local place=catalog[id].id
  if (place~="curse" or S.round<=5) and (place~="enchant" or #S.items>0) then table.insert(pool,id)end
 end
 while #S.offer<3 do table.insert(S.offer,table.remove(pool,1+floor(rng()*#pool)))end
end
local function openLoadout():boolean
 if S.enchantPending then return false end
 if S.phase=="shop" or S.phase=="choice" or S.phase=="clear" then
  local matching=false;for _,item in ipairs(S.items)do if item.slot==S.equipSlot then matching=true end end
  if not matching and #S.items>0 then S.equipSlot=S.items[#S.items].slot end
  S.loadoutReturn=S.phase;S.phase="loadout";return true
 end
 return S.phase=="loadout"
end
local function travelToRound()
 S.phase="map";S.paused=false;S.mapMoving=true;S.mapElapsed=0;S.mapFrom=S.round-1;S.mapPosition=S.mapFrom;S.offer={}
end
local function addMonster(rank:number,x:number,z:number)
 serial+=1
 local guards={22,32,100,160,480};local _names={"橡果蹦蹦","菇背幼豬","獠牙搬木王","古榕守衛","冠角白鹿"}
 local skins={{"acorn","moth"},{"piglet","turtle"},{"boar","treant"},{"elder"},{"stag"}}
 local skin=skins[rank][1+serial%#skins[rank]]
 local skinNames={acorn="橡果蹦蹦",moth="苔羽蛾",piglet="菇背幼豬",turtle="苔殼龜",boar="獠牙搬木王",treant="花冠樹靈",elder="古榕守衛",stag="冠角白鹿"}
 local guard=floor(guards[rank]*(1+(S.round-1)*(rank==5 and .28 or (rank<=2 and .12 or .19))))
 monsters[#monsters+1]={id=serial,skin=skin,rank=rank,x=x,z=z,guard=guard,damage=0,alive=true,angle=rng()*math.pi*2,turn=1+rng()*3,breaks=0,slow=0,flash=0,name=skinNames[skin],scale=({.9,1.15,1.65,2.1,3.1})[rank]}
end
local function beginBattle()
 if skillRuntime then skillRuntime:reset()end
 monsters={};troops={};effects={};S.roundDuration=S.round==7 and 240 or 180;S.time=S.roundDuration;S.roundSettled=false;S.roundWinner=nil;S.phase="battle";S.paused=false;S.message="";cooldown=0
 S.roundRefund=0;S.returnedUnits=0
 S.roundCrystalEarned=0;S.crystalProgress=0;S.roundCrystalBonus=0
 S.targetId=0;S.targetName="";S.presentationDelay=0;S.roundOutro=nil;S.bossSpawned=false
 S.specialSpawned=false;S.wheelSpawned=false;S.recruitUses={0,0,0,0};S.roundSpent={0,0,0,0};S.rallyUsed={false,false,false,false};S.rallyUntil={0,0,0,0}
 -- Readable depth bands across the whole square: small creatures in front,
 -- large silhouettes behind them, with a clear initial firing lane at the cannon.
 for i=1,32 do
  local col=(i-1)%8;local row=floor((i-1)/8)
  addMonster(i%4==0 and 2 or 1,-10+col*2.85+(rng()-.5)*.8,-9.5+row*5.4+(rng()-.5)*1.1)
 end
 addMonster(3,-6,-4);addMonster(3,6,-5);addMonster(4,0,-8)
 -- One optional surge per round, before the final boss window.
 S.hordeAt=rng()<.7 and (22+rng()*23) or -1
 S.hordeCount=0;S.hordeNotice=0;S.hordeAdded=0
end
local function effect(x:number,z:number,kind:string,size:number?,direction:number?)
 effects[#effects+1]={x=x,z=z,kind=kind,age=0,size=size or 1,id=fxSerial+1,time=S.rewardClock,direction=direction}
 fxSerial+=1
 local count=kind=="frost" and 40 or (kind=="jackpot" and 65 or (kind=="spawn" and 80 or (kind=="wall_surge" and 32 or (kind=="wall_charge" and 18 or (kind=="critical" and 22 or (kind=="wall" and 9 or 14))))))
 local tint=kind=="frost" and "spark_ice" or ((kind=="lightning" or kind=="cleave") and "spark_gold" or kind=="renew" and "spark_jade" or (kind=="jackpot" or kind=="wall" or kind=="wall_charge" or kind=="wall_surge" or kind=="critical") and "spark_gold" or (kind=="spawn" and "spark_red" or "spark_jade"))
 for n=1,count do
  local sample=((n*2.39996+fxSerial*.71)%(2*math.pi))/(2*math.pi)
  local angle=direction and direction+(sample-.5)*(kind=="wall_surge" and .8 or .45) or n*2.39996+fxSerial
  local speed=kind=="frost" and (1.8+(n%7)*.34) or ((1+(n%7)*.3)*(kind=="spawn" and 2 or (kind=="wall_surge" and 2.7 or (kind=="wall_charge" and .65 or 1))))
  sparks[#sparks+1]={x=x,y=.2,z=z,vx=cos(angle)*speed,vz=sin(angle)*speed,vy=kind=="frost" and (2.2+(n%6)*.38) or (1.5+(n%6)*.45),age=0,life=kind=="frost" and (.68+(n%7)*.045) or (.4+(n%7)*.11),kind=tint,size=kind=="frost" and (.13+(n%3)*.025) or (.11+(n%3)*.04),spin=kind=="frost" and ((n%2==0 and 1 or -1)*(2+(n%5)*.55)) or nil}
 end
 while #sparks>650 do table.remove(sparks,1)end
end
local function combatVisual(kind:string,x:number,z:number,tx:number,tz:number,t:any,radius:number?)
 S.visualSerial+=1;table.insert(S.vfx,{id=S.visualSerial,kind=kind,x=x,z=z,tx=tx,tz=tz,sx=t.x,sz=t.z,radius=radius or 1,time=S.rewardClock,playerId=t.playerId,source=t.visualId,damageClass="secondary"})
 if #S.vfx>48 then table.remove(S.vfx,1)end
 S.skillTriggers[kind]=(S.skillTriggers[kind] or 0)+1
end
local function queueChest(playerId:number)
 local roll=rng();local tier=roll<.05 and 3 or (roll<.30 and 2 or 1)
 table.insert(S.chests,{tier=tier,playerId=playerId});S.chestCount=#S.chests
end
local function applyWheel(result:number,winner:number)
  local buffs=S.playerBuffs[winner]
  if result==1 then buffs.haste=S.rewardClock+10
  elseif result==2 then buffs.critical=S.rewardClock+10
  elseif result==3 then buffs.pierce+=8
  elseif result==4 then for _,unit in ipairs(troops)do if unit.alive and unit.playerId==winner then unit.life+=1*(unit.lifeScale or 1) end end
  elseif result==5 then
   local origin=corners[winner];local len=sqrt(origin.x^2+origin.z^2)
   for n=1,3 do serial+=1;local skills=composeSkills(1)
    table.insert(troops,{visualId=serial,equipment=table.clone(S.worn[1]),k=1,playerId=winner,paid=0,targetId=0,x=origin.x,z=origin.z,dx=-origin.x/len,dz=-origin.z/len,age=0,alive=true,damage=baseDamage[1],rune=0,skills=skills,pierceRemaining=skills.pierce,hits={},spinHits={},state="run",spin=0,travel=0,landing=5.4,life=2.5,bounceCount=0,lifeAdded=0,reboundStacks=0})
    skillRuntime:spawn(troops[#troops])
    S.freeFired+=1
   end
  else queueChest(winner)end
end
local function win(tier:number?)
 -- Game-owned outro: payment/refunds happen once on the winning tick. No
 -- animation callback can pay, skip the ceremony or advance the expedition.
 S.phase="celebration";S.won=true;S.autoConfigOpen=false;S.fireRearm=true
 S.roundOutro={eventId=S.event,tier=tier or 3,amount=S.prize,elapsed=0,duration=tier==4 and 6.4 or 3.3,result=S.round==7 and "victory" or "clear"}
 S.presentationDelay=S.roundOutro.duration
 S.message=S.round==7 and "七輪遠征完成，森林回應了你的號令。" or "大王已開出大獎，下一片森林在等你。"
end
local function settleSurvivors()
 if skillRuntime then skillRuntime:clear("round_end")end
 -- Run only after contact deaths and expiration have resolved for the final tick.
 -- The stored purchase price includes the discount at the time of deployment.
 if S.roundSettled then return end
 if not S.roundSettled then
  S.roundSettled=true
  if S.won then
   S.roundCrystalBonus=6+(S.round-1)*2;grantCrystals(S.roundCrystalBonus)
   town.materials+=30+(S.round==7 and 90 or 0);town.gold=town.materials;town.bestRound=math.max(town.bestRound,S.round);queueChest(S.roundWinner or S.seat)
   for i=#S.curses,1,-1 do local curse=S.curses[i];curse.remaining-=1;if curse.remaining<=0 then S.curseRewards[curse.kind]+=1;table.remove(S.curses,i)end end
  elseif S.phase=="defeat" then
   -- Progress is earned from actual battle time, never from repeatedly opening menus.
   town.materials+=min(20,floor((S.roundDuration-S.time)/9));town.gold=town.materials;town.bestRound=math.max(town.bestRound,S.round-1);S.message..=" 帶回城鎮建材。"
  end
  persistProfiles()
 end
 local refund,count=0,0
 for _,t in ipairs(troops)do
  if t.alive and t.age<t.life then refund+=t.paid;count+=1;changeGold(t.playerId or S.seat,t.paid)end
 end
 S.refunded+=refund;S.roundRefund=refund;S.returnedUnits=count
 S.returnedTotal+=count
 troops={}
end
local function recordKill(t:any,m:any,kind:string?,reaction:boolean?)
 if skillRuntime then skillRuntime:onEnemyDeath(t,m,{reaction=reaction==true,triggered=kind=="guard_bequest"or kind=="resonant_debt"or kind=="contact_mine"or kind=="step_orb"or kind=="grave_bloom"or kind=="third_pulse"or kind=="delayed_bloom"or kind=="last_echo"or kind=="cinder_seal"or kind=="chain_fuse"or kind=="thunder_fan"or kind=="echo_blade"or kind=="starfall"or kind=="soul_return"})end
 -- Only the killer's own living troop can extend itself. Expired/contact-dead troops stay dead.
 if t.alive and t.age<t.life and t.skills.killLife>0 then
  local extra=min(max(0,1-(t.killLifeAdded or 0)),t.skills.killLife)
  t.life+=extra*(t.lifeScale or 1);t.killLifeAdded=(t.killLifeAdded or 0)+extra
  if extra>0 then effect(t.x,t.z,"renew",.6)end
 end
 if t.skills.frenzy<=0 then return end
 local streak=S.streaks[t.playerId or S.seat];streak.count=min(15,streak.count+1);streak.time=2.5
end
local function hit(m:any,amount:number,t:any,secondary:boolean?,damageType:string?,reaction:boolean?)
 if not m.alive or S.phase~="battle" then return end
 if t.targetId~=0 and t.targetId~=m.id then S.lockViolations+=1;return end
 local critical=false
 if not secondary then
  local alreadySlowed=m.slow>0
  if t.rune==1 then amount*=1.35 elseif t.rune==3 then m.slow=2 end
  if t.skills.frost>0 then m.slow=max(m.slow,1.2)end
  t.mainHits=(t.mainHits or 0)+1
  local inRunSurge=t.state=="run" or t.state=="wall_surge"
  local bonus=skillRuntime.composition:damageBonus(t)+skillRuntime.triggers:consumeDamageBonus(t)+min(.6,(t.bounceCount or 0)*t.skills.bouncePower)+min(.25,floor(t.age)*t.skills.heat)
  if t.state=="wall_surge" and (t.wallSurgeRemaining or 0)>0 then bonus+=t.wallSurgeDamageBonus or .45 end
  bonus+=min(.3,max(0,-t.skills.speedBonus)*t.skills.slowForce)
  if alreadySlowed and t.skills.shatter>0 then
   bonus+=min(.9,t.skills.shatter)
   if not t.shatterUsed then
    t.shatterUsed=true;pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,exclude=m.id,t=t,damage=t.damage*min(.6,t.skills.shatter),radius=1.8,limit=4,kind="frost"}
   end
  end
  if S.rewardClock<S.rallyUntil[t.playerId or S.seat] then bonus+=.15 end
  if S.time<=30 then bonus+=min(.75,t.skills.showdown)end
  if inRunSurge and m.damage>=m.guard*.7 then bonus+=min(.6,t.skills.fracture)end
  if t.skills.soloHunt>0 then
   local alone=true;for _,other in ipairs(monsters)do if other.alive and other.id~=m.id and (other.x-m.x)^2+(other.z-m.z)^2<4 then alone=false;break end end
   if alone then bonus+=min(.75,t.skills.soloHunt)end
  end
  if t.skills.solitary>0 and t.paid>0 then
   local count=0;for _,other in ipairs(troops)do if other.alive and other.paid>0 and other.playerId==t.playerId then count+=1 end end
   if count==1 then bonus+=min(.9,t.skills.solitary)end
  end
  if t.k==1 and inRunSurge then bonus+=t.skills.swordContact end
  if t.skills.hitEcho>0 then
   t.echoTargets=t.echoTargets or {};if not t.echoTargets[m.id] then t.echoTargets[m.id]=true;t.echoCount=(t.echoCount or 0)+1 end
   if t.echoCount>=3 and not t.echoUsed then t.echoUsed=true;pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,exclude=m.id,t=t,damage=t.damage*min(.6,t.skills.hitEcho),radius=1.5,limit=4,kind="cleave"}end
  end
  if m.rank>=3 then bonus+=t.skills.kingDamage end
  if t.skills.frenzy>0 then bonus+=floor(S.streaks[t.playerId or S.seat].count/5)*.1 end
  if inRunSurge then
   if t.pierceRemaining>0 then bonus+=min(.6,max(0,t.skills.speedBonus+skillRuntime.triggers:speedBonus(t)+(S.rewardClock<S.playerBuffs[t.playerId or S.seat].haste and .25 or 0))*t.skills.momentum)
   else bonus+=min(5,(t.skills.pierce-t.pierceRemaining))*t.skills.finisher end
   if t.age>=t.life*.75 and not t.lastStandUsed then bonus+=t.skills.lastStand;t.lastStandUsed=true end
   if (t.groundTravel or 0)>=12 and not t.distanceUsed then bonus+=t.skills.distance;t.distanceUsed=true end
  end
  bonus+=(t.reboundStacks or 0)*t.skills.reboundCharge;t.reboundStacks=0
  amount*=1+bonus
  local critBonus=min(.45,(t.bounceCount or 0)*t.skills.bounceCrit)
  local townCrit=t.k==1 and t.skills.swordCrit or 0
  local critChance=t.skills.critChance+townCrit+critBonus+(S.rewardClock<S.playerBuffs[t.playerId or S.seat].critical and .2 or 0)
  critical=(t.skills.thirdCrit>0 and t.mainHits%3==0) or (critChance>0 and rng()<min(1,critChance))
  if critical then amount*=max(1.5,t.skills.critMultiplier);S.criticalHits+=1;effect(m.x,m.z,"critical",1)end
  if t.skills.shock>0 and S.rewardClock>=(t.shockAfter or 0) and (t.state~="spin" or not t.spinShockUsed) then
   pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,exclude=m.id,t=t,damage=t.damage*t.skills.shock,radius=1.2,limit=4,kind="shock"}
   t.shockAfter=S.rewardClock+skillRuntime.composition:period(t,.25);if t.state=="spin" then t.spinShockUsed=true end
  end
  if critical and t.skills.lightning>0 and (t.lightningUses or 0)<2 then
   t.lightningUses=(t.lightningUses or 0)+1;pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,exclude=m.id,t=t,damage=t.damage*t.skills.lightning,radius=2.4,limit=2,kind="lightning"}
  end
 else S.procHits+=1;amount*=skillRuntime.composition:spellPower(t) end
 S.rankEconomy[m.rank].damage+=amount
 -- Read-only hit receipts: record the final applied damage, even when the
 -- following guard-break lottery misses. No extra rolls or economic effects.
 S.damageEvent+=1
 table.insert(S.damageEvents,{id=S.damageEvent,monsterId=m.id,playerId=t.playerId or S.seat,source=t.visualId,amount=amount,critical=critical,secondary=secondary==true,x=m.x,z=m.z,rank=m.rank,time=S.rewardClock,damageType=damageType,reaction=reaction==true})
 if #S.damageEvents>128 then table.remove(S.damageEvents,1)end
 m.damage+=amount;m.flash=.12
 if skillRuntime then
  local kind=damageType or(not secondary and t.rune==1 and "fire"or "physical")
  local element=(kind=="burn"or kind=="flame_cloak"or kind=="ember"or kind=="fire"or kind=="ignite"or kind=="grave_bloom"or kind=="delayed_bloom"or kind=="cinder_seal"or kind=="chain_fuse"or kind=="starfall"or kind=="soul_wraith")and "fire"or((kind=="lightning"or kind=="thunder_fan")and "lightning"or "physical")
  if (t.skills.stormPayload or 0)>0 and(kind=="resonant_debt"or kind=="contact_mine"or kind=="step_orb"or kind=="soul_wraith")then element="lightning"elseif kind=="contact_mine"then element="fire"end
  skillRuntime:onDamage(t,m,{id=S.damageEvent,amount=amount,secondary=secondary==true,element=element,reaction=reaction==true,kind=kind})
 end
 effect(m.x,m.z,"impact",.6)
 if m.damage<m.guard then return end
 -- One hit may cause one lottery only. Excess damage is not another ticket.
 m.damage=0;m.breaks+=1;S.breaks+=1;S.rankEconomy[m.rank].attempts+=1
 -- Breaking guard purchases an attempt, never a guaranteed prize. No pity gate.
 local chance=(m.special=="beetle" and .25 or baseAwardChances[m.rank])*economyTuning.awardScale
 if rng()>=chance then
  S.lotteryMisses+=1
  table.insert(S.lotteryResults,{monsterId=m.id,playerId=t.playerId or S.seat,won=false,tier=0,amount=0,time=S.rewardClock})
  if #S.lotteryResults>40 then table.remove(S.lotteryResults,1)end
  -- Every failed award leaves the monster alive. Guard was reset above;
  -- no money, kill streak, kill-life extension or extra lottery is granted.
  return
 end
 local roll=rng();local distribution=awardWeights(m,t.skills,S.luck)
 local tier=selectAwardTier(distribution.weights,roll)
 if m.special=="roulette" then
  local winner=t.playerId or S.seat;local result=1+floor(rng()*6)
  awardCrystals(m.rank,tier,winner)
  S.roulette={id=(S.roulette and S.roulette.id or 0)+1,playerId=winner,result=result,label=({"疾風號令","戰意沸騰","穿軍祝福","生命之泉","免費援軍","領主寶箱"})[result],time=S.rewardClock}
  S.pendingWheel[#S.pendingWheel+1]={winner=winner,result=result,revealAt=S.rewardClock+2.6,id=S.roulette.id}
  m.alive=false;S.kills+=1;recordKill(t,m,damageType,reaction);effect(m.x,m.z,"jackpot",1.5)
  table.insert(S.lotteryResults,{monsterId=m.id,playerId=winner,won=true,tier=1,amount=0,wheel=result,time=S.rewardClock})
  if #S.lotteryResults>40 then table.remove(S.lotteryResults,1)end
  return
 end
 local prizes={{16},{28},{28,50,110},{48,100,250},{80,180,500,1100}}
 local prize=prizes[m.rank][tier] or prizes[m.rank][1]
 prize=floor(prize*(1+(S.round-1)*(m.rank<=2 and 0 or .08))*(t.rune==2 and 1.25 or 1))
 if m.special=="beetle" then
  prize=m.poolGold;tier=3;S.poolPaidOut+=prize;S.poolWinner=t.playerId or S.seat
  m.poolGold=0;m.alive=false;S.kills+=1;recordKill(t,m,damageType,reaction)
 end
 local winner=t.playerId or S.seat
 local crystalGain=awardCrystals(m.rank,tier,winner)
 changeGold(winner,prize);S.earned+=prize;S.rankEconomy[m.rank].earned+=prize;S.event+=1;S.prize=prize;S.prizeTier=tier;S.lastMonster=m.name
 table.insert(S.lotteryResults,{monsterId=m.id,playerId=winner,won=true,tier=tier,amount=prize,awardShift=distribution.shift,time=S.rewardClock})
 if #S.lotteryResults>40 then table.remove(S.lotteryResults,1)end
 local multiplier=m.special=="beetle" and prize/80 or prize/max(1,t.paid)
 local celebration=tier==4 and "LEGENDARY WIN" or (tier==3 and (m.rank>=4 and "MEGA WIN" or "BIG WIN") or "")
 rewardEvents[#rewardEvents+1]={id=S.event,playerId=winner,tier=tier,amount=prize,crystals=crystalGain,multiplier=multiplier,title=celebration,name=m.name,x=m.x,z=m.z,time=S.rewardClock}
 if #rewardEvents>40 then table.remove(rewardEvents,1)end
 local count=({8,18,38,72})[tier];local player=corners[winner]
 -- Visual scatter uses an analytic pattern; it never consumes lottery RNG.
 for n=1,count do
  local a=n*2.39996+S.event;local radius=.35+(n%9)*.12
  coinsFX[#coinsFX+1]={x=m.x,z=m.z,dx=cos(a)*radius,dz=sin(a)*radius,tx=player.x,tz=player.z,age=-n*.008,peak=.8+(n%5)*.17}
 end
 if #coinsFX>420 then for _=1,#coinsFX-420 do table.remove(coinsFX,1)end end
 effect(m.x,m.z,"jackpot",m.scale*2)
 if m.alive and (m.rank<=2 or tier>=3) then m.alive=false;S.kills+=1;recordKill(t,m,damageType,reaction);if m.rank==5 then S.roundWinner=winner;win(tier)end end
end
-- BEGIN GENERATED SKILL RUNTIME
-- Game-owned combinations: trigger recipes, payloads and source modifiers.
local function createCompositionRuntime(hooks:any)
 local C:any={clock=0,serial=0,units={},pairs={},marks={},nodes={},wells={},queue={},events={},counts={},tracks={},monsterStarts={}}
 C.recipes={
  contact_mine={trigger="period",modifier="contactMine",period=2,arm=.35,ttl=5,triggerRadius=.9,radius=2,damage=.5,targets=5,cap=3,playerCap=64},
  step_orb={trigger="distance",modifier="stepOrb",distance=6,delay=1.4,radius=1.8,damage=.45,targets=4,cap=16,playerCap=256},
  resonant_debt={trigger="received_hits",modifier="resonantDebt",hits=5,ttl=4,radius=1.8,damage=.7,targets=4},
  gravity_law={trigger="period",modifier="gravityLaw",period=2.4,windup=.25,duration=.4,radius=4.2,targets=8,distance=2},
  comrade_oath={trigger="ally_contact",modifier="comradeOath",radius=.65,duration=2.5,bonus=.25,cooldown=1.2},
 }
 local function now()return hooks.clock()end
 local function id()C.serial+=1;return C.serial end
 local function player(t:any)return t.playerId or 1 end
 local function allowed(t:any,m:any)return m.alive and(t.targetId==0 or t.targetId==m.id)end
 local function has(t:any,key:string)return(t.skills[key]or 0)>0 end
 local function radius(t:any,r:number)return r*(1+math.min(.6,t.skills.areaBonus or 0))end
 function C:period(t:any,seconds:number)
  return seconds*(1-math.min(.5,math.max(0,t.skills.quickChant or 0)*.25))*(has(t,"overloadScript")and 1.5 or 1)
 end
 function C:spellPower(t:any)return has(t,"overloadScript")and 2 or 1 end
 local function event(kind:string,t:any,x:number,z:number,extra:any?)
  local e={id=id(),kind=kind,time=now(),x=x,z=z,sourceId=t.visualId,playerId=player(t)}
  if extra then for k,v in pairs(extra)do e[k]=v end end
  C.events[#C.events+1]=e;if #C.events>128 then table.remove(C.events,1)end
 end
 local function count(kind:string)C.counts[kind]=(C.counts[kind]or 0)+1 end
 local function unit(t:any)
  if not C.units[t.visualId]then C.units[t.visualId]={owner=t,distance=0,nextMine=now()+C:period(t,C.recipes.contact_mine.period),nextGravity=now()+C:period(t,C.recipes.gravity_law.period)}end
  return C.units[t.visualId]
 end
 function C:attach(t:any)unit(t)end
 local function node(kind:string,t:any,x:number,z:number)
  local r=C.recipes[kind];local n={id=id(),kind=kind,owner=t,x=x,z=z,born=now(),due=now()+(r.delay or r.ttl),armed=now()+(r.arm or 0),radius=radius(t,r.radius),element=has(t,"stormPayload")and "lightning"or(kind=="contact_mine"and "fire"or "arcane")}
  local sourceCount,playerCount=0,0
  for _,v in ipairs(C.nodes)do if v.kind==kind then if v.owner==t then sourceCount+=1 end;if player(v.owner)==player(t)then playerCount+=1 end end end
  -- Keep committed timers. Replacing old nodes can starve every detonation at high speed.
  if sourceCount>=r.cap or playerCount>=r.playerCap then return nil end
  C.nodes[#C.nodes+1]=n;count(kind);return n
 end
 function C:beginFrame(live:any,monsters:any)
  self.tracks={};self.monsterStarts={}
  -- Trajectories are normalized over the same simulation tick, split at walls.
  local enabled=false;for _,t in ipairs(live)do if t.alive and has(t,"comradeOath")then enabled=true;break end end
  self.trackContacts=enabled
  if enabled then for _,t in ipairs(live)do if t.alive then self.tracks[t.visualId]={owner=t,x=t.x,z=t.z,segments={},distance=0,planned=0}end end end
  for _,m in ipairs(monsters)do if m.alive then self.monsterStarts[m.id]={x=m.x,z=m.z}end end
 end
 function C:planMove(t:any,distance:number)
  local tr=self.tracks[t.visualId];if tr then tr.planned=distance end
 end
 function C:moved(t:any,ax:number,az:number,bx:number,bz:number)
  if not hooks.active()or t.state=="airborne"then return end
  local length=math.sqrt((bx-ax)^2+(bz-az)^2);if length<1e-8 then return end
  local tr=self.tracks[t.visualId]
  if tr then local from=tr.distance;tr.distance+=length;tr.segments[#tr.segments+1]={ax=ax,az=az,bx=bx,bz=bz,from=from,to=tr.distance}end
  if has(t,"stepOrb")then
   local u=unit(t);local r=self.recipes.step_orb;local step=r.distance-u.distance
   while step<=length+1e-8 do local q=math.min(1,step/length);node("step_orb",t,ax+(bx-ax)*q,az+(bz-az)*q);step+=r.distance end
   u.distance=(u.distance+length)%r.distance;if u.distance<1e-8 or r.distance-u.distance<1e-8 then u.distance=0 end
  end
 end
 local function closest(ax:number,az:number,bx:number,bz:number,x:number,z:number)
  local dx,dz=bx-ax,bz-az;local q=math.clamp(((x-ax)*dx+(z-az)*dz)/math.max(1e-12,dx*dx+dz*dz),0,1)
  return (ax+dx*q-x)^2+(az+dz*q-z)^2,q
 end
 local function position(tr:any,q:number)
  local d=q*math.max(tr.planned,tr.distance)
  for _,s in ipairs(tr.segments)do if d<=s.to+1e-8 then local p=math.clamp((d-s.from)/math.max(1e-8,s.to-s.from),0,1);return s.ax+(s.bx-s.ax)*p,s.az+(s.bz-s.az)*p end end
  return tr.owner.x,tr.owner.z
 end
 local function crossed(a:any,b:any,r:number)
  local times={0,1}
  for _,tr in ipairs({a,b})do for _,s in ipairs(tr.segments)do times[#times+1]=s.to/math.max(1e-8,tr.planned,tr.distance)end end
  table.sort(times)
  for i=2,#times do local q0,q1=times[i-1],times[i]
   local ax,az=position(a,q0);local bx,bz=position(b,q0);local atx,atz=position(a,q1);local btx,btz=position(b,q1)
   local distance,q=closest(ax-bx,az-bz,atx-btx,atz-btz,0,0)
   if distance<=r*r then return true,(ax+(atx-ax)*q+bx+(btx-bx)*q)*.5,(az+(atz-az)*q+bz+(btz-bz)*q)*.5 end
  end
  return false,0,0
 end
 function C:contacts(live:any)
  local r=self.recipes.comrade_oath;local eligible={};local seen={}
  for _,t in ipairs(live)do if t.alive and t.state~="airborne"and(t.age or 0)>=.35 and(t.travel or 0)>=1.5 then
   eligible[#eligible+1]=t;self.tracks[t.visualId]=self.tracks[t.visualId]or{owner=t,x=t.x,z=t.z,segments={},distance=0,planned=0}
  end end
  table.sort(eligible,function(a:any,b:any)return a.visualId<b.visualId end)
  for i=1,#eligible do for j=i+1,#eligible do local a,b=eligible[i],eligible[j]
   if player(a)==player(b)and(has(a,"comradeOath")or has(b,"comradeOath"))then
    local key=a.visualId..":"..b.visualId;local old=self.pairs[key]or{touching=false,next=0};seen[key]=true
    local contact,x,z=crossed(self.tracks[a.visualId],self.tracks[b.visualId],r.radius)
    if contact and not old.touching and now()+1e-8>=old.next then
     local source=has(a,"comradeOath")and a or b;old.next=now()+self:period(source,r.cooldown)
     a.oathUntil=now()+r.duration;b.oathUntil=now()+r.duration;count("comrade_oath");event("comrade_oath",source,x,z,{tx=b.x,tz=b.z,radius=r.radius})
    end
    old.touching=(a.x-b.x)^2+(a.z-b.z)^2<=r.radius^2;self.pairs[key]=old
   end
  end end
  for key in pairs(self.pairs)do if not seen[key]then self.pairs[key]=nil end end
 end
 function C:damageBonus(t:any)return(t.oathUntil or 0)>now()and self.recipes.comrade_oath.bonus or 0 end
 function C:onDamage(t:any,m:any,info:any)
  if not hooks.active()or(info.amount or 0)<=0 or not allowed(t,m)then return end
  -- A debt explosion cannot advance another debt; all other friendly hits and DoTs can.
  if info.kind=="resonant_debt"then return end
  local key=player(t)..":"..m.id;local mark=self.marks[key]
  if mark and mark.due<=now()then self.marks[key]=nil;mark=nil end
  if mark then
   mark.hits+=1
   if mark.hits>=self.recipes.resonant_debt.hits then
    self.marks[key]=nil;self.queue[#self.queue+1]={kind="resonant_debt",owner=mark.owner,x=m.x,z=m.z,radius=radius(mark.owner,self.recipes.resonant_debt.radius),element=has(mark.owner,"stormPayload")and "lightning"or "arcane"};count("resonant_debt")
   end
  elseif not info.secondary and has(t,"resonantDebt")then
   self.marks[key]={id=id(),kind="resonant_debt",owner=t,target=m,hits=0,due=now()+self.recipes.resonant_debt.ttl}
  end
 end
 local function explode(n:any)
  count(n.kind.."_detonate")
  local r=C.recipes[n.kind];local list={}
  for _,m in ipairs(hooks.monsters())do if allowed(n.owner,m)then local d=(m.x-n.x)^2+(m.z-n.z)^2;if d<=n.radius^2 or m==n.triggerTarget then list[#list+1]={m=m,d=m==n.triggerTarget and -1 or d}end end end
  table.sort(list,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end)
  event(n.kind,n.owner,n.x,n.z,{radius=n.radius,element=n.element,power=C:spellPower(n.owner),phase="explode"})
  for i=1,math.min(r.targets,#list)do if not hooks.active()then break end;count(n.kind.."_hits");hooks.damage(list[i].m,n.owner.damage*r.damage*math.max(.5,1-(n.owner.skills.areaPenalty or 0)),n.owner,n.kind)end
 end
 function C:flush()
  -- Drain one generation only. Mine/orb hits may finish marks on the next flush.
  local jobs=self.queue;self.queue={};for _,n in ipairs(jobs)do if not hooks.active()then break end;explode(n)end
  if not hooks.active()then self:clear()end
 end
 function C:update(dt:number,live:any)
  if not hooks.active()then self:clear();return end
  local present={}
  for _,t in ipairs(live)do if t.alive then
   present[t.visualId]=true;local u=unit(t)
   if has(t,"contactMine")and t.state~="airborne"and now()+1e-8>=u.nextMine then node("contact_mine",t,t.x,t.z);u.nextMine=now()+self:period(t,self.recipes.contact_mine.period)end
   if has(t,"gravityLaw")and now()+1e-8>=u.nextGravity then
    local r=self.recipes.gravity_law;local existing=false;for _,w in ipairs(self.wells)do if w.owner==t then existing=true end end
    if not existing then self.wells[#self.wells+1]={id=id(),owner=t,born=now(),due=now()+r.windup,untilTime=now()+r.windup+r.duration,pulled={}};count("gravity_law")end
    u.nextGravity=now()+self:period(t,r.period)
   end
  end end
  local pullBudget={};local r=self.recipes.gravity_law
  for i=#self.wells,1,-1 do local w=self.wells[i];local t=w.owner
   if not t.alive or not present[t.visualId]or now()>w.untilTime+1e-8 then table.remove(self.wells,i)
   elseif now()+1e-8>=w.due then
    if not w.targets then
     local choices={};for _,m in ipairs(hooks.monsters())do if allowed(t,m)and m.rank<=2 then local d=(m.x-t.x)^2+(m.z-t.z)^2;if d<=r.radius^2 then choices[#choices+1]={m=m,d=d}end end end
     table.sort(choices,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end);w.targets={}
     for n=1,math.min(r.targets,#choices)do w.targets[#w.targets+1]=choices[n].m end
    end
    local elapsed=math.max(0,math.min(now(),w.untilTime)-math.max(now()-dt,w.due))
    for _,m in ipairs(w.targets)do if allowed(t,m)then
     local dx,dz=t.x-m.x,t.z-m.z;local length=math.sqrt(dx*dx+dz*dz)
     local step=math.min(math.max(0,length-.9),math.max(0,r.distance-(w.pulled[m.id]or 0)),r.distance/r.duration*elapsed,math.max(0,5*dt-(pullBudget[m.id]or 0)))
     if step>0 then
      local wall=math.max(0,hooks.wallX-(.4+m.scale*.5)-.65)
      m.x=math.clamp(m.x+dx/length*step,-wall,wall);m.z=math.clamp(m.z+dz/length*step,-wall,wall)
      w.pulled[m.id]=(w.pulled[m.id]or 0)+step;pullBudget[m.id]=(pullBudget[m.id]or 0)+step
     end
    end end
   end
  end
  for i=#self.nodes,1,-1 do local n=self.nodes[i];local trigger=false;local expired=now()+1e-8>=n.due
   if n.kind=="step_orb"then trigger=expired
   elseif not expired and now()+1e-8>=n.armed then
    for _,m in ipairs(hooks.monsters())do if allowed(n.owner,m)then
     local start=self.monsterStarts[m.id]or m
     -- An arming mine only senses the path after it became armed, never old travel.
     local fraction=dt>0 and math.clamp((n.armed-(now()-dt))/dt,0,1)or 1
     local ax,az=start.x+(m.x-start.x)*fraction,start.z+(m.z-start.z)*fraction
     if closest(ax,az,m.x,m.z,n.x,n.z)<=self.recipes.contact_mine.triggerRadius^2 then trigger=true;n.triggerTarget=m;break end
    end end
   end
   if trigger or expired then table.remove(self.nodes,i);if trigger then self.queue[#self.queue+1]=n end end
  end
  for key,mark in pairs(self.marks)do if not mark.target.alive or now()>=mark.due then self.marks[key]=nil end end
  if self.trackContacts then self:contacts(live)else self.pairs={}end
  for id in pairs(self.units)do if not present[id]then self.units[id]=nil end end
  for i=#self.events,1,-1 do if now()-self.events[i].time>1 then table.remove(self.events,i)end end
  self:flush();self.tracks={};self.monsterStarts={}
 end
 function C:hasPendingDamage()return #self.nodes>0 or #self.queue>0 end
 function C:view()
  local v={nodes={},marks={},wells={},buffs={},events=self.events,counts=self.counts}
  for _,n in ipairs(self.nodes)do v.nodes[#v.nodes+1]={id=n.id,kind=n.kind,x=n.x,z=n.z,radius=n.radius,triggerRadius=self.recipes[n.kind].triggerRadius,element=n.element,armed=now()>=n.armed,remaining=math.max(0,n.due-now()),progress=math.clamp((now()-n.born)/(n.due-n.born),0,1)}end
  for _,m in pairs(self.marks)do v.marks[#v.marks+1]={id=m.id,x=m.target.x,z=m.target.z,hits=m.hits,required=5,remaining=math.max(0,m.due-now()),playerId=player(m.owner)}end
  for _,w in ipairs(self.wells)do local r=self.recipes.gravity_law;v.wells[#v.wells+1]={id=w.id,x=w.owner.x,z=w.owner.z,radius=r.radius,progress=math.clamp((now()-w.born)/(w.untilTime-w.born),0,1),active=now()>=w.due}end
  for _,u in pairs(self.units)do local t=u.owner;if t.alive and(t.oathUntil or 0)>now()then v.buffs[#v.buffs+1]={kind="comrade_oath",sourceId=t.visualId,x=t.x,z=t.z,remaining=t.oathUntil-now()}end end
  table.sort(v.marks,function(a:any,b:any)return a.hits>b.hits or a.hits==b.hits and a.id<b.id end);table.sort(v.buffs,function(a:any,b:any)return a.sourceId<b.sourceId end)
  return v
 end
 function C:clear()self.units={};self.pairs={};self.marks={};self.nodes={};self.wells={};self.queue={};self.events={};self.tracks={};self.monsterStarts={}end
 function C:reset()self:clear();self.serial=0;self.counts={}end
 return C
end

-- Gameplay-owned elemental surfaces and event dispatch. No rendering or lottery rules here.
local function createElementRuntime(hooks:any)
 local E:any={fields={},statuses={},queue={},events={},serial=0,nextScan=0,reactions=0,triggers={distance=0,damage=0,death=0}}
 E.rules={
  {id="ember_trail",modifier="emberTrail",trigger="distance",action="fire_path",distance=1,duration=3,radius=.48,cap=12},
  {id="slick_oil",modifier="slickOil",trigger="damage",action="coat_oil",primaryOnly=true,duration=3},
  {id="rain_strike",modifier="rainStrike",trigger="damage",action="splash_water",primaryOnly=true,duration=3,radius=1.2,cap=6},
  {id="storm_touch",modifier="stormTouch",trigger="damage",action="strike_lightning",primaryOnly=true,damage=.2},
  {id="oil_legacy",modifier="oilLegacy",trigger="death",action="spill_oil",duration=4,radius=2.2,cap=1},
 }
 E.reactionRules={oilFire={cooldown=1,burnDuration=2.4,burnInterval=.6,burnDamage=.24,burst=.25},waterLightning={cooldown=1.2,range=3,targets=4,damage=.25,duration=1.8,interval=.6,tick=.12},firePath={duration=2,interval=.6,damage=.12}}
 local function now()return hooks.clock()end
 local function id()E.serial+=1;return 1000000+E.serial end
 local function allowed(t:any,m:any)return m.alive and (t.targetId==0 or t.targetId==m.id)end
 local function has(t:any,key:string)return (t.skills[key] or 0)>0 end
 local function scaled(t:any,key:string)return 1+math.min(1,math.max(0,(t.skills[key] or 1)-1)*.25)end
 local function radius(t:any,r:number)return r*(1+math.min(.6,t.skills.areaBonus or 0))end
 local function areaDamage(t:any,d:number)return t.damage*d*math.max(.5,1-(t.skills.areaPenalty or 0))end
 local function signal(kind:string,t:any,x:number,z:number,tx:number?,tz:number?,extra:any?)
  E.events[#E.events+1]={id=id(),kind=kind,sourceId=t.visualId,playerId=t.playerId,x=x,z=z,tx=tx or x,tz=tz or z,time=now(),trigger=extra and extra.trigger,reason=extra and extra.reason}
  if #E.events>128 then table.remove(E.events,1)end
 end
 local function distance2(x:number,z:number,f:any)
  local dx,dz=f.tx-f.ox,f.tz-f.oz;local length=dx*dx+dz*dz
  local p=length>1e-10 and math.clamp(((x-f.ox)*dx+(z-f.oz)*dz)/length,0,1)or 0
  return (x-f.ox-dx*p)^2+(z-f.oz-dz*p)^2
 end
 local function status(m:any,kind:string)
  local s=E.statuses[tostring(m.id)..":"..kind]
  return s and s.untilTime>now()+1e-8 and m.alive and s or nil
 end
 local function removeStatus(m:any,kind:string)E.statuses[tostring(m.id)..":"..kind]=nil end
 local function coat(m:any,kind:string,t:any,duration:number)
  if not allowed(t,m)then return end
  local key=tostring(m.id)..":"..kind;local s=status(m,kind)
  if s then s.untilTime=now()+duration else
   s={id=id(),kind=kind,owner=t,target=m,since=now(),untilTime=now()+duration};E.statuses[key]=s
   signal(kind=="oil" and "oil_apply" or "wet_apply",t,m.x,m.z)
  end
 end
 local function endField(f:any,reason:string)
  if f.phase=="death"then return end
  f.phase="death";f.ended=now();signal("surface_end",f.owner,f.x,f.z,nil,nil,{reason=reason})
 end
 local function addField(kind:string,t:any,ox:number,oz:number,tx:number,tz:number,r:number,duration:number,cap:number,tag:string)
  if not hooks.active()then return end
  ox=math.clamp(ox,-hooks.wallX,hooks.wallX);tx=math.clamp(tx,-hooks.wallX,hooks.wallX)
  oz=math.clamp(oz,-hooks.wallZ,hooks.wallZ);tz=math.clamp(tz,-hooks.wallZ,hooks.wallZ)
  local owned={};for _,f in ipairs(E.fields)do if f.creator==t and f.tag==tag and f.phase=="active"then owned[#owned+1]=f end end
  if tag=="ember_trail"then
   local last=owned[#owned];local dx,dz=tx-ox,tz-oz
   -- Grow straight runs up to four units; never bridge a bounce corner.
   if last and last.kind==kind and (last.tx-ox)^2+(last.tz-oz)^2<1e-8 and (tx-last.ox)^2+(tz-last.oz)^2<=16 and math.abs((last.tx-last.ox)*dz-(last.tz-last.oz)*dx)<1e-6 and (last.tx-last.ox)*dx+(last.tz-last.oz)*dz>0 then
    last.tx=tx;last.tz=tz;last.x=(last.ox+tx)*.5;last.z=(last.oz+tz)*.5;last.untilTime=now()+duration;return last
   end
  end
  table.sort(owned,function(a:any,b:any)return a.id<b.id end)
  for i=1,math.max(0,#owned-cap+1)do endField(owned[i],"replaced")end
  local f:any={id=id(),kind=kind,tag=tag,owner=t,creator=t,ox=ox,oz=oz,tx=tx,tz=tz,x=(ox+tx)*.5,z=(oz+tz)*.5,radius=radius(t,r),phase="active",since=now(),untilTime=now()+duration}
  E.fields[#E.fields+1]=f;return f
 end
 function E:dispatch(trigger:string,t:any,context:any)
  if not hooks.active()then return end
  for _,rule in ipairs(self.rules)do if rule.trigger==trigger and has(t,rule.modifier) and (not context.ruleId or context.ruleId==rule.id)and (not rule.primaryOnly or not context.secondary)then
   self.triggers[trigger]+=1
   local m=context.target;local x,z=context.x or t.x,context.z or t.z
   signal("trigger",t,x,z,nil,nil,{trigger=trigger,reason=rule.id})
   if rule.action=="fire_path" then
    for i=2,#context.path do local a,b=context.path[i-1],context.path[i];addField("fire",t,a.x,a.z,b.x,b.z,rule.radius,rule.duration,rule.cap,rule.id)end
   elseif rule.action=="coat_oil"then coat(m,"oil",t,rule.duration)
   elseif rule.action=="splash_water"then
    coat(m,"wet",t,rule.duration);addField("water",t,x,z,x,z,rule.radius,rule.duration,rule.cap,rule.id)
   elseif rule.action=="strike_lightning"then
    if allowed(t,m)then hooks.damage(m,t.damage*rule.damage*scaled(t,rule.modifier),t,"lightning",false);signal("lightning",t,t.x,t.z,m.x,m.z)end
   elseif rule.action=="spill_oil"then addField("oil",t,x,z,x,z,rule.radius,rule.duration,rule.cap,rule.id);signal("oil_spill",t,x,z)end
  end end
 end
 function E:moved(t:any,ox:number,oz:number,x:number,z:number)
  if not hooks.active()or t.state=="airborne" then return end
  local length=math.sqrt((x-ox)^2+(z-oz)^2);if length<1e-8 then return end
  local dx,dz=(x-ox)/length,(z-oz)/length
  for _,rule in ipairs(self.rules)do if rule.trigger=="distance"and has(t,rule.modifier)then
  local used=0;local threshold=rule.distance
  assert(threshold>0,"distance trigger needs positive threshold")
  t.elementMovement=t.elementMovement or {};local progress=t.elementMovement[rule.id]or {distance=0,path={{x=ox,z=oz}}};t.elementMovement[rule.id]=progress
  while used<length-1e-8 do
   local step=math.min(length-used,threshold-progress.distance);used+=step;progress.distance+=step
   local p={x=ox+dx*used,z=oz+dz*used};local points=progress.path
   if #points>1 then local a,b=points[#points-1],points[#points]
    if math.abs((b.x-a.x)*(p.z-b.z)-(b.z-a.z)*(p.x-b.x))<1e-7 and (b.x-a.x)*(p.x-b.x)+(b.z-a.z)*(p.z-b.z)>=0 then points[#points]=p else points[#points+1]=p end
   else points[#points+1]=p end
   if progress.distance>=threshold-1e-8 then self:dispatch("distance",t,{path=points,x=p.x,z=p.z,ruleId=rule.id});progress.distance=0;progress.path={{x=p.x,z=p.z}}end
  end
  end
  end
 end
 function E:death(t:any,reason:string,x:number?,z:number?)
  if t.elementDeathDone or (reason~="contact" and reason~="expired")then return end
  t.elementDeathDone=true;self:dispatch("death",t,{reason=reason,x=x or t.x,z=z or t.z})
 end
 function E:onDamage(t:any,m:any,info:any)
  if info.reaction or not hooks.active()then return end
  self.queue[#self.queue+1]={t=t,m=m,info=info,x=m.x,z=m.z}
 end
 local function eligibleReaction(m:any,kind:string,cooldown:number)
  m.elementCooldowns=m.elementCooldowns or {}
  if now()<(m.elementCooldowns[kind] or -1)then return false end
  m.elementCooldowns[kind]=now()+cooldown;return true
 end
 local function ignite(m:any,t:any)
  local d=E.reactionRules.oilFire
  if not allowed(t,m)or not status(m,"oil")or not eligibleReaction(m,"ignite",d.cooldown)then return end
  removeStatus(m,"oil");E.reactions+=1;signal("ignite",t,m.x,m.z)
  hooks.burn(m,areaDamage(t,d.burnDamage),t,d.burnDuration,d.burnInterval)
  hooks.damage(m,areaDamage(t,d.burst),t,"ignite",true)
 end
 local function electrify(first:any,t:any)
  local d=E.reactionRules.waterLightning
  if not allowed(t,first)or not status(first,"wet")or not eligibleReaction(first,"conduct",d.cooldown)then return end
  local queue={first};local visited={[first.id]=true};local index=1;local total=0
  while index<=#queue and total<d.targets and hooks.active()do
   local m=queue[index];index+=1
   if allowed(t,m)then
    total+=1;removeStatus(m,"wet");m.elementCooldowns=m.elementCooldowns or {};m.elementCooldowns.conduct=now()+d.cooldown
    E.reactions+=1;hooks.shock(m,areaDamage(t,d.tick),t,d.duration,d.interval)
    local candidates={};for _,other in ipairs(hooks.monsters())do if not visited[other.id]and allowed(t,other)and status(other,"wet")and now()>=(other.elementCooldowns and other.elementCooldowns.conduct or -1)then
     local dist=(other.x-m.x)^2+(other.z-m.z)^2;if dist<=d.range^2 then candidates[#candidates+1]={m=other,d=dist}end
    end end
    table.sort(candidates,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end)
    for _,candidate in ipairs(candidates)do if #queue>=d.targets then break end;visited[candidate.m.id]=true;queue[#queue+1]=candidate.m;signal("conduct",t,m.x,m.z,candidate.m.x,candidate.m.z)end
    signal("charged",t,m.x,m.z);hooks.damage(m,areaDamage(t,d.damage),t,"conduct",true)
   end
  end
 end
 function E:touch(element:string,t:any,x:number,z:number,m:any?)
  if not hooks.active()then return end
  if m then if element=="fire"then ignite(m,t)elseif element=="lightning"then electrify(m,t)end end
  if not hooks.active()then return end
  -- A fire/lightning hit transforms the connected matching surface component.
  local from,to=element=="fire" and "oil" or "water",element=="fire" and "fire" or "charged_water"
  if element~="fire" and element~="lightning"then return end
  local candidates={};for _,f in ipairs(self.fields)do if f.phase=="active"and f.kind==from and f.untilTime>now()then candidates[#candidates+1]=f end end
  table.sort(candidates,function(a:any,b:any)return a.id<b.id end)
  local queue={};local visited={}
  for _,f in ipairs(candidates)do if distance2(x,z,f)<=f.radius^2 then queue[#queue+1]=f;visited[f.id]=true end end
  local cursor=1
  while cursor<=#queue do
   local f=queue[cursor];cursor+=1;f.kind=to;f.owner=t;f.since=now();f.untilTime=now()+3;f.chargedUntil=to=="charged_water" and now()+1.8 or nil
   signal(to=="fire"and "surface_ignite"or "surface_charge",t,f.x,f.z)
   for _,other in ipairs(candidates)do if not visited[other.id]and (other.x-f.x)^2+(other.z-f.z)^2<=(other.radius+f.radius)^2 then visited[other.id]=true;queue[#queue+1]=other end end
  end
 end
 function E:flush()
  local cursor=1
  while cursor<=#self.queue and hooks.active()do
   local e=self.queue[cursor];cursor+=1
   self:dispatch("damage",e.t,{target=e.m,x=e.x,z=e.z,secondary=e.info.secondary})
   local element=e.info.element
   if element=="fire"or element=="lightning"then self:touch(element,e.t,e.x,e.z,e.m)end
  end
  self.queue={}
 end
 function E:slowMultiplier(m:any)
  return status(m,"oil")and .75 or 1
 end
 function E:update()
  if not hooks.active()then self:clear();return end
  self:flush()
  for i=#self.fields,1,-1 do local f=self.fields[i]
   if f.phase=="death"then if now()-f.ended>.32 then table.remove(self.fields,i)end
   elseif now()>=f.untilTime then endField(f,"expired")
   elseif f.kind=="charged_water"and now()>=f.chargedUntil then f.kind="water";signal("surface_discharge",f.owner,f.x,f.z)end
  end
  for key,s in pairs(self.statuses)do if not s.target.alive or now()>=s.untilTime then self.statuses[key]=nil end end
  if now()+1e-8<self.nextScan then return end;self.nextScan=now()+.1
  -- Spatial buckets bound dense trail/contact work to local surface candidates.
  local grid={};local cell=4
  for _,f in ipairs(self.fields)do if f.phase=="active"then
   for gx=math.floor((math.min(f.ox,f.tx)-f.radius)/cell),math.floor((math.max(f.ox,f.tx)+f.radius)/cell)do
    for gz=math.floor((math.min(f.oz,f.tz)-f.radius)/cell),math.floor((math.max(f.oz,f.tz)+f.radius)/cell)do
     local key=tostring(gx)..":"..gz;grid[key]=grid[key]or {};grid[key][#grid[key]+1]=f
    end
   end
  end end
  -- Oil touching a burning road ignites even if no monster is standing there.
  for _,f in ipairs(self.fields)do if f.phase=="active"and f.kind=="oil"then
   local lit=false
   for gx=math.floor((f.x-f.radius)/cell),math.floor((f.x+f.radius)/cell)do
    for gz=math.floor((f.z-f.radius)/cell),math.floor((f.z+f.radius)/cell)do
     for _,other in ipairs(grid[tostring(gx)..":"..gz]or {})do
      if not lit and other.phase=="active"and other.kind=="fire"and distance2(f.x,f.z,other)<=(f.radius+other.radius)^2 then self:touch("fire",other.owner,f.x,f.z);lit=true end
     end
    end
   end
  end end
  for _,m in ipairs(hooks.monsters())do if m.alive then
   local fields=grid[tostring(math.floor(m.x/cell))..":"..math.floor(m.z/cell)]or {}
   -- Primers precede fire/electric surfaces, independent of field insertion order.
   for _,f in ipairs(fields)do if allowed(f.owner,m)and distance2(m.x,m.z,f)<=f.radius^2 then
    if f.kind=="oil"then coat(m,"oil",f.owner,3)elseif f.kind=="water"or f.kind=="charged_water"then coat(m,"wet",f.owner,3)end
   end end
   for _,f in ipairs(fields)do if allowed(f.owner,m)and distance2(m.x,m.z,f)<=f.radius^2 then
    if f.kind=="fire"then local d=self.reactionRules.firePath;ignite(m,f.owner);hooks.burn(m,areaDamage(f.owner,d.damage)*scaled(f.owner,"emberTrail"),f.owner,d.duration,d.interval)
    elseif f.kind=="charged_water"then electrify(m,f.owner)end
   end end
  end end
  self:flush()
 end
 function E:hasPendingDamage()for _,f in ipairs(self.fields)do if f.phase=="active"and(f.kind=="fire"or f.kind=="charged_water")then return true end end;return false end
 function E:clear()self.fields={};self.statuses={};self.queue={}end
 function E:reset()self:clear();self.events={};self.serial=0;self.nextScan=0;self.reactions=0;self.triggers={distance=0,damage=0,death=0}end
 function E:view()
  local v:any={fields={},statuses={},events=self.events,reactions=self.reactions,triggers=self.triggers}
  for _,f in ipairs(self.fields)do v.fields[#v.fields+1]={id=f.id,kind=f.kind,phase=f.phase,x=f.x,z=f.z,ox=f.ox,oz=f.oz,tx=f.tx,tz=f.tz,radius=f.radius,age=now()-(f.ended or f.since),remaining=math.max(0,f.untilTime-now()),sourceId=f.owner.visualId,playerId=f.owner.playerId}end
  for _,s in pairs(self.statuses)do v.statuses[#v.statuses+1]={id=s.id,kind=s.kind,phase=now()-s.since<.15 and "apply"or "active",x=s.target.x,z=s.target.z,age=now()-s.since,remaining=s.untilTime-now(),targetId=s.target.id,sourceId=s.owner.visualId,playerId=s.owner.playerId}end
  table.sort(v.statuses,function(a:any,b:any)return a.id<b.id end);return v
 end
 return E
end

-- Game-owned event rules. Primary hits, real deaths and clocks are separate inputs.
local function createTriggerRuntime(hooks:any)
 local F:any={units={},queue={},events={},counts={},serial=0,wraiths={},ghostSerial=0}
 F.rules={
  {id="plunder",modifier="plunder",trigger="damage",action="gold"},
  {id="firstborn",modifier="firstborn",trigger="spawn",action="rush",duration=3,bonus=1.8},
  {id="march_capacitor",modifier="marchCapacitor",trigger="distance",action="charge",distance=8,cap=2},
  {id="delayed_bloom",modifier="delayedBloom",trigger="age",action="burst",after=2,radius=2.2,damage=.5},
  {id="third_pulse",modifier="thirdPulse",trigger="nth_hit",action="burst",nth=3,radius=1.8,damage=.4},
  {id="battle_elegy",modifier="battleElegy",trigger="ally_death",action="inspire",radius=4,duration=2,bonus=.25},
  {id="grave_bloom",modifier="graveBloom",trigger="enemy_death",action="burst",radius=2.4,damage=.4},
  {id="last_echo",modifier="lastEcho",trigger="life_threshold",action="burst",ratio=.25,radius=2.3,damage=.35},
  {id="legacy_gift",modifier="legacyGift",trigger="death",action="bequeath",bonus=.2,cap=3},
  {id="guard_bequest",modifier="guardBequest",trigger="death",action="burst",radius=2.8,targets=3,guardFraction=.2,damageCap=1},
  {id="necromancer",modifier="necromancer",trigger="death",action="wraith",chance=.38,range=5.8,duration=.34,direct=.34,splash=.16,radius=1.25,targets=3,cap=6},
 }
 local function now()return hooks.clock()end
 local function signal(kind:string,t:any,x:number?,z:number?,radius:number?,targetId:number?,extra:any?)
  F.serial+=1
  F.events[#F.events+1]={id=F.serial,kind=kind,sourceId=t.visualId,playerId=t.playerId,targetId=targetId,time=now(),x=x or t.x,z=z or t.z,radius=radius or .6}
  if extra then for k,v in pairs(extra)do F.events[#F.events][k]=v end end
  if #F.events>96 then table.remove(F.events,1)end
 end
 function F:dispatch(trigger:string,t:any,c:any)
  if not hooks.active()then return end
  for _,r in ipairs(self.rules)do if r.trigger==trigger and (not c.ruleId or c.ruleId==r.id) and (t.skills[r.modifier]or 0)>0 then
   local eligible=true;local recipient:any=nil
   if r.action=="wraith"then
    local x,z=c.x or t.x,c.z or t.z;local nearest:any=nil;local best=r.range*r.range
    for _,m in ipairs(hooks.monsters())do if m.alive and(t.targetId==0 or t.targetId==m.id)then
     local d=(m.x-x)^2+(m.z-z)^2
     if d<=best and(not nearest or d<best or d==best and m.id<nearest.id)then nearest=m;best=d end
    end end
    c.wraithTarget=nearest
    local owned=0;for _,g in ipairs(self.wraiths)do if g.owner.playerId==t.playerId then owned+=1 end end
    eligible=nearest~=nil and owned<r.cap and hooks.random()<r.chance
   end
   if trigger=="damage"or trigger=="nth_hit"then eligible=not c.secondary and (c.amount or 0)>0 end
   if r.nth then eligible=eligible and (t.mainHits or 0)>0 and t.mainHits%r.nth==0 end
   if trigger=="ally_death"then eligible=t.alive and t~=c.source and t.playerId==c.source.playerId and (t.x-c.x)^2+(t.z-c.z)^2<=r.radius^2 end
   if r.action=="bequeath"then
    local choices={}
    local giftCap=r.cap+max(0,floor(t.skills.legacyGift)-1)
    for _,other in ipairs(hooks.troops())do
     if other~=t and other.alive and other.playerId==t.playerId and (not other.life or (other.age or 0)<other.life) and (other.legacyStacks or 0)<giftCap then choices[#choices+1]=other end
    end
    table.sort(choices,function(a:any,b:any)return a.visualId<b.visualId end)
    eligible=#choices>0
    if eligible then recipient=choices[math.clamp(1+math.floor(hooks.random()*#choices),1,#choices)]end
   end
   if eligible then
    self.counts[r.id]=(self.counts[r.id]or 0)+1
    if r.action=="gold"then hooks.gold(t,c.target,1)
    elseif r.action=="charge"then
     local before=t.marchCharges or 0;t.marchCharges=math.min(r.cap,before+1)
     if t.marchCharges>before then signal(r.id,t)end
    elseif r.action=="inspire"then t.elegyUntil=now()+r.duration;signal(r.id,t,nil,nil,r.radius,c.source.visualId)
    elseif r.action=="bequeath"then
     -- The fixed gift does not copy skills, price, lifetime or inherited stacks.
     local giftCap=r.cap+max(0,floor(t.skills.legacyGift)-1)
     recipient.legacyStacks=min(giftCap,(recipient.legacyStacks or 0)+1)
     signal(r.id,t,c.x,c.z,.7,recipient.visualId,{tx=recipient.x,tz=recipient.z,stacks=recipient.legacyStacks})
    elseif r.action=="wraith"then
     local target=c.wraithTarget;local x,z=c.x or t.x,c.z or t.z
     self.ghostSerial+=1
     local g:any={id=self.ghostSerial,owner=t,target=target,x=x,z=z,ox=x,oz=z,tx=target.x,tz=target.z,dx=target.x-x,dz=target.z-z,born=now(),duration=r.duration,direct=r.direct,splash=r.splash,radius=r.radius*(1+math.min(.6,t.skills.areaBonus or 0)),splashScale=math.max(.5,1-(t.skills.areaPenalty or 0)),targets=r.targets,range=r.range,progress=0}
     self.wraiths[#self.wraiths+1]=g
     signal("necromancer",t,x,z,r.radius,target.id,{tx=target.x,tz=target.z,ghostId=g.id})
    elseif r.action=="burst"then
     self.queue[#self.queue+1]={rule=r,owner=t,x=c.x or t.x,z=c.z or t.z}
    else signal(r.id,t)end
   end
  end end
 end
 function F:attach(t:any)
  if self.units[t.visualId]then return end
  self.units[t.visualId]={owner=t,distances={},timers={}}
  if not t.triggerBorn then
   t.triggerBorn=true;t.lifeScale=(t.skills.plunder or 0)>0 and .5 or 1
   if t.life then t.life*=t.lifeScale end
   self:dispatch("spawn",t,{})
  end
 end
 function F:speedBonus(t:any,age:number?)
  if (t.skills.firstborn or 0)<=0 then return 0 end
  return 1.8*math.min(1.5,1+((t.skills.firstborn or 1)-1)*.25)*math.max(0,1-(age or t.age or 0)/3)
 end
 function F:movementBonus(t:any,dt:number)
  if (t.skills.firstborn or 0)<=0 or dt<=0 then return 0 end
  local a=math.max(0,(t.age or 0)-dt);local b=math.max(a,t.age or 0)
  local function integral(x:number)local v=math.min(3,x);return v-v*v/6 end
  return 1.8*math.min(1.5,1+((t.skills.firstborn or 1)-1)*.25)*(integral(b)-integral(a))/dt
 end
 function F:consumeDamageBonus(t:any)
  local charges=t.marchCharges or 0;t.marchCharges=0
  return charges*.3+((t.elegyUntil or 0)>now()and .25 or 0)+math.min(3,t.legacyStacks or 0)*.2
 end
 function F:onDamage(t:any,m:any,c:any)
  self:dispatch("damage",t,{target=m,amount=c.amount,secondary=c.secondary})
  self:dispatch("nth_hit",t,{x=m.x,z=m.z,amount=c.amount,secondary=c.secondary})
 end
 function F:moved(t:any,ox:number,oz:number,x:number,z:number)
  if not hooks.active()or t.state=="airborne"then return end
  local length=math.sqrt((x-ox)^2+(z-oz)^2);if length<1e-8 then return end
  for _,r in ipairs(self.rules)do if r.trigger=="distance"and(t.skills[r.modifier]or 0)>0 then
   self:attach(t);local u=self.units[t.visualId];local previous=u.distances[r.id]or 0
   local step=r.distance-previous
   while step<=length+1e-8 do
    local q=math.min(1,step/length);self:dispatch("distance",t,{ruleId=r.id,x=ox+(x-ox)*q,z=oz+(z-oz)*q});step+=r.distance
   end
   local remainder=(previous+length)%r.distance
   u.distances[r.id]=(remainder<1e-8 or r.distance-remainder<1e-8)and 0 or remainder
  end end
 end
 function F:death(t:any,reason:string,x:number?,z:number?)
  if not hooks.active()or(reason~="contact"and reason~="expired")or t.triggerDeathDone then return end
  t.triggerDeathDone=true
  local c={source=t,x=x or t.x,z=z or t.z}
  self:dispatch("death",t,c)
  for _,other in ipairs(hooks.troops())do if other.alive then self:dispatch("ally_death",other,c)end end
 end
 function F:enemyDeath(t:any,m:any,c:any)
  if not hooks.active()or m.triggerDeathDone then return end
  m.triggerDeathDone=true
  -- DoT kills qualify, but triggered bursts/reactions cannot start another death chain.
  if c.reaction or c.triggered then return end
  self:dispatch("enemy_death",t,{x=m.x,z=m.z})
 end
 function F:update(live:any)
  local present={}
  for _,t in ipairs(live)do if t.alive then
   self:attach(t);present[t.visualId]=true;local u=self.units[t.visualId]
   for _,r in ipairs(self.rules)do
    if (t.skills[r.modifier]or 0)>0 and not u.timers[r.id] and ((r.trigger=="age"and(t.age or 0)>=r.after)or(r.trigger=="life_threshold"and t.life and(t.age or 0)>=t.life*(1-r.ratio)))then
     u.timers[r.id]=true;self:dispatch(r.trigger,t,{ruleId=r.id})
    end
   end
  end end
  for i=#self.wraiths,1,-1 do
   local g=self.wraiths[i];local t=g.owner
   if g.target and not g.target.alive then
    local nearest:any=nil;local best=2.4^2
    for _,m in ipairs(hooks.monsters())do if m.alive and(t.targetId==0 or t.targetId==m.id)then
     local dist=(m.x-g.x)^2+(m.z-g.z)^2
     if dist<=best and(not nearest or dist<best or dist==best and m.id<nearest.id)then nearest=m;best=dist end
    end end
    g.target=nearest
   end
   if g.target and g.target.alive then g.tx=g.target.x;g.tz=g.target.z end
   local p=math.clamp((now()-g.born)/g.duration,0,1)
   g.x=g.ox+(g.tx-g.ox)*p;g.z=g.oz+(g.tz-g.oz)*p;g.progress=p
   local length=math.sqrt((g.tx-g.ox)^2+(g.tz-g.oz)^2)
   if length>1e-8 then g.dx=(g.tx-g.ox)/length;g.dz=(g.tz-g.oz)/length end
   if p>=1 then
    signal("necromancer_burst",t,g.x,g.z,g.radius,g.target and g.target.alive and g.target.id or nil,{ghostId=g.id})
    local candidates={}
    for _,m in ipairs(hooks.monsters())do if m.alive and(t.targetId==0 or t.targetId==m.id)then
     local dist=(m.x-g.x)^2+(m.z-g.z)^2;if dist<=g.radius*g.radius then candidates[#candidates+1]={m=m,d=dist}end
    end end
    table.sort(candidates,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end)
    for n=1,math.min(g.targets,#candidates)do
     if not hooks.active()then break end
     hooks.damage(candidates[n].m,t.damage*(n==1 and g.direct or g.splash*g.splashScale),t,"soul_wraith",false)
    end
    table.remove(self.wraiths,i)
   end
  end
  for id in pairs(self.units)do if not present[id]then self.units[id]=nil end end
  for i=#self.events,1,-1 do if now()-self.events[i].time>1 then table.remove(self.events,i)end end
 end
 function F:flush()
  local jobs=self.queue;self.queue={}
  for _,job in ipairs(jobs)do
   if not hooks.active()then break end
   local t,r=job.owner,job.rule;local radius=r.radius*(1+math.min(.6,t.skills.areaBonus or 0))
   signal(r.id,t,job.x,job.z,radius)
   local candidates={}
   for _,m in ipairs(hooks.monsters())do if m.alive and(t.targetId==0 or t.targetId==m.id)then
    local d=(m.x-job.x)^2+(m.z-job.z)^2;if d<=radius^2 then candidates[#candidates+1]={m=m,d=d}end
   end end
   table.sort(candidates,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end)
   for i=1,math.min(r.targets or 4,#candidates)do
    if not hooks.active()then break end
    local m=candidates[i].m
    if r.id=="last_echo"then m.slow=math.max(m.slow or 0,1.5)end
    local amount=r.guardFraction and math.min(m.guard*r.guardFraction,t.damage*r.damageCap)or t.damage*r.damage
    hooks.damage(m,amount*math.max(.5,1-(t.skills.areaPenalty or 0)),t,r.id)
   end
  end
 end
 function F:hasPendingDamage()return #self.queue>0 or #self.wraiths>0 end
 function F:view()
  local buffs={};local wraiths={}
  for _,g in ipairs(self.wraiths)do wraiths[#wraiths+1]={id=g.id,sourceId=g.owner.visualId,playerId=g.owner.playerId,x=g.x,z=g.z,tx=g.tx,tz=g.tz,dx=g.dx,dz=g.dz,progress=g.progress,targetId=g.target and g.target.id or nil,radius=g.radius}end
  for _,u in pairs(self.units)do local t=u.owner
   if t.alive then
    local speed=self:speedBonus(t)
    if speed>0 then buffs[#buffs+1]={kind="firstborn",sourceId=t.visualId,x=t.x,z=t.z,remaining=math.max(0,3-(t.age or 0)),strength=speed/1.8}end
    if(t.marchCharges or 0)>0 then buffs[#buffs+1]={kind="march_capacitor",sourceId=t.visualId,x=t.x,z=t.z,stacks=t.marchCharges}end
    if(t.elegyUntil or 0)>now()then buffs[#buffs+1]={kind="battle_elegy",sourceId=t.visualId,x=t.x,z=t.z,remaining=t.elegyUntil-now()}end
    if(t.legacyStacks or 0)>0 then buffs[#buffs+1]={kind="legacy_gift",sourceId=t.visualId,x=t.x,z=t.z,stacks=t.legacyStacks,remaining=math.max(0,(t.life or 0)-(t.age or 0))}end
   end
  end
  table.sort(buffs,function(a:any,b:any)return a.sourceId<b.sourceId or a.sourceId==b.sourceId and a.kind<b.kind end)
  return {events=self.events,counts=self.counts,buffs=buffs,wraiths=wraiths}
 end
 function F:clear()self.units={};self.queue={};self.events={};self.wraiths={}end
 function F:reset()self:clear();self.counts={};self.serial=0;self.ghostSerial=0 end
 return F
end

-- Delayed skills own their clocks, geometry, attribution and finite chain budgets.
local function createResonanceRuntime(hooks:any)
 local L:any={jobs={},ghosts={},events={},counts={},serial=0}
 L.definitions={
  cinder_seal={modifier="cinderSeal",delay=1.2,radius=1.8,damage=.6,targets=4},
  chain_fuse={modifier="chainFuse",delay=1.8,radius=2.1,damage=.5,targets=4,links=6,step=.12},
  thunder_fan={modifier="thunderFan",delay=.18,range=4.8,angle=math.rad(100),damage=.45,targets=5},
  echo_blade={modifier="echoBlade",delay=.55,radius=.55,damage=.55,targets=4},
  starfall={modifier="starfall",after=2.8,delay=.65,radius=1.5,damage=.4,targets=3},
  soul_return={modifier="soulReturn",range=12,speed=20,radius=.5,damage=.4,targets=4},
 }
 local function now()return hooks.clock()end
 local function id()L.serial+=1;return L.serial end
 local function valid(t:any,m:any)return m.alive and(t.targetId==0 or t.targetId==m.id)end
 local function owner(t:any)return t.playerId or 1 end
 local function event(kind:string,j:any,extra:any?)
  local e={id=id(),kind=kind,x=j.x,z=j.z,radius=j.radius or .6,time=now(),sourceId=j.owner.visualId,playerId=owner(j.owner)}
  if extra then for k,v in pairs(extra)do e[k]=v end end
  L.events[#L.events+1]=e;if #L.events>160 then table.remove(L.events,1)end
 end
 local function radius(t:any,r:number)return r*(1+math.min(.6,t.skills.areaBonus or 0))end
 local function damage(t:any,m:any,d:number,kind:string)
  if hooks.active()and valid(t,m)then hooks.damage(m,t.damage*d*math.max(.5,1-(t.skills.areaPenalty or 0)),t,kind)end
 end
 local function schedule(kind:string,t:any,x:number,z:number,extra:any?)
  local d=L.definitions[kind];local j:any={id=id(),kind=kind,owner=t,x=x,z=z,born=now(),due=now()+d.delay,radius=radius(t,d.radius or .7)}
  if extra then for k,v in pairs(extra)do j[k]=v end end
  -- A finite per-player/per-kind pool; old marks fizzle rather than detonate early.
  local candidates={};for _,old in ipairs(L.jobs)do if old.kind==kind and owner(old.owner)==owner(t)then candidates[#candidates+1]=old end end
  if #candidates>=24 then
   local oldest=candidates[1];for _,old in ipairs(candidates)do if old.id<oldest.id then oldest=old end end
   for i,old in ipairs(L.jobs)do if old==oldest then table.remove(L.jobs,i);break end end
  end
  L.jobs[#L.jobs+1]=j;L.counts[kind]=(L.counts[kind]or 0)+1;return j
 end
 local function circle(j:any)
  local d=L.definitions[j.kind];local list={}
  for _,m in ipairs(hooks.monsters())do if valid(j.owner,m)then
   local dist=(m.x-j.x)^2+(m.z-j.z)^2;if dist<=j.radius^2 then list[#list+1]={m=m,d=dist}end
  end end
  table.sort(list,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end)
  for i=1,math.min(d.targets,#list)do damage(j.owner,list[i].m,d.damage,j.kind)end
 end
 local function segmentDistance(m:any,ax:number,az:number,bx:number,bz:number)
  local dx,dz=bx-ax,bz-az;local q=math.clamp(((m.x-ax)*dx+(m.z-az)*dz)/math.max(1e-12,dx*dx+dz*dz),0,1)
  return (m.x-ax-dx*q)^2+(m.z-az-dz*q)^2,q
 end
 function L:onDamage(t:any,m:any,info:any)
  if not hooks.active()or info.secondary or(info.amount or 0)<=0 then return end
  for _,kind in ipairs({"cinder_seal","chain_fuse"})do local d=self.definitions[kind]
   if(t.skills[d.modifier]or 0)>0 then
    local exists=false;for _,j in ipairs(self.jobs)do if j.kind==kind and j.target==m and owner(j.owner)==owner(t)then exists=true;break end end
    if not exists then schedule(kind,t,m.x,m.z,{target=m})end
   end
  end
  if(t.skills.thunderFan or 0)>0 and (t.mainHits or 0)%3==0 then
   schedule("thunder_fan",t,m.x-t.dx*.8,m.z-t.dz*.8,{dx=t.dx,dz=t.dz})
  end
  if(t.skills.echoBlade or 0)>0 and not t.echoBladeUsed then
   t.echoBladeUsed=true
   schedule("echo_blade",t,m.x,m.z,{ax=m.x-t.dx*1.2,az=m.z-t.dz*1.2,bx=m.x+t.dx*3.2,bz=m.z+t.dz*3.2})
  end
 end
 function L:moved(t:any,ax:number,az:number,bx:number,bz:number)
  if not hooks.active()or(t.skills.soulReturn or 0)<=0 or t.state=="airborne"then return end
  local length=math.sqrt((bx-ax)^2+(bz-az)^2);if length<1e-8 then return end
  t.returnPath=t.returnPath or {};local path=t.returnPath;local last=path[#path]
  if last and math.abs(last.bx-ax)+math.abs(last.bz-az)<1e-6 and ((last.bx-last.ax)*(bx-ax)+(last.bz-last.az)*(bz-az))/(last.length*length)>.99999 then last.bx=bx;last.bz=bz;last.length+=length
  else path[#path+1]={ax=ax,az=az,bx=bx,bz=bz,length=length}end
  local total=0;for _,s in ipairs(path)do total+=s.length end
  local excess=math.max(0,total-self.definitions.soul_return.range)
  while excess>1e-8 and #path>0 do
   local first=path[1]
   if first.length<=excess+1e-8 then excess-=first.length;table.remove(path,1)
   else local q=excess/first.length;first.ax+=(first.bx-first.ax)*q;first.az+=(first.bz-first.az)*q;first.length-=excess;excess=0 end
  end
 end
 function L:death(t:any,reason:string,x:number?,z:number?)
  if not hooks.active()or(reason~="contact"and reason~="expired")or t.returnedGhost or(t.skills.soulReturn or 0)<=0 then return end
  t.returnedGhost=true;local path=t.returnPath or {};local last=path[#path]
  if last then self:moved(t,last.bx,last.bz,x or t.x,z or t.z)end
  if #path==0 then return end
  local reverse={};local total=0
  for i=#path,1,-1 do local s=path[i];reverse[#reverse+1]={ax=s.bx,az=s.bz,bx=s.ax,bz=s.az,length=s.length};total+=s.length end
  local g={id=id(),owner=t,x=x or t.x,z=z or t.z,segments=reverse,index=1,offset=0,total=total,travel=0,hits={},hitCount=0,radius=.5}
  local owned={};for i,other in ipairs(self.ghosts)do if owner(other.owner)==owner(t)then owned[#owned+1]=i end end
  if #owned>=24 then table.remove(self.ghosts,owned[1])end
  self.ghosts[#self.ghosts+1]=g;self.counts.soul_return=(self.counts.soul_return or 0)+1;event("soul_spawn",g)
 end
 local function release(j:any)
  local d=L.definitions[j.kind]
  if j.kind=="thunder_fan"then
   local angle=math.atan2(j.dz,j.dx);local rays={};local chosen={}
   for _,m in ipairs(hooks.monsters())do if valid(j.owner,m)then
    local dx,dz=m.x-j.x,m.z-j.z;local distance=math.sqrt(dx*dx+dz*dz)
    local a=math.atan2(dz,dx)-angle;a=(a+math.pi)%(math.pi*2)-math.pi
    if distance<=d.range and math.abs(a)<=d.angle/2 then
     local bin=math.clamp(math.floor((a/d.angle+.5)*5)+1,1,5)
     if not chosen[bin]or distance<chosen[bin].d or distance==chosen[bin].d and m.id<chosen[bin].m.id then chosen[bin]={m=m,d=distance}end
    end
   end end
   for i=1,5 do
    local target=chosen[i]and chosen[i].m;local a=angle+(i-3)*d.angle/5
    rays[#rays+1]={x=j.x,z=j.z,tx=target and target.x or j.x+math.cos(a)*d.range,tz=target and target.z or j.z+math.sin(a)*d.range,hit=target~=nil}
    if target then damage(j.owner,target,d.damage,j.kind)end
   end
   event(j.kind,j,{rays=rays,angle=angle,range=d.range})
  elseif j.kind=="echo_blade"then
   local list={};for _,m in ipairs(hooks.monsters())do if valid(j.owner,m)then local dist,q=segmentDistance(m,j.ax,j.az,j.bx,j.bz);if dist<=j.radius^2 then list[#list+1]={m=m,q=q}end end end
   table.sort(list,function(a:any,b:any)return a.q<b.q or a.q==b.q and a.m.id<b.m.id end)
   for i=1,math.min(d.targets,#list)do damage(j.owner,list[i].m,d.damage,j.kind)end
   event(j.kind,j,{ax=j.ax,az=j.az,bx=j.bx,bz=j.bz})
  else
   if j.kind=="chain_fuse"then
    local wave=j.wave or {used=1};local candidates={}
    for _,other in ipairs(L.jobs)do if other.kind=="chain_fuse"and not other.wave and owner(other.owner)==owner(j.owner)and(other.x-j.x)^2+(other.z-j.z)^2<=j.radius^2 then candidates[#candidates+1]=other end end
    table.sort(candidates,function(a:any,b:any)return a.id<b.id end)
    for _,other in ipairs(candidates)do if wave.used>=d.links then break end
     wave.used+=1;other.wave=wave;other.due=now()+d.step;event("fuse_link",j,{tx=other.x,tz=other.z})
    end
   end
   event(j.kind,j);circle(j)
  end
 end
 function L:update(dt:number,live:any)
  if not hooks.active()then self:clear();return end
  for _,t in ipairs(live)do if t.alive and(t.skills.starfall or 0)>0 and not t.starfallUsed and(t.age or 0)>=self.definitions.starfall.after then
   t.starfallUsed=true;local choices={}
   for _,m in ipairs(hooks.monsters())do if valid(t,m)then choices[#choices+1]={m=m,d=(m.x-t.x)^2+(m.z-t.z)^2}end end
   table.sort(choices,function(a:any,b:any)return a.d<b.d or a.d==b.d and a.m.id<b.m.id end)
   for i=1,math.min(3,#choices)do local m=choices[i].m;schedule("starfall",t,m.x,m.z,{due=now()+.65+(i-1)*.15})end
  end end
  for _,j in ipairs(self.jobs)do if j.target then j.x=j.target.x;j.z=j.target.z end end
  local ready={};for _,j in ipairs(self.jobs)do if now()+1e-8>=j.due then ready[#ready+1]=j end end
  table.sort(ready,function(a:any,b:any)return a.due<b.due or a.due==b.due and a.id<b.id end)
  for _,j in ipairs(ready)do
   if not hooks.active()then break end
   if now()+1e-8>=j.due then
    for i,v in ipairs(self.jobs)do if v==j then table.remove(self.jobs,i);break end end
    release(j)
   end
  end
  for i=#self.ghosts,1,-1 do local g=self.ghosts[i];local distance=self.definitions.soul_return.speed*dt
   while distance>1e-8 and g.index<=#g.segments and hooks.active()do
    local s=g.segments[g.index];local step=math.min(distance,s.length-g.offset);local ax,az=g.x,g.z
    g.offset+=step;distance-=step;g.travel+=step;local q=g.offset/s.length;g.x=s.ax+(s.bx-s.ax)*q;g.z=s.az+(s.bz-s.az)*q
    local list={};for _,m in ipairs(hooks.monsters())do if valid(g.owner,m)and not g.hits[m.id]then
     local d,u=segmentDistance(m,ax,az,g.x,g.z);if d<=(.4+m.scale*.5+g.radius)^2 then list[#list+1]={m=m,q=u}end
    end end
    table.sort(list,function(a:any,b:any)return a.q<b.q or a.q==b.q and a.m.id<b.m.id end)
    for _,entry in ipairs(list)do if g.hitCount>=4 then break end;g.hits[entry.m.id]=true;g.hitCount+=1;damage(g.owner,entry.m,.4,"soul_return")end
    if g.offset>=s.length-1e-8 then g.index+=1;g.offset=0 end
   end
   if g.index>#g.segments then event("soul_end",g);table.remove(self.ghosts,i)end
  end
  for i=#self.events,1,-1 do if now()-self.events[i].time>1 then table.remove(self.events,i)end end
  if not hooks.active()then self:clear()end
 end
 function L:hasPendingDamage()return #self.jobs>0 or #self.ghosts>0 end
 function L:view()
  local v={jobs={},ghosts={},events=self.events,counts=self.counts}
  for _,j in ipairs(self.jobs)do v.jobs[#v.jobs+1]={id=j.id,kind=j.kind,x=j.x,z=j.z,dx=j.dx,dz=j.dz,ax=j.ax,az=j.az,bx=j.bx,bz=j.bz,radius=j.radius,range=self.definitions[j.kind].range,angle=self.definitions[j.kind].angle,remaining=math.max(0,j.due-now()),progress=math.clamp((now()-j.born)/math.max(.001,j.due-j.born),0,1),targetId=j.target and j.target.id,sourceId=j.owner.visualId,linked=j.wave~=nil}end
  for _,g in ipairs(self.ghosts)do local s=g.segments[g.index];v.ghosts[#v.ghosts+1]={id=g.id,x=g.x,z=g.z,dx=s and(s.bx-s.ax)/s.length or 0,dz=s and(s.bz-s.az)/s.length or 0,progress=g.travel/g.total,k=g.owner.k}end
  return v
 end
 function L:clear()self.jobs={};self.ghosts={};self.events={}end
 function L:reset()self:clear();self.counts={};self.serial=0 end
 return L
end

-- Game-owned skill lifecycle. Bundled by tools/build-skills.mjs; no renderer callbacks.
local function createSkillRuntime(hooks:any)
 local R:any={clock=0,serial=0,units={},casts={},entities={},buffs={},events={},statusViews={}}
 R.definitions={
  flame_cloak={modifier="flameCloak",windup=.28,release=.08,channel=true,ending=.18,period=.8,radius=2,damage=.18},
  phoenix_fire={modifier="phoenixFire",windup=.28,release=.08,channel=.20,ending=.18,period=1.8,range=6,targets=3,flight=.38,duration=3,interval=.75,damage=.16},
  plague_vial={modifier="plagueVial",windup=.12,release=.06,channel=0,ending=.18,distance=6,throw=1.5,flight=.45,radius=1.8,duration=3,linger=2,interval=.5,damage=.10,maxClouds=4},
 }
 local function id()R.serial+=1;return R.serial end
 local function allowed(t:any,m:any)return m.alive and (t.targetId==0 or t.targetId==m.id)end
 local function event(domain:string,kind:string,phase:string,ref:any,reason:string?)
  R.events[#R.events+1]={id=id(),domain=domain,kind=kind,phase=phase,refId=ref.id,time=R.clock,x=ref.x,z=ref.z,sourceId=ref.owner and ref.owner.visualId or ref.sourceId,targetId=ref.target and ref.target.id or nil,reason=reason}
  if #R.events>128 then table.remove(R.events,1)end
 end
 local function stage(ref:any,domain:string,phase:string,reason:string?)ref.phase=phase;ref.since=R.clock;event(domain,ref.kind,phase,ref,reason)end
 local function damage(m:any,amount:number,owner:any,kind:string)
  if hooks.active() and allowed(owner,m)then hooks.damage(m,amount,owner,kind)end
 end
 local function strength(t:any,kind:string)
  local d=R.definitions[kind];return 1+math.min(1,math.max(0,(t.skills[d.modifier] or 1)-1)*.25)
 end
 local function area(t:any,r:number)return r*(1+math.min(.6,t.skills.areaBonus or 0))end
 local function areaDamage(t:any,d:number)return t.damage*d*math.max(.5,1-(t.skills.areaPenalty or 0))end
 local function addBuff(kind:string,m:any,t:any,amount:number,duration:number,interval:number,ignoreElements:boolean?)
  if not allowed(t,m)then return end
  if kind=="burn"and not ignoreElements and R.elements then R.elements:touch("fire",t,m.x,m.z,m)end
  if not hooks.active()or not allowed(t,m)then return end
  local key=tostring(m.id)..":"..kind;local b=R.buffs[key]
  if b and b.phase=="expire"then b=nil end
  if b then
   -- One global timer per status/monster. Refresh never resets tick cadence.
   b.untilTime=math.max(b.untilTime,R.clock+duration)
   if amount>b.damage then b.damage=amount;b.owner=t end
   if R.clock-(b.refreshed or b.since)>=.4 then b.refreshed=R.clock;event("buff",kind,"refresh",b)end
  else
   b={id=id(),kind=kind,phase="apply",since=R.clock,owner=t,target=m,x=m.x,z=m.z,damage=amount,interval=interval,nextTick=R.clock+interval,untilTime=R.clock+duration}
   R.buffs[key]=b;event("buff",kind,"apply",b)
  end
 end
 R.composition=createCompositionRuntime({clock=function()return R.clock end,active=hooks.active,monsters=hooks.monsters,wallX=hooks.wallX,damage=hooks.damage})
 R.elements=createElementRuntime({clock=function()return R.clock end,active=hooks.active,monsters=hooks.monsters,wallX=hooks.wallX,wallZ=hooks.wallZ,damage=hooks.damage,
  burn=function(m:any,amount:number,t:any,duration:number,interval:number)addBuff("burn",m,t,amount,duration,interval,true)end,
  shock=function(m:any,amount:number,t:any,duration:number,interval:number)addBuff("electrified",m,t,amount,duration,interval,true)end})
 R.triggers=createTriggerRuntime({clock=function()return R.clock end,active=hooks.active,monsters=hooks.monsters,troops=hooks.troops or function()return {}end,damage=hooks.damage,gold=hooks.gold or function()end,random=hooks.random})
 R.resonance=createResonanceRuntime({clock=function()return R.clock end,active=hooks.active,monsters=hooks.monsters,damage=hooks.damage})
 function R:spawn(t:any)self.composition:attach(t);self.triggers:attach(t)end
 function R:onDamage(t:any,m:any,info:any)self.composition:onDamage(t,m,info);self.resonance:onDamage(t,m,info);self.triggers:onDamage(t,m,info);self.elements:onDamage(t,m,info)end
 function R:onDeath(t:any,reason:string,x:number?,z:number?)self.resonance:death(t,reason,x,z);self.triggers:death(t,reason,x,z);self.elements:death(t,reason,x,z)end
 function R:onEnemyDeath(t:any,m:any,info:any)self.triggers:enemyDeath(t,m,info)end
 function R:flush()self.triggers:flush();self.elements:flush();self.composition:flush();if not hooks.active()then self:clear("round_end")end end
 function R:slowMultiplier(m:any)
  local shock=self.buffs[tostring(m.id)..":electrified"]
  return math.min(self.elements:slowMultiplier(m),shock and shock.phase~="expire"and shock.untilTime>self.clock and .65 or 1)
 end
 local function entity(kind:string,t:any,x:number,z:number,tx:number,tz:number,target:any?)
  local d=R.definitions[kind];local e:any={id=id(),kind=kind,owner=t,x=x,z=z,ox=x,oz=z,tx=tx,tz=tz,target=target,radius=area(t,d.radius or .35),power=strength(t,kind),born=R.clock}
  R.entities[#R.entities+1]=e;stage(e,"effect","spawn");return e
 end
 local function cast(kind:string,t:any,x:number?,z:number?,dx:number?,dz:number?)
  local c:any={id=id(),kind=kind,owner=t,x=x or t.x,z=z or t.z,dx=dx or t.dx,dz=dz or t.dz,power=strength(t,kind)}
  R.casts[#R.casts+1]=c;stage(c,"cast","windup");return c
 end
 function R:attach(t:any)
  self.composition:attach(t);self.triggers:attach(t)
  if self.units[t.visualId]then return end
  self.units[t.visualId]={owner=t,nextPhoenix=self.clock,distance=0}
  if (t.skills.flameCloak or 0)>0 then cast("flame_cloak",t)end
 end
 function R:moved(t:any,ox:number,oz:number,x:number,z:number,skipTriggers:boolean?)
  self.composition:moved(t,ox,oz,x,z)
  if not skipTriggers then self.resonance:moved(t,ox,oz,x,z)end
  if not skipTriggers then self.triggers:moved(t,ox,oz,x,z)end
  self.elements:moved(t,ox,oz,x,z)
  if not t.alive or (t.skills.plagueVial or 0)<=0 or t.state=="airborne" then return end
  self:attach(t);local u=self.units[t.visualId];local d=self.definitions.plague_vial
  local length=math.sqrt((x-ox)^2+(z-oz)^2);if length<1e-8 then return end
  local offset=d.distance-u.distance
  while offset<=length+1e-8 do
   local q=math.min(1,offset/length);cast("plague_vial",t,ox+(x-ox)*q,oz+(z-oz)*q,(x-ox)/length,(z-oz)/length)
   offset+=d.distance
  end
  u.distance=(u.distance+length)%d.distance
  if u.distance<1e-8 or d.distance-u.distance<1e-8 then u.distance=0 end
 end
 local function release(c:any)
  local t,d=c.owner,R.definitions[c.kind]
  if c.kind=="flame_cloak" then c.nextTick=R.clock+R.composition:period(t,d.period);c.radius=area(t,d.radius)
  elseif c.kind=="phoenix_fire" then
   local choices={};for _,m in ipairs(hooks.monsters())do if allowed(t,m) and (m.x-t.x)^2+(m.z-t.z)^2<=d.range^2 then choices[#choices+1]=m end end
   table.sort(choices,function(a:any,b:any)return a.id<b.id end)
   for _=1,math.min(d.targets,#choices)do
    local pick=math.min(#choices,1+math.floor(hooks.random()*#choices));local m=table.remove(choices,pick)
    entity(c.kind,t,t.x,t.z,m.x,m.z,m)
   end
  else
   entity(c.kind,t,c.x,c.z,math.clamp(c.x+c.dx*d.throw,-hooks.wallX,hooks.wallX),math.clamp(c.z+c.dz*d.throw,-hooks.wallZ,hooks.wallZ))
  end
 end
 function R:update(dt:number,live:any)
  if not hooks.active()then self:clear("round_end");return end
  self.clock+=dt
  self.triggers:update(live)
  self.resonance:update(dt,live)
  self.composition:update(dt,live)
  local present={}
  for _,t in ipairs(live)do if t.alive then
   self:attach(t);present[t.visualId]=true;local u=self.units[t.visualId]
   if (t.skills.phoenixFire or 0)>0 and self.clock>=u.nextPhoenix then cast("phoenix_fire",t);u.nextPhoenix=self.clock+self.composition:period(t,self.definitions.phoenix_fire.period) end
  end end
  -- A recalled source is also absent. Mark it dead so lingering DoTs cannot revive it.
  for unitId,u in pairs(self.units)do if not present[unitId]then u.owner.alive=false;self.units[unitId]=nil end end
  for i=#self.casts,1,-1 do
   local c=self.casts[i];local d=self.definitions[c.kind];local t=c.owner
   if not t.alive and c.phase~="end"then stage(c,"cast","end","source_gone")end
   if c.kind~="plague_vial"then c.x=t.x;c.z=t.z end
   local elapsed=self.clock-c.since
   if c.phase=="windup" and elapsed+1e-8>=d.windup then
    stage(c,"cast","release");release(c)
   elseif c.phase=="release" and elapsed+1e-8>=d.release then stage(c,"cast",d.channel==0 and "end" or "channel")
   elseif c.phase=="channel" then
    if d.channel==true then
     while self.clock+1e-8>=c.nextTick and hooks.active()do
      c.nextTick+=self.composition:period(t,d.period);event("cast",c.kind,"pulse",c)
      for _,m in ipairs(hooks.monsters())do if allowed(t,m) and (m.x-t.x)^2+(m.z-t.z)^2<=c.radius^2 then damage(m,areaDamage(t,d.damage)*c.power,t,c.kind)end end
     end
    elseif elapsed+1e-8>=d.channel then stage(c,"cast","end")end
   elseif c.phase=="end" and elapsed>=d.ending then table.remove(self.casts,i)end
  end
  for i=#self.entities,1,-1 do
   local e=self.entities[i];local d=self.definitions[e.kind];local elapsed=self.clock-e.since
   if e.phase=="spawn"then stage(e,"effect","flight")
   elseif e.phase=="flight" then
    if e.target and not e.target.alive then stage(e,"effect","death","target_gone")
    else
     if e.target then e.tx=e.target.x;e.tz=e.target.z end
     local p=math.min(1,elapsed/d.flight);e.x=e.ox+(e.tx-e.ox)*p;e.z=e.oz+(e.tz-e.oz)*p;e.y=math.sin(p*math.pi)*(e.kind=="plague_vial" and 1.4 or .55)+.4
     if p>=1 then
      if e.kind=="phoenix_fire"then addBuff("burn",e.target,e.owner,e.owner.damage*d.damage*e.power,d.duration,d.interval);stage(e,"effect","death","impact")
      else
       -- Per-source persistent field budget is a declared gameplay rule.
       local clouds={};for _,other in ipairs(self.entities)do if other~=e and other.kind==e.kind and other.owner==e.owner and other.phase=="active"then clouds[#clouds+1]=other end end
       table.sort(clouds,function(a:any,b:any)return a.id<b.id end)
       for n=1,math.max(0,#clouds-d.maxClouds+1)do stage(clouds[n],"effect","death","replaced")end
       e.y=.1;e.nextScan=self.clock;stage(e,"effect","active")
      end
     end
    end
   elseif e.phase=="active" then
    if elapsed>=d.duration then stage(e,"effect","death","expired")
    elseif self.clock+1e-8>=e.nextScan then
     e.nextScan=self.clock+.1
     for _,m in ipairs(hooks.monsters())do if allowed(e.owner,m) and (m.x-e.x)^2+(m.z-e.z)^2<=e.radius^2 then addBuff("poison",m,e.owner,areaDamage(e.owner,d.damage)*e.power,d.linger,d.interval)end end
    end
   elseif e.phase=="death" and elapsed>=.32 then table.remove(self.entities,i)end
  end
  -- Explicit order keeps simultaneous DoT breaks and payout attribution reproducible.
  local ordered={};for key,b in pairs(self.buffs)do ordered[#ordered+1]={key=key,b=b}end
  table.sort(ordered,function(a:any,b:any)return a.b.id<b.b.id end)
  for _,entry in ipairs(ordered)do
   local b=entry.b;local m=b.target;b.x=m.x;b.z=m.z
   if b.phase=="expire"then if self.clock-b.since>=.25 then self.buffs[entry.key]=nil end
   else
    if b.phase=="apply" and self.clock-b.since>=.15 then stage(b,"buff","active")end
    while m.alive and self.clock+1e-8>=b.nextTick and b.nextTick<=b.untilTime+1e-8 and hooks.active()do
     b.nextTick+=b.interval;damage(m,b.damage,b.owner,b.kind);event("buff",b.kind,"tick",b)
    end
    if not m.alive or self.clock>=b.untilTime then stage(b,"buff","expire",m.alive and "expired" or "target_gone")end
   end
  end
  self.elements:update()
  if not hooks.active()then self:clear("round_end")end
  local visible={}
  if hooks.active() and hooks.statuses then for _,status in ipairs(hooks.statuses())do
   visible[status.key]=true;local b=self.statusViews[status.key]
   if not b or b.phase=="expire" then b={id=id(),kind=status.kind,phase="apply",since=self.clock,sourceId=status.sourceId,targetId=status.targetId};self.statusViews[status.key]=b end
   b.x=status.x;b.z=status.z;b.remaining=status.remaining
   if self.clock-b.since>.15 then b.phase="active"end
  end end
  for key,b in pairs(self.statusViews)do if not visible[key]then
   if b.phase~="expire"then b.phase="expire";b.since=self.clock elseif self.clock-b.since>.25 then self.statusViews[key]=nil end
  end end
 end
 function R:hasPendingDamage()
  if self.composition:hasPendingDamage()then return true end
  if self.resonance:hasPendingDamage()then return true end
  if self.triggers:hasPendingDamage()then return true end
  if self.elements:hasPendingDamage()then return true end
  for _,e in ipairs(self.entities)do if e.phase~="death"then return true end end
  for _,b in pairs(self.buffs)do if b.phase~="expire"then return true end end
  return false
 end
 function R:clear(reason:string)
  self.composition:clear()
  self.resonance:clear()
  self.triggers:clear()
  self.elements:clear()
  for _,c in ipairs(self.casts)do if c.phase~="end"then stage(c,"cast","end",reason)end end
  for _,e in ipairs(self.entities)do if e.phase~="death"then stage(e,"effect","death",reason)end end
  for _,b in pairs(self.buffs)do if b.phase~="expire"then stage(b,"buff","expire",reason)end end
  self.units={};self.casts={};self.entities={};self.buffs={};self.statusViews={}
 end
 function R:reset()self:clear("reset");self.elements:reset();self.triggers:reset();self.resonance:reset();self.composition:reset();self.clock=0;self.serial=0;self.events={}end
 function R:view()
  local v:any={clock=self.clock,casts={},entities={},buffs={},events=self.events,elements=self.elements:view(),triggers=self.triggers:view(),resonance=self.resonance:view(),composition=self.composition:view()}
  local function copy(ref:any)
   local d=self.definitions[ref.kind];local duration=d and (ref.phase=="windup" and d.windup or ref.phase=="release" and d.release or ref.phase=="channel" and type(d.channel)=="number" and d.channel or ref.phase=="end" and d.ending or ref.phase=="flight" and d.flight or ref.phase=="active" and d.duration) or nil
   return {id=ref.id,kind=ref.kind,phase=ref.phase,since=ref.since,age=self.clock-ref.since,x=ref.x,z=ref.z,y=ref.y or .1,tx=ref.tx,tz=ref.tz,radius=ref.radius or d and d.radius or .7,sourceId=ref.owner.visualId,playerId=ref.owner.playerId,targetId=ref.target and ref.target.id or nil,progress=duration and math.min(1,(self.clock-ref.since)/duration) or nil,remaining=ref.untilTime and math.max(0,ref.untilTime-self.clock) or nil}
  end
  for _,c in ipairs(self.casts)do v.casts[#v.casts+1]=copy(c)end
  for _,e in ipairs(self.entities)do v.entities[#v.entities+1]=copy(e)end
  for _,b in pairs(self.buffs)do v.buffs[#v.buffs+1]=copy(b)end
  for _,b in pairs(self.statusViews)do v.buffs[#v.buffs+1]={id=b.id,kind=b.kind,phase=b.phase,age=self.clock-b.since,x=b.x,z=b.z,sourceId=b.sourceId,targetId=b.targetId,remaining=b.remaining,radius=.65}end
  table.sort(v.buffs,function(a:any,b:any)return a.id<b.id end)
  return v
 end
 return R
end

-- END GENERATED SKILL RUNTIME
skillRuntime=createSkillRuntime({active=function()return S.phase=="battle"end,monsters=function()return monsters end,random=rng,wallX=WALL_X,wallZ=WALL_Z,
 troops=function()return troops end,
 gold=function(t:any,m:any,amount:number)
  local player=t.playerId or S.seat;changeGold(player,amount);S.earned+=amount;S.plunderEarned+=amount;S.plunderSerial+=1
  S.plunderEvents[#S.plunderEvents+1]={id=S.plunderSerial,playerId=player,source=t.visualId,amount=amount,x=m.x,z=m.z,time=S.rewardClock}
  if #S.plunderEvents>64 then table.remove(S.plunderEvents,1)end
  local p=corners[player];coinsFX[#coinsFX+1]={x=m.x,z=m.z,dx=.25,dz=.15,tx=p.x,tz=p.z,age=0,peak=.65}
  if #coinsFX>420 then table.remove(coinsFX,1)end
 end,
 statuses=function()
  local list={}
  for _,t in ipairs(troops)do if t.alive then
   local buffs=S.playerBuffs[t.playerId or S.seat]
   for _,kind in ipairs({"haste","critical","rally","pierce"})do
    local remaining=kind=="rally" and S.rallyUntil[t.playerId or S.seat]-S.rewardClock or kind=="pierce" and t.pierceRemaining or buffs[kind]-S.rewardClock
    if remaining>0 then list[#list+1]={key=tostring(t.visualId)..kind,sourceId=t.visualId,kind=kind,x=t.x,z=t.z,remaining=remaining}end
   end
  end end
  for _,m in ipairs(monsters)do if m.alive and m.slow>0 then list[#list+1]={key="m"..m.id.."frost",targetId=m.id,kind="frost",x=m.x,z=m.z,remaining=m.slow}end end
  return list
 end,
 damage=function(m:any,amount:number,t:any,kind:string,reaction:boolean?)
  hit(m,amount,t,true,kind,reaction)
 end})
local function fire()
 if cooldown>0 or S.coins<costs(S.selected) or #troops>=100 then return end
 local k=S.selected;local p=corners[S.seat];local dx,dz=S.aimX-p.x,S.aimZ-p.z;local len=sqrt(dx*dx+dz*dz)
 if len<.3 then return end
 local paid=costs(k);local skills=composeSkills(k)
 if S.coins<80 and S.recruitUses[S.seat]<3 and skills.recruit>0 then S.recruitUses[S.seat]+=1 end
 S.roundSpent[S.seat]+=paid
 if skills.rally>0 and S.roundSpent[S.seat]>=400 and not S.rallyUsed[S.seat] then S.rallyUsed[S.seat]=true;S.rallyUntil[S.seat]=S.rewardClock+10 end
 S.lastSpawnX=p.x;S.lastSpawnZ=p.z;S.coins-=paid;S.spent+=paid;S.fired+=1;cooldown=.24/(1+min(.5,skills.rapid))
 -- The beetle has ONE shared pot; each paid deployment contributes at most once.
 for _,m in ipairs(monsters)do if m.alive and m.special=="beetle" then
  local aimed=S.fireMode=="manual" and (S.aimX-m.x)^2+(S.aimZ-m.z)^2<(m.scale+1)^2 or S.fireMode~="manual" and S.targetId==m.id
  if aimed then m.poolGold+=paid;m.contributions[S.seat]+=paid;S.poolContributed+=paid;break end
 end end
 effect(p.x,p.z,"summon",.8)
 if S.playerBuffs[S.seat].pierce>0 then skills.pierce+=1;S.playerBuffs[S.seat].pierce-=1 end
 serial+=1
 -- AUTO chooses a firing direction; only LOCK makes this troop target-exclusive.
 -- A lob saves the selected ground point, not just a direction or a fixed range.
 troops[#troops+1]={visualId=serial,equipment=table.clone(S.worn[k]),k=k,playerId=S.seat,paid=paid,targetId=S.lockEnabled and S.targetId or 0,x=p.x,z=p.z,dx=dx/len,dz=dz/len,age=0,alive=true,damage=baseDamage[k]*S.damage*(1+.3*(S.equipment[k]-1))*(1+skills.damageBonus),rune=S.runes[k],skills=skills,pierceRemaining=skills.pierce,hits={},spinHits={},state=skills.landingSpin and "airborne" or "run",spin=0,travel=0,landing=len,landingX=S.aimX,landingZ=S.aimZ,life=baseLife[k]*(k==3 and S.lifetime or 1)*(1+skills.lifeBonus),bounceCount=0,lifeAdded=0,reboundStacks=0}
 skillRuntime:spawn(troops[#troops])
end
local function segmentEntry(m:any,ax:number,az:number,bx:number,bz:number): number?
 local dx,dz=bx-ax,bz-az;local px,pz=ax-m.x,az-m.z
 local a=dx*dx+dz*dz;local c=px*px+pz*pz-(.4+m.scale*.5)^2
 if c<=0 then return 0 end
 if a<1e-16 then return nil end
 local b=px*dx+pz*dz;local discriminant=b*b-a*c
 if discriminant<0 then return nil end
 local entry=(-b-sqrt(discriminant))/a
 return entry>=0 and entry<=1 and entry or nil
end
local function contactHit(t:any,m:any,contactX:number?,contactZ:number?)
 t.hits[m.id]=true;S.contactHits+=1;hit(m,t.damage,t)
 if t.pierceRemaining>0 then t.pierceRemaining-=1;S.piercesUsed+=1
  t.usedPierces=(t.usedPierces or 0)+1
  if t.skills.pierceWave>0 and t.usedPierces%2==0 then
   pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,exclude=m.id,t=t,damage=t.damage*min(.6,t.skills.pierceWave),radius=1.8,limit=4,kind="cleave"}
  end
 else t.alive=false;S.contactDeaths+=1;S.lostPaid+=t.paid
  skillRuntime:onDeath(t,"contact",contactX,contactZ)
  if t.skills.deathBurst>0 then pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,t=t,damage=t.damage*t.skills.deathBurst,radius=1.5,limit=4,kind="ember"}end
 end
end
local function startWallCharge(t:any)
 local stacks=max(1,floor(t.skills.reboundCharge/.2+.5))
 t.state="wall_charge";t.wallChargeStacks=stacks
 t.wallChargeDuration=max(.38,.8-(stacks-1)*.08);t.wallChargeRemaining=t.wallChargeDuration
 t.wallSurgeDuration=1.25+.1*(stacks-1);t.wallSurgeSpeed=1.7+.1*(stacks-1);t.wallSurgeDamageBonus=.45+.12*(stacks-1)
 effect(t.x,t.z,"wall_charge",.72)
 S.skillTriggers.wall_charge=(S.skillTriggers.wall_charge or 0)+1
end
local function advanceWallCharge(t:any,dt:number)
 if t.state=="wall_charge" then
  t.wallChargeRemaining=max(0,(t.wallChargeRemaining or 0)-dt)
  if t.wallChargeRemaining<=1e-8 then
   local angle=rng()*math.pi*2;local dx,dz=cos(angle),sin(angle)
   -- Roll a new heading, but always launch back into the square from the wall.
   if abs(t.x)>=WALL_X-1e-5 and dx*t.x>0 then dx=-dx end
   if abs(t.z)>=WALL_Z-1e-5 and dz*t.z>0 then dz=-dz end
   local length=sqrt(dx*dx+dz*dz);t.dx=dx/length;t.dz=dz/length
   t.state="wall_surge";t.wallSurgeRemaining=t.wallSurgeDuration
   effect(t.x,t.z,"wall_surge",1.05,math.atan2(t.dz,t.dx))
  end
 elseif t.state=="wall_surge" then
  t.wallSurgeRemaining=max(0,(t.wallSurgeRemaining or 0)-dt)
  if t.wallSurgeRemaining<=1e-8 then t.state="run" end
 end
end
local function troopMovementSpeed(t:any,rush:number):number
 local speed=(t.k==3 and 24 or 8)*max(.25,1+t.skills.speedBonus+rush+(S.rewardClock<S.playerBuffs[t.playerId or S.seat].haste and .25 or 0))
 if t.state=="wall_surge" and (t.wallSurgeRemaining or 0)>0 then speed*=t.wallSurgeSpeed or 1.7 end
 return speed
end
local function moveTroop(t:any,distance:number)
 skillRuntime.composition:planMove(t,distance)
 -- Split the path at each wall. Sweeping across the reflected chord would
 -- incorrectly hit monsters that were never on the actual travel path.
 while distance>1e-8 and t.alive and S.phase=="battle" do
  local toX=t.dx>1e-8 and (WALL_X-t.x)/t.dx or (t.dx< -1e-8 and (-WALL_X-t.x)/t.dx or math.huge)
  local toZ=t.dz>1e-8 and (WALL_Z-t.z)/t.dz or (t.dz< -1e-8 and (-WALL_Z-t.z)/t.dz or math.huge)
  local step=max(0,min(distance,toX,toZ));local ox,oz=t.x,t.z
  t.x+=t.dx*step;t.z+=t.dz*step;t.travel+=step;distance-=step
  if t.state~="airborne" then
   local groundStart=t.groundTravel or 0
   local contacts:{{m:any,entry:number}}={}
   for _,m in ipairs(monsters)do
    if m.alive and (t.targetId==0 or t.targetId==m.id) and not t.hits[m.id] then
     local entry=segmentEntry(m,ox,oz,t.x,t.z)
     if entry~=nil then table.insert(contacts,{m=m,entry=entry})end
    end
   end
   table.sort(contacts,function(a:{m:any,entry:number},b:{m:any,entry:number})return a.entry<b.entry or (a.entry==b.entry and a.m.id<b.m.id)end)
   local triggerX,triggerZ=ox,oz
   for _,contact in ipairs(contacts)do
    t.groundTravel=groundStart+step*contact.entry
    local cx,cz=ox+(t.x-ox)*contact.entry,oz+(t.z-oz)*contact.entry
    skillRuntime.resonance:moved(t,triggerX,triggerZ,cx,cz);skillRuntime.triggers:moved(t,triggerX,triggerZ,cx,cz);triggerX=cx;triggerZ=cz
    contactHit(t,contact.m,cx,cz)
    if not t.alive then t.x=ox+(t.x-ox)*contact.entry;t.z=oz+(t.z-oz)*contact.entry end
    if not t.alive or S.phase~="battle" then break end
   end
   if t.alive then t.groundTravel=groundStart+step;skillRuntime.resonance:moved(t,triggerX,triggerZ,t.x,t.z);skillRuntime.triggers:moved(t,triggerX,triggerZ,t.x,t.z)end
  end
  if S.phase=="battle" then skillRuntime:moved(t,ox,oz,t.x,t.z,true)end
  if not t.alive or S.phase~="battle" then break end
  local bounceX=toX<=step+1e-8;local bounceZ=toZ<=step+1e-8
  if bounceX then t.dx=-t.dx end
  if bounceZ then t.dz=-t.dz end
  if bounceX or bounceZ then
   S.bounces+=1;t.bounceCount+=1;
   if t.bounceCount==1 and t.skills.wallQuake>0 then pendingProcs[#pendingProcs+1]={x=t.x,z=t.z,t=t,damage=t.damage*min(.9,t.skills.wallQuake),radius=1.5,limit=4,kind="cleave"}end
   t.reboundStacks=min(2,t.reboundStacks+1)
   local extra=min(max(0,1-t.lifeAdded),t.skills.bounceLife);t.life+=extra*(t.lifeScale or 1);t.lifeAdded+=extra
   effect(t.x,t.z,"wall",.6)
   if t.skills.reboundCharge>0 then startWallCharge(t);break end
  end
 end
end
local function updateCombat(dt:number)
 skillRuntime.composition:beginFrame(troops,monsters)
 S.battleSeconds+=dt;S.time=max(0,S.time-dt);cooldown=max(0,cooldown-dt)
 for _,streak in ipairs(S.streaks)do if streak.count>0 then streak.time-=dt;if streak.time<=0 then streak.count=max(0,streak.count-5);streak.time=1 end end end
 if not S.wheelSpawned and S.time<=S.roundDuration-80 and S.time>45 then
  S.wheelSpawned=true
  if rng()<.7 then
   addMonster(3,-6,0);local wheel=monsters[#monsters];wheel.special="roulette";wheel.skin="wheel";wheel.name="金鈴狸 · 奇遇轮盤";wheel.escapeAt=S.rewardClock+12;wheel.guard=70;wheel.scale=1.3
   effect(wheel.x,wheel.z,"spawn",1.3)
  end
 end
 if not S.specialSpawned and S.time<=S.roundDuration-45 then
  S.specialSpawned=true;addMonster(4,0,-2)
  local beetle=monsters[#monsters];beetle.name="聚寶甲蟲";beetle.special="beetle";beetle.skin="beetle";beetle.poolGold=80;beetle.contributions={0,0,0,0};beetle.guard=120;beetle.scale=1.9
  effect(beetle.x,beetle.z,"spawn",2)
 end
 S.hordeNotice=max(0,S.hordeNotice-dt)
 if S.hordeAt>=0 and S.roundDuration-S.time>=S.hordeAt then
  S.hordeAt=S.time>75 and S.roundDuration-S.time+25+rng()*15 or -1;S.hordeCount+=1;S.hordeNotice=3.5
  local small=0;for _,m in ipairs(monsters)do if m.alive and m.rank<=2 then small+=1 end end
  S.hordeAdded=min(80,max(0,110-small))
  -- Spread a simultaneous wave across the whole hunting area, not one pile.
  for i=1,S.hordeAdded do
   local x=-10+((i-1)%10)*2.22+(rng()-.5)*.45
   local z=-10+floor((i-1)/10)*2.75+(rng()-.5)*.35
   addMonster(i%4==0 and 2 or 1,x,z)
   effect(x,z,"summon",.45)
  end
 end
 if S.time<=30 and not S.bossSpawned then S.bossSpawned=true;addMonster(5,0,-1);effect(0,-1,"spawn",5)end
 for _,m in ipairs(monsters)do if m.alive then
  if m.escapeAt and S.rewardClock>=m.escapeAt then m.alive=false end
  m.slow=max(0,m.slow-dt);m.flash=max(0,m.flash-dt);m.turn-=dt
  if m.turn<=0 then m.angle+=(rng()-.5)*1.7;m.turn=1+rng()*3 end
  local speed=(m.rank<=2 and 1.35 or .65)*min(m.slow>0 and .8 or 1,skillRuntime:slowMultiplier(m))
  m.x+=sin(m.angle)*speed*dt;m.z+=cos(m.angle)*speed*dt
  -- Leave a narrow clear strip beside the stonework for silhouettes and rebounds.
  local roam=WALL_X-(.4+m.scale*.5)-.65
  if math.abs(m.x)>roam then m.x=max(-roam,min(roam,m.x));m.angle=-m.angle end
  if math.abs(m.z)>roam then m.z=max(-roam,min(roam,m.z));m.angle=math.pi-m.angle end
 end end
 -- Age every troop before a possible winning hit ends the iteration.
 for _,t in ipairs(troops)do
  t.age+=dt
  if t.age>=t.life-1e-8 then
   t.alive=false;S.expired+=1;S.lostPaid+=t.paid
   skillRuntime:onDeath(t,"expired")
   if t.skills.expireBurst>0 then pendingProcs[#pendingProcs+1]={x=t.x,z=t.z,t=t,damage=t.damage*t.skills.expireBurst,radius=1.4,limit=4,kind="leaf"}end
  end
 end
 for i=#troops,1,-1 do local t=troops[i]
  if t.alive then
  if frame%3==0 and #sparks<650 then sparks[#sparks+1]={x=t.x,y=.3,z=t.z,vx=-t.dx*.5,vz=-t.dz*.5,vy=.4,age=0,life=.38,kind=({"spark_red","spark_jade","spark_gold"})[t.k],size=t.k==3 and .20 or .14}end
  -- A piercing troop stops homing after its one primary contact, then travels
  -- through and rebounds normally. Keep targetId for LOCK damage exclusivity.
  advanceWallCharge(t,dt)
  if t.targetId~=0 and not t.hits[t.targetId] and t.state=="run" then for _,m in ipairs(monsters)do if m.id==t.targetId and m.alive then
   local dx,dz=m.x-t.x,m.z-t.z;local len=sqrt(dx*dx+dz*dz)
   if len>.01 then t.dx=dx/len;t.dz=dz/len end
   break
  end end end
  if t.state=="airborne" and t.travel>=t.landing-1e-8 then
   if t.landingX~=nil then t.x=t.landingX;t.z=t.landingZ end
   t.state="spin"
   if t.skills.crowdRing>0 then
    local count=0;for _,m in ipairs(monsters)do if m.alive and (m.x-t.x)^2+(m.z-t.z)^2<=2.9^2 then count+=1 end end
    if count>=3 then t.skills.spinRadius*=1+min(.6,t.skills.crowdRing)end
   end
  end
  if t.state=="wall_charge" then
   if frame%6==0 and #sparks<648 then
    local angle=(t.visualId*.731+frame*.21)%(2*math.pi)
    for side=-1,1,2 do local a=angle+side*.42;sparks[#sparks+1]={x=t.x,y=.32,z=t.z,vx=cos(a)*.34,vz=sin(a)*.34,vy=.25,age=0,life=.32,kind="spark_gold",size=.09}end
   end
  elseif t.state=="spin" then
   t.spin+=dt
   local targets:{any}={};for _,m in ipairs(monsters)do if m.alive and (t.targetId==0 or t.targetId==m.id) and not t.spinHits[m.id] and (m.x-t.x)^2+(m.z-t.z)^2<(t.skills.spinRadius+m.scale*.4)^2 then table.insert(targets,m)end end
   table.sort(targets,function(a:any,b:any)local da,db=(a.x-t.x)^2+(a.z-t.z)^2,(b.x-t.x)^2+(b.z-t.z)^2;return da<db or (da==db and a.id<b.id)end)
   for _,m in ipairs(targets)do t.spinHits[m.id]=true;S.spinHits+=1;hit(m,t.damage*t.skills.spinDamage,t);if S.phase~="battle" then break end end
   if t.spin>=t.skills.spinDuration then t.state="run" end
  else
   local rush=skillRuntime.triggers:movementBonus(t,dt)
   local speed=t.state=="airborne" and t.skills.flightSpeed*(1+rush) or troopMovementSpeed(t,rush)
   local distance=speed*dt
   if t.state=="airborne" then distance=min(distance,max(0,t.landing-t.travel))end
   moveTroop(t,distance)
  end
  end
  if not t.alive then effect(t.x,t.z,"impact",.7);table.remove(troops,i)end
  if S.phase~="battle" then break end
 end
 skillRuntime:update(dt,troops)
 local jobs=pendingProcs;pendingProcs={}
 for _,job in ipairs(jobs)do
  if S.phase~="battle" then break end
  local candidates:{{m:any,d:number}}={}
  for _,m in ipairs(monsters)do if m.alive and m.id~=job.exclude and (job.t.targetId==0 or job.t.targetId==m.id) then
   local d=(m.x-job.x)^2+(m.z-job.z)^2;if d<=(job.radius*(1+min(.6,job.t.skills.areaBonus)))^2 then table.insert(candidates,{m=m,d=d})end
  end end
  table.sort(candidates,function(a:{m:any,d:number},b:{m:any,d:number})return a.d<b.d or (a.d==b.d and a.m.id<b.m.id)end)
  effect(job.x,job.z,job.kind or "impact",job.radius*(1+min(.6,job.t.skills.areaBonus)))
  if #candidates>0 and job.kind~="lightning" then combatVisual(job.kind or "shock",job.x,job.z,job.x,job.z,job.t,job.radius*(1+min(.6,job.t.skills.areaBonus)))end
  for j=1,min(#candidates,job.limit)do
   if job.kind=="lightning" then combatVisual("lightning",job.x,job.z,candidates[j].m.x,candidates[j].m.z,job.t)end
   hit(candidates[j].m,job.damage*max(.5,1-job.t.skills.areaPenalty),job.t,true,job.kind);if S.phase~="battle" then break end end
 end
 skillRuntime:flush()
 if S.phase=="battle" then
  local small=0;for _,m in ipairs(monsters)do if m.alive and m.rank<=2 then small+=1 end end
  if small<32 and frame%45==0 then addMonster(rng()<.2 and 2 or 1,-10.2+rng()*20.4,-9.8+rng()*19.6)end
  if S.time>30 then
   local minor,middle=0,0;for _,m in ipairs(monsters)do if m.alive then if m.rank==3 then minor+=1 elseif m.rank==4 then middle+=1 end end end
   if minor<2 and frame%720==0 then addMonster(3,-5.9+rng()*11.8,-3)end
   if middle==0 and frame%1200==0 then addMonster(4,3,-3)end
  end
  if #monsters>70 then local living={};for _,m in ipairs(monsters)do if m.alive then living[#living+1]=m end end;monsters=living end
  if S.time<=0 then S.phase="defeat";S.message="時間耗盡，大王尚未開出大獎。"
  elseif S.coins<costs(1) and #troops==0 and not skillRuntime:hasPendingDamage()then S.phase="defeat";S.message="金幣耗盡，軍團已無法再出征。"end
 end
 if S.phase~="battle" then settleSurvivors()end
end
local function pack(b:buffer,i:number,x:number,y:number,z:number,yaw:number,sx:number,sy:number,sz:number)
 local o=(i-1)*40
 buffer.writef32(b,o,x);buffer.writef32(b,o+4,y);buffer.writef32(b,o+8,z)
 buffer.writef32(b,o+12,0);buffer.writef32(b,o+16,sin(yaw*.5));buffer.writef32(b,o+20,0);buffer.writef32(b,o+24,cos(yaw*.5))
 buffer.writef32(b,o+28,sx);buffer.writef32(b,o+32,sy);buffer.writef32(b,o+36,sz)
end
local function publish(api:any)
 S.skillRuntime=skillRuntime:view()
 local batches:{[string]:{any}}={cannon={},sword={},spear={},cavalry={},hound={},wraith={},minotaur={},lord={},impact={},target={},trail={},coin={},spark_gold={},spark_jade={},spark_red={},spark_ice={}}
 for _,p in ipairs(sparks)do local size=p.size*max(0,1-p.age/p.life);local list=batches[p.kind];list[#list+1]={p.x,p.y,p.z,p.spin and p.age*p.spin or p.age*6,size,size*2.4,size}end
 if S.phase=="battle" then for i=1,28 do local x=sin(i*37)*10;local z=cos(i*13)*7;local y=(S.rewardClock*.5+i*.27)%2.7;local size=.024+.018*sin(S.rewardClock*3+i);batches.spark_gold[#batches.spark_gold+1]={x,y,z,0,size,size*2,size}end end
 for _,c in ipairs(coinsFX)do if c.age>=0 then
  local a=c.age;local x,z,y=c.x,c.z,.1
  if a<.65 then local p=a/.65;x+=c.dx*p;z+=c.dz*p;y=.12+sin(p*math.pi)*c.peak
  elseif a<1.15 then x+=c.dx;z+=c.dz;y=.12
  else local p=min(1,(a-1.15)/.8);local ease=p*p;x=c.x+c.dx+(c.tx-c.x-c.dx)*ease;z=c.z+c.dz+(c.tz-c.z-c.dz)*ease;y=.12+sin(p*math.pi)*2 end
  batches.coin[#batches.coin+1]={x,y,z,a*7,.16,.16,.16}
 end end
 local publicMonsters={}
 for _,m in ipairs(monsters)do if m.alive then
  local kind=({"hound","wraith","minotaur","minotaur","lord"})[m.rank]
  batches[kind][#batches[kind]+1]={m.x,math.abs(sin(frame*.09+m.id))*.06,m.z,m.angle,m.scale,m.scale*(m.flash>0 and 1.09 or 1),m.scale}
  publicMonsters[#publicMonsters+1]={id=m.id,x=floor(m.x*1e6+.5)/1e6,z=floor(m.z*1e6+.5)/1e6,rank=m.rank,skin=m.skin,yaw=m.angle,animation=m.flash>0 and "hit" or "walk",scale=m.scale,guard=m.guard,damage=floor(m.damage),guardProgress=min(1,m.damage/max(1,m.guard)),name=m.name,breaks=m.breaks,special=m.special,poolGold=m.poolGold,poolMultiplier=m.poolGold and m.poolGold/80 or nil,contributions=m.contributions}
 end end
 for _,t in ipairs(troops)do
  local y=t.state=="airborne" and sin(min(1,t.travel/t.landing)*math.pi)*2.5 or math.abs(sin(t.age*20))*.1
  local yaw=math.atan2(t.dx,t.dz)+(t.state=="spin" and t.spin/t.skills.spinDuration*math.pi*2 or 0)
  batches[kinds[t.k]][#batches[kinds[t.k]]+1]={t.x,y,t.z,yaw,.67,.67,.67}
  if t.state=="spin" then batches.impact[#batches.impact+1]={t.x,.08,t.z,0,t.skills.spinRadius,1,t.skills.spinRadius}end
 end
 if S.phase=="menu" then
  for i,k in ipairs(kinds)do batches[k][1]={(i-2)*4,.2,3,-.25,1.4,1.4,1.4}end
 end
 for i=#effects,1,-1 do local e=effects[i];local size=e.size*(.3+e.age*2);batches.impact[#batches.impact+1]={e.x,.08,e.z,0,size,max(.01,1-e.age*2),size}end
 if S.phase=="battle" then
  batches.target[1]={S.aimX,.04,S.aimZ,0,.8,1,.8}
  local p=corners[S.seat];for i=1,10 do local a=i/11;batches.trail[i]={p.x+(S.aimX-p.x)*a,.12,p.z+(S.aimZ-p.z)*a,0,.5,.5,.5}end
 end
 for i,p in ipairs(corners)do
  local yaw=i==S.seat and math.atan2(S.aimX-p.x,S.aimZ-p.z) or math.atan2(-p.x,-p.z)
  batches.cannon[i]={p.x,0,p.z,yaw,1,1,1}
 end
 for key,list in pairs(batches)do
  local b=buffer.create(#list*40);for i,p in ipairs(list)do pack(b,i,table.unpack(p))end;api.instances3d.set(key,"mesh://"..key,b)
 end
 local offer={};for _,id in ipairs(S.offer)do local c=catalog[id];offer[#offer+1]={id=c.id,name=c.name,type=c.type,desc=c.desc}end
 for k=1,3 do for i=1,#runeDefinitions do S.runeOwned[k][i]=runeCopies(i)>0 end end
 S.chapter=chapters[S.round];S.costs={costs(1),costs(2),costs(3)};S.troops=#troops;S.monsters=publicMonsters;S.cards=offer
 S.visualTroops={}
  for _,t in ipairs(troops)do table.insert(S.visualTroops,{id=t.visualId,k=t.k,x=t.x,z=t.z,y=t.state=="airborne" and sin(min(1,t.travel/t.landing)*math.pi)*2.5 or 0,yaw=math.atan2(t.dx,t.dz)+(t.state=="spin" and t.spin/t.skills.spinDuration*math.pi*2 or 0),state=t.state,age=t.age,life=t.life,equipment=t.equipment,skillFx=t.skills.vfxSkills,playerId=t.playerId,bounces=t.bounceCount,pierce=t.pierceRemaining,mainHits=t.mainHits or 0,birthRush=skillRuntime.triggers:speedBonus(t),wallCharge=t.state=="wall_charge" and (t.wallChargeRemaining or 0)/max(.01,t.wallChargeDuration or .8) or 0,wallSurge=t.state=="wall_surge" and (t.wallSurgeRemaining or 0)/max(.01,t.wallSurgeDuration or 1.25) or 0,marchCharges=t.marchCharges or 0,inspired=(t.elegyUntil or 0)>skillRuntime.clock,spinRadius=t.skills.spinRadius,spinProgress=t.state=="spin" and t.spin/t.skills.spinDuration or 0})end
 -- Presentation receipts only; the native fallback batches above remain available.
 S.visualEffects={}
  for i=max(1,#effects-63),#effects do local e=effects[i];table.insert(S.visualEffects,{id=e.id,kind=e.kind,x=e.x,z=e.z,tx=e.tx,tz=e.tz,sx=e.sx,sz=e.sz,radius=e.size,time=e.time,direction=e.direction})end
 S.loadouts={composeSkills(1),composeSkills(2),composeSkills(3)}
 S.unitStats={}
 for k=1,3 do
  local skills=S.loadouts[k]
  S.unitStats[k]={
   damage=baseDamage[k]*S.damage*(1+.3*(S.equipment[k]-1))*(1+skills.damageBonus),
   life=baseLife[k]*(k==3 and S.lifetime or 1)*(1+skills.lifeBonus),
   speed=(k==3 and 24 or 8)*max(.25,1+skills.speedBonus),
   crit=skills.critChance,
   pierce=skills.pierce,
  }
 end
 S.runeBook=runeDefinitions;S.awardPreview={}
 for rank=3,5 do local preview=awardWeights({rank=rank},S.loadouts[S.selected],S.luck);preview.rank=rank;preview.awardChance=baseAwardChances[rank]*economyTuning.awardScale;S.awardPreview[#S.awardPreview+1]=preview end
 if not S.skillBook then
  S.skillBook={}
  for _,entry in ipairs(catalog)do if skillDefinitions[entry.id] then S.skillBook[entry.id]={name=entry.name,desc=entry.desc,deployExtra=sourcePrices[entry.id] or 0}end end
  for _,def in ipairs(awardAffixes)do S.skillBook[def.id].icon=def.icon end
 end
 S.activeSkills={}
 for _,sources in ipairs({innateSkills[S.selected],S.skillSources[S.selected],wornSources(S.selected),S.tech[S.selected]})do
  for _,source in ipairs(sources)do S.activeSkills[source.id]=(S.activeSkills[source.id] or 0)+(source.stacks or 1)end
 end
 local equippedRune=runeDefinitions[S.runes[S.selected]];if equippedRune and equippedRune.skill then S.activeSkills[equippedRune.skill]=(S.activeSkills[equippedRune.skill] or 0)+1 end
 S.rewards=rewardEvents;S.coinParticles=#coinsFX
 while #S.damageEvents>0 and S.rewardClock-S.damageEvents[1].time>1.8 do table.remove(S.damageEvents,1)end
 S.particles=#sparks;S.bossPresent=false;local smallCount,kingCount=0,0
 for _,m in ipairs(monsters)do if m.alive then if m.rank<=2 then smallCount+=1 elseif m.rank==5 then S.bossPresent=true else kingCount+=1 end end end
 api.observation.set("boss_present",S.bossPresent);api.observation.set("small_present",smallCount>0);api.observation.set("kings_present",kingCount>0)
 api.observation.set("horde_count",S.hordeCount);api.observation.set("horde_added",S.hordeAdded);api.observation.set("small_count",smallCount)
 S.playerGold[S.seat]=S.coins
 api.observation.set("game",S)
 local allGold=0;for _,gold in ipairs(S.playerGold)do allGold+=gold end
 api.observation.set("crystal_conserved",S.crystals==S.crystalStart+S.crystalEarned+S.crystalSold-S.crystalSpent and S.crystals>=0)
 api.observation.set("economy_conserved",allGold==1280+S.earned+S.refunded+S.sold-S.spent-S.shopSpent)
 api.observation.set("lottery_misses",S.lotteryMisses)
 local livePaid=0;for _,t in ipairs(troops)do livePaid+=t.paid end
 api.observation.set("deployment_cost_conserved",S.spent==S.lostPaid+S.refunded+livePaid)
 api.observation.set("troop_count_conserved",S.fired+S.freeFired==S.contactDeaths+S.expired+S.returnedTotal+#troops)
 api.observation.set("troops",#troops);api.observation.set("bounces",S.bounces);api.observation.set("expired",S.expired);api.observation.set("refunded",S.refunded)
 local bounded=true;for _,t in ipairs(troops)do if math.abs(t.x)>WALL_X+1e-6 or math.abs(t.z)>WALL_Z+1e-6 then bounded=false end end
 api.observation.set("troops_in_bounds",bounded)
 api.observation.set("lock_exclusive",S.lockViolations==0)
 api.observation.set("field_width",WALL_X*2);api.observation.set("field_depth",WALL_Z*2)
 api.observation.set("deployment_origin_x",corners[S.seat].x);api.observation.set("deployment_origin_z",corners[S.seat].z)
 api.observation.set("last_spawn_x",S.lastSpawnX or 0);api.observation.set("last_spawn_z",S.lastSpawnZ or 0)
 api.observation.set("phase",S.phase);api.observation.set("round",S.round);api.observation.set("fired",S.fired);api.observation.set("breaks",S.breaks);api.observation.set("choices",#S.inventory)
 if publishFormalUI then publishFormalUI(api) end
end
local function pressed(api:any,key:string)
 local down=api.input.isDown(key);local edge=down and not held[key];held[key]=down;return edge
end
local function autoInput(api:any,escape:boolean):boolean
 -- Consume every edge even while hidden, so a held action cannot toggle twice.
 local toggleAuto=pressed(api,"Mode_auto");local settings=pressed(api,"Auto_settings")
 local toggleLock=pressed(api,"Mode_lock");local manual=pressed(api,"Mode_manual")
 local all=pressed(api,"Auto_all");local none=pressed(api,"Auto_none")
 local small=pressed(api,"Auto_small");local boss=pressed(api,"Auto_boss");local special=pressed(api,"Auto_special")
 local apply=pressed(api,"Auto_apply");local cancel=pressed(api,"Auto_cancel");local stop=pressed(api,"Auto_stop")
 local toggles={};for _,def in ipairs(autoSpecies)do toggles[def.id]=pressed(api,"Auto_target_"..def.id)end
 local wasOpen=S.autoConfigOpen
 local changed=false;local open=false
 if S.phase=="battle" and not S.paused then
  -- LOCK and AUTO are independent switches. A toggle never disables its sibling.
  if manual then S.lockEnabled=false;S.autoEnabled=false;changed=true end -- legacy harness action, no UI option
  if toggleLock then S.lockEnabled=not S.lockEnabled;changed=true end
  if toggleAuto then
   if S.autoEnabled then S.autoEnabled=false;changed=true else open=true end
  end
  if settings then open=true end
  if changed then
   S.fireRearm=true;pointerHeld=false
   if not S.lockEnabled and not S.autoEnabled then S.targetId=0;S.targetName="" end
  end
 end
 if open then
  S.autoDraft={};for _,def in ipairs(autoSpecies)do S.autoDraft[def.id]=S.autoTargets[def.id]==true end
  S.autoConfigOpen=true;S.paused=true;S.fireRearm=true;pointerHeld=false
 end
 if S.autoConfigOpen then
  if all then S.autoDraft=autoPreset("all")end
  if none then S.autoDraft=autoPreset("none")end
  if small then S.autoDraft=autoPreset("small")end
  if boss then S.autoDraft=autoPreset("boss")end
  if special then S.autoDraft=autoPreset("special")end
  for _,def in ipairs(autoSpecies)do if toggles[def.id]then S.autoDraft[def.id]=not S.autoDraft[def.id]end end
  if cancel or escape or stop then
   S.autoConfigOpen=false;S.paused=false;S.fireRearm=true
   if stop then
    S.autoEnabled=false
    if not S.lockEnabled then S.targetId=0;S.targetName="" end
   end
  elseif apply and autoCount(S.autoDraft)>0 then
   S.autoTargets={};for _,def in ipairs(autoSpecies)do S.autoTargets[def.id]=S.autoDraft[def.id]==true end
   S.autoEnabled=true;S.targetId=0;S.targetName="";S.autoConfigOpen=false;S.paused=false;S.fireRearm=true
  end
 end
 -- Compatibility observation for existing replay consumers; flags own the state.
 S.fireMode=S.lockEnabled and "lock" or (S.autoEnabled and "auto" or "manual")
 return changed or wasOpen or S.autoConfigOpen
end
local function targeting(api:any)
 local down=api.input.isPointerDown();local p=api.input.getPointerPosition()
 if S.fireRearm then
  pointerHeld=down
  if down or api.input.isDown("Space")then return end
  S.fireRearm=false
 end
 if S.lockEnabled and down and not pointerHeld then
  local best:any=nil;local dist=math.huge
  for _,m in ipairs(monsters)do if m.alive and (not S.autoEnabled or S.autoTargets[m.skin])then local d=(m.x-p.x)^2+(m.z-p.y)^2;if d<dist and d<(m.scale+1)^2 then best=m;dist=d end end end
  S.targetId=best and best.id or 0
 end
 pointerHeld=down
 local target:any=nil
 for _,m in ipairs(monsters)do if m.alive and m.id==S.targetId and (not S.autoEnabled or S.autoTargets[m.skin])then target=m;break end end
 if S.autoEnabled and not target then
  local dist=math.huge;local origin=corners[S.seat]
  for _,m in ipairs(monsters)do if m.alive and S.autoTargets[m.skin] then
   local d=(m.x-origin.x)^2+(m.z-origin.z)^2;if d<dist then target=m;dist=d end
  end end
 end
 S.targetId=target and target.id or 0;S.targetName=target and target.name or ""
 if S.lockEnabled or S.autoEnabled then
  if target then S.aimX=target.x;S.aimZ=target.z;fire()end
 else
  S.aimX=max(-WALL_X+.1,min(WALL_X-.1,p.x));S.aimZ=max(-WALL_Z+.1,min(WALL_Z-.1,p.y))
  if down or api.input.isDown("Space") then fire()end
 end
end
-- BEGIN FORMAL UI
-- Game-owned view composition. Bundled into main.luau by build-formal-ui.mjs.
-- All purchases, combat and rewards still use existing game semantic actions.
local formalRoute="home"
local formalPage=1
local formalScroll=0
local formalPreviousPhase=""
local formalMuted=false
-- BEGIN GENERATED UI SKINS
local formalSkins:any={
 ["control-quiet-v3"]={width=1940,height=412,x=76,y=161,left=80,top=80,right=80,bottom=80,scale=0.12},
 ["shop-window-panel-v2"]={width=1285,height=1224,x=0,y=0,left=360,top=540,right=360,bottom=360,scale=0.2},
 ["shop-card-rare-v2"]={width=940,height=1672,x=0,y=0,left=210,top=360,right=210,bottom=360,scale="width"},
 ["shop-card-epic-v2"]={width=941,height=1672,x=0,y=0,left=210,top=360,right=210,bottom=360,scale="width"},
 ["shop-card-legendary-v2"]={width=941,height=1672,x=0,y=0,left=210,top=360,right=210,bottom=360,scale="width"},
 ["shop-button-primary-v2"]={width=2044,height=484,x=66,y=113,left=300,top=100,right=300,bottom=100,scale="height"},
 ["shop-button-secondary-v2"]={width=1999,height=489,x=49,y=100,left=300,top=100,right=300,bottom=100,scale="height"}
}
-- END GENERATED UI SKINS
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
  -- One texture / one logical Core node. The host owns patch rendering;
  -- these approved art cut-lines and sizing choices remain game-owned.
  local window=string.find(prefix,"window")~=nil
  if window then img(id.."_fill","texture://ui_shop-surface",x+.8,y+2,w-1.6,h-4)end
  local key=string.gsub(prefix,"texture://ui_","");local data=formalSkins[key]
  assert(data,"UI_SKIN_MISSING: "..key.."; run build-formal-ui.mjs")
  local scale=if data.scale=="width" then w*1920/100/data.width elseif data.scale=="height" then h*1080/100/data.height else data.scale*1.2
  scale=min(scale,w*1920/100/(data.left+data.right+1),h*1080/100/(data.top+data.bottom+1))
  table.insert(nodes,{kind="image",id=id,asset=prefix,fit="stretch",rect=rect(x,y,w,h),slice={left=data.left,top=data.top,right=data.right,bottom=data.bottom,pixels_per_unit=10.8/scale,source={x=data.x,y=data.y,width=data.width,height=data.height}}})
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

-- END FORMAL UI
function Game.start(api:any)
 apiRef=api
 local saved=api.save.get();profiles={newProfile(1),newProfile(2),newProfile(3)};activeProfile=1;settings=validSettings(nil)
 if type(saved)=="table" and saved.version==1 then
  local old=validProfile(saved,1);if old then profiles[1]=old end
 elseif type(saved)=="table" and saved.version==2 and type(saved.profiles)=="table" then
  local valid=true;for i=1,3 do local p=validProfile(saved.profiles[i],i);if not p then valid=false;break end;profiles[i]=p end
  if valid then activeProfile=type(saved.active)=="number" and math.clamp(floor(saved.active),1,3) or 1 else profiles={newProfile(1),newProfile(2),newProfile(3)} end
 elseif type(saved)=="table" and (saved.version==3 or saved.version==4) and type(saved.profiles)=="table" then
  local valid=true;for i=1,3 do local p=validProfile(saved.profiles[i],i);if not p then valid=false;break end;profiles[i]=p end
  if valid then activeProfile=type(saved.active)=="number" and math.clamp(floor(saved.active),1,3) or 1;settings=validSettings(saved.settings) else profiles={newProfile(1),newProfile(2),newProfile(3)} end
 end
 town=profiles[activeProfile]
 reset();publish(api)
end
local function advancePresentation(dt:number)
 if not S.paused then
  S.rewardClock+=dt
  for i=#S.pendingWheel,1,-1 do local job=S.pendingWheel[i]
   if S.rewardClock>=job.revealAt and (S.phase=="battle" or job.result==6)then table.remove(S.pendingWheel,i);applyWheel(job.result,job.winner);if S.roulette and S.roulette.id==job.id then S.roulette.settled=true end end
  end
  S.presentationDelay=max(0,S.presentationDelay-dt)
  for i=#coinsFX,1,-1 do local c=coinsFX[i];c.age+=dt;if c.age>=1.95 then table.remove(coinsFX,i)end end
  for i=#sparks,1,-1 do local p=sparks[i];p.age+=dt;p.vy-=4*dt;p.x+=p.vx*dt;p.y=max(.04,p.y+p.vy*dt);p.z+=p.vz*dt;if p.age>=p.life then table.remove(sparks,i)end end
 end
 if not S.paused then for i=#effects,1,-1 do effects[i].age+=dt;if effects[i].age>.45 then table.remove(effects,i)end end end
end
function Game.update(api:any,dt:number)
 formalInput(api)
 frame+=1
 if S.phase=="celebration" then
  if pressed(api,"Pause") or pressed(api,"Escape") then S.paused=not S.paused end
  advancePresentation(dt)
  if not S.paused then
   local outro=S.roundOutro
   outro.elapsed=min(outro.duration,outro.elapsed+dt)
   S.presentationDelay=max(0,outro.duration-outro.elapsed)
   if outro.elapsed>=outro.duration-1e-8 then outro.elapsed=outro.duration;S.phase=outro.result;S.presentationDelay=0 end
  end
  -- Inputs from a held fire button or a stale result panel are consumed here.
  if frame%2==0 then publish(api)end
  return
 end
 if S.phase=="defeat" then S.resultElapsed=min(3,S.resultElapsed+dt) end
 if S.phase=="map" and S.mapMoving then
  S.mapElapsed=min(S.mapDuration,S.mapElapsed+dt)
  local progress=min(1,S.mapElapsed/S.mapDuration)
  S.mapPosition=S.mapFrom+(S.round-S.mapFrom)*(progress*progress*(3-2*progress))
  if S.mapElapsed>=S.mapDuration-1e-8 then S.mapMoving=false;S.mapPosition=S.round;offers();S.phase="choice" end
 end
 local start=pressed(api,"Start");local nextRound=pressed(api,"Next");local home=pressed(api,"Home");local pause=pressed(api,"Pause") or pressed(api,"Escape")
 if home then reset()end
 if pressed(api,"ReturnTown") and (S.phase=="defeat" or S.phase=="victory") then reset();formalPreviousPhase="menu";formalRoute="town" end
 if pressed(api,"LaunchExpedition") and S.phase=="menu" and formalRoute=="town" then town.runs+=1;persistProfiles();reset();travelToRound()end
 if pressed(api,"ExitGame") and S.phase=="menu" then persistProfiles();S.exitRequested=true;S.message="進度已儲存，請關閉遊戲視窗。" end
 if S.phase=="menu" and formalRoute=="profiles" then
 for i=1,3 do
   local profileAction=pressed(api,"Profile"..i)
   local loadAction=pressed(api,"LoadProfile"..i) or profileAction
   local createAction=pressed(api,"CreateProfile"..i) or profileAction
   if loadAction and profileReady(profiles[i]) then
    activeProfile=i;town=profiles[i];persistProfiles();reset();formalPreviousPhase="menu";formalRoute="town"
   elseif createAction and not profileReady(profiles[i]) then
    profiles[i]=newProfile(i);profiles[i].created=true;activeProfile=i;town=profiles[i];persistProfiles();reset();formalPreviousPhase="menu";formalRoute="town"
   elseif pressed(api,"DeleteProfile"..i) and profileReady(profiles[i]) then
    S.deleteCandidate=i
   end
  end
  if pressed(api,"ConfirmDelete") and S.deleteCandidate and S.deleteCandidate>0 then
   local index=S.deleteCandidate;profiles[index]=newProfile(index)
   if activeProfile==index then town=profiles[index] end
   S.profiles=profiles;S.town=town;S.activeProfile=activeProfile;S.deleteCandidate=0;persistProfiles()
  elseif pressed(api,"CancelDelete") then S.deleteCandidate=0 end
 end
 if S.phase=="menu" and formalRoute=="settings" then
  local changed=false
  if pressed(api,"Setting_music_down") then settings.music=max(0,settings.music-.1);changed=true end
  if pressed(api,"Setting_music_up") then settings.music=min(1,settings.music+.1);changed=true end
  if pressed(api,"Setting_sfx_down") then settings.sfx=max(0,settings.sfx-.1);changed=true end
  if pressed(api,"Setting_sfx_up") then settings.sfx=min(1,settings.sfx+.1);changed=true end
  if pressed(api,"Setting_quality") then local order={"low","medium","high"};local index=table.find(order,settings.quality) or 3;settings.quality=order[index%#order+1];changed=true end
  if pressed(api,"Setting_language") then local order={"繁中","简中","English"};local index=table.find(order,settings.language) or 1;settings.language=order[index%#order+1];changed=true end
  if changed then S.settings=settings;persistProfiles() end
 end
 local autoHandled=autoInput(api,pause);if autoHandled then pause=false end
 -- Local player stays at the assigned cannon. UI/debug actions cannot change seats.
 for i=1,3 do if pressed(api,"Unit"..i) or pressed(api,"Digit"..i) then S.selected=i end end
 if start and S.phase=="menu" and formalRoute=="home" then
  formalRoute="profiles";formalPreviousPhase="menu"
 elseif start and S.phase=="menu" then
  formalRoute="town";formalPreviousPhase="menu"
 elseif start and (S.phase=="defeat" or S.phase=="victory") then
  local build=S.buildIndex;reset();S.buildIndex=build;travelToRound()
 end
 if nextRound and S.phase=="clear" and S.presentationDelay<=0 then S.round+=1;S.won=false;S.chestResult=nil;travelToRound()end
 if pressed(api,"ViewMap") and S.phase=="choice" then S.phase="map";S.mapMoving=false;S.mapPosition=S.round end
 if pressed(api,"VisitLocation") and S.phase=="map" and not S.mapMoving then S.phase="choice" end
 for i=1,3 do
  if pressed(api,"Choice"..i) and S.phase=="choice" then
   local c=catalog[S.offer[i]];c.apply();S.inventory[#S.inventory+1]={name=c.name,type=c.type};if S.phase=="choice" then beginBattle()end
  end
 end
 if S.phase=="shop" or S.phase=="choice" or S.phase=="clear" or S.phase=="loadout" then S.choiceSeconds+=dt end
 for i=1,5 do if pressed(api,"Slot"..i)then S.equipSlot=i end end
 if S.phase=="loadout" then
  for i=1,#runeDefinitions do if pressed(api,"Rune"..i) and S.runes[S.selected]~=i then
   local donor=runeHolder(i,S.selected)
   if S.runeBag[i]>0 or donor then
    local old=S.runes[S.selected];if old>0 then S.runeBag[old]+=1 end
    if S.runeBag[i]>0 then S.runeBag[i]-=1 elseif donor then S.runes[donor]=0 end
    S.runes[S.selected]=i
   end
  end end
  if pressed(api,"RuneOff")then local old=S.runes[S.selected];if old>0 then S.runeBag[old]+=1;S.runes[S.selected]=0 end end
  for i=1,27 do
   local item=S.items[i]
   if pressed(api,"Equip"..i) and item then
    local elsewhere=false;for _,worn in ipairs(S.worn :: {{number}})do for _,id in ipairs(worn)do if id==item.id then elsewhere=true end end end
    if elsewhere and S.worn[S.selected][item.slot]~=0 and S.worn[S.selected][item.slot]~=item.id and not canStoreItem() then S.message="背包已滿，先騰出位置"
    else
    for _,worn in ipairs(S.worn :: {{number}})do for slot,id in ipairs(worn)do if id==item.id then worn[slot]=0 end end end
    S.worn[S.selected][item.slot]=item.id
    end
   end
  end
  if pressed(api,"Unequip")then if canStoreItem() then S.worn[S.selected][S.equipSlot]=0 else S.message="背包已滿，無法卸下" end end
 end
 if pressed(api,"Deploy") and S.phase=="loadout" and S.loadoutReturn=="shop" then beginBattle()end
 if S.phase=="shop" then
  for i=1,27 do local item=S.items[i]
   if pressed(api,"Sell"..i) and item and S.location=="market" then
    local equipped=false;for _,worn in ipairs(S.worn :: {{number}})do for _,id in ipairs(worn)do if id==item.id then equipped=true end end end
    if equipped then S.message="先到部隊配置卸下裝備" else local value=floor(item.paid*.5);S.crystals+=value;S.crystalSold+=value;table.remove(S.items,i)end
   end
  end
  for i=1,#runeDefinitions do if pressed(api,"SellRune"..i) and S.location=="rune" and S.runeBag[i]>0 then
   local value=floor(runePrices[i]*.5);S.runeBag[i]-=1;S.crystals+=value;S.crystalSold+=value
  end end
  for i=1,#S.stock do if pressed(api,"Buy"..i)then
   local item=S.stock[i]
   if item and not item.sold then
    local wasSold=item.sold==true
    if item.kind=="gear" and canStoreItem() and payCrystals(item.price)then addItem(gearCatalog[item.value],item.price);item.sold=true;item.itemId=S.items[#S.items].id
    elseif item.kind=="rune" and runeCopies(item.value)<3 and payCrystals(item.price)then S.runeBag[item.value]+=1;item.sold=true
    elseif item.kind=="potion" and #S.potions<2 and pay(item.price)then table.insert(S.potions,{kind=item.value,paid=item.price});item.sold=true
    elseif item.kind=="tech" and not S.researchUsed and payCrystals(item.price)then table.insert(S.tech[item.unit],{id=item.value});S.researchUsed=true;item.sold=true
    elseif item.kind=="curse" and #S.curses<2 then
     local duplicate=false;for _,c in ipairs(S.curses :: {Curse})do if c.kind==item.value then duplicate=true end end
     if not duplicate then table.insert(S.curses,{kind=item.value,remaining=2});for _,stock in ipairs(S.stock :: {{sold:boolean?,[string]:any}})do stock.sold=true end end
    end
    if item.sold and not wasSold then formalShopDetail=0 end
   end
  end end
  if pressed(api,"RefreshShop") and S.location=="market" and payCrystals(S.refreshCost or 2)then
   S.refreshCount=(S.refreshCount or 0)+1;stockShop(true)
  end
  if pressed(api,"Enchant") and S.location=="enchant" and S.enchantUses<2 and not S.enchantPending then
   local item=itemById(S.worn[S.selected][S.equipSlot])
   if not item then S.message="先選擇已穿戴裝備" elseif payCrystals(8)then
    S.enchantUses+=1;local roll=rng();local forgeLuck=0;local tier=roll<.05 and 3 or (roll<.30+forgeLuck and 2 or 1)
    local pools={
     {"longlife","haste","heavy","critical","crit_power","king_hunter","frost_touch","heat","distance","last_stand","slow_force","sharp","short_fuse","wide_blade","fracture","solo_hunt","recruit","solitary"},
     {"pierce","bounce_power","bounce_life","rebound_charge","ricochet_precision","hunter_vigor","frenzy","finisher","shatter","expire_burst","wall_quake","hit_echo","crowd_ring","rally","rapid","showdown","giant"},
     {"landing_spin","momentum","lightning","shock","third_crit","ember_burst","piercing_wave","spin_master","double_pierce","deadly","flame_cloak","phoenix_fire","plague_vial","ember_trail","slick_oil","rain_strike","storm_touch","oil_legacy","plunder","firstborn","march_capacitor","delayed_bloom","third_pulse","battle_elegy","grave_bloom","last_echo","comrade_oath","resonant_debt","contact_mine","step_orb","gravity_law","quick_chant","overload_script","storm_payload","cinder_seal","chain_fuse","thunder_fan","echo_blade","starfall","soul_return","legacy_gift","guard_bequest"}}
    for _,def in ipairs(awardAffixes)do table.insert(pools[2],def.id)end
    local pool=pools[tier];S.enchantPending={itemId=item.id,skill=pool[1+floor(rng()*#pool)],tier=tier}
   end
  end
  if pressed(api,"AcceptEnchant") and S.enchantPending then local item=itemById(S.enchantPending.itemId);if item then item.enchant=S.enchantPending.skill end;S.enchantPending=nil end
  if pressed(api,"KeepEnchant")then S.enchantPending=nil end
  -- Use the same battle start; never discard an unresolved enchant or dialog.
  if pressed(api,"QuickDeploy") and not S.enchantPending and formalShopDetail==0 then beginBattle()
  elseif pressed(api,"LeaveShop") and openLoadout() then formalPreviousPhase="shop";formalRoute="gear";formalPage=1;formalDrawerOpen=true;formalDrawerClosed=false;formalLoadoutWasActive=true end
 end
 for i=1,2 do if pressed(api,"Potion"..i) and S.phase=="battle" and not S.paused and not autoHandled then
  local potion=S.potions[i]
  local owned:{any}={};for _,t in ipairs(troops)do if t.alive and t.playerId==S.seat then table.insert(owned,t)end end
  if potion and (#owned>0 or potion.kind==1)then
   if potion.kind==1 then S.playerBuffs[S.seat].haste=S.rewardClock+8
   elseif potion.kind==2 then for _,t in ipairs(owned)do t.life+=1.5*(t.lifeScale or 1) end
   else
    for i=#troops,1,-1 do local t=troops[i];if t.alive and t.playerId==S.seat then S.coins+=t.paid;S.refunded+=t.paid;S.returnedTotal+=1;table.remove(troops,i)end end
   end
   table.remove(S.potions,i)
  end
 end end
 if S.phase=="clear" or S.phase=="victory" then
  if api.input.isDown("OpenChest") and S.chestCount>0 and S.chests[1].playerId==S.seat and not S.chestResult then
   S.chestHold+=dt
   if S.chestHold>=1 then
    local chest=S.chests[1];local pool={}
    for _,def in ipairs(gearCatalog)do if (chest.tier==1 and def.price<=96)or(chest.tier==2 and def.price>=104)or(chest.tier==3 and def.price>=120)then table.insert(pool,def)end end
    local def=pool[1+floor(rng()*#pool)]
    if addItem(def,0)then
     if chest.tier==3 then S.items[#S.items].enchant="critical" end
     table.remove(S.chests,1);S.chestCount=#S.chests;S.chestResult=def.name;S.chestHold=0
    end
   end
  else S.chestHold=0 end
  if pressed(api,"ChestDone")then S.chestResult=nil end
 end
 if S.phase=="menu" and formalRoute=="town" then
  for i=1,3 do if pressed(api,"Profile"..i)then activeProfile=i;town=profiles[i];S.town=town;S.activeProfile=i;S.townStartMaterials=town.materials;persistProfiles() end end
  -- The UI opens a confirmation modal first; only this explicit confirmation
  -- mutates save-scoped materials and node levels.
  if S.townUpgradeConfirmRequested then
   local i=S.townUpgradeIndex or 0;local node=townNodeDefs[i];town.nodes=town.nodes or {0,0,0,0,0,0,0,0}
   local level=i<=4 and (town.nodes[i] or 0) or (town.nodes[i] or 0)
   local price=i<=4 and ({60,100,160,240,360})[(town.levels[i] or 0)+1] or (node and node.prices[level+1])
   if node and price and level<node.max and townNodePrereqsMet(i) and town.materials>=price then
    town.materials-=price;town.gold=town.materials
    if i<=4 then town.levels[i]=min(5,(town.levels[i] or 0)+1) end
    town.nodes[i]=min(node.max,level+1);persistProfiles()
   end
   S.townUpgradeConfirmRequested=false;S.townUpgradePending=false;S.townUpgradeIndex=0
  end
 end
 if pause and S.phase=="battle" then S.paused=not S.paused end
 if S.phase=="battle" and not S.paused and not autoHandled then
  targeting(api)
  updateCombat(dt)
 end
 advancePresentation(dt)
 if frame%2==0 then publish(api)end
end
return Game
