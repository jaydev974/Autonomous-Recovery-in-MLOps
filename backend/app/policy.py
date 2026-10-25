from typing import Any


CATALOG = {
    "high_drift": {"action_id": "compare_baseline", "label": "Compare with baseline", "risk": "low", "approval_required": True,
                    "reversible": True, "rationale": "Review drift evidence against a baseline before considering retraining.", "field": None},
    "missing_data": {"action_id": "quarantine_batch", "label": "Quarantine batch (simulation)", "risk": "medium", "approval_required": True,
                      "reversible": True, "rationale": "Isolate the incomplete batch from the simulated pipeline state.", "field": "data_quality_missing_rate"},
    "schema_invalid": {"action_id": "quarantine_batch", "label": "Quarantine batch (simulation)", "risk": "high", "approval_required": True,
                        "reversible": True, "rationale": "Keep schema-invalid input out of the simulated pipeline; human review is mandatory.", "field": "quarantined"},
    "high_latency": {"action_id": "compare_baseline", "label": "Compare with baseline", "risk": "low", "approval_required": True,
                      "reversible": True, "rationale": "Compare this synthetic latency signal with a baseline; no infrastructure is changed.", "field": None},
    "training_failed": {"action_id": "retain_previous_model", "label": "Select previous model version (simulation)", "risk": "high", "approval_required": True,
                         "reversible": True, "rationale": "Use a prior version only in the local overlay; human review is mandatory.", "field": "training_success"},
}


def recommendation(alerts: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not alerts:
        return None
    # Prefer high-impact categories first so the human-review gate is never hidden.
    priority = {"schema_invalid": 0, "training_failed": 1, "missing_data": 2, "high_latency": 3, "high_drift": 4}
    primary = min(alerts, key=lambda item: priority[item["rule_id"]])
    policy = CATALOG[primary["rule_id"]].copy()
    policy["triggered_by"] = primary["rule_id"]
    policy["evidence"] = primary["observed_value"]
    policy["mode"] = "recommend-only"
    policy["simulated"] = True
    return policy


def approveable(action_id: str, approval: bool) -> bool:
    return action_id in {item["action_id"] for item in CATALOG.values()} and approval