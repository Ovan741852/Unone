"""Regression checks against actual Luau simulation, not a second JS simulation."""
import json
import math
from pathlib import Path
import subprocess
import sys
sys.stdout.reconfigure(encoding="utf-8")

project = Path(__file__).resolve().parents[1]
game = project.parents[1] / "target/release/game.exe"
layout = json.loads((project / "assets/town-layout.json").read_text(encoding="utf-8"))
previous = None
reports = []
inputs = project / ".runtime/verified-nanojev-inputs.json"
if not inputs.exists():
    inputs = project / "tests/evidence/nanojev-lookahead-inputs.json"
replay = ["--input-sequence", str(inputs)] if inputs.exists() else []
for frames in (1, 120, 600, 1200, 2400, 4800, 7200):
    run = subprocess.run([str(game), "--project", str(project), "--json", "run", "--frames", str(frames), "--seed", "42", *replay], capture_output=True, text=True, encoding="utf-8", check=True)
    result = json.loads(run.stdout)
    assert result["ok"], result.get("diagnostics")
    state = result["value"]
    world = state["world"]
    obs = world["observations"]
    residents = obs["view_model"]["npc"]
    assert len(residents) == 80
    assert obs["residential_capacity"] == 80
    if frames >= 4800:
        assert obs["treasure"]["spawned"] >= 1, obs.get("treasure")
    assert len(obs["world_labels"]) == 80
    assert all(n["name"] in n["head_label"] and n["action"] in n["head_label"] for n in residents)
    assert len({n["residence"] for n in residents}) == 40
    living = [n for n in residents if n["alive"]]
    positions = {n["id"]: world["entities"][n["id"]]["transform3d"]["position"] for n in living}
    min_gap = 100
    for i, a in enumerate(living):
        p = positions[a["id"]]
        assert abs(p["x"]) <= 90 and abs(p["z"]) <= 72
        for b in living[i+1:]:
            q = positions[b["id"]]
            gap = math.hypot(p["x"]-q["x"], p["z"]-q["z"])
            min_gap = min(min_gap, gap)
            # Walking agents may visually pass through one another.  The
            # gameplay invariant is unique destinations, checked below.
            if not a.get("moving") and not b.get("moving"):
                assert gap >= 1.39, (frames, a["id"], b["id"], gap)
        for b in layout["buildings"] + layout["homes"]:
            # The model footprint is smaller than clearance; doors are outside it.
            if b["clearanceX"] > 2:
                assert not (abs(p["x"]-b["x"]) < b["clearanceX"]-.5 and abs(p["z"]-b["z"]) < b["clearanceZ"]-.5), (frames, a["id"], "inside", b["id"])
        route = a["route"] if isinstance(a["route"], list) else []
        for left, right in zip(route, route[1:]):
            assert abs(left["x"]-right["x"])+abs(left["z"]-right["z"]) == 1
    destination_cells = []
    for resident in living:
        target = resident.get("route_target")
        if target and not resident.get("moving"):
            destination_cells.append((resident["id"], round(target["x"] / 2), round(target["z"] / 2)))
    assert len({(x, z) for _, x, z in destination_cells}) == len(destination_cells), (frames, destination_cells)
    moved = sum(n in previous and math.hypot(p["x"]-previous[n]["x"], p["z"]-previous[n]["z"]) > .1 for n, p in positions.items()) if previous else 0
    if not replay:
        assert obs["decision_count"] == 0 and moved == 0, "Offline residents must wait, not invent decisions"
    previous = positions
    reports.append({"frames": frames, "alive": len(living), "moved_since_previous_sample": moved, "walking": sum(n["location"] == "road" for n in living), "min_separation": round(min_gap, 3), "actions": sorted({n["action"] for n in living}), "decisions": obs["decision_count"], "p95_ms": state["performance"]["p95_frame_ms"], "frames_over_budget": state["performance"]["frames_over_budget"]})
print(json.dumps({"passed": True, "samples": reports}, ensure_ascii=False, indent=2))
