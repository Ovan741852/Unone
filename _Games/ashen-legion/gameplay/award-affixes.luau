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
