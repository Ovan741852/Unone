-- Game-owned reproducible particle presentation probe, no engine special cases.
local G={};local frame=0
function G.start(api) end
function G.update(api,dt)
 frame+=1
 if frame%3~=0 then return end
 local b=buffer.create(36)
 for i=0,2 do
  local t=frame/60+i*2.1
  buffer.writef32(b,i*12,math.sin(t)*4)
  buffer.writef32(b,i*12+4,2+math.cos(t*.7+i)*1.4)
  buffer.writef32(b,i*12+8,-i*1.8)
 end
 api.particle.play_batch("magic",b,frame)
 api.particle.play_batch("dust",b,frame)
 api.observation.set("particle_usage",api.particle.stats())
end
return G
