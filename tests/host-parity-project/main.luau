local Game = {}
local frame = 0
function Game.start(api)
 if api.debug.enabled then
  api.debug.registerTab({id="fixture",label="Fixture tools"})
  api.debug.register({kind="label",id="fixture.status",tab="fixture",text="ready"})
  api.debug.register({kind="button",id="fixture.bump",tab="fixture",label="Bump"},function()
   api.observation.set("debug_bump",1)
   api.debug.set("fixture.status","invoked")
  end)
  api.debug.register({kind="checkbox",id="fixture.flag",tab="fixture",label="Flag",checked=false},function(value)
   api.observation.set("debug_flag",value)
  end)
 end
 for _, call in ipairs({math.random, math.randomseed, os.clock, os.time, os.date}) do
  local ok, err = pcall(call)
  assert(not ok and string.find(tostring(err), "LUA_NONDETERMINISTIC_SOURCE", 1, true))
 end
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
 api.observation.set("portable_numeric",{frame*dt,math.sqrt(2),api.random.nextFloat(),api.random.nextInt(-100,100)})
 local keys = {"z", "a", "m"}
 table.sort(keys)
 api.observation.set("ordered_keys",keys)
end
return Game
