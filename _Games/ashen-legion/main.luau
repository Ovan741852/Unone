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
local floor,min,max,sin,cos,sqrt=math.floor,math.min,math.max,math.sin,math.cos,math.sqrt
local function rng()return apiRef.random.nextFloat()end
local sourcePrices:{[string]:number}={pierce=4,critical=3,landing_spin=6,longlife=2,haste=2,heavy=3,bounce_power=4,bounce_life=3,momentum=4,shock=6}
local town:any={version=1,gold=0,levels={0,0,0,0}}
local function itemById(id:number): Item?
 for _,item in ipairs((S.items or {}) :: {Item})do if item.id==id then return item end end
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
local skillDefinitions={
 critical={critChance=.10,critMultiplier=1.5},
 pierce={pierce=1},
 landing_spin={landingSpin=true,spinRadius=2.9,spinDuration=.55,spinDamage=1.0,flightSpeed=16},
 longlife={lifeBonus=.15},haste={speedBonus=.15},heavy={speedBonus=-.20,damageBonus=.35},
 bounce_power={bouncePower=.12},bounce_life={bounceLife=.2},momentum={momentum=.6},shock={shock=.2},
 crit_power={critAdd=.25},finisher={finisher=.1},ember_burst={deathBurst=.35},king_hunter={kingDamage=.2},
 frost_touch={frost=1},frenzy={frenzy=1},last_stand={lastStand=.4},heat={heat=.05},distance={distance=.3},
 wall_quake={wallQuake=.3},short_fuse={lifeBonus=-.2,damageBonus=.45},wide_blade={areaBonus=.2,areaPenalty=.1},hit_echo={hitEcho=.2},fracture={fracture=.2},solo_hunt={soloHunt=.25},crowd_ring={crowdRing=.2},recruit={recruit=1},rally={rally=1},rapid={rapid=.25},solitary={solitary=.3},showdown={showdown=.25},sharp={damageBonus=.1},giant={damageBonus=.25},double_pierce={pierce=2},deadly={critAdd=.5},
 shatter={shatter=.3},ricochet_precision={bounceCrit=.15},hunter_vigor={killLife=.25},piercing_wave={pierceWave=.2},slow_force={slowForce=.75},spin_master={spinMaster=.2},
 lightning={lightning=.25},third_crit={thirdCrit=1},expire_burst={expireBurst=.25},rebound_charge={reboundCharge=.2},

}
local modifierKeys={"lifeBonus","speedBonus","damageBonus","bouncePower","bounceLife","momentum","shock","critAdd","finisher","deathBurst","kingDamage","frost","frenzy","lastStand","heat","distance","lightning","thirdCrit","expireBurst","reboundCharge","shatter","bounceCrit","killLife","pierceWave","slowForce","spinMaster","wallQuake","areaBonus","areaPenalty","hitEcho","fracture","soloHunt","crowdRing","recruit","rally","rapid","solitary","showdown"}
local innateSkills:{{SkillSource}}={{{id="critical"}},{{id="landing_spin"}},{{id="pierce",stacks=20}}}
local function composeSkills(k:number)
 local result:any={pierce=0,critChance=0,critMultiplier=1,landingSpin=false,spinRadius=0,spinDuration=0,spinDamage=0,flightSpeed=0}
 for _,key in ipairs(modifierKeys)do result[key]=0 end
 local function add(source:any)
  local definition=skillDefinitions[source.id];assert(definition,"Unknown skill: "..source.id)
  local stacks=source.stacks or 1
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
 result.lifeBonus+=town.levels[1]*.02;result.damageBonus+=town.levels[1]*.10
 for _,curse in ipairs((S.curses or {}) :: {Curse})do if curse.kind==2 then result.lifeBonus-=.15 elseif curse.kind==3 then result.speedBonus-=.15 end end
 if S.curseRewards then result.pierce+=S.curseRewards[1];result.damageBonus+=S.curseRewards[2]*.25;result.critChance+=S.curseRewards[3]*.1 end
 result.critMultiplier=max(1.5,result.critMultiplier)+result.critAdd
 result.pierce=max(0,floor(result.pierce));result.critChance=max(0,min(1,result.critChance))
 if result.landingSpin then result.spinRadius+=S.radius-2.9+min(.8,result.spinMaster*2);result.spinDamage*=1+min(.6,result.spinMaster);result.spinRadius*=1+min(.6,result.areaBonus);result.spinDamage*=max(.5,1-result.areaPenalty) end
 return result
