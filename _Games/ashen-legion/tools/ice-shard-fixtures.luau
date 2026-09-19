-- In-memory regression fixture using the production particle pool and updater.
function Game.start(api:any)
 apiRef=api;reset();S.phase="battle";S.rewardClock=14
 local checks=0
 local function check(ok:boolean,label:string)assert(ok,"ICE SHARD: "..label);checks+=1 end
 effect(1,2,"frost",1.8)
 check(#sparks==40,"a frost proc creates exactly forty particles")
 local beforeX,beforeY,beforeZ=sparks[1].x,sparks[1].y,sparks[1].z
 for _,p in ipairs(sparks)do
  check(p.kind=="spark_ice","every shard uses the ice mesh batch")
  check(p.life>=.68 and p.life<1 and p.spin~=nil,"shards carry bounded life and rotation")
  check(p.vx*p.vx+p.vz*p.vz>1 and p.vy>2,"shards receive radial speed and lift")
 end
 advancePresentation(.12)
 check(#sparks==40 and sparks[1].age>.11,"shards persist after the burst frame")
 check(sparks[1].x~=beforeX or sparks[1].z~=beforeZ,"shards travel through the arena")
 check(sparks[1].y>beforeY,"gravity simulation gives the shard a visible arc")
 local nativeSet=api.instances3d.set;local shardBatches=0
 api.instances3d.set=function(key:string,asset:string,data:buffer)
  if key=="spark_ice"then
   check(asset=="mesh://spark_ice","publisher uses the registered low-poly shard mesh")
   check(buffer.len(data)==40*40,"publisher submits all forty packed transforms")
   shardBatches+=1
  end
  return nativeSet(key,asset,data)
 end
 publish(api)
 api.instances3d.set=nativeSet
 check(shardBatches==1,"publisher emits one shared ice-shard instance batch")
 advancePresentation(1)
 check(#sparks==0,"shards expire and leave the bounded pool")
 api.observation.set("ice_shard_checks",checks)
end
