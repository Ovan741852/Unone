"""Bundle the staged UI package into a standalone, staging-only Unone demo."""
import json
from pathlib import Path

game = Path(__file__).resolve().parents[1]
stage = game / '.unone/staging'
module = (stage / 'unone-ui/luau/unone_ui.luau').read_text(encoding='utf-8-sig')
demo = stage / 'ui-migration/demo'
demo.mkdir(parents=True, exist_ok=True)
script = '''
local Game={}
local checked=false
local value=168
local held={}
local function pressed(api,action)
 local down=api.input.isDown(action)
 local edge=down and not held[action]
 held[action]=down
 return edge
end
local function publish(api)
 UI.publish(api,UI.screen("common-components","demo",{
  UI.text({id="title",text="Unone UI 0.2.0 - Common components",rect={x=10,y=84,width=80,height=8}}),
  UI.label({id="label",text="Luau owns state; this demo does not alter your game.",rect={x=10,y=74,width=80,height=6}}),
  UI.button({id="hit",label="Add 24",action="Hit",rect={x=10,y=58,width=23,height=10}}),
  UI.toggle({id="auto",label="AUTO",checked=checked,action="ToggleAuto",rect={x=38,y=58,width=23,height=10}}),
  UI.icon_button({id="reset",icon="R",label="Reset",action="Reset",rect={x=66,y=58,width=23,height=10}}),
  UI.progress_bar({id="guard",label="Guard",value=value,min=0,max=240,rect={x=10,y=43,width=80,height=8}}),
  UI.button({id="disabled",label="Disabled button (text fallback)",action="Blocked",disabled=true,rect={x=10,y=29,width=80,height=8}}),
  UI.text({id="boundary",text="Panel/Tabs: composition. Input/Dialog/Tooltip: host required.",rect={x=10,y=12,width=80,height=10}})
 }))
 api.observation.set("checked",checked)
 api.observation.set("guard",value)
end
function Game.start(api)publish(api)end
function Game.update(api,dt)
 if pressed(api,"Hit") then value=math.min(240,value+24)end
 if pressed(api,"ToggleAuto")then checked=not checked end
 if pressed(api,"Reset")then value=0;checked=false end
 publish(api)
end
return Game
'''
(demo / 'main.luau').write_text('local UI=(function()\n' + module +
                                '\nend)()\n' + script, encoding='utf-8')
(demo / 'scene.json').write_text('{"entities":[]}', encoding='utf-8')
(demo / 'project.unone.json').write_text(json.dumps({
    'name': 'Unone UI 0.2.0 Common Components', 'entry_script': 'main.luau',
    'main_scene': 'scene.json', 'test_files': ['controls.test.json']}, indent=2),
    encoding='utf-8')
(demo / 'controls.test.json').write_text(json.dumps({
    'name': 'state-owned-by-luau', 'frames': 6, 'seed': 42,
    'input_sequence': [{'actions': {'Hit': True, 'ToggleAuto': True}}, {},
                       {'actions': {'Hit': True}}, {}, {}, {}],
    'assertions': [{'observation': {'key': 'guard', 'equals': 216}},
                   {'observation': {'key': 'checked', 'equals': True}}]}, indent=2),
    encoding='utf-8')
print(demo)
