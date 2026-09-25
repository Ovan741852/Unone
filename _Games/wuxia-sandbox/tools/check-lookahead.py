"""Synthetic transport tests of production Luau lookahead, not model judgement."""
import json
from pathlib import Path
import subprocess
import tempfile

project = Path(__file__).resolve().parents[1]
engine = project.parents[1]
source = (project / "scripts/main.luau").read_text(encoding="utf-8")
brain = source[source.index("local Brain="):source.index("local function buildDecisionRequest")]
fixture = '''
local npcs={}
local frame,worldMinutes=10,30
local INTERACTION_ACTION={social=true}
local PAIR_ACTION,PAIR_RESPONSE={},{}
local Pair={occupied=function() return false end}
local Life={tick=function() end,clock=function() return {is_night=false} end}
local Persona={trait=function() return 50 end} -- Timing-only extraction; full profiles tested in production sweep.
local PORTABLE_ACTION={eat_packed=true}
local ACTION_LABEL={rest="rest",work="work",wait="wait",social="social"}
local function findNpc(id) for _,n in ipairs(npcs) do if n.id==id then return n end end end
local function addEvent() end
local function targetZone(n) return n.destination end
''' + 'local function clamp(v,a,b) return math.max(a,math.min(b,v)) end\n' + source[source.index('local Condition={}'):source.index('local Economy =')] + brain + '''
local n={id="npc_1",name="Resident",alive=true,action="rest",location="home",destination="home",task={ticks=0,minutes=0,duration_minutes=30,complete=false}}
table.insert(npcs,n)
local plan={action="work",target="none",timing="after_current",request_id="test",created_frame=1}
n.nextPlan=plan
Brain.progress(n,29); Brain.advancePlans({})
assert(n.action=="rest" and n.nextPlan==plan and not n.task.complete)
Brain.progress(n,1); n.reservedX=1; Brain.advancePlans({})
assert(n.action=="rest","must keep current grid reservation")
n.reservedX=nil; Brain.requests[n.id]={id="based-on-old-action"}; Brain.advancePlans({})
assert(n.action=="work" and not n.nextPlan and not Brain.requests[n.id])
assert(n.thinking.request_id=="test" and n.task.ticks==0)
for i=1,7 do Brain.progress(n,n.task.effort_minutes) end
assert(not n.task.complete); Brain.progress(n,n.task.effort_minutes); assert(n.task.complete)
plan={action="rest",target="none",timing="interrupt_now",request_id="interrupt",created_frame=2}
n.task.complete=false; n.nextPlan=plan; n.reservedX=2; Brain.advancePlans({}); assert(n.action=="work")
n.reservedX=nil; Brain.advancePlans({}); assert(n.action=="rest" and n.thinking.request_id=="interrupt")
n.location="road"; Brain.progress(n,100); assert(n.task.minutes==0 and not n.task.complete)
n.nextPlan={action="social",target="dead",timing="interrupt_now",request_id="invalid",created_frame=3}
Brain.advancePlans({}); assert(not n.nextPlan and n.action=="rest","invalid target must not select a fallback")
n.alive=false; n.nextPlan=plan; Brain.advancePlans({}); assert(n.nextPlan==plan)
print("Lookahead unit checks: completion, deferred handoff, safe grid interruption, stale context, invalid target, no fallback.")
'''
with tempfile.TemporaryDirectory(prefix="wuxia-lookahead-") as folder:
    script = Path(folder) / "lookahead.luau"
    script.write_text(fixture, encoding="utf-8")
    subprocess.run([str(engine / ".toolcache/luau-0.734/luau.exe"), str(script)], check=True)
    for timing in ("after_current", "interrupt_now"):
        sequence = [{} for _ in range(300)]
        def choose(at, request_frame, action, when):
            prefix = f"nano_npc_1_1_{request_frame}_"
            sequence[at-1] = {"actions": {"nano_reply": True, prefix+"apply": True, prefix+action: True,
                prefix+"target_none": True, prefix+"timing_"+when: True}}
        choose(2, 1, "rest", "after_current")
        choose(122, 121, "work", timing)
        inputs = Path(folder) / "inputs.json"
        inputs.write_text(json.dumps(sequence), encoding="utf-8")
        for frames in (150, 300, 3600):
            run = subprocess.run([str(engine / "target/release/game.exe"), "--project", str(project), "--json", "run",
                "--frames", str(frames), "--seed", "42", "--input-sequence", str(inputs)], capture_output=True, text=True, encoding="utf-8", check=True)
            result = json.loads(run.stdout)
            assert result["ok"], result.get("diagnostics")
            obs = result["value"]["world"]["observations"]
            n = obs["view_model"]["npc"][0]
            assert obs["decision_count"] == 2 and obs["economy"]["money_delta"] == 0
            assert n["planning_request_id"] == "npc_1:1_121" and n["planning_updated_frame"] == 122
            if frames < 3600 and timing == "after_current":
                assert n["action_id"] == "rest" and n["next_plan"]["action"] == "work" and not n["task"]["complete"]
                assert n["decision_request_id"] == "npc_1:1_1"
            else:
                assert n["action_id"] == "work" and not n.get("next_plan") and n["decision_request_id"] == "npc_1:1_121"
            print(json.dumps({"frames": frames, "timing": timing, "current": n["action_id"], "next": n.get("next_plan"), "passed": True}))