end
local pendingProcs:{any}={}
-- Recommendations describe combinations, not hidden set bonuses.
local buildDefinitions={
 {name="省錢長征",core={"longlife","hunter_vigor","heat"},desc="先用低價劍兵，一兩件裝備即可起步；熱機吃存活時間，擊殺最多延命1秒。",tradeoff="接觸死亡照常，延命不會讓劍兵穿怪。"},
 {name="鏡面雷暴",core={"ricochet_precision","crit_power","lightning"},desc="瞄準空隙折返蓄爆擊，再用雷鏈清旁邊小怪；穿透讓同一兵多次出手。",tradeoff="雷鏈每兵最多兩次，反彈爆擊率最多額外45%。"},
 {name="折返蓄力",core={"bounce_power","rebound_charge","bounce_life"},desc="利用牆面兩次折返累積增傷；回春增加找角度的時間。",tradeoff="碰怪仍按原本穿透次數結算，角落只算一次反彈。"},
 {name="疾風破陣",core={"haste","momentum","finisher"},desc="騎兵先用速度強化穿透，耗盡後把已用穿透轉成最後一撞傷害。",tradeoff="加速不延長壽命；不追蹤時要選好射線。"},
 {name="穿陣旋風",core={"pierce","piercing_wave","shock"},desc="每兩次成功穿透追加旋斬，主要命中再震盪；適合怪物潮。",tradeoff="旋斬和震盪都是次級傷害，不再互相觸發或爆擊。"},
 {name="霜鋼重擊",core={"frost_touch","shatter","slow_force"},desc="先用凝霜兵標記目標，碎冰兵跟進；搭配沉重把慢速換成傷害。",tradeoff="同一次首次上霜不能立即吃碎冰；重步需負向速度加成。"},
 {name="狂獵續航",core={"frenzy","hunter_vigor","pierce"},desc="追著怪物潮累積5／10／15連殺，穿透兵靠擊殺延長作戰。",tradeoff="2.5秒沒有擊殺後開始掉層；王少的時段不容易維持。"},
 {name="背水餘燼",core={"last_stand","ember_burst","expire_burst"},desc="活到最後四分之一壽命拚強力撞擊；接觸終結或到期各有爆發。",tradeoff="接觸爆炸與到期爆炸不會在同一次死亡疊觸發；召回不爆炸。"},
 {name="落地風環",core={"landing_spin","spin_master","king_hunter"},desc="任何兵種都能裝落地旋轉斬，擴圈壓住怪群，再往前撞王。",tradeoff="擴張不會自行授予旋轉技能；空中也會消耗壽命。"},
}
-- AUTO is game-owned targeting policy, shared by the UI and simulation.
-- Species IDs are the same IDs used by the creature models and spawn rules.
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
 local count=0;for _,def in ipairs(autoSpecies)do if selected[def.id] then count+=1 end end;return count
end
local function reset()
 pendingProcs={}
 S={phase="menu",round=1,coins=320,earned=0,spent=0,kills=0,breaks=0,seat=1,selected=1,time=180,roundDuration=180,paused=false,damage=1,discount=0,luck=0,radius=2.9,lifetime=1,equipment={1,1,1},runes={0,0,0},inventory={},offer={},message="",event=0,prize=0,prizeTier=0,lastMonster="",fired=0,won=false,aimX=0,aimZ=0}
 monsters={};troops={};effects={};cooldown=0
 S.refunded=0;S.roundRefund=0;S.returnedUnits=0;S.bounces=0;S.expired=0;S.contactDeaths=0
 S.crystalStart=18;S.crystals=18;S.crystalEarned=0;S.crystalSpent=0;S.crystalSold=0
 S.roundCrystalEarned=0;S.crystalProgress=0;S.roundCrystalBonus=0;S.lastCrystalGain=0
 S.arenaHalfExtent=12.5;S.returnedTotal=0;S.lostPaid=0;S.resultElapsed=0;S.townStartGold=town.gold
 S.mapElapsed=0;S.mapDuration=1.5;S.mapMoving=false;S.mapFrom=0;S.mapPosition=0
 S.playerGold={320,320,320,320};S.lotteryMisses=0;S.lotteryResults={};S.poolContributed=0;S.poolPaidOut=0;S.procHits=0;S.streaks={{count=0,time=0},{count=0,time=0},{count=0,time=0},{count=0,time=0}}
 S.skillSources={{},{},{}};S.criticalHits=0;S.contactHits=0;S.piercesUsed=0;S.spinHits=0
 S.damageEvents={};S.damageEvent=0
 S.fireMode="manual";S.targetFilter="all";S.targetId=0;S.targetName="";S.lockViolations=0;S.rewardClock=0;S.presentationDelay=0
 S.autoTargets=autoPreset("all");S.autoDraft={};S.autoConfigOpen=false;S.fireRearm=false
 S.lockEnabled=false;S.autoEnabled=false
 coinsFX={};rewardEvents={};pointerHeld=false
 sparks={};fxSerial=0
 S.hordeCount=0;S.hordeNotice=0;S.hordeAdded=0;S.hordeAt=-1
 S.specialSpawned=false;S.poolWinner=0
 S.runeOwned={{false,false,false},{false,false,false},{false,false,false}};S.balanceVersion=economyTuning.version;S.economyTuning=table.clone(economyTuning);S.awardChances={};for i,p in ipairs(baseAwardChances)do S.awardChances[i]=p*economyTuning.awardScale end;S.beetleAwardChance=.25*economyTuning.awardScale;S.buildIndex=0;S.items={};S.worn={{0,0,0,0,0},{0,0,0,0,0},{0,0,0,0,0}};S.itemSerial=0;S.equipSlot=5
 S.tech={{},{},{}};S.potions={};S.curses={};S.curseRewards={0,0,0};S.shopSpent=0;S.sold=0;S.stock={};S.location="";S.enchantPending=nil
 S.pendingWheel={};S.chestCount=0;S.chests={};S.chestHold=0;S.chestResult=nil;S.hasteUntil=0;S.critUntil=0;S.roulette=nil;S.freeFired=0;S.wheelSpawned=false;S.playerBuffs={{haste=0,critical=0,pierce=0},{haste=0,critical=0,pierce=0},{haste=0,critical=0,pierce=0},{haste=0,critical=0,pierce=0}}
 S.recruitUses={0,0,0,0};S.roundSpent={0,0,0,0};S.rallyUsed={false,false,false,false};S.rallyUntil={0,0,0,0};S.skillTriggers={};S.vfx={};S.visualSerial=0;S.rankEconomy={{damage=0,attempts=0,earned=0},{damage=0,attempts=0,earned=0},{damage=0,attempts=0,earned=0},{damage=0,attempts=0,earned=0},{damage=0,attempts=0,earned=0}}
 S.town=town;S.battleSeconds=0;S.choiceSeconds=0;S.shopVisits=0;S.roundSettled=false
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
 {"rebound_charge","折光","反彈最多兩層，下一主要命中每層+20%",4},
})do
 local id,name,description,price=entry[1] :: string,entry[2] :: string,entry[3] :: string,entry[4] :: number
 sourcePrices[id]=price
 table.insert(catalog,{id=id,name=name,type="技能裝備",desc=description.."；每支派兵 +"..price,apply=function()table.insert(S.skillSources[S.selected],{id=id})end})
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
local function preferredGear()
 local build=buildDefinitions[S.buildIndex or 0]
 if build then
  for _,skill in ipairs(build.core)do
   local owned=false;for _,item in ipairs(S.items)do if item.skill==skill then owned=true end end
   if not owned then for i,gear in ipairs(gearCatalog)do if gear.skill==skill then return i end end end
  end
 end
 return 1
