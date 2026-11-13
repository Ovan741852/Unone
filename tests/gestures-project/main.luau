--!strict
-- Canonical types are in types.luau, refreshed from game api typings.
local T=require("./types")
local g:T.GestureRecognizer
local kit:T.UiComponentKit
local offsetX,offsetY,zoom,rotation=0,0,1,0
local width,height=720,1280
local last="Ready"
local enabled=true
local function render(api:T.EngineApi)
    local size=math.clamp(18*zoom,4,40)
    local x=math.clamp(50+offsetX/width*100,7+size/2,93-size/2)
    local y=math.clamp(50-offsetY/height*100,24+size/2,78-size/2)
    local markerX=x+math.cos(rotation)*size*.3
    local markerY=y-math.sin(rotation)*size*.3
    api.ui.setRoot(kit.screen({id="screen",node="gesture-lab",children={
        kit.text({id="title",text="Unone Gestures 0.1.0",rect={x=5,y=90,width=90,height=7},style={font_size=4,color={1,.86,.5,1}}}),
        kit.text({id="help",text="One finger: pan   Two fingers: zoom / rotate",rect={x=5,y=83,width=90,height=6},style={font_size=2.5,color={.85,.9,1,1}}}),
        kit.component({id="map",component="gesture.map",rect={x=5,y=20,width=90,height=60},surface={kind="panel",style={background={.04,.09,.14,1}}},children={
            kit.component({id="tile",component="gesture.tile",rect={x=x-size/2,y=y-size/2,width=size,height=size},surface={kind="panel",style={background={.1,.55,.8,1}}},children={
                kit.panel({id="direction",rect={x=markerX-size*.05,y=markerY-size*.05,width=size*.1,height=size*.1},style={background={1,.8,.2,1}}}),
            }}),
        }}),
        kit.text({id="status",text=string.format("Zoom %.2f   Rotation %.1f deg   Touches %d",zoom,math.deg(rotation),g.status().contacts),rect={x=5,y=13,width=90,height=5},style={font_size=2.6,color={1,1,1,1}}}),
        kit.text({id="event",text=last,rect={x=5,y=8,width=46,height=4},style={font_size=2.3,color={.7,.85,1,1}}}),
        kit.button({id="reset",text="Reset",action="Reset",rect={x=54,y=3,width=18,height=7},style={font_size=2.5,background={.2,.3,.4,1}}}),
        kit.button({id="pause",text=if enabled then "Pause" else "Resume",action="Pause",rect={x=75,y=3,width=20,height=7},style={font_size=2.5,background={.2,.3,.4,1}}}),
    }}))
end
return {
    start=function(api:T.EngineApi)
        kit=api.ui.components.create()
        g=api.input.gestures.create({accept=function(p:T.GesturePoint):boolean
            return p.y>=p.viewport.height*.20 and p.y<p.viewport.height*.80
        end})
        render(api)
    end,
    update=function(api:T.EngineApi,_dt:number)
        if api.input.wasPressed("Reset") then g.cancel();offsetX=0;offsetY=0;zoom=1;rotation=0 end
        if api.input.wasPressed("Pause") then enabled=not enabled;g.setEnabled(enabled) end
        local batch=api.input.getPhysicalBatch()
        if batch then for _,row in batch.events do
            local result=g.process(row)
            for _,e in result.events do
                width=e.viewport.width;height=e.viewport.height;last=e.kind.." / "..e.phase
                if e.phase=="change" or (e.kind=="pan" and e.phase=="start") then
                    offsetX+=e.deltaX;offsetY+=e.deltaY
                    zoom=math.clamp(zoom*e.scale,.25,4);rotation+=e.rotation
                end
            end
        end end
        api.observation.set("gesture",{x=offsetX,y=offsetY,zoom=math.round(zoom*1000)/1000,rotation=math.round(math.deg(rotation)*1000)/1000,contacts=g.status().contacts,captured=g.status().captured})
        render(api)
    end,
}
