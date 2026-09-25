"""Synthetic execution checks of production Luau callers, not model judgement.

Optional --tokens uses .venv-town's local tokenizer only, never model weights.
"""
import argparse
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile

project = Path(__file__).resolve().parents[1]
engine = project.parents[1]
source = (project / "scripts/main.luau").read_text(encoding="utf-8")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--tokens", action="store_true")
args = parser.parse_args()

# Execute the whole production module with only the engine boundary stubbed.
fixture = r'''
local observed,transforms={},{}
local roll=.5
local api={debug={enabled=false},log=function() end,ui={setRoot=function() end},
    camera3d={setPosition=function() end,setTarget=function() end},
    observation={set=function(k,v) observed[k]=v end},random={nextFloat=function() return roll end},
    entity={getTransform3D=function(id) return transforms[id] or {position={x=0,y=0,z=0}} end,
        setTransform3D=function(id,t) transforms[id]=t end}}
local function near(a,b) assert(math.abs(a-b)<1e-8,tostring(a).." ~= "..tostring(b)) end
local function trait(n,id,value) for _,t in ipairs(n.identity.traits) do if t.id==id then t.value=value; return end end; error(id) end
local function audit()
    local e=Economy.snapshot(); assert(e.money_delta==0)
    for _,g in ipairs(e.goods) do assert(g.stock+g.carried==g.initial_stock+g.produced-g.consumed) end
    for _,n in ipairs(npcs) do
        for _,s in ipairs({"morale","fear","jealousy","loneliness"}) do assert(n[s]>=0 and n[s]<=100) end
    end
end
local function fresh()
    resetWorld(api); frame=1; worldMinutes=720; roll=.5
    for _,n in ipairs(npcs) do
        n.routeCells=nil; n.reservedX=nil; n.reservedZ=nil; n.lastNeedsMinute=720; n.lastTaskMinute=720; n.executionSince=720
        n.task={ticks=0,effort=0,minutes=0,complete=false,effort_minutes=4}
        n.morale=50; n.fear=20; n.loneliness=50; n.jealousy=20
    end
    local a,b,c=npcs[1],npcs[2],npcs[3]
    a.x=0; a.z=0; b.x=2; b.z=0; c.x=6; c.z=0
    return a,b,c
end
local function fourMinutes()
    worldMinutes+=4
    for _,n in ipairs(npcs) do n.lastNeedsMinute=worldMinutes end -- Hold needs equal while comparing event reactions.
    applyAction(api)
end
local function finishTimed(a,action,location)
    a.action=action; a.location=location; a.interactionZone=location; a.itemActionDone=false
    a.task={ticks=0,effort=0,minutes=0,complete=false,duration_minutes=1}
    a.executionSince=worldMinutes; a.lastTaskMinute=worldMinutes; worldMinutes+=1
    for _,n in ipairs(npcs) do n.lastNeedsMinute=worldMinutes end
    applyAction(api)
end
local function encounter(a,b,action)
    Brain.startPlan(api,a,{action=action,target=b.id,timing="interrupt_now",request_id="offer_"..Pair.sequence,created_frame=frame})
    local plan={action="wait",target="none",timing="after_current"}; a.nextPlan=plan
    roll=.1; Pair.tick(api,.01)
    local pair=a.pair
    if pair and pair.phase=="awaiting_response" and action~="steal" then
        Brain.startPlan(api,b,{action="accept",target=a.id,timing="interrupt_now",request_id="reply_"..pair.id,created_frame=frame,pair_id=pair.id,pair_basis=Pair.basis(b)})
        Pair.tick(api,.01); Pair.tick(api,pair.duration_minutes/8+.01)
    elseif pair then Pair.tick(api,91) end
    roll=.5
    assert(a.action==action and a.interactionTargetId==b.id and a.nextPlan==plan)
    audit()
end
local function record(n,event)
    assert(n.lastPersonalityReaction.event==event)
    print("REACTION_CODE:"..n.lastPersonalityReaction.code)
    local snapshot=snapshotNPC(n)
    assert(snapshot.identity==n.identity and snapshot.last_personality_reaction==n.lastPersonalityReaction)
    assert(string.find(snapshot.emotion_cause,n.lastPersonalityReaction.text,1,true))
    local request=buildDecisionRequest(n)
    assert(string.find(request.state,n.lastPersonalityReaction.code,1,true))
    assert(string.find(request.state,"Fear=",1,true) and string.find(request.state,"jealousy=",1,true))
end
assert(Persona.trait({},"sociability")==50)
for _,v in ipairs({0,100}) do
    local factor=.5+v/100
    local a,b=fresh(); trait(a,"sociability",v)
    Life.tick(a,10,Life.clock(720)); near(a.loneliness,50+factor)
    a.loneliness=50; encounter(a,b,"social"); near(a.loneliness,50-13*factor); record(a,"social")
    local after=a.loneliness; processEncounters(api); near(a.loneliness,after)
    a,b=fresh(); trait(a,"empathy",v); encounter(a,b,"cooperate")
    near(a.morale,50+2*factor); near(b.fatigue,18+(NPC_DEFS[2].martial%10)-2); record(a,"cooperate")
    a,b=fresh(); trait(b,"sensitivity",v); local money=b.wealth
    encounter(a,b,"steal"); near(b.morale,50-4*factor); assert(b.wealth==money-18); record(b,"robbed")
    a=fresh(); trait(a,"discipline",v); a.action="work"; a.location=a.job.zone; a.fatigue=0; a.hunger=0
    local cash,energy=a.wealth,a.jobEnergy
    for _=1,7 do fourMinutes(); near(a.morale,50); assert(not a.lastPersonalityReaction) end
    fourMinutes(); near(a.morale,50+2*factor); assert(a.wealth==cash+a.job.wage and a.finance.shifts==1)
    near(a.jobEnergy,energy+8); assert(a.action=="work"); record(a,"paid_work"); audit()
    a=fresh(); a.action="cultivate"; a.location="training"; local cultivation_before,qi_before=a.cultivation,a.qi
    fourMinutes(); assert(a.cultivation>cultivation_before and a.qi>qi_before and a.realm=="凡人"); audit()
    -- The actual combat windup/hit path: traits never modify physical damage.
    a,b=fresh(); a.action="attack"; a.martial=50; b.martial=50; a.fatigue=0; a.hunger=0
    trait(b,"sensitivity",v); trait(b,"risk",v)
    assert(Combat.begin(api,a,b,"attack")); Combat.tick(api,.01); Combat.tick(api,.31); Combat.tick(api,.25)
    assert(b.injury==7 and a.action=="attack" and b.action=="wait")
    near(b.morale,50-5*factor); near(b.fear,20+7*(1.5-v/100)); record(b,"hit"); audit()
    a=fresh(); trait(a,"risk",v); a.action="hunt"; a.location="monster_den"
    fourMinutes(); assert(a.injury==1 and a.action=="hunt"); near(a.fear,20+.5*(1.5-v/100)); record(a,"hunt"); audit()
    local c; a,b,c=fresh(); trait(c,"possessiveness",v); a.partnerId=c.id
    for _=1,3 do encounter(a,b,"flirt") end
    near(c.jealousy,20+3*factor); assert(getRelationship(a,c).jealousy==3 and storyStats.jealousy==1)
    assert(c.action=="wait"); record(c,"partner_flirt")
end
-- Cultivation loop: manuals, pills and artifacts are real inventory/effect paths.
a,b=fresh(); a.inventory.herbs=1; finishTimed(a,"alchemy","clinic"); assert(a.inventory.pills==1)
local cultivation_after_alchemy=a.cultivation; finishTimed(a,"use_pill","clinic"); assert(a.inventory.pills==0 and a.cultivation>cultivation_after_alchemy)
roll=.1; finishTimed(a,"seek_manual","archive"); assert(a.inventory.manuals>0 and a.technique~="基礎吐納")
a.inventory.wares=1; finishTimed(a,"forge_artifact","forge"); assert(a.inventory.artifacts==1 and a.artifact_power==8)
-- Failed, remote, dead and already-completed events must not create reactions.
local a,b,c=fresh(); b.x=7; encounter(a,b,"social"); assert(not a.lastPersonalityReaction)
a,b=fresh(); Economy.transfer(b,Economy.accounts.treasury,b.wealth,"test","empty purse")
encounter(a,b,"steal"); assert(not b.lastPersonalityReaction)
fresh(); a=npcs[2]; a.action="work"; a.location=a.job.zone; a.fatigue=0; a.hunger=0
local firm=Economy.accounts[a.job.firm]; Economy.transfer(firm,Economy.accounts.treasury,firm.wealth,"test","insolvent")
for _=1,8 do fourMinutes() end
assert(a.morale==50 and a.finance.shifts==0 and not a.lastPersonalityReaction); audit()
a,b=fresh(); a.action="attack"; roll=.99
assert(Combat.begin(api,a,b,"attack")); Combat.tick(api,.01); Combat.tick(api,.31); Combat.tick(api,.25)
assert(b.injury==0 and b.lastPersonalityReaction and b.lastPersonalityReaction.event=="attacked" and Combat.misses==1)
a=fresh(); a.action="hunt"; a.location="monster_den"; a.injury=100; applyAction(api)
assert(a.alive and not a.lastPersonalityReaction and a.fear==20 and a.finance.work_ticks==0)
for _,situation in ipairs({"distant","dead","not_flirt","target_distant"}) do
    a,b,c=fresh(); a.partnerId=c.id
    if situation=="distant" then c.x=7 elseif situation=="dead" then c.alive=false
    elseif situation=="target_distant" then c.x=-6 end
    encounter(a,b,situation=="not_flirt" and "social" or "flirt")
    assert(c.jealousy==20 and not c.lastPersonalityReaction and getRelationship(a,c).jealousy==0)
end
-- Actual clamped deltas remain visible even when fatigue dominates the mood.
a,b=fresh(); a.fatigue=100; a.morale=99.75; a.loneliness=.25
encounter(a,b,"cooperate"); near(a.morale,100); near(a.loneliness,0)
near(a.lastPersonalityReaction.effects[1].delta,-.25); near(a.lastPersonalityReaction.effects[2].delta,.25)
record(a,"cooperate"); assert(snapshotNPC(a).emotion=="疲憊")
a,b=fresh(); b.morale=.25; encounter(a,b,"steal"); near(b.lastPersonalityReaction.effects[1].delta,-.25)
a,b=fresh(); a.alive=false; a.action="social"; a.interactionTargetId=b.id
Life.tick(a,10,Life.clock(720)); processEncounters(api); applyAction(api); Economy.work(a)
assert(a.loneliness==50 and a.morale==50 and not a.lastPersonalityReaction); audit()
resetWorld(api); assert(not npcs[1].lastPersonalityReaction and not observed.view_model.npc[1].last_personality_reaction)
print("Persona effects passed: explicit synthetic paired offer/accept settlement, six axes at production callers, witnessed flirt, success gates, clamped deltas, dead/reset, no intention overrides, damage/wage invariance, money/inventory conservation.")
'''
with tempfile.TemporaryDirectory(prefix="wuxia-persona-effects-") as directory:
    script = Path(directory) / "effects.luau"
    script.write_text(source.rsplit("return Game", 1)[0] + fixture, encoding="utf-8")
    result = subprocess.run([str(engine / ".toolcache/luau-0.734/luau.exe"), str(script)],
                            capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        print(result.stdout + result.stderr)
        raise SystemExit(result.returncode)
    codes = {line.removeprefix("REACTION_CODE:") for line in result.stdout.splitlines() if line.startswith("REACTION_CODE:")}
    print(result.stdout.splitlines()[-1])

if args.tokens:
    repo = Path("C:/Users/liNao/Documents/ComfyUI/NanoJev")
    assert Path(sys.prefix).resolve() == (repo / ".venv-town").resolve(), "Use .venv-town for tokenizer checks"
    sys.path.insert(0, str(repo / "scripts"))
    from transformers import AutoTokenizer
    from predict_toy_decisions import prepare_examples
    tokenizer = AutoTokenizer.from_pretrained(str(repo / "checkpoints/NanoJev/tokenizer"), local_files_only=True)
    run = subprocess.run([str(engine / "target/release/game.exe"), "--project", str(project), "--json", "run", "--frames", "120", "--seed", "42"],
                         capture_output=True, text=True, encoding="utf-8", check=True)
    obs = json.loads(run.stdout)["value"]["world"]["observations"]
    maximum = 0
    for request in obs["decision_requests"]:
        for code in codes:
            row = copy.deepcopy({k: request[k] for k in ("id", "state", "questions")})
            row["state"] = row["state"].replace("Last game-rule effect: none.", "Last game-rule effect: " + code + ".")
            peers = {f"npc_{i}": f"npc_{i} 珠寶匠; cash=999999, affinity=100, trust=100, resentment=100, romance=100; partner=npc_40; proposal to you=true" for i in (36, 37, 38, 39)}
            progress = row["state"].partition(" Current unit:")[2]
            row["state"] = row["state"].split("Nearby people:")[0] + "Nearby people: " + "; ".join(peers.values()) + " Current unit:" + progress
            assert "Condition=" in row["state"] and "speed/effort/strike damage multiplier" in row["state"]
            row["state"] += " Last transaction: 市集現金不足，工作尚未結算；購買生活物資失敗，錢袋與庫存未改動。"
            row["questions"]["target"] = {"type": "choice", "instructions": "Choose a person using your values, love outlook, traits, needs and relationships.", "criteria": {"none": "No specific person.", **peers}}
            examples = prepare_examples({"states": [row]}, tokenizer, 1024)
            maximum = max(maximum, max(len(path) for ex in examples for path in ex["leaf_tokens"]))
    print(json.dumps({"personality_effect_token_stress_passed": True, "profiles": 40, "actual_reaction_codes": len(codes), "max_tokens": maximum, "model_loaded": False}))