end
local function stockShop()
 S.stock={};S.researchUsed=false;S.enchantUses=0;S.refreshUsed=false;S.enchantPending=nil
 if S.location=="potion" then
  for i,name in ipairs({"疾風藥水","續命藥水","召回藥水"})do table.insert(S.stock,{kind="potion",value=i,name=name,price=({32,48,40})[i]})end
 elseif S.location=="tech" then
  local pool={};for _,entry in ipairs(catalog)do if skillDefinitions[entry.id] then table.insert(pool,entry.id)end end
  for i=1,3 do local pick=table.remove(pool,1+floor(rng()*#pool));table.insert(S.stock,{kind="tech",value=pick,name=pick,unit=1+floor(rng()*3),price=7})end
 elseif S.location=="curse" then
  for i,name in ipairs({"負債誓約","脆弱誓約","遲緩誓約"})do table.insert(S.stock,{kind="curse",value=i,name=name,price=0})end
 elseif S.location=="market" then
  local pool={};for index=1,#gearCatalog do pool[index]=index end
  for i=1,4+(town.levels[4]>=3 and 1 or 0)do local index=table.remove(pool,i==1 and preferredGear() or 1+floor(rng()*#pool));assert(index, "Equipment stock pool exhausted");local def=gearCatalog[index];table.insert(S.stock,{kind="gear",value=index,name=def.name,slot=def.slot,skill=def.skill,deployExtra=sourcePrices[def.skill] or 0,price=math.ceil(def.price*(1-town.levels[4]*.02)/8)})end
 end
 for _,item in ipairs(S.stock)do item.currency=(item.kind=="gear" or item.kind=="tech")and "crystal" or "gold" end
end
local locationEntries={}
for _,entry in ipairs({{"market","商店","用結晶買賣裝備；配裝增加派兵金幣費"},{"potion","藥水攤","花金幣購買，最多攜帶兩瓶"},{"tech","科技研究","7 結晶研究兵種能力；本局生效"},{"enchant","附魔坊","8 結晶試附魔，可保留原詞綴"},{"curse","詛咒契約","承受兩輪代價，之後獲得強化"}})do
 local id,name,description=entry[1],entry[2],entry[3]
 table.insert(catalog,{id=id,name=name,type="地點",desc=description,apply=function()S.location=id;S.phase="shop";S.shopVisits+=1;stockShop()end})
 locationEntries[#locationEntries+1]=#catalog
end
local function offers()
 S.offer={};local pool={}
 for i,id in ipairs(locationEntries)do if i~=5 or S.round<=5 then table.insert(pool,id)end end
 if S.round<=2 then S.offer[1]=table.remove(pool,1)end
 while #S.offer<3 do table.insert(S.offer,table.remove(pool,1+floor(rng()*#pool)))end
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
local function effect(x:number,z:number,kind:string,size:number?)
 effects[#effects+1]={x=x,z=z,kind=kind,age=0,size=size or 1}
 fxSerial+=1
 local count=kind=="jackpot" and 65 or (kind=="spawn" and 80 or (kind=="critical" and 22 or (kind=="wall" and 9 or 14)))
 local tint=(kind=="lightning" or kind=="cleave") and "spark_gold" or (kind=="frost" or kind=="renew") and "spark_jade" or (kind=="jackpot" or kind=="wall" or kind=="critical") and "spark_gold" or (kind=="spawn" and "spark_red" or "spark_jade")
 for n=1,count do
  local angle=n*2.39996+fxSerial;local speed=(1+(n%7)*.3)*(kind=="spawn" and 2 or 1)
  sparks[#sparks+1]={x=x,y=.2,z=z,vx=cos(angle)*speed,vz=sin(angle)*speed,vy=1.5+(n%6)*.45,age=0,life=.4+(n%7)*.11,kind=tint,size=.11+(n%3)*.04}
 end
 while #sparks>650 do table.remove(sparks,1)end
end
local function combatVisual(kind:string,x:number,z:number,tx:number,tz:number,t:any,radius:number?)
 S.visualSerial+=1;table.insert(S.vfx,{id=S.visualSerial,kind=kind,x=x,z=z,tx=tx,tz=tz,radius=radius or 1,time=S.rewardClock,playerId=t.playerId,source=t.visualId,damageClass="secondary"})
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
  elseif result==4 then for _,unit in ipairs(troops)do if unit.alive and unit.playerId==winner then unit.life+=1 end end
  elseif result==5 then
   local origin=corners[winner];local len=sqrt(origin.x^2+origin.z^2)
   for n=1,3 do serial+=1;local skills=composeSkills(1)
    table.insert(troops,{visualId=serial,equipment=table.clone(S.worn[1]),k=1,playerId=winner,paid=0,targetId=0,x=origin.x,z=origin.z,dx=-origin.x/len,dz=-origin.z/len,age=0,alive=true,damage=baseDamage[1],rune=0,skills=skills,pierceRemaining=skills.pierce,hits={},spinHits={},state="run",spin=0,travel=0,landing=5.4,life=2.5,bounceCount=0,lifeAdded=0,reboundStacks=0})
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
 -- Run only after contact deaths and expiration have resolved for the final tick.
 -- The stored purchase price includes the discount at the time of deployment.
 if S.roundSettled then return end
 if not S.roundSettled then
  S.roundSettled=true
  if S.won then
   S.roundCrystalBonus=6+(S.round-1)*2;grantCrystals(S.roundCrystalBonus)
   town.gold+=30+(S.round==7 and 90 or 0);queueChest(S.roundWinner or S.seat)
   for i=#S.curses,1,-1 do local curse=S.curses[i];curse.remaining-=1;if curse.remaining<=0 then S.curseRewards[curse.kind]+=1;table.remove(S.curses,i)end end
  elseif S.phase=="defeat" then
   -- Progress is earned from actual battle time, never from repeatedly opening menus.
   town.gold+=min(20,floor((S.roundDuration-S.time)/9));S.message..=" 帶回城鎮建設金。"
  end
  apiRef.save.set(town)
 end
 local refund,count=0,0
 for _,t in ipairs(troops)do
  if t.alive and t.age<t.life then refund+=t.paid;count+=1;changeGold(t.playerId or S.seat,t.paid)end
 end
 S.refunded+=refund;S.roundRefund=refund;S.returnedUnits=count
 S.returnedTotal+=count
 troops={}
end
local function recordKill(t:any)
 -- Only the killer's own living troop can extend itself. Expired/contact-dead troops stay dead.
 if t.alive and t.age<t.life and t.skills.killLife>0 then
  local extra=min(max(0,1-(t.killLifeAdded or 0)),t.skills.killLife)
  t.life+=extra;t.killLifeAdded=(t.killLifeAdded or 0)+extra
  if extra>0 then effect(t.x,t.z,"renew",.6)end
 end
 if t.skills.frenzy<=0 then return end
 local streak=S.streaks[t.playerId or S.seat];streak.count=min(15,streak.count+1);streak.time=2.5
end
local function hit(m:any,amount:number,t:any,secondary:boolean?)
 if not m.alive or S.phase~="battle" then return end
 if t.targetId~=0 and t.targetId~=m.id then S.lockViolations+=1;return end
 local critical=false
 if not secondary then
  local alreadySlowed=m.slow>0
  if t.rune==1 then amount*=1.35 elseif t.rune==3 then m.slow=2 end
  if t.skills.frost>0 then m.slow=max(m.slow,1.2)end
  t.mainHits=(t.mainHits or 0)+1
  local bonus=min(.6,(t.bounceCount or 0)*t.skills.bouncePower)+min(.25,floor(t.age)*t.skills.heat)
  bonus+=min(.3,max(0,-t.skills.speedBonus)*t.skills.slowForce)
  if alreadySlowed and t.skills.shatter>0 then
   bonus+=min(.9,t.skills.shatter)
   if not t.shatterUsed then
    t.shatterUsed=true;pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,exclude=m.id,t=t,damage=t.damage*min(.6,t.skills.shatter),radius=1.8,limit=4,kind="frost"}
   end
  end
  if S.rewardClock<S.rallyUntil[t.playerId or S.seat] then bonus+=.15 end
  if S.time<=30 then bonus+=min(.75,t.skills.showdown)end
  if t.state=="run" and m.damage>=m.guard*.7 then bonus+=min(.6,t.skills.fracture)end
  if t.skills.soloHunt>0 then
   local alone=true;for _,other in ipairs(monsters)do if other.alive and other.id~=m.id and (other.x-m.x)^2+(other.z-m.z)^2<4 then alone=false;break end end
   if alone then bonus+=min(.75,t.skills.soloHunt)end
  end
  if t.skills.solitary>0 and t.paid>0 then
   local count=0;for _,other in ipairs(troops)do if other.alive and other.paid>0 and other.playerId==t.playerId then count+=1 end end
   if count==1 then bonus+=min(.9,t.skills.solitary)end
  end
  if t.skills.hitEcho>0 then
   t.echoTargets=t.echoTargets or {};if not t.echoTargets[m.id] then t.echoTargets[m.id]=true;t.echoCount=(t.echoCount or 0)+1 end
   if t.echoCount>=3 and not t.echoUsed then t.echoUsed=true;pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,exclude=m.id,t=t,damage=t.damage*min(.6,t.skills.hitEcho),radius=1.5,limit=4,kind="cleave"}end
  end
  if m.rank>=3 then bonus+=t.skills.kingDamage end
  if t.skills.frenzy>0 then bonus+=floor(S.streaks[t.playerId or S.seat].count/5)*.1 end
  if t.state=="run" then
   if t.pierceRemaining>0 then bonus+=min(.6,max(0,t.skills.speedBonus+(S.rewardClock<S.playerBuffs[t.playerId or S.seat].haste and .25 or 0))*t.skills.momentum)
   else bonus+=min(5,(t.skills.pierce-t.pierceRemaining))*t.skills.finisher end
   if t.age>=t.life*.75 and not t.lastStandUsed then bonus+=t.skills.lastStand;t.lastStandUsed=true end
   if (t.groundTravel or 0)>=12 and not t.distanceUsed then bonus+=t.skills.distance;t.distanceUsed=true end
  end
  bonus+=(t.reboundStacks or 0)*t.skills.reboundCharge;t.reboundStacks=0
  amount*=1+bonus
  local critBonus=min(.45,(t.bounceCount or 0)*t.skills.bounceCrit)
  critical=(t.skills.thirdCrit>0 and t.mainHits%3==0) or (t.skills.critChance+critBonus+(S.rewardClock<S.playerBuffs[t.playerId or S.seat].critical and .2 or 0)>0 and rng()<min(1,t.skills.critChance+critBonus+(S.rewardClock<S.playerBuffs[t.playerId or S.seat].critical and .2 or 0)))
  if critical then amount*=max(1.5,t.skills.critMultiplier);S.criticalHits+=1;effect(m.x,m.z,"critical",1)end
  if t.skills.shock>0 and S.rewardClock>=(t.shockAfter or 0) and (t.state~="spin" or not t.spinShockUsed) then
   pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,exclude=m.id,t=t,damage=t.damage*t.skills.shock,radius=1.2,limit=4,kind="shock"}
   t.shockAfter=S.rewardClock+.25;if t.state=="spin" then t.spinShockUsed=true end
  end
  if critical and t.skills.lightning>0 and (t.lightningUses or 0)<2 then
   t.lightningUses=(t.lightningUses or 0)+1;pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,exclude=m.id,t=t,damage=t.damage*t.skills.lightning,radius=2.4,limit=2,kind="lightning"}
  end
 else S.procHits+=1 end
 S.rankEconomy[m.rank].damage+=amount
 -- Read-only hit receipts: record the final applied damage, even when the
 -- following guard-break lottery misses. No extra rolls or economic effects.
 S.damageEvent+=1
 table.insert(S.damageEvents,{id=S.damageEvent,monsterId=m.id,playerId=t.playerId or S.seat,source=t.visualId,amount=amount,critical=critical,secondary=secondary==true,x=m.x,z=m.z,rank=m.rank,time=S.rewardClock})
 if #S.damageEvents>128 then table.remove(S.damageEvents,1)end
 m.damage+=amount;m.flash=.12
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
 local roll=rng();local tier=1
 if m.rank<=2 then tier=1
 elseif m.rank==3 then tier=roll<.34+S.luck and 3 or 1
 elseif m.rank==4 then tier=roll<.23+S.luck and 3 or (roll<.65 and 2 or 1)
 else tier=roll<.06+S.luck*.25 and 4 or (roll<.26+S.luck and 3 or (roll<.65 and 2 or 1))end
 if m.special=="roulette" then
  local winner=t.playerId or S.seat;local result=1+floor(rng()*6)
  awardCrystals(m.rank,tier,winner)
  S.roulette={id=(S.roulette and S.roulette.id or 0)+1,playerId=winner,result=result,label=({"疾風號令","戰意沸騰","穿軍祝福","生命之泉","免費援軍","領主寶箱"})[result],time=S.rewardClock}
  S.pendingWheel[#S.pendingWheel+1]={winner=winner,result=result,revealAt=S.rewardClock+2.6,id=S.roulette.id}
  m.alive=false;S.kills+=1;recordKill(t);effect(m.x,m.z,"jackpot",1.5)
  table.insert(S.lotteryResults,{monsterId=m.id,playerId=winner,won=true,tier=1,amount=0,wheel=result,time=S.rewardClock})
  if #S.lotteryResults>40 then table.remove(S.lotteryResults,1)end
  return
 end
 local prizes={{16},{28},{28,50,110},{48,100,250},{80,180,500,1100}}
 local prize=prizes[m.rank][tier] or prizes[m.rank][1]
 prize=floor(prize*(1+(S.round-1)*(m.rank<=2 and 0 or .08))*(t.rune==2 and 1.25 or 1))
 if m.special=="beetle" then
  prize=m.poolGold;tier=3;S.poolPaidOut+=prize;S.poolWinner=t.playerId or S.seat
  m.poolGold=0;m.alive=false;S.kills+=1;recordKill(t)
 end
 local winner=t.playerId or S.seat
 local crystalGain=awardCrystals(m.rank,tier,winner)
 changeGold(winner,prize);S.earned+=prize;S.rankEconomy[m.rank].earned+=prize;S.event+=1;S.prize=prize;S.prizeTier=tier;S.lastMonster=m.name
 table.insert(S.lotteryResults,{monsterId=m.id,playerId=winner,won=true,tier=tier,amount=prize,time=S.rewardClock})
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
 if m.alive and (m.rank<=2 or tier>=3) then m.alive=false;S.kills+=1;recordKill(t);if m.rank==5 then S.roundWinner=winner;win(tier)end end
end
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
local function contactHit(t:any,m:any)
 t.hits[m.id]=true;S.contactHits+=1;hit(m,t.damage,t)
 if t.pierceRemaining>0 then t.pierceRemaining-=1;S.piercesUsed+=1
  t.usedPierces=(t.usedPierces or 0)+1
  if t.skills.pierceWave>0 and t.usedPierces%2==0 then
   pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,exclude=m.id,t=t,damage=t.damage*min(.6,t.skills.pierceWave),radius=1.8,limit=4,kind="cleave"}
  end
 else t.alive=false;S.contactDeaths+=1;S.lostPaid+=t.paid
  if t.skills.deathBurst>0 then pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,t=t,damage=t.damage*t.skills.deathBurst,radius=1.5,limit=4,kind="ember"}end
 end
end
local function moveTroop(t:any,distance:number)
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
   for _,contact in ipairs(contacts)do
    t.groundTravel=groundStart+step*contact.entry
    contactHit(t,contact.m)
    if not t.alive then t.x=ox+(t.x-ox)*contact.entry;t.z=oz+(t.z-oz)*contact.entry end
    if not t.alive or S.phase~="battle" then break end
   end
   if t.alive then t.groundTravel=groundStart+step end
  end
  if not t.alive or S.phase~="battle" then break end
  local bounceX=toX<=step+1e-8;local bounceZ=toZ<=step+1e-8
  if bounceX then t.dx=-t.dx end
  if bounceZ then t.dz=-t.dz end
  if bounceX or bounceZ then
   S.bounces+=1;t.bounceCount+=1;
   if t.bounceCount==1 and t.skills.wallQuake>0 then pendingProcs[#pendingProcs+1]={x=t.x,z=t.z,t=t,damage=t.damage*min(.9,t.skills.wallQuake),radius=1.5,limit=4,kind="cleave"}end
   t.reboundStacks=min(2,t.reboundStacks+1)
   local extra=min(max(0,1-t.lifeAdded),t.skills.bounceLife);t.life+=extra;t.lifeAdded+=extra
   effect(t.x,t.z,"wall",.6)
  end
 end
end
local function updateCombat(dt:number)
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
  local speed=(m.rank<=2 and 1.35 or .65)*(m.slow>0 and .8 or 1)
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
   if t.skills.expireBurst>0 then pendingProcs[#pendingProcs+1]={x=t.x,z=t.z,t=t,damage=t.damage*t.skills.expireBurst,radius=1.4,limit=4,kind="leaf"}end
  end
 end
 for i=#troops,1,-1 do local t=troops[i]
  if t.alive then
  if frame%3==0 and #sparks<650 then sparks[#sparks+1]={x=t.x,y=.3,z=t.z,vx=-t.dx*.5,vz=-t.dz*.5,vy=.4,age=0,life=.38,kind=({"spark_red","spark_jade","spark_gold"})[t.k],size=t.k==3 and .20 or .14}end
  if t.targetId~=0 and t.state=="run" then for _,m in ipairs(monsters)do if m.id==t.targetId and m.alive then
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
  if t.state=="spin" then
   t.spin+=dt
   local targets:{any}={};for _,m in ipairs(monsters)do if m.alive and (t.targetId==0 or t.targetId==m.id) and not t.spinHits[m.id] and (m.x-t.x)^2+(m.z-t.z)^2<(t.skills.spinRadius+m.scale*.4)^2 then table.insert(targets,m)end end
   table.sort(targets,function(a:any,b:any)local da,db=(a.x-t.x)^2+(a.z-t.z)^2,(b.x-t.x)^2+(b.z-t.z)^2;return da<db or (da==db and a.id<b.id)end)
   for _,m in ipairs(targets)do t.spinHits[m.id]=true;S.spinHits+=1;hit(m,t.damage*t.skills.spinDamage,t);if S.phase~="battle" then break end end
   if t.spin>=t.skills.spinDuration then t.state="run" end
  else
   local speed=t.state=="airborne" and t.skills.flightSpeed or (t.k==3 and 24 or 8)*max(.25,1+t.skills.speedBonus+(S.rewardClock<S.playerBuffs[t.playerId or S.seat].haste and .25 or 0))
   local distance=speed*dt
   if t.state=="airborne" then distance=min(distance,max(0,t.landing-t.travel))end
   moveTroop(t,distance)
  end
  end
  if not t.alive then effect(t.x,t.z,"impact",.7);table.remove(troops,i)end
  if S.phase~="battle" then break end
 end
 local jobs=pendingProcs;pendingProcs={}
 for _,job in ipairs(jobs)do
  if S.phase~="battle" then break end
  local candidates:{{m:any,d:number}}={}
  for _,m in ipairs(monsters)do if m.alive and m.id~=job.exclude and (job.t.targetId==0 or job.t.targetId==m.id) then
   local d=(m.x-job.x)^2+(m.z-job.z)^2;if d<=(job.radius*(1+min(.6,job.t.skills.areaBonus)))^2 then table.insert(candidates,{m=m,d=d})end
  end end
  table.sort(candidates,function(a:{m:any,d:number},b:{m:any,d:number})return a.d<b.d or (a.d==b.d and a.m.id<b.m.id)end)
  effect(job.x,job.z,job.kind or "impact",job.radius)
  if #candidates>0 and job.kind~="lightning" then combatVisual(job.kind or "shock",job.x,job.z,job.x,job.z,job.t,job.radius)end
  for j=1,min(#candidates,job.limit)do
   if job.kind=="lightning" then combatVisual("lightning",job.x,job.z,candidates[j].m.x,candidates[j].m.z,job.t)end
   hit(candidates[j].m,job.damage*max(.5,1-job.t.skills.areaPenalty),job.t,true);if S.phase~="battle" then break end end
 end
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
  elseif S.coins<costs(1) and #troops==0 then S.phase="defeat";S.message="金幣耗盡，軍團已無法再出征。"end
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
 local batches:{[string]:{any}}={cannon={},sword={},spear={},cavalry={},hound={},wraith={},minotaur={},lord={},impact={},target={},trail={},coin={},spark_gold={},spark_jade={},spark_red={}}
 for _,p in ipairs(sparks)do local size=p.size*max(0,1-p.age/p.life);local list=batches[p.kind];list[#list+1]={p.x,p.y,p.z,p.age*6,size,size*2.4,size}end
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
 S.chapter=chapters[S.round];S.costs={costs(1),costs(2),costs(3)};S.troops=#troops;S.monsters=publicMonsters;S.cards=offer
 S.visualTroops={}
 for _,t in ipairs(troops)do table.insert(S.visualTroops,{id=t.visualId,k=t.k,x=t.x,z=t.z,y=t.state=="airborne" and sin(min(1,t.travel/t.landing)*math.pi)*2.5 or 0,yaw=math.atan2(t.dx,t.dz)+(t.state=="spin" and t.spin/t.skills.spinDuration*math.pi*2 or 0),state=t.state,age=t.age,life=t.life,equipment=t.equipment,playerId=t.playerId,bounces=t.bounceCount,pierce=t.pierceRemaining,mainHits=t.mainHits or 0})end
 S.loadouts={composeSkills(1),composeSkills(2),composeSkills(3)}
 if not S.skillBook then
  S.skillBook={};S.buildGuide=buildDefinitions
  for _,entry in ipairs(catalog)do if skillDefinitions[entry.id] then S.skillBook[entry.id]={name=entry.name,desc=entry.desc,deployExtra=sourcePrices[entry.id] or 0}end end
 end
 S.activeSkills={}
 for _,sources in ipairs({innateSkills[S.selected],S.skillSources[S.selected],wornSources(S.selected),S.tech[S.selected]})do
  for _,source in ipairs(sources)do S.activeSkills[source.id]=(S.activeSkills[source.id] or 0)+(source.stacks or 1)end
 end
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

-- END FORMAL UI
function Game.start(api:any)
 apiRef=api
 local saved=api.save.get()
 if type(saved)=="table" and saved.version==1 and type(saved.gold)=="number" and saved.gold>=0 and saved.gold<1e12 and saved.gold==floor(saved.gold) and type(saved.levels)=="table" and #saved.levels==4 then
  local valid=true;for _,level in ipairs(saved.levels)do if type(level)~="number" or level<0 or level>5 or level~=floor(level)then valid=false end end
  if valid then town={version=1,gold=saved.gold,levels=saved.levels}end
 end
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
 if pressed(api,"ReturnTown") and S.phase=="defeat" then reset();formalPreviousPhase="menu";formalRoute="town" end
 local autoHandled=autoInput(api,pause);if autoHandled then pause=false end
 -- Local player stays at the assigned cannon. UI/debug actions cannot change seats.
 for i=1,3 do if pressed(api,"Unit"..i) or pressed(api,"Digit"..i) then S.selected=i end end
 if start and (S.phase=="menu" or S.phase=="defeat" or S.phase=="victory") then
  local build=S.buildIndex;reset();S.buildIndex=build;travelToRound()
 end
 if nextRound and S.phase=="clear" and S.presentationDelay<=0 then S.round+=1;S.won=false;S.chestResult=nil;travelToRound()end
 if pressed(api,"ViewMap") and S.phase=="choice" then S.phase="map";S.mapMoving=false;S.mapPosition=S.round end
 if pressed(api,"VisitLocation") and S.phase=="map" and not S.mapMoving then S.phase="choice" end
 for i=1,#buildDefinitions do if pressed(api,"Build"..i) and S.phase~="battle" then S.buildIndex=i end end
 for i=1,3 do
  if pressed(api,"Choice"..i) and S.phase=="choice" then
   local c=catalog[S.offer[i]];c.apply();S.inventory[#S.inventory+1]={name=c.name,type=c.type};if S.phase=="choice" then beginBattle()end
  end
 end
 if S.phase=="shop" or S.phase=="choice" or S.phase=="clear" then S.choiceSeconds+=dt end
 for i=1,5 do if pressed(api,"Slot"..i)then S.equipSlot=i end end
 local safe=S.phase=="shop" or S.phase=="clear" or S.phase=="menu"
 if safe then
  for i=1,3 do if pressed(api,"Rune"..i) then
   if S.runeOwned[S.selected][i] or (S.location=="market" and S.phase=="shop" and payCrystals(({6,9,7})[i]))then
    S.runeOwned[S.selected][i]=true;S.runes[S.selected]=i
   end
  end end
  if pressed(api,"RuneOff")then S.runes[S.selected]=0 end
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
   if pressed(api,"Sell"..i) and item and S.phase=="shop" and S.location=="market" then
    local equipped=false;for _,worn in ipairs(S.worn :: {{number}})do for _,id in ipairs(worn)do if id==item.id then equipped=true end end end
    if equipped then S.message="先卸下裝備才能出售" else local value=floor(item.paid*.5);S.crystals+=value;S.crystalSold+=value;table.remove(S.items,i)end
   end
  end
  if pressed(api,"Unequip")then if canStoreItem() then S.worn[S.selected][S.equipSlot]=0 else S.message="背包已滿，無法卸下" end end
 end
 if S.phase=="shop" then
  for i=1,5 do if pressed(api,"Buy"..i)then
   local item=S.stock[i]
   if item and not item.sold then
    if item.kind=="gear" and canStoreItem() and payCrystals(item.price)then addItem(gearCatalog[item.value],item.price);item.sold=true;item.itemId=S.items[#S.items].id
    elseif item.kind=="potion" and #S.potions<2 and pay(item.price)then table.insert(S.potions,{kind=item.value,paid=item.price});item.sold=true
    elseif item.kind=="tech" and not S.researchUsed and payCrystals(item.price)then table.insert(S.tech[item.unit],{id=item.value});S.researchUsed=true;item.sold=true
    elseif item.kind=="curse" and #S.curses<2 then
     local duplicate=false;for _,c in ipairs(S.curses :: {Curse})do if c.kind==item.value then duplicate=true end end
     if not duplicate then table.insert(S.curses,{kind=item.value,remaining=2});for _,stock in ipairs(S.stock :: {{sold:boolean?,[string]:any}})do stock.sold=true end end
    end
   end
  end end
  if pressed(api,"RefreshShop") and S.location=="market" and not S.refreshUsed and payCrystals(2)then stockShop();S.refreshUsed=true end
  if pressed(api,"Enchant") and S.location=="enchant" and S.enchantUses<2 and not S.enchantPending then
   local item=itemById(S.worn[S.selected][S.equipSlot])
   if not item then S.message="先選擇已穿戴裝備" elseif payCrystals(8)then
    S.enchantUses+=1;local roll=rng();local tier=roll<.05 and 3 or (roll<.30+town.levels[2]*.01 and 2 or 1)
    local pools={
     {"longlife","haste","heavy","critical","crit_power","king_hunter","frost_touch","heat","distance","last_stand","slow_force","sharp","short_fuse","wide_blade","fracture","solo_hunt","recruit","solitary"},
     {"pierce","bounce_power","bounce_life","rebound_charge","ricochet_precision","hunter_vigor","frenzy","finisher","shatter","expire_burst","wall_quake","hit_echo","crowd_ring","rally","rapid","showdown","giant"},
     {"landing_spin","momentum","lightning","shock","third_crit","ember_burst","piercing_wave","spin_master","double_pierce","deadly"}}
    local pool=pools[tier];S.enchantPending={itemId=item.id,skill=pool[1+floor(rng()*#pool)],tier=tier}
   end
  end
  if pressed(api,"AcceptEnchant") and S.enchantPending then local item=itemById(S.enchantPending.itemId);if item then item.enchant=S.enchantPending.skill end;S.enchantPending=nil end
  if pressed(api,"KeepEnchant")then S.enchantPending=nil end
  if pressed(api,"LeaveShop") and not S.enchantPending then beginBattle()end
 end
 for i=1,2 do if pressed(api,"Potion"..i) and S.phase=="battle" and not S.paused and not autoHandled then
  local potion=S.potions[i]
  local owned:{any}={};for _,t in ipairs(troops)do if t.alive and t.playerId==S.seat then table.insert(owned,t)end end
  if potion and (#owned>0 or potion.kind==1)then
   if potion.kind==1 then S.playerBuffs[S.seat].haste=S.rewardClock+8*(1+town.levels[3]*.02)
   elseif potion.kind==2 then for _,t in ipairs(owned)do t.life+=1.5 end
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
 if S.phase=="menu" then for i=1,4 do if pressed(api,"Town"..i)and town.levels[i]<5 then
  local price=({60,100,160,240,360})[town.levels[i]+1]
  if town.gold>=price then town.gold-=price;town.levels[i]+=1;api.save.set(town)end
 end end end
 if pause and S.phase=="battle" then S.paused=not S.paused end
 if S.phase=="battle" and not S.paused and not autoHandled then
  targeting(api)
  updateCombat(dt)
 end
 advancePresentation(dt)
 if frame%2==0 then publish(api)end
end
return Game
