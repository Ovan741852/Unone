"""Offline cemetery checks; deaths/decisions remain Luau-owned and are not model evidence."""
import json
import math
import subprocess
import tempfile
from pathlib import Path

project = Path(__file__).resolve().parents[1]
engine_root = project.parents[1]
luau = engine_root / ".toolcache/luau-0.734/luau.exe"
game = engine_root / "target/release/game.exe"
source = (project / "scripts/main.luau").read_text(encoding="utf-8")
cemetery_block = source[source.index("-- Cemetery parcel"):source.index("local ZONES = {}")]
snapshot_block = source[source.index("local function cemeterySnapshot"):source.index("local function publishCemetery")]
publish_block = source[source.index("local function publishCemetery"):source.index("local function resolveRouteTarget")]
kill_block = source[source.index("local function killNpc"):source.index("local function maybeJealousy")]

lua_fixture = f'''local GRID_STEP=2
{cemetery_block}
for _,count in ipairs({{0,1,21,40}}) do
    local assigned={{}}
    for i=1,count do
        local npc={{id="npc_"..i}}
        local slot=allocateCemeterySlot(npc)
        assert(slot==i and cemeteryAssignments[npc.id]==i and cemeteryReservations[i]==npc.id)
        assert(cemeterySlotAt(cemeteryCell(slot))==slot)
        assigned[i]=npc
    end
    for i=1,count do assert(allocateCemeterySlot(assigned[i])==i) end
    for i=1,count do _releaseCemeterySlot(assigned[i]) end
    for i=1,CEMETERY.capacity do assert(cemeteryReservations[i]==nil) end
end
assert(cemeterySlotAt({{x=CEMETERY.originX+1,z=CEMETERY.originZ}})==nil)
assert(cemeteryWorldPosition(1).x==-36 and cemeteryWorldPosition(1).z==-52)
assert(cemeteryWorldPosition(40).x==-8 and cemeteryWorldPosition(40).z==-36)
print("Luau cemetery checks passed: 0/1/21/40 allocation, stable slots, aisle cells, reset")
'''
with tempfile.TemporaryDirectory(prefix="wuxia-cemetery-") as directory:
    script = Path(directory) / "cemetery.luau"
    script.write_text(lua_fixture, encoding="utf-8")
    subprocess.run([str(luau), str(script)], check=True)

real_kill_fixture = f'''local GRID_STEP=2
{cemetery_block}
{snapshot_block}
{publish_block}
local npcs={{}}
local events={{}}
local eventCount=0
local frame=123
local storyStats={{deaths=0}}
local EXTENSIONS={{}}
local Brain={{requests={{}}}}
local function clamp(value,low,high) return math.max(low,math.min(high,value)) end
local function findNpc(id) for _,npc in ipairs(npcs) do if npc.id==id then return npc end end end
local function addEvent(api,message) eventCount+=1; table.insert(events,message); api.log(message) end
{kill_block}
local published={{}}
local transform={{position={{x=0,y=0.04,z=0}},rotation={{x=0,y=0,z=0}}}}
local api={{
    observation={{set=function(key,value) published[key]=value end}},
    entity={{getTransform3D=function(_) return transform end,setTransform3D=function(_,value) transform=value end}},
    log=function(_) end
}}
local victim={{id="npc_test",name="測試居民",alive=true,wealth=2,inventory={{food=2,herbs=2}},injury=17,morale=73,partnerId=nil}}
table.insert(npcs,victim)
local wealth,food,herbs=victim.wealth,victim.inventory.food,victim.inventory.herbs
killNpc(api,victim,nil,"synthetic confirmed cause")
local firstSlot,firstX,firstZ=victim.cemeterySlot,victim.cemeteryPosition.x,victim.cemeteryPosition.z
publishCemetery(api)
assert(published.cemetery.slots[firstSlot].resident_id==victim.id)
assert(published.cemetery.slots[firstSlot].position.x==firstX and published.cemetery.slots[firstSlot].position.z==firstZ)
assert(victim.wealth==wealth and victim.inventory.food==food and victim.inventory.herbs==herbs)
killNpc(api,victim,nil,"must not overwrite")
assert(victim.cemeterySlot==firstSlot and victim.cemeteryPosition.x==firstX and storyStats.deaths==1)
cemeteryAssignments={{}}; cemeteryReservations={{}}
publishCemetery(api)
for _,slot in ipairs(published.cemetery.slots) do assert(slot.resident_id=="") end
print("Luau real kill/publish checks passed: requested slot, estate, repeat guard, reset")
'''
with tempfile.TemporaryDirectory(prefix="wuxia-cemetery-kill-") as directory:
    script = Path(directory) / "real-kill.luau"
    script.write_text(real_kill_fixture, encoding="utf-8")
    subprocess.run([str(luau), str(script)], check=True)

layout = json.loads((project / "assets/town-layout.json").read_text(encoding="utf-8"))
assert layout["size"] == {"width": 80, "depth": 88, "center": {"x": 0, "z": -12}}

