"""Synthetic profile-swap diagnostics; never sends decisions to the running town.

Default: stdlib self-check + isolated Luau requests, no tokenizer or model weights.
--tokens: also check exact production token paths in NanoJev/.venv-town.
--model: explicitly load the CUDA model (only run when GPU capacity is available).
--full-candidates: add one contrast using an unchanged production action candidate set.
Sensitivity to profiles is not evidence of believable personality: this checkpoint
is navigation-trained. Expected tendencies below are authored hypotheses, not gold labels.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

PROJECT = Path(__file__).resolve().parents[1]
REPO = Path("C:/Users/liNao/Documents/ComfyUI/NanoJev")
REPORT = PROJECT / ".runtime/personality-behavior-audit.json"
FIELDS = ("values", "red_line", "love_style", "love_boundary", "tension")
LIMIT = 1024


def production_inputs():
    command = [str(PROJECT.parents[1] / "target/release/game.exe"), "--project", str(PROJECT),
               "--json", "run", "--frames", "120", "--seed", "42"]
    run = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", check=True, timeout=60)
    result = json.loads(run.stdout)
    assert result["ok"], result.get("diagnostics")
    obs = result["value"]["world"]["observations"]
    people = {p["id"]: p for p in obs["view_model"]["npc"]}
    requests = {r["npc_id"]: r for r in obs["decision_requests"]}
    assert len(people) == len(requests) == 40 and obs["decision_count"] == 0
    profiles = {}
    for npc_id, person in people.items():
        request = requests[npc_id]
        description, marker, _ = request["state"].partition("Time day ")
        identity = person["identity"]
        assert marker and description.startswith("Values (priority): ")
        assert all(identity[field] in description for field in FIELDS)
        assert all(f'{trait["id"]}={trait["value"]}' in description for trait in identity["traits"])
        profiles[npc_id] = {"profile_id": npc_id, "identity": identity,
                            "description": description, "source_request_id": request["id"]}
    # A real, full social-capable request without the herb-farmer-only gather option.
    reference = max((r for r in requests.values() if "social" in r["questions"]["action"]["criteria"]
                     and "gather" not in r["questions"]["action"]["criteria"]),
                    key=lambda r: len(r["questions"]["action"]["criteria"]))
    return profiles, reference, command


def scenarios(profiles, reference, full_candidates):
    neutral = (
        "Synthetic controlled diagnostic, not an event in the town. "
        "Time day 1 12:00; phase=day, night=false. Inventory: rations=1, herbs=1, supplies=1, tool=none. "
        "Sleeping=false; rest so far=0 game minutes. Town resident diagnostic_resident (general worker). "
        "Background: neutral and identical in both versions. Likes: unspecified. "
        "Hunger=20/100; fatigue=20/100; injury=0/100; loneliness=50/100; morale=60/100; "
        "greed=30/100; resentment=20/100. Cash=30 coins. Wage=5 per shift, employer cash=100. "
        "Meal price=6, stock=20. Treatment price=5. Supplies price=4, need=20/100. "
        "Partner=none. Last transaction outcome: none. Health=100/100. Combat=none. "
        "Nearby people: neutral_peer general worker; cash=30, affinity=30, trust=30, resentment=20, "
        "romance=0; partner=none; proposal to you=false. The interaction target, if needed, is neutral_peer. "
    )
    idle = ("Current action=wait, location=market. Current unit: wait for 15 game minutes. "
            "Progress: ticks=8, game minutes=15, complete=true, walking=false. Planned next=none. ")
    specs = [
        ("sociability", "action", ("social", "wait", "work"), "npc_7", "npc_27", "sociability",
         ("social",), ("wait", "work"), idle + "A peer is available for an ordinary conversation; no urgent need.",
         "The more sociable profile may prefer conversation; the reserved profile may prefer solitude or work."),
        ("empathy_after_disagreement", "action", ("social", "attack", "travel"), "npc_5", "npc_4", "empathy",
         ("social",), ("attack",), idle + "The peer broke a minor promise and has now apologized; there is no immediate threat.",
         "The compassionate profile may favor reconciliation; the honor/grievance-sensitive profile may be relatively more attracted to attack. Neither response is a correct label."),
        ("discipline_timing", "timing", ("after_current", "interrupt_now"), "npc_38", "npc_36", "discipline",
         ("after_current",), ("interrupt_now",),
         "Current action=work, location=workplace. Current unit: complete eight work ticks to earn a wage. "
         "Progress: ticks=4, game minutes=10, complete=false, walking=false. Planned next=none. "
         "For this timing-only diagnostic the same next intention is social in both versions. There is no emergency.",
         "The more disciplined profile may finish work first; the less disciplined profile may be more attracted to interruption."),
    ]
    if full_candidates:
        spec = specs[0]
        specs.append(("sociability_full_candidates", spec[1], None, *spec[3:]))
    pairs = []
    for name, qid, choices, high_id, low_id, trait, high_expected, low_expected, situation, expectation in specs:
        question = copy.deepcopy(reference["questions"][qid])
        if choices is not None:
            assert set(choices) <= question["criteria"].keys()
            question["criteria"] = {k: v for k, v in question["criteria"].items() if k in choices}
        pair = {"scenario": name, "synthetic": True, "question_id": qid, "relevant_trait": trait,
                "shared_physical_state": neutral + situation, "authored_expected_tendencies": expectation,
                "candidate_scope": "full production question" if choices is None else "diagnostic subset of production question",
                "variants": [], "comparison": None}
        for side, profile_id, expected in (("high", high_id, high_expected), ("low", low_id, low_expected)):
            profile = copy.deepcopy(profiles[profile_id])
            value = next(t["value"] for t in profile["identity"]["traits"] if t["id"] == trait)
            pair["variants"].append({**profile, "side": side, "relevant_trait_value": value,
                "authored_expected_preferred_choices": list(expected),
                "input": {"id": "diagnostic_resident", "state": profile["description"] + pair["shared_physical_state"],
                          "questions": {qid: copy.deepcopy(question)}},
                "token_paths": None, "prediction": None})
        pairs.append(pair)
    return pairs


def compare(high, low):
    assert high.keys() == low.keys()
    for distribution in (high, low):
        assert all(math.isfinite(p) and 0 <= p <= 1 for p in distribution.values())
        assert math.isclose(math.fsum(distribution.values()), 1, abs_tol=1e-5)
    return {"total_variation_distance": math.fsum(abs(high[k] - low[k]) for k in high) / 2,
            "probability_high_minus_low": {k: high[k] - low[k] for k in high},
            "argmax_changed": max(high, key=high.get) != max(low, key=low.get)}


def self_check(pairs):
    assert compare({"a": .75, "b": .25}, {"a": .25, "b": .75})["total_variation_distance"] == .5
    assert compare({"a": 1., "b": 0.}, {"a": 1., "b": 0.})["total_variation_distance"] == 0
    for pair in pairs:
        high, low = pair["variants"]
        assert high["relevant_trait_value"] > low["relevant_trait_value"]
        assert high["description"] != low["description"]
        assert high["input"]["id"] == low["input"]["id"] == "diagnostic_resident"
        assert high["input"]["questions"] == low["input"]["questions"]
        for variant in (high, low):
            assert variant["input"]["state"].removeprefix(variant["description"]) == pair["shared_physical_state"]
            assert set(variant["authored_expected_preferred_choices"]) <= variant["input"]["questions"][pair["question_id"]]["criteria"].keys()
            assert variant["profile_id"] not in variant["input"]["state"], "Profile IDs must not enter the model input"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tokens", action="store_true", help="Local tokenizer only; no weights or CUDA model")
    parser.add_argument("--model", action="store_true", help="Explicit real CUDA inference; arrange GPU capacity before running")
    parser.add_argument("--full-candidates", action="store_true", help="Add one full production action candidate contrast")
    args = parser.parse_args()
    profiles, reference, command = production_inputs()
    pairs = scenarios(profiles, reference, args.full_candidates)
    self_check(pairs)
    checkpoint = REPO / "checkpoints/NanoJev"
    report = {"schema": "personality-behavior-audit-v1", "created_at": datetime.now(timezone.utc).isoformat(),
        "mode": "model" if args.model else "tokenizer" if args.tokens else "self_check",
        "model_ran": False, "submitted_to_town": False, "self_check_passed": True,
        "limitations": ["Navigation-trained checkpoint; profile sensitivity does not establish believable personality.",
                        "Whole authored profiles are swapped, not single traits: causal attribution to one trait is not supported.",
                        "Synthetic fixed scenarios; expected tendencies are authored hypotheses, not guaranteed correct labels.",
                        "Argmax is descriptive; the live worker samples distributions. No town decisions are submitted."],
        "production_source": {"command": command, "luau_sha256": hashlib.sha256((PROJECT / "scripts/main.luau").read_bytes()).hexdigest(),
                              "reference_request": reference},
        "checkpoint": {"directory": str(checkpoint), "sha256": None},
        "settings": {"max_length": LIMIT, "precision": "bf16", "batch_questions": 1, "temperature": 1.0},
        "pairs": pairs}
    if args.tokens or args.model:
        if Path(sys.prefix).resolve() != (REPO / ".venv-town").resolve():
            parser.error("Use NanoJev/.venv-town/Scripts/python.exe for --tokens or --model")
        sys.path.insert(0, str(REPO / "scripts"))
        from transformers import AutoTokenizer
        from predict_toy_decisions import prepare_examples
        tokenizer = AutoTokenizer.from_pretrained(str(checkpoint / "tokenizer"), local_files_only=True, trust_remote_code=False)
        for pair in pairs:
            for variant in pair["variants"]:
                example, = prepare_examples({"states": [variant["input"]]}, tokenizer, LIMIT)
                variant["token_paths"] = dict(zip(example["candidate_ids"], map(len, example["leaf_tokens"])))
        report["tokenizer_passed"] = True
        report["max_tokens"] = max(n for p in pairs for v in p["variants"] for n in v["token_paths"].values())
    if args.model:
        import torch
        from predict_toy_decisions import DecisionPredictor
        torch.set_num_threads(2)
        with (checkpoint / "best.safetensors").open("rb") as weights:
            report["checkpoint"]["sha256"] = hashlib.file_digest(weights, "sha256").hexdigest()
        model = DecisionPredictor(checkpoint, max_length=LIMIT, precision="bf16")
        for pair in pairs:
            for variant in pair["variants"]:
                result = model.predict({"states": [variant["input"]]}, batch_questions=1)
                assert result["states"][0]["id"] == variant["input"]["id"]
                variant["prediction"] = result
            high, low = pair["variants"]
            distributions = [v["prediction"]["states"][0]["answers"][pair["question_id"]]["probabilities"] for v in (high, low)]
            for variant, distribution in zip((high, low), distributions):
                assert distribution.keys() == variant["input"]["questions"][pair["question_id"]]["criteria"].keys()
            pair["comparison"] = compare(*distributions)
            pair["comparison"]["authored_tendency_mass_high_minus_low"] = {
                v["side"]: math.fsum(distributions[0][c] - distributions[1][c] for c in v["authored_expected_preferred_choices"])
                for v in (high, low)}
        report["model_ran"] = True
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(REPORT), "mode": report["mode"], "pairs": len(pairs),
                      "self_check_passed": True, "model_ran": report["model_ran"],
                      "max_tokens": report.get("max_tokens")}, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
