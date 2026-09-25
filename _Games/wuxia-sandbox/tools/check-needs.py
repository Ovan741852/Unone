"""Check descriptive need pressure summaries and their NanoJev request wiring."""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

project = Path(__file__).resolve().parents[1]
engine = project.parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--tokens", action="store_true")
args = parser.parse_args()
source = (project / "scripts/main.luau").read_text(encoding="utf-8")
fixture = r'''
local observed,transforms={},{}
local api={debug={enabled=false},log=function() end,ui={setRoot=function() end},
    camera3d={setPosition=function() end,setTarget=function() end},
    observation={set=function(k,v) observed[k]=v end},random={nextFloat=function() return .5 end},
    entity={getTransform3D=function(id) return transforms[id] or {position={x=0,y=0,z=0}} end,
        setTransform3D=function(id,t) transforms[id]=t end}}
local function has(text,part) assert(string.find(text,part,1,true),part) end

local urgent=Condition.needsPriority({injury=98,hunger=100,fatigue=100,loneliness=100,fear=10,morale=100})
assert(urgent.primary_pressure=="survival")
assert(urgent.priority_order[1]=="survival")
assert(urgent.survival_severity==100 and urgent.social_severity==100)
assert(urgent.morale.value==100 and urgent.morale.level=="positive" and urgent.morale.is_crisis==false)
assert(#urgent.priority_ranking==5 and #urgent.priority_items==5)
assert(urgent.priority_items[1].id=="hunger" and urgent.priority_items[1].value==100)
assert(urgent.priority_items[2].id=="fatigue" and urgent.priority_items[3].id=="injury")
local rank={}
for i,item in ipairs(urgent.priority_items) do rank[item.id]=i end
assert(rank.injury<rank.loneliness,"injury must rank above loneliness")
has(urgent.summary,"傷勢 98/100")
has(urgent.summary,"飢餓100/100")
has(urgent.summary,"疲勞100/100")
has(urgent.summary,"孤獨100/100")
has(urgent.summary,"士氣100/100（正向；不列為危機）")
has(urgent.compact_model_summary,"survival first; critical needs favor rest/eat/treat")

local fatigueOverSocial=Condition.needsPriority({injury=0,hunger=0,fatigue=97,loneliness=100,fear=0,morale=50})
assert(fatigueOverSocial.priority_items[1].id=="fatigue")
local fatigueRank={}
for i,item in ipairs(fatigueOverSocial.priority_items) do fatigueRank[item.id]=i end
assert(fatigueRank.fatigue<fatigueRank.loneliness)
assert(fatigueOverSocial.action==nil and fatigueOverSocial.veto_action==nil)

local social=Condition.needsPriority({injury=10,hunger=20,fatigue=15,loneliness=100,fear=0,morale=50})
assert(social.primary_pressure=="social" and social.priority_order[1]=="social")
local afraid=Condition.needsPriority({injury=0,hunger=0,fatigue=0,loneliness=0,fear=100,morale=50})
assert(afraid.primary_pressure=="fear" and afraid.priority_order[1]=="fear")
assert(urgent.action==nil and urgent.recommended_action==nil and urgent.veto_action==nil)

resetWorld(api)
local n=npcs[1]
for i=2,5 do
    local peer=npcs[i]
    peer.x=n.x+(i-1)
    peer.z=n.z
end
n.inventory.food=1
n.inventory.herbs=1
n.inventory.wares=1
local request=buildDecisionRequest(n)
local view=snapshotNPC(n)
assert(view.needs_priority and view.needs_summary==view.needs_priority.summary)
has(view.needs_summary,"生存壓力：")
has(request.state,"Need pressure summary (compact, decision reference, not mandatory)")
has(request.state,"Priority:")
has(request.state,"not mandatory")
assert(not string.find(request.state,"需求",1,true),"NanoJev state must not contain Chinese labels")
assert(not string.find(request.state,"背景",1,true),"NanoJev state must not contain Chinese lore")
assert(not string.find(request.state,"藥農",1,true),"NanoJev state must use an English role")
assert(not string.find(request.state,"生存壓力：",1,true),"model state must use compact summary")
has(request.questions.action.instructions,"not a forced action")
assert(request.questions.action.criteria.rest and request.questions.action.criteria.work)
assert(not request.questions.action.criteria.forced_action)
local criteria_count=0
for id,text in pairs(request.questions.action.criteria) do
    criteria_count+=1
    assert(not string.find(text,"需求參考（非強制）",1,true),"criteria must not duplicate need reference")
end
assert(criteria_count>=15 and request.questions.target and request.questions.target.criteria)
local target_count=0
for _ in pairs(request.questions.target.criteria) do target_count+=1 end
assert(target_count==5,"expected four neighbors plus none")

local function json(v)
    if type(v)=="string" then return '"'..v:gsub('\\','\\\\'):gsub('"','\\"'):gsub('\n','\\n'):gsub('\r','\\r')..'"' end
    if type(v)=="number" or type(v)=="boolean" then return tostring(v) end
    local entries={}
    for k,item in pairs(v) do table.insert(entries,json(k)..":"..json(item)) end
    return "{"..table.concat(entries,",").."}"
end
print("NEEDS_REQUEST:"..json({id=request.id,state=request.state,questions=request.questions}))
print("Need checks passed: stable survival/fear/social ordering, positive morale, descriptive-only wiring.")
'''

with tempfile.TemporaryDirectory(prefix="wuxia-needs-") as directory:
    script = Path(directory) / "needs.luau"
    script.write_text(source.rsplit("return Game", 1)[0] + fixture, encoding="utf-8")
    result = subprocess.run(
        [str(engine / ".toolcache/luau-0.734/luau.exe"), str(script)],
        capture_output=True, text=True, encoding="utf-8"
    )
    if result.returncode:
        print(result.stdout + result.stderr)
        raise SystemExit(result.returncode)
    line = next(line for line in result.stdout.splitlines() if line.startswith("NEEDS_REQUEST:"))
    request = json.loads(line.removeprefix("NEEDS_REQUEST:"))
    print(result.stdout.splitlines()[-1])

if args.tokens:
    repo = Path("C:/Users/liNao/Documents/ComfyUI/NanoJev")
    assert Path(sys.prefix).resolve() == (repo / ".venv-town").resolve(), "Use isolated .venv-town"
    sys.path.insert(0, str(repo / "scripts"))
    from transformers import AutoTokenizer
    from predict_toy_decisions import prepare_examples

    tokenizer = AutoTokenizer.from_pretrained(
        str(repo / "checkpoints/NanoJev/tokenizer"), local_files_only=True
    )
    examples = prepare_examples({"states": [request]}, tokenizer, 1024)
    maximum = max(len(path) for example in examples for path in example["leaf_tokens"])
    assert maximum <= 980
    print(json.dumps({"needs_tokens_passed": True, "max_tokens": maximum}, ensure_ascii=False))
