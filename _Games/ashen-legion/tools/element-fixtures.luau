-- Actual game helpers in a disclosed in-memory WASM fixture, never shipped.
function Game.start(api:any)
 apiRef=api;local checks=0
 local function check(ok:boolean,label:string)assert(ok,"ELEMENT: "..label);checks+=1 end
 local function near(a:number,b:number)return math.abs(a-b)<.00001 end
 local function prepare(sources:any)
  reset();S.phase="battle";S.selected=3;S.skillSources[3]=sources;S.aimX=0;S.aimZ=0;fire()
  local t=troops[1];t.x=0;t.z=0;t.dx=1;t.dz=0;monsters={};return t,skillRuntime.elements
 end
 local function monster(id:number,x:number,z:number)
  local m={id=id,rank=4,x=x,z=z,guard=1000000,damage=0,alive=true,scale=1,slow=0,flash=0,angle=0,turn=100,breaks=0,name="fixture",special=""}
  monsters[#monsters+1]=m;return m
 end
 local function steps(seconds:number)for _=1,math.floor(seconds*60+.5)do S.rewardClock+=1/60;skillRuntime:update(1/60,troops);skillRuntime:flush()end end
 local function source(t:any,id:number)local other=table.clone(t);other.skills=table.clone(t.skills);other.visualId=id;other.playerId=id;other.rune=0;return other end
 local function activeFields(e:any,kind:string?)local result={};for _,f in ipairs(e.fields)do if f.phase=="active"and(not kind or f.kind==kind)then result[#result+1]=f end end;return result end
 local t,e=prepare({{id="ember_trail"}})
 moveTroop(t,.9);check(#e.fields==0,"distance below threshold emits no fire")
 moveTroop(t,.1);check(#e.fields==1 and near(e.fields[1].ox,0)and near(e.fields[1].tx,1),"one unit leaves exact path")
 moveTroop(t,49);check(e.triggers.distance==50 and t.bounceCount==2,"real reflected path counts fifty distance events")
 check(#activeFields(e,"fire")<=12,"per-source trail budget")
 for _,f in ipairs(activeFields(e))do check(math.abs(f.ox)<=WALL_X and math.abs(f.tx)<=WALL_X,"road endpoints stay inside walls")end
 t,e=prepare({{id="ember_trail"}});skillRuntime:moved(t,0,0,.6,0);skillRuntime:moved(t,.6,0,.6,.4)
 check(e.triggers.distance==1 and #activeFields(e)==2,"distance across a corner keeps two actual path legs")
 for _,f in ipairs(e.fields)do check(near((f.tx-f.ox)*(f.tz-f.oz),0),"no diagonal corner shortcut")end
 t.state="airborne";skillRuntime:moved(t,.6,.4,8,8);check(e.triggers.distance==1,"airborne travel leaves no ground fire")
 t,e=prepare({{id="ember_trail"},{id="oil_legacy"}})
 table.insert(e.rules,{id="fixture_distance_oil",modifier="oilLegacy",trigger="distance",action="spill_oil",distance=2,duration=2,radius=1,cap=1})
 moveTroop(t,5);check(e.triggers.distance==7 and #activeFields(e,"oil")==1,"two distance triggers keep independent thresholds and actions")
 check(near(t.elementMovement.fixture_distance_oil.distance,1),"distance trigger preserves remainder")
 table.remove(e.rules)
 t,e=prepare({{id="ember_trail"}});moveTroop(t,3);local m=monster(100,1.5,0);steps(.15)
 check(skillRuntime.buffs["100:burn"]~=nil,"entering road applies burn")
 steps(.6);check(m.damage>0,"road burn uses actual hit pipeline")
 m.z=5;local damage=m.damage;steps(1.2);check(m.damage>damage,"burn persists briefly after leaving road")
 steps(3);check(not skillRuntime:hasPendingDamage(),"road and attached burn expire")
 t,e=prepare({{id="slick_oil"}});m=monster(101,0,0);hit(m,90,t);skillRuntime:flush()
 check(e.statuses["101:oil"]~=nil and skillRuntime:slowMultiplier(m)==.75,"damage trigger coats oil and slows 25 percent")
 local other=monster(102,1,0);hit(other,20,t,true);skillRuntime:flush();check(e.statuses["102:oil"]==nil,"secondary damage does not trigger coating")
 local lighter=source(t,2);lighter.skills.slickOil=0;e:touch("fire",lighter,m.x,m.z,m)
 check(e.statuses["101:oil"]==nil and e.reactions==1,"fire consumes oil once")
 check(skillRuntime.buffs["101:burn"].owner.playerId==2,"igniter owns reaction burn")
 check(S.damageEvents[#S.damageEvents].reaction==true and S.damageEvents[#S.damageEvents].playerId==2,"reaction damage retains igniter payout attribution")
 local reactionDamage=m.damage;e:touch("fire",lighter,m.x,m.z,m);check(m.damage==reactionDamage,"same oil cannot ignite twice")
 hit(m,90,t);skillRuntime:flush();e:touch("fire",lighter,m.x,m.z,m);check(e.reactions==1,"fresh oil honours per-target reaction cooldown")
 steps(1.1);e:touch("fire",lighter,m.x,m.z,m);check(e.reactions>=2,"new dose can react after cooldown")
 t,e=prepare({{id="oil_legacy"}});skillRuntime:onDeath(t,"recall",2,3);check(#e.fields==0,"recall does not count as death")
 skillRuntime:onDeath(t,"contact",2,3);check(#e.fields==1 and e.fields[1].x==2 and e.fields[1].z==3,"contact death spills at exact contact position")
 skillRuntime:onDeath(t,"expired",8,8);check(#e.fields==1 and e.triggers.death==1,"death triggers once across causes")
 t,e=prepare({{id="oil_legacy"}});t.alive=false;skillRuntime:onDeath(t,"expired");check(#activeFields(e,"oil")==1,"expiry is a real death trigger")
 t,e=prepare({{id="oil_legacy"}});skillRuntime:onDeath(t,"contact",3,0);local creator=e.fields[1].creator
 lighter=source(t,2);lighter.skills.emberTrail=1;skillRuntime:moved(lighter,2,0,4,0);steps(.15)
 check(#activeFields(e,"oil")==0 and #activeFields(e,"fire")==2,"burning road ignites touching oil surface without a monster")
 check(e.fields[1].owner.playerId==2 and e.fields[1].creator==creator,"surface conversion preserves creator cap but changes damage owner")
 t,e=prepare({{id="rain_strike"}});for i=1,6 do local wet=monster(200+i,(i-1)*1.5,0);hit(wet,90,t)end;skillRuntime:flush()
 check(#activeFields(e,"water")==6 and e.statuses["201:wet"]~=nil,"water hit trigger creates wet target and puddle")
 local storm=source(t,2);storm.skills.rainStrike=0;storm.skills.stormTouch=1
 hit(monsters[1],90,storm);skillRuntime:flush()
 check(e.reactions==4,"one lightning reaction visits at most four wet monsters")
 for i=1,4 do check(skillRuntime.buffs[tostring(200+i)..":electrified"]~=nil,"conduction applies electrified status")end
 check(skillRuntime.buffs["205:electrified"]==nil and skillRuntime.buffs["206:electrified"]==nil,"direct chain does not exceed cap")
 check(#activeFields(e,"charged_water")==6,"lightning electrifies connected water puddles")
 check(skillRuntime:slowMultiplier(monsters[1])==.65,"electrified status slows without multiplying slows")
 local triggers=e.triggers.damage;skillRuntime:flush();check(e.triggers.damage==triggers and #e.queue==0,"reaction chain drains without recursion")
 steps(4);check(#activeFields(e)==0 and not skillRuntime:hasPendingDamage(),"electrified water cannot recharge itself forever")
 t,e=prepare({{id="rain_strike"},{id="storm_touch"}});m=monster(301,1,0);hit(m,90,t);skillRuntime:flush()
 check(e.reactions==1,"same hit applies water before lightning by declared trigger order")
 t,e=prepare({{id="storm_touch"}});m=monster(302,0,0);hit(m,90,t);skillRuntime:flush();check(e.reactions==0 and near(m.damage,108),"dry lightning damages without fake reaction")
 t,e=prepare({{id="rain_strike"}});for i=1,3 do local wet=monster(310+i,i,0);hit(wet,90,t)end;skillRuntime:flush()
 storm=source(t,2);storm.skills.rainStrike=0;storm.skills.stormTouch=1;storm.targetId=311
 local untouched=monsters[2].damage;hit(monsters[1],90,storm);skillRuntime:flush();steps(.2)
 check(e.reactions==1 and monsters[2].damage==untouched and skillRuntime.buffs["312:electrified"]==nil and S.lockViolations==0,"LOCK restricts both chain and charged surface damage")
 local before=monsters[1].damage;S.phase="celebration";skillRuntime:flush();steps(1)
 check(#e.fields==0 and next(e.statuses)==nil and monsters[1].damage==before,"settlement clears fields and prevents delayed reaction damage")
 reset();publish(api);api.observation.set("element_checks",checks)
end
