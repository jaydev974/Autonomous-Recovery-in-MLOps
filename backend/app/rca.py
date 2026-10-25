from typing import Any


CAUSES = {
    "high_drift": ("Feature distribution shift", "high", "Drift score exceeds the configured rule threshold."),
    "missing_data": ("Upstream data completeness issue", "high", "Observed missing rate exceeds the configured rule threshold."),
    "schema_invalid": ("Required schema validation failed", "high", "The schema_valid field is false in this scenario record."),
    "high_latency": ("Pipeline processing delay", "medium", "Observed latency exceeds the configured rule threshold."),
    "training_failed": ("Training job failure", "high", "The training_success field is false in this scenario record."),
}


def diagnose(record: dict[str, Any], alerts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    diagnoses = []
    for alert in alerts:
        cause, confidence, rationale = CAUSES[alert["rule_id"]]
        diagnoses.append({
            "cause": cause,
            "rule_id": alert["rule_id"],
            "confidence": confidence,
            "confidence_note": "Rule-based category, not a statistically calibrated probability.",
            "rationale": rationale,
            "evidence": [{"field": alert["evidence_field"], "value": record[alert["evidence_field"]],
                          "threshold": alert["threshold"]}],
        })
    return diagnoses