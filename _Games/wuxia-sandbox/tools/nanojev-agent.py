"""Actual local NanoJev inference; no gameplay scoring or heuristic fallback.

Luau authors state/questions/candidates. This process returns the checkpoint's
choice through Unone's existing boolean InputFrame contract. Full unrounded
probabilities and checkpoint identity live in a read-only presentation sidecar;
only Luau can apply actions, validate targets, and change the world.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen

sys.stdout.reconfigure(encoding="utf-8")

PROJECT = Path(__file__).resolve().parents[1]
DEFAULT_REPO = Path("C:/Users/liNao/Documents/ComfyUI/NanoJev")


def native(url, command):
    request = Request(url + "/request", json.dumps(command).encode(), {"Content-Type": "application/json"})
    with urlopen(request, timeout=8) as response:
        result = json.load(response)
    if not result.get("ok"):
        raise RuntimeError(str(result.get("diagnostics", result)))
    return result["value"]


def write_status(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    # Windows readers may briefly hold the destination open. This sidecar is
    # presentation telemetry, never a reason to drop an already-computed decision.
    for _ in range(3):
        try:
            os.replace(temporary, path)
            return
        except PermissionError:
            time.sleep(.02)


def compact_model_request(request):
    """Remove duplicated nearby-person prose from the action context.

    The target question already carries the nearby candidates. Keeping that
    same prose in the action state pushed some valid residents over the local
    checkpoint's 1024-token inference ceiling.
    """
    state = request["state"]
    marker = " Nearby people:"
    if marker not in state:
        return request, False
    before, remainder = state.split(marker, 1)
    contract = remainder.find(" Employment contract:")
    compact = before + (remainder[contract:] if contract >= 0 else "")
    result = dict(request)
    result["state"] = compact
    return result, True


def question_context(request, question_id):
    contexts = request.get("question_states")
    if isinstance(contexts, dict) and isinstance(contexts.get(question_id), str):
        return contexts[question_id], False
    compact, changed = compact_model_request(request)
    return compact["state"], changed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=DEFAULT_REPO)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--native", default="http://127.0.0.1:55433")
    parser.add_argument("--batch", type=int, default=2)
    parser.add_argument("--selection", choices=("sample", "argmax"), default="sample")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    # One worker per town: repeated launch commands must not allocate another model.
    import msvcrt
    lock_path = PROJECT / ".runtime/nanojev-worker.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    worker_lock = lock_path.open("a+b")
    if lock_path.stat().st_size == 0:
        worker_lock.write(b"0"); worker_lock.flush()
    worker_lock.seek(0)
    try:
        msvcrt.locking(worker_lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        print("NanoJev worker is already running for this town; no second model loaded.", flush=True)
        return
    checkpoint = args.checkpoint or args.repo / "checkpoints/NanoJev"
    status_path = PROJECT / ".runtime/nanojev-status.json"
    status = {"backend": "NanoJev", "ready": False, "phase": "loading", "fallback": False, "pid": os.getpid(),
              "checkpoint": str(checkpoint), "receipts": {}, "active_receipts": {}, "batches": 0, "applied": 0,
              "worker_mode": "single GPU worker", "batch_size": args.batch, "batch_questions": 3, "torch_threads": 2}
    write_status(status_path, status)
    sys.path.insert(0, str(args.repo / "scripts"))
    import torch
    torch.set_num_threads(2)
    generator = torch.Generator().manual_seed(args.seed)
    from predict_toy_decisions import DecisionPredictor
    model = DecisionPredictor(checkpoint, max_length=1024, precision="bf16")
    with (checkpoint / "best.safetensors").open("rb") as weights:
        status["checkpoint_sha256"] = hashlib.file_digest(weights, "sha256").hexdigest()
    status.update(ready=True, phase="ready", gpu=torch.cuda.get_device_name(), model=model.run_config["model"], selection=args.selection, temperature=1, seed=args.seed, context_limit=1024)
    write_status(status_path, status)
    if args.probe:
        payload = {"states": [{"id": "probe", "state": "You live in a town. Hunger=85/100; fatigue=15/100; cash=20 coins; a meal costs 6 coins and the inn has 20 meals; injury=0. Your job is a farmer.", "questions": {"action": {"type": "choice", "instructions": "Choose what this resident wants to do next given their needs and money.", "criteria": {"work": "Earn wages at work.", "eat": "Buy and eat a meal.", "rest": "Rest at home.", "social": "Talk to another resident."}}}}]}
        for _ in range(2):
            start = time.perf_counter()
            result = model.predict(payload)
            print(json.dumps({"seconds": time.perf_counter()-start, "result": result}, ensure_ascii=False), flush=True)
        return
    pending = {}
    recorded = set()
    tape_path = PROJECT / ".runtime/nanojev-input-tape.jsonl"
    tape_path.write_text("", encoding="utf-8")
    last_frame = -1
    while True:
        try:
            obs = native(args.native, {"method": "observations"})["observations"]
            if obs.get("view_model", {}).get("paused"):
                time.sleep(.2)
                continue
            requests = obs.get("decision_requests", [])
            requests = requests if isinstance(requests, list) else []
            if obs.get("simulation_tick_count", 0) < last_frame:
                pending.clear(); status["receipts"] = {}; status["active_receipts"] = {}; recorded.clear()
                tape_path.write_text("", encoding="utf-8")
            # Record only actions Luau acknowledged, not merely submitted input.
            for npc in obs.get("view_model", {}).get("npc", []):
                receipt = status["receipts"].get(npc["id"])
                request_id = npc.get("planning_request_id")
                if receipt and receipt["request_id"] == request_id and request_id not in recorded:
                    with tape_path.open("a", encoding="utf-8") as tape:
                        tape.write(json.dumps({"frame": npc["planning_updated_frame"], "npc_id": npc["id"], "receipt": receipt}, ensure_ascii=False)+"\n")
                    recorded.add(request_id)
                if receipt and receipt["request_id"] == npc.get("decision_request_id"):
                    status["active_receipts"][npc["id"]] = receipt
            last_frame = obs.get("simulation_tick_count", 0)
            current_ids = {item["id"] for item in requests}
            pending = {key: value for key, value in pending.items() if key in current_ids}
            batch = [r for r in requests if r["id"] not in pending][:args.batch]
            if batch:
                start = time.perf_counter()
                # The target question still carries nearby-person details; do
                # not duplicate that prose in every action candidate path.
                model_batch = []
                compacted = {}
                for request in batch:
                    for question_id in ("action", "target", "timing"):
                        question = request["questions"].get(question_id)
                        if not question:
                            continue
                        context, was_compacted = question_context(request, question_id)
                        model_batch.append({"id": request["id"] + "::" + question_id, "state": context,
                                             "questions": {question_id: question}})
                        compacted[request["id"] + "::" + question_id] = was_compacted
                result = model.predict({"states": model_batch}, batch_questions=3)
                status["latency_ms"] = round((time.perf_counter()-start)*1000, 1)
                status["batches"] += 1
                answers = {answer["id"]: answer for answer in result["states"]}
                def choose(decision):
                    if args.selection == "argmax":
                        return decision["choice"]
                    probabilities = decision["probabilities"]
                    index = torch.multinomial(torch.tensor(list(probabilities.values()), dtype=torch.float64), 1, generator=generator).item()
                    return list(probabilities)[index]
                for request in batch:
                    action_answer = answers.get(request["id"] + "::action")
                    timing_answer = answers.get(request["id"] + "::timing")
                    target_answer = answers.get(request["id"] + "::target")
                    if not action_answer or not timing_answer:
                        raise ValueError("Model response identity mismatch")
                    action = choose(action_answer["answers"]["action"])
                    target = choose(target_answer["answers"]["target"]) if target_answer else "none"
                    timing = choose(timing_answer["answers"]["timing"])
                    if action not in request["questions"]["action"]["criteria"]:
                        raise ValueError("Model returned an action outside the Luau candidate set")
                    if timing not in request["questions"]["timing"]["criteria"]:
                        raise ValueError("Model returned timing outside the Luau candidate set")
                    pending[request["id"]] = {"request": request, "action": action, "target": target, "timing": timing,
                        "probabilities": action_answer["answers"]["action"]["probabilities"],
                        "timing_probabilities": timing_answer["answers"]["timing"]["probabilities"],
                        "target_probabilities": target_answer["answers"]["target"]["probabilities"] if target_answer else {},
                        "latency_ms": status["latency_ms"], "request_id": request["id"], "input_prefix": request["input_prefix"],
                        "selection": args.selection, "source": "NanoJev checkpoint forward", "input_state": request["state"],
                        "model_contexts": "action/target/timing-specific", "model_state_compacted": any(compacted.get(request["id"] + "::" + key, False) for key in ("action", "target", "timing"))}
            # Recheck after GPU work: reset/death/expired requests must never receive old actions.
            fresh = native(args.native, {"method": "observations"})["observations"]
            actions = {}
            for request in fresh.get("decision_requests", []):
                receipt = pending.get(request["id"])
                if not receipt or receipt["request"]["state"] != request["state"]:
                    continue
                actions["nano_reply"] = True
                actions[request["input_prefix"] + "apply"] = True
                actions[request["input_prefix"] + receipt["action"]] = True
                actions[request["input_prefix"] + "target_" + receipt["target"]] = True
                actions[request["input_prefix"] + "timing_" + receipt["timing"]] = True
                status["receipts"][request["npc_id"]] = {key: value for key, value in receipt.items() if key != "request"}
            if actions and not fresh.get("view_model", {}).get("paused"):
                native(args.native, {"method": "input", "frame": {"actions": actions}})
            status.update(phase="running", error=None, updated_at=time.time(), applied=fresh.get("decision_count", 0), queued=len(fresh.get("decision_requests", [])))
            write_status(status_path, status)
            time.sleep(.08 if actions else .15)
        except (OSError, ValueError, RuntimeError, KeyError) as error:
            status.update(phase="error", error=str(error), updated_at=time.time())
            write_status(status_path, status)
            print(json.dumps({"error": str(error), "fallback": False}), flush=True)
            time.sleep(1)


if __name__ == "__main__":
    main()
