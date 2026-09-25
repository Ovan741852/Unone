"""Verify real checkpoint receipts against Luau acknowledgements and replay them.

Requires a running town plus nanojev-agent.py. No synthetic choices are used here.
The separate nanojev-transport.test.json tests transport only, not model quality.
"""
import json
import math
from pathlib import Path
import subprocess
from urllib.request import Request, urlopen

project = Path(__file__).resolve().parents[1]
status = json.loads((project / ".runtime/nanojev-status.json").read_text(encoding="utf-8"))
assert status["ready"] and status["phase"] == "running" and not status["fallback"], status.get("error")
assert len(status["checkpoint_sha256"]) == 64
records = [json.loads(line) for line in (project / ".runtime/nanojev-input-tape.jsonl").read_text(encoding="utf-8").splitlines() if line]
assert len(records) >= 40, "Wait for all 40 residents to receive model decisions before checking"
seen = set()
sampled_below_top = 0
for row in records:
    receipt = row["receipt"]
    assert receipt["source"] == "NanoJev checkpoint forward"
    assert receipt["request_id"] not in seen
    seen.add(receipt["request_id"])
    for field in ("probabilities", "target_probabilities", "timing_probabilities"):
        probabilities = receipt[field]
        if probabilities:
            assert all(math.isfinite(p) and 0 <= p <= 1 for p in probabilities.values())
            assert abs(sum(probabilities.values()) - 1) < 1e-5
    assert receipt["probabilities"][receipt["action"]] > 0
    assert receipt["timing_probabilities"][receipt["timing"]] > 0
    sampled_below_top += receipt["action"] != max(receipt["probabilities"], key=receipt["probabilities"].get)

frames = max(row["frame"] for row in records)
published_frame = math.ceil(frames / 30) * 30
sequence = [{} for _ in range(published_frame)]
for row in records:
    receipt = row["receipt"]
    prefix = receipt["input_prefix"]
    sequence[row["frame"]-1].setdefault("actions", {}).update({"nano_reply": True, prefix+"apply": True,
        prefix+receipt["action"]: True, prefix+"target_"+receipt["target"]: True, prefix+"timing_"+receipt["timing"]: True})
inputs = project / ".runtime/verified-nanojev-inputs.json"
inputs.write_text(json.dumps(sequence), encoding="utf-8")
run = subprocess.run([str(project.parents[1] / "target/release/game.exe"), "--project", str(project), "--json", "run", "--frames", str(published_frame), "--seed", "42", "--input-sequence", str(inputs)], capture_output=True, text=True, encoding="utf-8", check=True)
result = json.loads(run.stdout)
assert result["ok"], result.get("diagnostics")
obs = result["value"]["world"]["observations"]
assert obs["decision_count"] == len(records), ("native replay rejected a recorded decision", obs["decision_count"], len(records))
assert obs["economy"]["money_delta"] == 0
assert all(n["decision_source"] in ("NanoJev", "waiting-for-nanojev") or not n["alive"] for n in obs["view_model"]["npc"])
report = {"passed": True, "checkpoint_sha256": status["checkpoint_sha256"], "selection": status["selection"],
          "model_decisions_replayed": len(records), "frames": frames, "unique_residents": len({r["npc_id"] for r in records}),
          "sampled_below_top": sampled_below_top, "money_delta": obs["economy"]["money_delta"],
          "timings": sorted({r["receipt"]["timing"] for r in records}), "plans_started": obs["plans_started"],
          "actions": sorted({r["receipt"]["action"] for r in records}), "p95_ms": result["value"]["performance"]["p95_frame_ms"]}
(project / ".runtime/nanojev-verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
