-- In-memory regression fixture, never bundled into the playable project.
function Game.start(api:any)
 apiRef=api
 local checks=0
 local function check(ok:boolean,label:string)assert(ok,label);checks+=1 end
 local function shot(k:number,x:number,z:number,sources:any?,mode:string?)
  reset();S.phase="battle";S.selected=k;S.aimX=x;S.aimZ=z;S.skillSources[k]=sources or {};S.fireMode=mode or "manual"
  fire();check(#troops==1,"one paid launch");monsters={};return troops[1]
 end
 local function land(t:any)
  local startX,startZ,dx,dz=t.x,t.z,t.dx,t.dz
  for _=1,240 do
   frame+=1;updateCombat(1/60)
   assert(math.abs(t.x-(startX+dx*t.travel))<1e-6 and math.abs(t.z-(startZ+dz*t.travel))<1e-6,"straight airborne path, no homing drift or final teleport")
   if t.state=="spin" then return end
  end
  error("projectile never landed")
 end
 for _,point in ipairs({{0,11.75},{0,0},{8,-7},{-12.4,-12.4},{12.4,-12.4},{12.4,12.1}})do
  local t=shot(2,point[1],point[2])
  local distance=sqrt(point[1]^2+(point[2]-corners[1].z)^2)
  check(math.abs(t.landing-distance)<1e-7,"flight covers the full clicked distance, not a legacy 5.4 cap")
  -- Moving the crosshair after launch must not drag this projectile.
  S.aimX=-point[1];S.aimZ=6
  land(t)
  check(math.abs(t.x-point[1])<1e-6 and math.abs(t.z-point[2])<1e-6,"spin centered on the selected ground point")
  check(t.alive and t.age<t.life and t.bounceCount==0,"reaches in-bounds destination alive without an early wall bounce")
 end
 for _,k in ipairs({1,3})do
  local t=shot(k,-8,-9,{{id="landing_spin"}});land(t)
  check(math.abs(t.x+8)<1e-6 and math.abs(t.z+9)<1e-6,"transferred landing skill also uses the clicked destination")
 end
 for _,mode in ipairs({"auto","lock"})do
  local t=shot(2,7,-8,nil,mode)
  if mode=="lock" then t.targetId=42 end
  monsters={{id=42,rank=4,x=-8,z=-7,guard=100000,damage=0,alive=true,scale=1,slow=0,flash=0,angle=0,turn=100,breaks=0,name="moving target"}}
  land(t)
  check(math.abs(t.x-7)<1e-6 and math.abs(t.z+8)<1e-6,"target movement cannot bend the saved airborne destination")
  check(monsters[1].damage==0 and S.contactHits==0,"airborne flight causes no contact hit")
 end
 local t=shot(2,0,8);land(t);monsters={}
 local x,z,dx,dz=t.x,t.z,t.dx,t.dz
 for _=1,40 do if t.state=="run" then break end;updateCombat(1/60)end
 check(t.state=="run","landing spin still returns to running")
 updateCombat(.05)
 check(math.abs(t.x-(x+dx*.4))<1e-6 and math.abs(t.z-(z+dz*.4))<1e-6,"runs forward after spinning")
 reset();publish(api);api.observation.set("spear_landing_checks",checks)
end
