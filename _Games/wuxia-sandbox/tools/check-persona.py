"""Check real Luau identities and exact NanoJev token paths without loading weights.

Run in NanoJev/.venv-town, which owns the checkpoint tokenizer dependencies.
No synthetic choices are sent to the running town.
"""
import argparse
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile

project = Path(__file__).resolve().parents[1]
repo = Path("C:/Users/liNao/Documents/ComfyUI/NanoJev")
parser = argparse.ArgumentParser()
parser.add_argument("--max-length", type=int, default=1024)
parser.add_argument("--live", action="store_true", help="Also audit acknowledged model receipts from the current preview")
args = parser.parse_args()
sys.path.insert(0, str(repo / "scripts"))
from transformers import AutoTokenizer
from predict_toy_decisions import prepare_examples

# Independence/reset: test the production constructor, not a hand-copied profile.
source = (project / "scripts/main.luau").read_text(encoding="utf-8")
block = source[source.index("local Persona = {}"):source.index("local BUILDINGS = {")]
with tempfile.TemporaryDirectory(prefix="wuxia-persona-") as folder:
    script = Path(folder) / "persona.luau"
    script.write_text(block + '''
local a,b=Persona.create(1),Persona.create(1)
a.traits[1].value=0
assert(b.traits[1].value==28 and Persona.defs[1].traits[1]==28)
assert(#Persona.defs==40 and #Persona.axes==6)
for i=1,40 do
    local identity=Persona.create(i)
    local input=Persona.describe(identity)
    for _,field in ipairs({"values","red_line","love_style","love_boundary","tension"}) do
        assert(string.find(input,identity[field],1,true))
    end
    for _,trait in ipairs(identity.traits) do
        assert(trait.value>=0 and trait.value<=100)
        assert(string.find(input,trait.id.."="..trait.value,1,true))
    end
end
''', encoding="utf-8")
    subprocess.run([str(project.parents[1] / ".toolcache/luau-0.734/luau.exe"), str(script)], check=True)

run = subprocess.run([str(project.parents[1] / "target/release/game.exe"), "--project", str(project),
    "--json", "run", "--frames", "120", "--seed", "42"], capture_output=True, text=True, encoding="utf-8", check=True)
result = json.loads(run.stdout)
assert result["ok"], result.get("diagnostics")
obs = result["value"]["world"]["observations"]
people = obs["view_model"]["npc"]
requests = obs["decision_requests"]
assert len(people) == len(requests) == 40 and obs["decision_count"] == 0
assert all(p["action_id"] == "wait" for p in people), "No identity-based fallback allowed"
assert len({json.dumps(p["identity"], sort_keys=True) for p in people}) == 40
for npc in people:
    identity = npc["identity"]
    request = next(r for r in requests if r["npc_id"] == npc["id"])
    assert all(identity[k] in request["state"] for k in ("values", "red_line", "love_style", "love_boundary", "tension"))
    assert len(identity["traits"]) == 6
    assert all(f'{t["id"]}={t["value"]}' in request["state"] for t in identity["traits"])
    assert "Inventory:" in request["state"] and "Cash=" in request["state"] and "Time day" in request["state"]

tokenizer = AutoTokenizer.from_pretrained(str(repo / "checkpoints/NanoJev/tokenizer"), local_files_only=True)
payload = {"states": [{k:r[k] for k in ("id", "state", "questions")} for r in requests]}
examples = prepare_examples(payload, tokenizer, args.max_length)
largest = max(len(path) for example in examples for path in example["leaf_tokens"])
stress = copy.deepcopy(payload)
for row in stress["states"]:
    peers = {f"npc_{i}": f"npc_{i} 珠寶匠; cash=999999, affinity=100, trust=100, resentment=100, romance=100; partner=npc_40; proposal to you=true" for i in (36, 37, 38, 39)}
    progress = row["state"].partition(" Current unit:")[2]
    row["state"] = row["state"].split("Nearby people:")[0] + "Nearby people: " + "; ".join(peers.values()) + (" Current unit:"+progress if progress else "")
    row["questions"]["target"] = {"type": "choice", "instructions": "Choose a person using your values, love outlook, traits, needs and relationships.", "criteria": {"none": "No specific person.", **peers}}
    row["state"] += " Last transaction: 市集現金不足，工作尚未結算；購買生活物資失敗，錢袋與庫存未改動。"
stress_examples = prepare_examples(stress, tokenizer, args.max_length)
stress_largest = max(len(path) for example in stress_examples for path in example["leaf_tokens"])
report = {"passed": True, "residents": 40, "unique_profiles": 40, "traits_per_person": 6,
    "initial_max_tokens": largest, "four_peer_stress_max_tokens": stress_largest,
    "context_limit": args.max_length, "offline_decisions": obs["decision_count"]}
if args.live:
    records = [json.loads(line) for line in (project / ".runtime/nanojev-input-tape.jsonl").read_text(encoding="utf-8").splitlines() if line]
    by_id = {p["id"]:p["identity"] for p in people}
    assert {r["npc_id"] for r in records} == set(by_id), "Wait for all 40 model receipts"
    for record in records:
        receipt = record["receipt"]
        identity = by_id[record["npc_id"]]
        assert receipt["source"] == "NanoJev checkpoint forward"
        assert all(identity[k] in receipt["input_state"] for k in ("values", "red_line", "love_style", "love_boundary", "tension"))
        assert all(f'{t["id"]}={t["value"]}' in receipt["input_state"] for t in identity["traits"])
    report["actual_profile_decisions_checked"] = len(records)
    (project / ".runtime/persona-verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))
