--!strict
-- All economy, roguelike choices, movement, damage and lotteries run in Unone Luau.
type SkillSource = {id: string, stacks: number?}
type Item = {id: number, skill: string, enchant: string?, slot: number, paid: number, [string]: any}
type Curse = {kind: number, remaining: number}
type Choice = {id: string, name: string, type: string, desc: string, apply: () -> ()}
local Game={}
local S:any={};local monsters:{any}={};local troops:{any}={};local effects:{any}={};local catalog:{Choice}={}
local coinsFX:{any}={};local rewardEvents:{any}={};local pointerHeld=false
local sparks:{any}={};local fxSerial=0
local frame=0;local serial=0;local apiRef:any=nil;local held:{[string]:boolean}={};local cooldown=0
local corners={{x=0,z=7.1},{x=7.1,z=0},{x=0,z=-7.1},{x=-7.1,z=0}} -- Midpoints of the square battlefield edges.
local kinds={"sword","spear","cavalry"}
local baseCosts={8,20,40};local baseDamage={24,48,90}
local baseLife={5,5,4.2}
local WALL_X,WALL_Z=7.4,7.4
local chapters={"苔光林口","菇冠小徑","橡木渡溪","古榕回廊","琥珀石庭","冠角聖林","森林王座"}
local floor,min,max,sin,cos,sqrt=math.floor,math.min,math.max,math.sin,math.cos,math.sqrt
local function rng()return apiRef.random.nextFloat()end
local sourcePrices:{[string]:number}={pierce=4,critical=3,landing_spin=6,longlife=2,haste=2,heavy=3,bounce_power=4,bounce_life=3,momentum=4,shock=6}
local town:any={version=1,gold=0,levels={0,0,0,0}}
local function itemById(id:number): Item?
 for _,item in ipairs((S.items or {}) :: {Item})do if item.id==id then return item end end
 return nil
end
local function wornSources(k:number): {SkillSource}
 local list:{SkillSource}={}
 for _,id in ipairs((S.worn and S.worn[k] or {}) :: {number})do
  local item=itemById(id)
  if item then table.insert(list,{id=item.skill});if item.enchant then table.insert(list,{id=item.enchant})end end
 end
 return list
end
local function sourceCount(k:number,id:string)
 local count=0
 for _,list in ipairs({S.skillSources and S.skillSources[k] or {},wornSources(k),S.tech and S.tech[k] or {}} :: {{SkillSource}})do
  for _,source in ipairs(list)do if source.id==id then count+=source.stacks or 1 end end
 end
 return count
