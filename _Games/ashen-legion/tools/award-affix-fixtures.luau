-- In-memory tests; never bundled into the playable game.
function Game.start(api:any)
 apiRef=api;local checks=0
 local function check(ok:boolean,label:string)assert(ok,label);checks+=1 end
 local function close(a:number,b:number):boolean return math.abs(a-b)<1e-8 end
 local function skills(id:string,stacks:number?)reset();S.skillSources[1]={{id=id,stacks=stacks or 1}};return composeSkills(1)end
 local baseline={{.66,0,.34,0},{.35,.42,.23,0},{.35,.39,.20,.06}}
 for rank=3,5 do
  local m={rank=rank};local base=awardWeights(m,{},0)
  for tier=1,4 do check(close(base.weights[tier],baseline[rank-2][tier]),"baseline rank/tier")end
 end
 for _,def in ipairs(awardAffixes)do
  local sk=skills(def.id);local rank=def.target.ranks[1];local m={rank=rank};local base=awardWeights(m,{},0)
  local actual=awardWeights(m,sk,0)
  check(close(actual.shift,def.delta),"correct single-source shift "..def.id)
  check(close(actual.weights[1],base.weights[1]-def.delta) and close(actual.weights[3],base.weights[3]+def.delta),"only small/large transfer")
  check(close(actual.weights[2],base.weights[2])and close(actual.weights[4],base.weights[4]),"medium/legendary untouched")
  for other=1,5 do if other~=rank then check(awardWeights({rank=other},sk,0).shift==0,"rank selector")end end
  for _,special in ipairs({"beetle","roulette"})do check(awardWeights({rank=rank,special=special},sk,0).shift==0,"special encounter exclusion")end
  local histogram={0,0,0,0}
  for i=1,10000 do local tier=selectAwardTier(actual.weights,(i-.5)/10000);histogram[tier]+=1 end
  for tier=1,4 do check(close(histogram[tier]/10000,actual.weights[tier]),"stratified 10000-draw distribution")end
  local saturated=awardWeights(m,skills(def.id,50),0);local sum=0
  for tier=1,4 do check(saturated.weights[tier]>=0 and saturated.weights[tier]<=1,"probability bounds");sum+=saturated.weights[tier]end
  check(close(sum,1)and math.abs(saturated.shift)<=.24,"normalized capped transfer")
 end
 reset();S.skillSources[1]={{id="crown_bounty",stacks=10},{id="crown_harvest",stacks=10}};check(awardWeights({rank=5},composeSkills(1),0).shift==0,"opposing stacks cancel before cap")
 reset();S.skillSources[1]={{id="minor_bounty"}};S.tech[1]={{id="minor_bounty"}};check(close(awardWeights({rank=3},composeSkills(1),0).shift,.24),"tech composes with other sources")
 reset();addItem(gearCatalog[1],12);S.items[1].enchant="crown_bounty";S.worn[1][5]=S.items[1].id;S.runes[1]=8
 local combined=composeSkills(1);check(close(awardWeights({rank=5},combined,0).shift,.24),"rune plus equipment enchant")
 S.phase="battle";S.selected=1;S.aimX=0;S.aimZ=0;fire();local snapshot=troops[1];S.runes[1]=0;S.items[1].enchant=nil
 check(close(awardWeights({rank=5},snapshot.skills,0).shift,.24)and awardWeights({rank=5},composeSkills(1),0).shift==0,"deployed snapshot is immutable")
 local scoped={awardShifts={{target={ranks={3},species={"treant"}},delta=.12}}}
 check(close(awardWeights({rank=3,skin="treant"},scoped,0).shift,.12),"species selector matches")
 check(awardWeights({rank=3,skin="boar"},scoped,0).shift==0,"same-rank other species excluded")
 for _,luck in ipairs({-.4,0,.04,.3,2})do for rank=3,5 do
  local base=awardWeights({rank=rank},{},luck);local mod=awardWeights({rank=rank},{awardShifts={{target={ranks={rank}},delta=.12}}},luck)
  check(close(base.weights[4],mod.weights[4])and close(base.weights[2],mod.weights[2]),"legacy luck preserved")
  for _,w in ipairs(mod.weights)do check(w>=-1e-8 and w<=1,"luck probability bounds")end
 end end
 local function enemy(rank:number):any return {id=400,skin="test",rank=rank,x=0,z=0,guard=1,damage=0,alive=true,scale=1,slow=0,flash=0,angle=0,turn=100,breaks=0,name="fixture"}end
 local function trial(id:string?,gate:number,tier:number,rank:number,secondary:boolean?):any
  apiRef=api;reset();S.selected=3;S.phase="battle";S.aimX=0;S.aimZ=0;if id then S.skillSources[3]={{id=id}}end;fire();local t=troops[1];t.skills.critChance=0
  local rolls=0;apiRef={random={nextFloat=function()rolls+=1;return rolls==1 and gate or tier end},save=api.save}
  local m=enemy(rank);hit(m,100,t,secondary);return {m=m,rolls=rolls,earned=S.earned,misses=S.lotteryMisses,tier=S.prizeTier,shift=S.lotteryResults[1]and S.lotteryResults[1].awardShift,phase=S.phase}
 end
 for rank=3,5 do
  local id=({"minor_bounty","elder_bounty","crown_bounty"})[rank-2]
  local chance=baseAwardChances[rank]*economyTuning.awardScale
  local miss=trial(id,chance,.01,rank)
  check(miss.m.alive and miss.earned==0 and miss.misses==1 and miss.rolls==1,"miss remains miss and consumes only gate roll")
  local win=trial(id,chance-1e-6,.4,rank)
  check(win.earned>0 and win.rolls==2,"same success gate and exactly one tier roll")
 end
 local high=trial("crown_bounty",0,.30,5);local regular=trial(nil,0,.30,5)
 check(high.tier==3 and not high.m.alive and high.phase=="celebration" and regular.tier==2 and regular.m.alive,"raised large prize reaches unchanged boss-clear pipeline")
 local low=trial("crown_harvest",0,.20,5);check(low.tier==2 and low.m.alive,"lower large prize keeps target alive")
 local tiny=trial("minor_harvest",0,.28,3);check(tiny.tier==1 and tiny.m.alive,"small-prize conversion retains small king")
 local legend=trial("crown_harvest",0,.02,5);check(legend.tier==4 and legend.phase=="celebration","legendary unaffected")
 local dot=trial("crown_bounty",0,.30,5,true);check(dot.tier==3 and close(dot.shift,.12),"secondary damage uses source owner snapshot")
 apiRef=api;reset();publish(api);api.observation.set("award_affix_checks",checks)
end
