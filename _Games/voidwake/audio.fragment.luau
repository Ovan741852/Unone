-- Paste after local S, before fresh()/publish(). Requires systems.audio=true.
-- Audio resources are reproducibly baked by tools/generate-audio.py. Game code
-- owns sound selection; the official player decodes and mixes the WAV assets.
local soundEnabled = true
local audioPrevious: any = nil
local audioNextShot = 0

local function resetAudio(api: any)
 api.audio.stopAll()
 api.audio.setMasterVolume(soundEnabled and 0.45 or 0)
 api.audio.loop("audio://voidwake/hum", {volume=0.2,category="ambience"})
 audioPrevious = {
  fired=S.fired,kills=S.kills,damageTaken=S.damageTaken,dashCount=S.dashCount,
  burstCount=S.burstCount,upgradesInstalled=S.upgradesInstalled,phase=S.phase,
  sector=S.sector,time=S.time,
 }
 audioNextShot = 0
end

local function updateAudio(api: any)
 if not audioPrevious then resetAudio(api);return end
 local old=audioPrevious
 -- Also recover if a caller rebuilds S without calling resetAudio explicitly.
 if S.time<old.time or S.fired<old.fired or S.kills<old.kills then
  resetAudio(api);return
 end
 local function play(name: string, volume: number, speed: number?)
  api.audio.play("audio://voidwake/"..name,{volume=volume,speed=speed or 1,category="sfx"})
 end
 if S.fired>old.fired and S.time>=audioNextShot then
  play("shot",0.45)
  audioNextShot=S.time+0.1
 end
 local explosion=S.kills>old.kills or (S.phase=="gameover" and old.phase~="gameover")
 if explosion then play("explosion",0.65) end
 if S.damageTaken>old.damageTaken then play("hit",0.6) end
 if S.dashCount>old.dashCount then play("dash",0.6) end
 if S.burstCount>old.burstCount then play("explosion",0.75,0.75) end
 if S.upgradesInstalled>old.upgradesInstalled or S.sector>old.sector
  or (S.phase=="upgrade" and old.phase~="upgrade")
  or (S.phase=="victory" and old.phase~="victory") then
  play("upgrade",0.55)
 elseif S.phase~=old.phase then
  play("click",0.4)
 end
 audioPrevious = {
  fired=S.fired,kills=S.kills,damageTaken=S.damageTaken,dashCount=S.dashCount,
  burstCount=S.burstCount,upgradesInstalled=S.upgradesInstalled,phase=S.phase,
  sector=S.sector,time=S.time,
 }
end