end
local function costs(k:number)
 local extra=3*((S.equipment and S.equipment[k] or 1)-1)+(S.runes and S.runes[k]~=0 and 2 or 0)
 for _,source in ipairs((S.skillSources and S.skillSources[k] or {}) :: {SkillSource})do extra+=(sourcePrices[source.id] or 0)*(source.stacks or 1)end
 for _,source in ipairs(wornSources(k))do extra+=sourcePrices[source.id] or 0 end
 local penalty=0;for _,curse in ipairs((S.curses or {}) :: {Curse})do if curse.kind==1 then penalty+=.15 end end
 local rescue=S.coins and S.coins<80 and S.recruitUses and S.recruitUses[S.seat]<3 and sourceCount(k,"recruit")>0
 return max(2,floor((baseCosts[k]+extra)*(1-S.discount)*(1+penalty)*(rescue and .5 or 1)))
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
local innateSkills:{{SkillSource}}={{{id="critical"}},{{id="landing_spin"}},{{id="pierce",stacks=4}}}
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
local function reset()
 pendingProcs={}
 S={phase="menu",round=1,coins=320,earned=0,spent=0,kills=0,breaks=0,seat=1,selected=1,time=180,roundDuration=180,paused=false,damage=1,discount=0,luck=0,radius=2.9,lifetime=1,equipment={1,1,1},runes={0,0,0},inventory={},offer={},message="",event=0,prize=0,prizeTier=0,lastMonster="",fired=0,won=false,aimX=0,aimZ=0}
 monsters={};troops={};effects={};cooldown=0
 S.refunded=0;S.roundRefund=0;S.returnedUnits=0;S.bounces=0;S.expired=0;S.contactDeaths=0
 S.returnedTotal=0;S.lostPaid=0
 S.playerGold={320,320,320,320};S.lotteryMisses=0;S.lotteryResults={};S.poolContributed=0;S.poolPaidOut=0;S.procHits=0;S.streaks={{count=0,time=0},{count=0,time=0},{count=0,time=0},{count=0,time=0}}
 S.skillSources={{},{},{}};S.criticalHits=0;S.contactHits=0;S.piercesUsed=0;S.spinHits=0
 S.fireMode="manual";S.targetFilter="all";S.targetId=0;S.targetName="";S.lockViolations=0;S.rewardClock=0;S.presentationDelay=0
 coinsFX={};rewardEvents={};pointerHeld=false
 sparks={};fxSerial=0
 S.hordeCount=0;S.hordeNotice=0;S.hordeAdded=0;S.hordeAt=-1
 S.specialSpawned=false;S.poolWinner=0
 S.runeOwned={{false,false,false},{false,false,false},{false,false,false}};S.balanceVersion="2026-09-10c";S.buildIndex=0;S.items={};S.worn={{0,0,0,0,0},{0,0,0,0,0},{0,0,0,0,0}};S.itemSerial=0;S.equipSlot=5
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
  for i=1,3 do local pick=table.remove(pool,1+floor(rng()*#pool));table.insert(S.stock,{kind="tech",value=pick,name=pick,unit=1+floor(rng()*3),price=50})end
 elseif S.location=="curse" then
  for i,name in ipairs({"負債誓約","脆弱誓約","遲緩誓約"})do table.insert(S.stock,{kind="curse",value=i,name=name,price=0})end
 elseif S.location=="market" then
  local pool={};for index=1,#gearCatalog do pool[index]=index end
  for i=1,4+(town.levels[4]>=3 and 1 or 0)do local index=table.remove(pool,i==1 and preferredGear() or 1+floor(rng()*#pool));assert(index, "Equipment stock pool exhausted");local def=gearCatalog[index];table.insert(S.stock,{kind="gear",value=index,name=def.name,slot=def.slot,skill=def.skill,deployExtra=sourcePrices[def.skill] or 0,price=floor(def.price*(1-town.levels[4]*.02))})end
 end
end
local locationEntries={}
for _,entry in ipairs({{"market","商店","買賣裝備、換裝；每件装備增加派兵費"},{"potion","藥水攤","最多攜帶兩瓶，一次性使用"},{"tech","科技研究","三選一兵種能力；本局生效"},{"enchant","附魔坊","60 金幣試附魔，可保留原詞綴"},{"curse","詛咒契約","承受兩輪代價，之後獲得強化"}})do
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
local function addMonster(rank:number,x:number,z:number)
 serial+=1
 local guards={22,32,100,160,480};local _names={"橡果蹦蹦","菇背幼豬","獠牙搬木王","古榕守衛","冠角白鹿"}
 local skins={{"acorn","moth"},{"piglet","turtle"},{"boar","treant"},{"elder"},{"stag"}}
 local skin=skins[rank][1+serial%#skins[rank]]
 local skinNames={acorn="橡果蹦蹦",moth="苔羽蛾",piglet="菇背幼豬",turtle="苔殼龜",boar="獠牙搬木王",treant="花冠樹靈",elder="古榕守衛",stag="冠角白鹿"}
 local guard=floor(guards[rank]*(1+(S.round-1)*(rank==5 and .28 or (rank<=2 and .12 or .19))))
 monsters[#monsters+1]={id=serial,skin=skin,rank=rank,x=x,z=z,guard=guard,damage=0,alive=true,angle=rng()*math.pi*2,turn=1+rng()*3,breaks=0,slow=0,flash=0,name=skinNames[skin],scale=({.65,.8,1.05,1.3,1.9})[rank]}
end
local function beginBattle()
 monsters={};troops={};effects={};S.roundDuration=S.round==7 and 240 or 180;S.time=S.roundDuration;S.roundSettled=false;S.roundWinner=nil;S.phase="battle";S.paused=false;S.message="";cooldown=0
 S.roundRefund=0;S.returnedUnits=0
 S.targetId=0;S.targetName="";S.presentationDelay=0;S.bossSpawned=false
 S.specialSpawned=false;S.wheelSpawned=false;S.recruitUses={0,0,0,0};S.roundSpent={0,0,0,0};S.rallyUsed={false,false,false,false};S.rallyUntil={0,0,0,0}
 for i=1,15 do addMonster(i%4==0 and 2 or 1,-6+rng()*12,-4+rng()*8)end
 addMonster(3,-4,-1);addMonster(3,4,1);addMonster(4,3,-3)
 -- One optional surge per round, before the final boss window.
 S.hordeAt=rng()<.7 and (22+rng()*23) or -1
 S.hordeCount=0;S.hordeNotice=0;S.hordeAdded=0
end
local function effect(x:number,z:number,kind:string,size:number?)
 effects[#effects+1]={x=x,z=z,kind=kind,age=0,size=size or 1}
 fxSerial+=1
 local count=kind=="jackpot" and 65 or (kind=="spawn" and 80 or (kind=="wall" and 9 or 14))
 local tint=(kind=="lightning" or kind=="cleave") and "spark_gold" or (kind=="frost" or kind=="renew") and "spark_jade" or (kind=="jackpot" or kind=="wall") and "spark_gold" or (kind=="spawn" and "spark_red" or "spark_jade")
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
local function win()
 S.phase=S.round==7 and "victory" or "clear";S.won=true
 S.message=S.round==7 and "七輪遠征完成，森林回應了你的號令。" or "大王已開出大獎，下一片森林在等你。"
end
local function settleSurvivors()
 -- Run only after contact deaths and expiration have resolved for the final tick.
 -- The stored purchase price includes the discount at the time of deployment.
 if not S.roundSettled then
  S.roundSettled=true
  if S.won then
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
  if critical then amount*=max(1.5,t.skills.critMultiplier);S.criticalHits+=1;effect(m.x,m.z,"wall",1)end
  if t.skills.shock>0 and S.rewardClock>=(t.shockAfter or 0) and (t.state~="spin" or not t.spinShockUsed) then
   pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,exclude=m.id,t=t,damage=t.damage*t.skills.shock,radius=1.2,limit=4,kind="shock"}
   t.shockAfter=S.rewardClock+.25;if t.state=="spin" then t.spinShockUsed=true end
  end
  if critical and t.skills.lightning>0 and (t.lightningUses or 0)<2 then
   t.lightningUses=(t.lightningUses or 0)+1;pendingProcs[#pendingProcs+1]={x=m.x,z=m.z,exclude=m.id,t=t,damage=t.damage*t.skills.lightning,radius=2.4,limit=2,kind="lightning"}
  end
 else S.procHits+=1 end
 S.rankEconomy[m.rank].damage+=amount
 m.damage+=amount;m.flash=.12
 effect(m.x,m.z,"impact",.6)
 if m.damage<m.guard then return end
 -- One hit may cause one lottery only. Excess damage is not another ticket.
 m.damage=0;m.breaks+=1;S.breaks+=1;S.rankEconomy[m.rank].attempts+=1
 -- Breaking guard purchases an attempt, never a guaranteed prize. No pity gate.
 local chance=m.special=="beetle" and .25 or ({.65,.65,.55,.50,.45})[m.rank]
 if rng()>=chance then
  S.lotteryMisses+=1
  table.insert(S.lotteryResults,{monsterId=m.id,playerId=t.playerId or S.seat,won=false,tier=0,amount=0,time=S.rewardClock})
  if #S.lotteryResults>40 then table.remove(S.lotteryResults,1)end
  -- Ordinary small monsters resolve once even when their lottery misses.
  if m.rank<=2 and not m.special then m.alive=false;S.kills+=1;recordKill(t)end
  return
 end
 local roll=rng();local tier=1
 if m.rank<=2 then tier=1
 elseif m.rank==3 then tier=roll<.34+S.luck and 3 or 1
 elseif m.rank==4 then tier=roll<.23+S.luck and 3 or (roll<.65 and 2 or 1)
 else tier=roll<.06+S.luck*.25 and 4 or (roll<.26+S.luck and 3 or (roll<.65 and 2 or 1))end
 if m.special=="roulette" then
  local winner=t.playerId or S.seat;local result=1+floor(rng()*6)
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
 changeGold(winner,prize);S.earned+=prize;S.rankEconomy[m.rank].earned+=prize;S.event+=1;S.prize=prize;S.prizeTier=tier;S.lastMonster=m.name
 table.insert(S.lotteryResults,{monsterId=m.id,playerId=winner,won=true,tier=tier,amount=prize,time=S.rewardClock})
 if #S.lotteryResults>40 then table.remove(S.lotteryResults,1)end
 local multiplier=m.special=="beetle" and prize/80 or prize/max(1,t.paid)
 local celebration=tier==4 and "LEGENDARY WIN" or (tier==3 and (m.rank>=4 and "MEGA WIN" or "BIG WIN") or "")
 rewardEvents[#rewardEvents+1]={id=S.event,playerId=winner,tier=tier,amount=prize,multiplier=multiplier,title=celebration,name=m.name,x=m.x,z=m.z,time=S.rewardClock}
 if #rewardEvents>40 then table.remove(rewardEvents,1)end
 local count=({8,18,38,72})[tier];local player=corners[winner]
 -- Visual scatter uses an analytic pattern; it never consumes lottery RNG.
 for n=1,count do
  local a=n*2.39996+S.event;local radius=.35+(n%9)*.12
  coinsFX[#coinsFX+1]={x=m.x,z=m.z,dx=cos(a)*radius,dz=sin(a)*radius,tx=player.x,tz=player.z,age=-n*.008,peak=.8+(n%5)*.17}
 end
 if #coinsFX>420 then for _=1,#coinsFX-420 do table.remove(coinsFX,1)end end
 effect(m.x,m.z,"jackpot",m.scale*2)
 if m.alive and (m.rank<=2 or tier>=3) then m.alive=false;S.kills+=1;recordKill(t);if m.rank==5 then S.roundWinner=winner;win();S.presentationDelay=3.3 end end
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
 troops[#troops+1]={visualId=serial,equipment=table.clone(S.worn[k]),k=k,playerId=S.seat,paid=paid,targetId=S.fireMode~="manual" and S.targetId or 0,x=p.x,z=p.z,dx=dx/len,dz=dz/len,age=0,alive=true,damage=baseDamage[k]*S.damage*(1+.3*(S.equipment[k]-1))*(1+skills.damageBonus),rune=S.runes[k],skills=skills,pierceRemaining=skills.pierce,hits={},spinHits={},state=skills.landingSpin and "airborne" or "run",spin=0,travel=0,landing=min(5.4,len),life=baseLife[k]*(k==3 and S.lifetime or 1)*(1+skills.lifeBonus),bounceCount=0,lifeAdded=0,reboundStacks=0}
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
   addMonster(3,-6,0);local wheel=monsters[#monsters];wheel.special="roulette";wheel.skin="wheel";wheel.name="金鈴狸 · 奇遇轮盤";wheel.escapeAt=S.rewardClock+12;wheel.guard=70;wheel.scale=.9
   effect(wheel.x,wheel.z,"spawn",1.3)
  end
 end
 if not S.specialSpawned and S.time<=S.roundDuration-45 then
  S.specialSpawned=true;addMonster(4,0,-2)
  local beetle=monsters[#monsters];beetle.name="聚寶甲蟲";beetle.special="beetle";beetle.skin="beetle";beetle.poolGold=80;beetle.contributions={0,0,0,0};beetle.guard=120;beetle.scale=1.15
  effect(beetle.x,beetle.z,"spawn",2)
 end
 S.hordeNotice=max(0,S.hordeNotice-dt)
 if S.hordeAt>=0 and S.roundDuration-S.time>=S.hordeAt then
  S.hordeAt=S.time>75 and S.roundDuration-S.time+25+rng()*15 or -1;S.hordeCount+=1;S.hordeNotice=3.5
  local small=0;for _,m in ipairs(monsters)do if m.alive and m.rank<=2 then small+=1 end end
  S.hordeAdded=min(72,max(0,90-small))
  -- Spread a simultaneous wave across the whole hunting area, not one pile.
  for i=1,S.hordeAdded do
   local x=-6.4+((i-1)%9)*1.6+(rng()-.5)*.25
   local z=-4.2+floor((i-1)/9)*1.2+(rng()-.5)*.18
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
  if math.abs(m.x)>6.7 then m.x=max(-6.7,min(6.7,m.x));m.angle=-m.angle end
  if math.abs(m.z)>4.5 then m.z=max(-4.5,min(4.5,m.z));m.angle=math.pi-m.angle end
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
  if t.targetId~=0 then for _,m in ipairs(monsters)do if m.id==t.targetId and m.alive then
   local dx,dz=m.x-t.x,m.z-t.z;local len=sqrt(dx*dx+dz*dz)
   if len>.01 then t.dx=dx/len;t.dz=dz/len end
   break
  end end end
  if t.state=="airborne" and t.travel>=t.landing-1e-8 then
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
   local speed=t.state=="airborne" and t.skills.flightSpeed or (t.k==3 and 12 or 8)*max(.25,1+t.skills.speedBonus+(S.rewardClock<S.playerBuffs[t.playerId or S.seat].haste and .25 or 0))
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
  if small<14 and frame%45==0 then addMonster(rng()<.2 and 2 or 1,-6+rng()*12,-4+rng()*8)end
  if S.time>30 then
   local minor,middle=0,0;for _,m in ipairs(monsters)do if m.alive then if m.rank==3 then minor+=1 elseif m.rank==4 then middle+=1 end end end
   if minor<2 and frame%720==0 then addMonster(3,-4+rng()*8,-3)end
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
  publicMonsters[#publicMonsters+1]={id=m.id,x=floor(m.x*1e6+.5)/1e6,z=floor(m.z*1e6+.5)/1e6,rank=m.rank,skin=m.skin,yaw=m.angle,animation=m.flash>0 and "hit" or "walk",scale=m.scale,guard=m.guard,damage=floor(m.damage),name=m.name,breaks=m.breaks,special=m.special,poolGold=m.poolGold,poolMultiplier=m.poolGold and m.poolGold/80 or nil,contributions=m.contributions}
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
 S.particles=#sparks;S.bossPresent=false;local smallCount,kingCount=0,0
 for _,m in ipairs(monsters)do if m.alive then if m.rank<=2 then smallCount+=1 elseif m.rank==5 then S.bossPresent=true else kingCount+=1 end end end
 api.observation.set("boss_present",S.bossPresent);api.observation.set("small_present",smallCount>0);api.observation.set("kings_present",kingCount>0)
 api.observation.set("horde_count",S.hordeCount);api.observation.set("horde_added",S.hordeAdded);api.observation.set("small_count",smallCount)
 S.playerGold[S.seat]=S.coins
 api.observation.set("game",S)
 local allGold=0;for _,gold in ipairs(S.playerGold)do allGold+=gold end
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
end
local function pressed(api:any,key:string)
 local down=api.input.isDown(key);local edge=down and not held[key];held[key]=down;return edge
end
local function targeting(api:any)
 for _,mode in ipairs({"manual","lock","auto"})do if pressed(api,"Mode_"..mode) then S.fireMode=mode;S.targetId=0 end end
 for _,filter in ipairs({"all","small","boss"})do if pressed(api,"Filter_"..filter) then S.targetFilter=filter;if S.fireMode=="auto" then S.targetId=0 end end end
 local down=api.input.isPointerDown();local p=api.input.getPointerPosition()
 if S.fireMode=="lock" and down and not pointerHeld then
  local best:any=nil;local dist=math.huge
  for _,m in ipairs(monsters)do if m.alive then local d=(m.x-p.x)^2+(m.z-p.y)^2;if d<dist and d<(m.scale+1)^2 then best=m;dist=d end end end
  S.targetId=best and best.id or 0
 end
 pointerHeld=down
 local target:any=nil
 for _,m in ipairs(monsters)do if m.alive and m.id==S.targetId then target=m;break end end
 if S.fireMode=="auto" and not target then
  local dist=math.huge;local origin=corners[S.seat]
  for _,m in ipairs(monsters)do if m.alive and (S.targetFilter=="all" or (S.targetFilter=="small" and m.rank<=2) or (S.targetFilter=="boss" and m.rank>=3))then
   local d=(m.x-origin.x)^2+(m.z-origin.z)^2;if d<dist then target=m;dist=d end
  end end
 end
 S.targetId=target and target.id or 0;S.targetName=target and target.name or ""
 if S.fireMode~="manual" then
  if target then S.aimX=target.x;S.aimZ=target.z;fire()end
 else
  S.aimX=max(-7.3,min(7.3,p.x));S.aimZ=max(-7.3,min(7.3,p.y))
  if down or api.input.isDown("Space") then fire()end
 end
end
function Game.start(api:any)
 apiRef=api
 local saved=api.save.get()
 if type(saved)=="table" and saved.version==1 and type(saved.gold)=="number" and saved.gold>=0 and saved.gold<1e12 and saved.gold==floor(saved.gold) and type(saved.levels)=="table" and #saved.levels==4 then
  local valid=true;for _,level in ipairs(saved.levels)do if type(level)~="number" or level<0 or level>5 or level~=floor(level)then valid=false end end
  if valid then town={version=1,gold=saved.gold,levels=saved.levels}end
 end
 reset();publish(api)
end
function Game.update(api:any,dt:number)
 frame+=1
 local start=pressed(api,"Start");local nextRound=pressed(api,"Next");local home=pressed(api,"Home");local pause=pressed(api,"Pause") or pressed(api,"Escape")
 if home then reset()end
 for i=1,4 do if pressed(api,"Seat"..i) and S.phase=="menu" then S.seat=i end end
 -- Local four-seat inspection; network multiplayer is a separate host concern.
 for i=1,4 do if pressed(api,"Player"..i) then
  S.playerGold[S.seat]=S.coins;S.seat=i;S.coins=S.playerGold[i];S.targetId=0;S.targetName="";pointerHeld=false
 end end
 for i=1,3 do if pressed(api,"Unit"..i) or pressed(api,"Digit"..i) then S.selected=i end end
 if start and (S.phase=="menu" or S.phase=="defeat" or S.phase=="victory") then
  local seat=S.seat;local build=S.buildIndex;reset();S.seat=seat;S.buildIndex=build;S.phase="choice";offers()
 end
 if nextRound and S.phase=="clear" and S.presentationDelay<=0 then S.round+=1;S.phase="choice";S.won=false;S.chestResult=nil;offers()end
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
   if S.runeOwned[S.selected][i] or (S.location=="market" and S.phase=="shop" and pay(({48,72,56})[i]))then
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
    if equipped then S.message="先卸下裝備才能出售" else local value=floor(item.paid*.5);S.coins+=value;S.sold+=value;table.remove(S.items,i)end
   end
  end
  if pressed(api,"Unequip")then if canStoreItem() then S.worn[S.selected][S.equipSlot]=0 else S.message="背包已滿，無法卸下" end end
 end
 if S.phase=="shop" then
  for i=1,5 do if pressed(api,"Buy"..i)then
   local item=S.stock[i]
   if item and not item.sold then
    if item.kind=="gear" and canStoreItem() and pay(item.price)then addItem(gearCatalog[item.value],item.price);item.sold=true
    elseif item.kind=="potion" and #S.potions<2 and pay(item.price)then table.insert(S.potions,{kind=item.value,paid=item.price});item.sold=true
    elseif item.kind=="tech" and not S.researchUsed and pay(item.price)then table.insert(S.tech[item.unit],{id=item.value});S.researchUsed=true;item.sold=true
    elseif item.kind=="curse" and #S.curses<2 then
     local duplicate=false;for _,c in ipairs(S.curses :: {Curse})do if c.kind==item.value then duplicate=true end end
     if not duplicate then table.insert(S.curses,{kind=item.value,remaining=2});for _,stock in ipairs(S.stock :: {{sold:boolean?,[string]:any}})do stock.sold=true end end
    end
   end
  end end
  if pressed(api,"RefreshShop") and S.location=="market" and not S.refreshUsed and pay(15)then stockShop();S.refreshUsed=true end
  if pressed(api,"Enchant") and S.location=="enchant" and S.enchantUses<2 and not S.enchantPending then
   local item=itemById(S.worn[S.selected][S.equipSlot])
   if not item then S.message="先選擇已穿戴裝備" elseif pay(60)then
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
 for i=1,2 do if pressed(api,"Potion"..i) and S.phase=="battle" and not S.paused then
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
 if S.phase=="battle" and not S.paused then
  targeting(api)
  updateCombat(dt)
 end
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
 if frame%2==0 then publish(api)end
end

Game.replay={
 id="yessir.menu-cycle",version="1",
 restore=function(capture:any,_api:any)
  return capture.captureOrigin.kind=="start" and capture.scenario.name=="menu_cycle" and S.phase=="menu"
 end,
 compatible=function(v:any,_api:any)
  return v.source.game.id==v.target.game.id and v.source.engine.coreRevision==v.target.engine.coreRevision
   and v.source.assets.manifestHash==v.target.assets.manifestHash
   and v.sourceAdapter.id=="yessir.menu-cycle" and v.sourceAdapter.version=="1"
   and v.targetAdapter.id=="yessir.menu-cycle" and v.targetAdapter.version=="1"
   and v.scenarioSchema.version==1
 end,
 inspect=function(_ctx:any,_api:any)
  local diagnostics={}
  if S.phase=="battle" then table.insert(diagnostics,{code="BATTLE_OBSERVED",flag="game.replay.battle.observed"}) end
  return {invariants={phase=S.phase,menu_clean=S.phase=="menu" and #troops==0 and S.fired==0 and #S.inventory==0},diagnostics=diagnostics}
 end,
}
return Game

-- Revised source identity; gameplay unchanged.
