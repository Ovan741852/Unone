local Game = {}
local expanded = false
local selected = "High"
function Game.start(api) end
function Game.update(api, dt)
 if api.input.isDown("Toggle") then expanded = not expanded end
 if api.input.isDown("SelectLow") then selected = "Low"; expanded = false end
 api.ui.setRoot({kind="screen",id="settings",node="settings",children={
  {kind="component",id="quality_control",component="ui.combobox",rect={x=10,y=10,width=70,height=10},children={
   {kind="text",id="quality_value",text=selected,rect={x=12,y=11,width=60,height=8}},
   {kind="combobox",id="quality",text=selected,action="Toggle",expanded=expanded,rect={x=10,y=10,width=70,height=10}}
  }}
 }})
 api.observation.set("selected", selected)
 api.observation.set("expanded", expanded)
end
return Game