run = subprocess.run([str(game), "--project", str(project), "--json", "run", "--frames", "120", "--seed", "42"], capture_output=True, text=True, encoding="utf-8", check=True)
result = json.loads(run.stdout)
assert result["ok"], result.get("diagnostics")
obs = result["value"]["world"]["observations"]
assert len(obs["view_model"]["npc"]) == 40
assert obs["cemetery"]["capacity"] == 40 and all(slot["resident_id"] == "" for slot in obs["cemetery"]["slots"])
slots = [(slot["position"]["x"], slot["position"]["z"]) for slot in obs["cemetery"]["slots"]]
assert len(set(slots)) == 40
assert all(-40 <= x <= 40 and -56 <= z <= 32 for x, z in slots)
access = {(b["access"]["x"], b["access"]["z"]) for b in layout["buildings"] + layout["homes"]}
for slot in obs["cemetery"]["slots"]:
    x, z = slot["position"]["x"], slot["position"]["z"]
    cell = (slot["cell"]["x"], slot["cell"]["z"])
    assert cell not in access, (cell, "access")
    for building in layout["buildings"] + layout["homes"]:
        assert not (abs(x - building["x"]) <= building["clearanceX"] and abs(z - building["z"]) <= building["clearanceZ"]), (cell, building["id"])
    for obstacle in layout["obstacles"]:
        assert not (abs(x - obstacle["x"]) <= obstacle["radius"] and abs(z - obstacle["z"]) <= obstacle["radius"]), (cell, obstacle)
for npc in obs["view_model"]["npc"]:
    position = result["value"]["world"]["entities"][npc["id"]]["transform3d"]["position"]
    assert -56 <= position["z"] <= 32, (npc["id"], position)

# Mirror the Luau walkability boundary to prove every authored building/home
# access cell and every live NPC spawn share one connected component.
cemetery_cells = {(slot["cell"]["x"], slot["cell"]["z"]) for slot in obs["cemetery"]["slots"]}
buildings = layout["buildings"] + layout["homes"]
def walkable(cell):
    x, z = cell
    if not (-20 <= x <= 20 and -28 <= z <= 16) or cell in cemetery_cells:
        return False
    wx, wz = x * 2, z * 2
    for building in buildings:
        access_cell = (building["access"]["x"], building["access"]["z"])
        if cell != access_cell and abs(wx - building["x"]) <= building["clearanceX"] and abs(wz - building["z"]) <= building["clearanceZ"]:
            return False
    if abs(wx) < 2 and abs(wz) < 2 or wx <= -38 and abs(wz - 20) > 1:
        return False
    return not any(abs(wx - obstacle["x"]) <= obstacle["radius"] and abs(wz - obstacle["z"]) <= obstacle["radius"] for obstacle in layout["obstacles"])

seeds = set()
for npc in obs["view_model"]["npc"]:
    position = result["value"]["world"]["entities"][npc["id"]]["transform3d"]["position"]
    seeds.add((round(position["x"] / 2), round(position["z"] / 2)))
reachable = set(seed for seed in seeds if walkable(seed))
assert reachable, "no valid live NPC spawn seed"
reachable = {next(iter(reachable))}
frontier = list(reachable)
while frontier:
    x, z = frontier.pop()
    for candidate in ((x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1)):
        if candidate not in reachable and walkable(candidate):
            reachable.add(candidate)
            frontier.append(candidate)
for building in buildings:
    access_cell = (building["access"]["x"], building["access"]["z"])
    assert access_cell in reachable, (building["id"], access_cell)
for seed in seeds:
    assert seed in reachable, ("spawn", seed)

module = (project / "viewer/tombstone.js").resolve().as_uri()
node_check = f'''import {{deadResidents,presentationCopy,portraitAsset,tombstonePosition}} from {json.dumps(module)};
const fail = message => {{ throw new Error(message); }};
for (const count of [0, 1, 21, 40]) {{
  const npc = Array.from({{length: 40}}, (_, i) => ({{id:`npc_${{i + 1}}`, alive:i < count ? false : true, hp:i < count ? 0 : 100, cemetery_position:i < count ? {{x:-36 + (i % 8) * 4, z:-52 + Math.floor(i / 8) * 4}} : undefined}}));
  npc.push({{id:'alive-zero',alive:true,hp:0,injury:100}});
  const entities = Object.fromEntries(npc.map((n, i) => [n.id, {{mesh3d:{{asset:i === 1 ? 'mesh://character-female-b' : 'mesh://character-male-a', visible:true}}, transform3d:{{position:{{x:i,z:i}}}}}}]));
  const snapshot = {{observations:{{view_model:{{npc}}}}, entities}};
  if (deadResidents(snapshot).length !== count) fail('dead count');
  const copy = presentationCopy(snapshot);
  if (copy.entities.npc_1?.mesh3d?.visible !== (count > 0 ? false : true)) fail('presentation visibility');
  if (snapshot.entities.npc_1.mesh3d.visible !== true) fail('source mutation');
  if (portraitAsset(snapshot, npc[1]) !== 'mesh://character-female-b') fail('portrait source');
  if (deadResidents(snapshot).some(n => n.id === 'alive-zero')) fail('alive zero-hp classification');
}}
const legacy = {{observations:{{view_model:{{npc:[{{id:'npc_2',alive:false}}]}}}}, entities:{{npc_2:{{transform3d:{{position:{{x:7,z:9}}}},mesh3d:{{asset:'mesh://character-female-b',visible:true}}}}}}}};
if (tombstonePosition(legacy, legacy.observations.view_model.npc[0]).x !== 7) fail('legacy position');
if (deadResidents({{observations:{{view_model:{{npc:{{}}}}}}}}).length !== 0) fail('object npc list normalization');
if (tombstonePosition({{observations:{{view_model:{{npc:[{{id:'missing',alive:false}}]}}}},entities:{{}}}}, {{id:'missing',alive:false}}) !== null) fail('phantom missing position');
console.log('viewer tombstone checks passed: counts, alive0HP, source copy, portrait, legacy fallback');
'''
subprocess.run(["node", "--input-type=module", "-e", node_check], check=True)
print("Cemetery checks passed: 40-slot collision bounds, north ground/layout, reset snapshot, viewer fallback/nonmutation")
