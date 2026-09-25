"""Synthetic whole-production Luau pair execution and optional local-tokenizer checks. No live inputs or model weights."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

project = Path(__file__).resolve().parents[1]
engine = project.parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--tokens", action="store_true")
args = parser.parse_args()
source = (project / "scripts/main.luau").read_text(encoding="utf-8")
fixture = r'''
local observed,transforms,inputs={},{},{}
local roll=.5
local api={debug={enabled=false},log=function() end,ui={setRoot=function() end},
    input={isDown=function(k) return inputs[k]==true end,isPointerDown=function() return false end},
    camera3d={setPosition=function() end,setTarget=function() end},
    observation={set=function(k,v) observed[k]=v end},random={nextFloat=function() return roll end},
    entity={getTransform3D=function(id) return transforms[id] or {position={x=0,y=0,z=0}} end,setTransform3D=function(id,t) transforms[id]=t end}}
local function audit()
    local e=Economy.snapshot(); assert(e.money_delta==0)
    for _,g in ipairs(e.goods) do assert(g.stock+g.carried==g.initial_stock+g.produced-g.consumed) end
end
local function place(n,x,z,zone)
    n.x=x; n.z=z; n.gridX=math.round(x/2); n.gridZ=math.round(z/2); n.location=zone or "road"
    n.reservedX=nil; n.reservedZ=nil; n.routeCells=nil
end
local function fresh()
    resetWorld(api); roll=.5; frame=1
    for _,n in ipairs(npcs) do n.nextDecisionFrame=100000; n.fatigue=0; n.hunger=0; n.injury=0; n.martial=40 end
    local a,b=npcs[1],npcs[2]; place(a,0,0); place(b,2,0)
    return a,b
end
local function request(n)
    frame+=1; local r=buildDecisionRequest(n); Brain.requests[n.id]=r; return r
end
local function reply(n,r,action,target,timing)
    inputs={nano_reply=true,[r.input_prefix.."apply"]=true,[r.input_prefix..action]=true,[r.input_prefix.."target_"..target]=true,[r.input_prefix.."timing_"..(timing or "interrupt_now")]=true}
    receiveModelDecisions(api); inputs={}
end
local function choose(n,action,target,timing)
    local r=request(n); assert(r.questions.action.criteria[action],action.." unavailable")
    reply(n,r,action,target or "none",timing); assert(n.nextPlan and n.nextPlan.request_id==r.id,"synthetic reply rejected")
    Brain.advancePlans(api); return r
end
local function offer(a,b,action)
    local r=choose(a,action,b.id); local p=a.pair; assert(p and p.b==b and b.pair==p)
    assert(p.initiator_request_id==r.id); Pair.tick(api,.01); return p
end
local function accept(a,b,p)
    assert(p.phase=="awaiting_response"); local r=choose(b,"accept",a.id)
    assert(p.response_request_id==r.id and b.action=="accept" and a.pair==p)
    Pair.tick(api,.01); assert(p.phase=="performing"); return r
end
local function complete()
    local seconds=0
    for _,p in pairs(Pair.sessions) do if p.duration_minutes then seconds=math.max(seconds,(p.duration_minutes-p.elapsed_minutes)/8/speed) end end
    Pair.tick(api,seconds+.01); audit()
end
-- Exact role/receipt linkage, no unilateral relationship or beneficiary effect, exactly-once settlement.
for _,action in ipairs({"social","cooperate","flirt","propose"}) do
    local a,b=fresh(); b.fatigue=20; a.loneliness=50
    local oldB=b.action; local p=offer(a,b,action)
    assert(b.action==oldB and not b.thinking and not p.response_request_id)
    assert(a.loneliness==50 and b.fatigue==20 and not a.partnerId)
    local av,bv=Pair.view(a,false),Pair.view(b,false)
    assert(av.id==bv.id and av.counterpart_id==b.id and bv.counterpart_id==a.id and string.find(av.head_label,"等待",1,true))
    accept(a,b,p); local coins=a.wealth+b.wealth; applyAction(api); assert(a.wealth+b.wealth==coins and a.finance.work_ticks==0 and b.finance.work_ticks==0)
    complete(); assert(not a.pair and not b.pair and a.lastInteraction.id==p.id)
    if action=="propose" then assert(a.partnerId==b.id and b.partnerId==a.id)
    elseif action=="cooperate" then assert(b.fatigue==18 and getRelationship(a,b).cooperation==1)
    elseif action=="flirt" then assert(getRelationship(a,b).romance==8) end
    local encounters=getRelationship(a,b).encounters; Pair.tick(api,10); assert(getRelationship(a,b).encounters==encounters)
end
-- Refusal, no response, distance, busy locks, invalid providers/targets and no money/herb.
local a,b=fresh(); local p=offer(a,b,"propose"); choose(b,"refuse",a.id); assert(not a.partnerId and not a.pair and a.lastKnownInteraction.phase=="cancelled")
assert(string.find(buildDecisionRequest(a).state,"Last pair=proposal/cancelled",1,true))
a,b=fresh(); p=offer(a,b,"propose"); Pair.tick(api,91); assert(not a.partnerId and not a.pair)
a,b=fresh(); speed=4; p=offer(a,b,"propose"); Pair.tick(api,30); assert(a.pair==p,"4x speed shortened real model response window"); Pair.tick(api,61); assert(not a.pair)
a,b=fresh(); p=offer(a,b,"social"); local c=npcs[3]; local busy=Pair.begin(api,c,b,"social","busy"); assert(not busy and b.pair==p and a.pair==p)
assert(not Pair.begin(api,a,a,"social","self")); c.alive=false; assert(not Pair.begin(api,npcs[4],c,"social","dead"))
a,b=fresh(); choose(a,"propose",b.id); p=a.pair; place(b,20,0); Pair.tick(api,.01); assert(p.phase=="approach"); Pair.tick(api,91); assert(not a.partnerId)
a,b=fresh(); a.injury=30; b.inventory.herbs=0; assert(not Pair.begin(api,a,b,"help","missing-provider")); assert(a.injury==30)
for _,sourceKind in ipairs({"clinic","field"}) do
    for _,failure in ipairs({"none","money","herb","depart","interrupt","death"}) do
        a,b=fresh(); local provider=sourceKind=="clinic" and npcs[5] or b; local patient=a
        patient.injury=30
        if sourceKind=="clinic" then place(provider,ZONES.clinic.x,ZONES.clinic.z,"clinic"); place(patient,ZONES.clinic.x+2,ZONES.clinic.z,"road")
        else provider.inventory.herbs=1; Economy.initial_stock.herbs+=1 end
        local beforeCash=patient.wealth
        p=offer(patient,provider,"help"); assert(p.source==(sourceKind=="clinic" and "clinic" or "carried_herb"))
        assert(string.find(buildDecisionRequest(provider).targets[patient.id],"injury=30",1,true))
        accept(patient,provider,p)
        if failure=="money" and sourceKind=="clinic" then Economy.transfer(patient,Economy.accounts.treasury,patient.wealth,"test","empty")
        elseif failure=="herb" then
            if sourceKind=="clinic" then local stock=Economy.accounts.clinic.inventory.herbs; Economy.consume(Economy.accounts.clinic,"herbs",stock)
            else Economy.useItem(provider,"herbs") end
        elseif failure=="depart" then place(provider,50,0)
        elseif failure=="interrupt" then choose(provider,"wait","none")
        elseif failure=="death" then killNpc(api,provider,nil,"synthetic death") end
        complete()
        local success=failure=="none" or (failure=="money" and sourceKind=="field")
        assert(patient.injury==(success and 18 or 30),sourceKind.."/"..failure)
        if sourceKind=="field" then assert(patient.wealth==beforeCash) end
        local injury=patient.injury; Pair.tick(api,100); assert(patient.injury==injury); audit()
    end
end
-- Provider-initiated treatment uses the patient's explicit response as well.
a,b=fresh(); b.injury=30; p=offer(a,b,"treat"); assert(p.provider==a and p.patient==b)
accept(a,b,p); complete(); assert(b.injury==18 and a.inventory.herbs==0)
-- Same clinic stock, stable id order, one herb cannot settle two concurrent treatments.
a,b=fresh(); local doctor1,doctor2=npcs[5],npcs[25]
place(doctor1,ZONES.clinic.x,ZONES.clinic.z,"clinic"); place(doctor2,ZONES.clinic.x-2,ZONES.clinic.z,"clinic")
place(a,ZONES.clinic.x,ZONES.clinic.z+2); place(b,ZONES.clinic.x-2,ZONES.clinic.z+2); a.injury=30; b.injury=30
Economy.consume(Economy.accounts.clinic,"herbs",Economy.accounts.clinic.inventory.herbs-1)
local first=offer(a,doctor1,"help"); accept(a,doctor1,first)
local second=offer(b,doctor2,"help"); accept(b,doctor2,second)
Pair.sessions={[second.id]=second,[first.id]=first}; complete()
assert(a.injury==18 and b.injury==30 and Economy.accounts.clinic.inventory.herbs==0)
-- A consensual pair grants no immunity to the existing independently selected attack.
a,b=fresh(); a.injury=99; b.inventory.herbs=1; Economy.initial_stock.herbs+=1
p=offer(a,b,"help"); accept(a,b,p)
local attacker=npcs[3]; place(attacker,0,2); roll=.1
choose(attacker,"attack",a.id); processEncounters(api); assert(attacker.combat,"paired target became immune to attack")
Combat.tick(api,.01); Combat.tick(api,.31); Combat.tick(api,.25)
assert(not a.alive and not a.pair and not b.pair and b.inventory.herbs==1); audit()
-- Paid treatment end-to-end through actual Game.update/path reservations, not manual arrival.
a,b=fresh(); local patient=npcs[2]; local provider=npcs[5]
place(patient,HOMES[1].access.x*2,HOMES[1].access.z*2,"home_1")
place(provider,ZONES.clinic.x,ZONES.clinic.z,"clinic"); provider.action="wait"; provider.interactionZone="clinic"
patient.injury=30; local money=patient.wealth; p=offer(patient,provider,"help"); assert(p.phase=="approach")
local startX,startZ=patient.x,patient.z; local arrived=false
for _=1,4500 do
    local x,z=patient.x,patient.z; Game.update(api,1/60)
    assert(math.abs(patient.x-x)+math.abs(patient.z-z)<=.076,"pair movement teleported")
    if p.phase=="awaiting_response" then arrived=true; break end
end
assert(arrived and (patient.x~=startX or patient.z~=startZ) and Pair.atClinic(patient),"clinic path did not arrive")
choose(provider,"accept",patient.id)
for _=1,360 do Game.update(api,1/60) end
assert(patient.injury==18 and patient.wealth<money and not patient.pair,"navigated clinic treatment did not settle")
audit()
-- Stale receipt and already-queued after_current response cannot attach to a replacement invitation.
a,b=fresh(); p=offer(a,b,"social"); b.task={ticks=0,effort=0,minutes=0,complete=false}; local old=request(b)
reply(b,old,"accept",a.id,"after_current"); local queued=b.nextPlan; assert(queued and queued.pair_id==p.id)
Pair.finish(api,p,"cancelled","test cancellation"); assert(not b.nextPlan)
p=offer(a,b,"social"); b.nextPlan=queued; b.task.complete=true; Brain.advancePlans(api)
assert(not p.accepted and not b.nextPlan and b.pair==p)
local new=request(b); reply(b,old,"accept",a.id); assert(not b.nextPlan)
reply(b,new,"accept",a.id); assert(b.nextPlan and b.nextPlan.pair_id==p.id)
-- Missing/wrong recipient choice remains invalid and never falls back to the initiator.
a,b=fresh(); p=offer(a,b,"social"); local r=request(b); local oldAction=b.action
reply(b,r,"accept","none"); assert(not p.accepted and not b.nextPlan and not Brain.requests[b.id] and b.action==oldAction)
b.nextDecisionFrame=frame+120; frame+=119; decideStaggered(api); assert(not Brain.requests[b.id])
frame+=1; decideStaggered(api); assert(Brain.requests[b.id] and Brain.requests[b.id].id~=r.id and b.action==oldAction)
-- Hidden theft is not leaked through role context, response criteria, last known outcome or promoted peers.
a,b=fresh(); roll=.9; p=offer(a,b,"steal"); assert(not p.noticed and not Pair.view(b,true)); local r=request(b)
assert(r.interaction_pair_id=="" and not r.questions.action.criteria.resist and string.find(r.state,"Pair=none.",1,true))
assert(string.find(Pair.view(b,false).summary,"本人尚未察覺",1,true))
roll=.1; complete(); assert(b.wealth==b.finance.initial_balance-18 and not b.lastKnownInteraction)
-- Detected crime: refusing is not a shield; wait, blocked leave, actual separation, yielding and resisting.
for _,response in ipairs({"none","blocked_leave","leave","yield","resist","ordinary_after_leave"}) do
    a,b=fresh(); roll=.1; p=offer(a,b,"rob"); local cash=b.wealth; local r=request(b)
    assert(not r.questions.action.criteria.refuse and not Pair.validResponse(b,"refuse",a.id,p.id,Pair.basis(b)))
    if response=="yield" then choose(b,"yield",a.id); Pair.tick(api,.01); complete(); assert(b.wealth==cash-18)
    elseif response=="resist" then choose(b,"resist",a.id); assert(b.action=="resist" and b.combat and b.combat.actor_id==b.id and b.combat.target_id==a.id); Combat.tick(api,.01); Combat.tick(api,.31); Combat.tick(api,.25); assert(a.injury>0)
    elseif response=="none" then Pair.tick(api,91); assert(b.wealth==cash-18)
    else
        choose(b,"leave",a.id); assert(a.pair==p and b.pair==p and b.wealth==cash,"leave command guaranteed escape")
        if response=="leave" then place(b,6,0); Pair.tick(api,.01); assert(not a.pair and b.wealth==cash)
        else
            if response=="ordinary_after_leave" then choose(b,"wait","none"); assert(a.pair==p) end
            Pair.tick(api,91); assert(b.wealth==cash-18,"blocked/abandoned escape guaranteed safety")
        end
    end
    audit()
end
-- Duel requires this exact accepted pair; direct old global matchmaking is rejected.
a,b=fresh(); a.action="duel"; b.action="duel"; assert(not Combat.begin(api,a,b,"duel"))
p=offer(a,b,"duel"); accept(a,b,p); assert(a.combat==b.combat and a.combat.id==p.bout.id and p.bout.a==a and p.bout.b==b)
roll=.1
for _=1,200 do Combat.tick(api,.1) end
assert(a.alive and b.alive and a.injury<=75 and b.injury<=75 and not a.pair and not b.pair); audit()
-- Serialize exact production requests for both roles, all 40 profiles, actual prior reactions and four-peer stress.
local function json(v)
    if type(v)=="string" then return '"'..v:gsub('\\','\\\\'):gsub('"','\\"'):gsub('\n','\\n'):gsub('\r','\\r')..'"' end
    if type(v)=="number" or type(v)=="boolean" then return tostring(v) end
    local entries={}; for k,item in pairs(v) do table.insert(entries,json(k)..":"..json(item)) end
    return "{"..table.concat(entries,",").."}"
end
local function capture(n)
    frame+=1 -- Production request ids include frame; every fixture request must also be unique.
    n.task={ticks=9999,effort=7.99,minutes=99999,duration_minutes=999999.9,remaining_minutes=99999.9,duration_estimated=true,complete=false}
    local count=0
    for _,index in ipairs({28,13,34,8,25}) do
        local other=npcs[index]
        if other~=n and (not n.pair or (other~=n.pair.a and other~=n.pair.b)) then
            place(other,n.x+4,n.z+count*2); other.injury=99; count+=1; if count==3 then break end
        end
    end
    local r=buildDecisionRequest(n)
    assert(string.find(r.state,"Character profile=",1,true) and string.find(r.state,"stable traits 0-100",1,true))
    assert(string.find(r.state,"Last game-rule effect: cooperate",1,true) and string.find(r.state,"Last pair=",1,true))
    local peers=0; for id,description in pairs(r.targets) do if id~="none" then peers+=1; assert(string.find(description,"injury=",1,true) and string.find(description,"at_clinic=",1,true)) end end
    assert(peers==4)
    print("PAIR_REQUEST:"..json({id=r.id,state=r.state,questions=r.questions}))
end
for i=1,40 do
    for _,recipient in ipairs({false,true}) do
        fresh(); local n=npcs[i]; local other=npcs[i==1 and 2 or 1]
        place(n,0,0); place(other,2,0); n.loneliness=50; n.morale=50
        p=offer(n,other,"cooperate"); accept(n,other,p); complete() -- Real two-effect prior reaction, not invented model rationale.
        for _,person in ipairs({n,other}) do Economy.initial_stock.herbs+=1-person.inventory.herbs; person.inventory.herbs=1; person.injury=30 end
        p=recipient and offer(other,n,"help") or offer(n,other,"help")
        assert(p.source=="carried_herb"); capture(n)
        Pair.finish(api,p,"cancelled","synthetic interruption"); capture(n)
    end
end
-- Paid clinic and crime response criteria are measured too, with complete actual resident data.
for _,kind in ipairs({"help","steal","rob"}) do
    a,b=fresh(); a=npcs[5]; b=npcs[2]; place(a,0,0); place(b,2,0)
    p=offer(a,b,"cooperate"); accept(a,b,p); complete()
    p=offer(b,a,"cooperate"); accept(b,a,p); complete()
    if kind=="help" then place(a,ZONES.clinic.x,ZONES.clinic.z,"clinic"); place(b,ZONES.clinic.x+2,ZONES.clinic.z,"road"); b.injury=30 end
    roll=.1; p=kind=="help" and offer(b,a,kind) or offer(a,b,kind)
    if kind=="help" then assert(p.source=="clinic") end
    capture(a); capture(b)
end
resetWorld(api); assert(next(Pair.sessions)==nil and not npcs[1].pair and not npcs[1].lastInteraction)
print("Paired checks passed: actual production offer/response receipts, atomic effects, clinic navigation via Game.update, stale/busy/dead/distant failures, consensual social/proposal/duel, stealth versus known crime, blocked/actual escape, no wage or double settlement, estates/stock, reset. Synthetic execution only.")
'''
with tempfile.TemporaryDirectory(prefix="wuxia-paired-") as directory:
    script = Path(directory) / "paired.luau"
    script.write_text(source.rsplit("return Game", 1)[0] + fixture, encoding="utf-8")
    result = subprocess.run([str(engine / ".toolcache/luau-0.734/luau.exe"), str(script)], capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        print(result.stdout + result.stderr)
        raise SystemExit(result.returncode)
    requests = [json.loads(line.removeprefix("PAIR_REQUEST:")) for line in result.stdout.splitlines() if line.startswith("PAIR_REQUEST:")]
    print(result.stdout.splitlines()[-1])
if args.tokens:
    repo = Path("C:/Users/liNao/Documents/ComfyUI/NanoJev")
    assert Path(sys.prefix).resolve() == (repo / ".venv-town").resolve(), "Use isolated .venv-town"
    sys.path.insert(0, str(repo / "scripts"))
    from transformers import AutoTokenizer
    from predict_toy_decisions import prepare_examples
    tokenizer = AutoTokenizer.from_pretrained(str(repo / "checkpoints/NanoJev/tokenizer"), local_files_only=True)
    maximum = max(len(path) for ex in prepare_examples({"states": requests}, tokenizer, 1024) for path in ex["leaf_tokens"])
    print(json.dumps({"paired_tokens_passed": True, "actual_production_requests": len(requests), "max_tokens": maximum, "model_loaded": False}))
