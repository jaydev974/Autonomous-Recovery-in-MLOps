from typing import Any

from . import database
from .detection import Thresholds, detect
from .policy import CATALOG, approveable


OVERLAYS: dict[str, dict[str, Any]] = {}
INJECTIONS: dict[str, dict[str, Any]] = {}


def simulated_record(base: dict[str, Any]) -> dict[str, Any]:
    return {**base, **OVERLAYS.get(base["run_id"], {}), **INJECTIONS.get(base["run_id"], {})}


def execute(base: dict[str, Any], action_id: str, human_approved: bool, thresholds: Thresholds) -> dict[str, Any]:
    if not human_approved or not approveable(action_id, human_approved):
        raise PermissionError("Explicit user approval is required for every simulated action.")
    if action_id not in {entry["action_id"] for entry in CATALOG.values()}:
        raise ValueError("Action is not in the allowlisted catalog.")
    run_id = base["run_id"]
    before = OVERLAYS.get(run_id, {}).copy()
    prior_record = simulated_record(base)
    matched = next((item for item in CATALOG.values() if item["action_id"] == action_id), None)
    changed = before.copy()
    if action_id == "quarantine_batch":
        changed["quarantined"] = True
    elif action_id == "retain_previous_model":
        changed["training_success"] = True
        changed["model_version"] = f"{base['model_version']} (simulated previous)"
    # Baseline comparison is advisory only; it intentionally cannot clear an alert.
    OVERLAYS[run_id] = changed
    after_record = simulated_record(base)
    remaining = detect(after_record, thresholds)
    if changed.get("quarantined"):
        remaining = [alert for alert in remaining if alert["rule_id"] != "schema_invalid"]
        remaining = [alert for alert in remaining if alert["rule_id"] != "missing_data"]
    validation_passed = len(remaining) < len(detect(prior_record, thresholds))
    status = "validated" if validation_passed else "rolled_back_escalated"
    if not validation_passed:
        if before:
            OVERLAYS[run_id] = before
        else:
            OVERLAYS.pop(run_id, None)
        after_record = simulated_record(base)
    details = {"label": "SIMULATED", "human_approved": True, "pre_action_alerts": detect(prior_record, thresholds),
               "post_action_alerts": remaining, "validation_passed": validation_passed,
               "escalated": not validation_passed}
    row_id = database.add_action(run_id, action_id, status, before, OVERLAYS.get(run_id, {}).copy(), details)
    database.log_event("approval", {"action_id": action_id, "explicit_user_approval": True, "simulated": True}, run_id)
    database.log_event("execution", {"action_id": action_id, "action_row_id": row_id, "simulated": True}, run_id)
    database.log_event("validation", {"passed": validation_passed, "remaining_alerts": remaining, "simulated": True}, run_id)
    if not validation_passed:
        database.log_event("rollback", {"reason": "Post-action validation failed; prior overlay restored.", "simulated": True}, run_id)
        database.log_event("escalation", {"reason": "Simulated action did not resolve the triggering alert.", "simulated": True}, run_id)
    return {"action_row_id": row_id, "run_id": run_id, "action_id": action_id, "status": status,
            "validation_passed": validation_passed, "pre_action": prior_record, "post_action": after_record,
            "remaining_alerts": remaining, "simulated": True}


def rollback(action_row_id: int) -> dict[str, Any]:
    action = database.get_action(action_row_id)
    if action is None:
        raise LookupError("Action history record not found.")
    run_id = action["run_id"]
    prior = action["prior_state"]
    if prior:
        OVERLAYS[run_id] = prior
    else:
        OVERLAYS.pop(run_id, None)
    database.update_action(action_row_id, "rolled_back", prior, {"label": "SIMULATED", "rolled_back_by_user": True})
    database.log_event("rollback", {"action_row_id": action_row_id, "simulated": True}, run_id)
    return {"action_row_id": action_row_id, "run_id": run_id, "state": OVERLAYS.get(run_id, {}), "simulated": True}