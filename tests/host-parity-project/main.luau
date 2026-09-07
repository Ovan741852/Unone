local Game = {}
local frame = 0
function Game.start(api)
 api.particle.play("spark",{x=0,y=0,z=0},42)
 api.observation.set("saved",api.save.get())
 api.audio.loop("music://fixture",{category="music"})
end
function Game.update(api,dt)
 frame += 1
 local transform = api.entity.getTransform3D("car")
 if api.input.isDown("Drive") then transform.position.z += 1 end
 api.entity.setTransform3D("car",transform)
 api.observation.set("pointer_down",api.input.isPointerDown())
 api.observation.set("pointer",api.input.getPointerPosition())
end
return Game