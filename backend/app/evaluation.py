from typing import Any


def evaluate(records: list[dict[str, Any]]) -> dict[str, Any]:
    actual = [int(record["incident_label"]) == 1 for record in records]
    predicted = [bool(record["detected"]) for record in records]
    tp = sum(a and p for a, p in zip(actual, predicted))
    tn = sum(not a and not p for a, p in zip(actual, predicted))
    fp = sum(not a and p for a, p in zip(actual, predicted))
    fn = sum(a and not p for a, p in zip(actual, predicted))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    fpr = fp / (fp + tn) if fp + tn else 0.0
    fnr = fn / (fn + tp) if fn + tp else 0.0
    return {"title": "Prototype evaluation against simulated scenario labels", "confusion_matrix": {"true_positive": tp, "false_positive": fp, "true_negative": tn, "false_negative": fn},
            "precision": precision, "recall": recall, "f1": f1, "false_positive_rate": fpr, "false_negative_rate": fnr,
            "sample_count": len(records), "limitations": ["Scenario labels and operational measurements are synthetic.",
            "Rule thresholds may overfit these scenarios; overlapping values can cause false positives.",
            "No independent causal ground truth is available; these metrics are not production performance claims."],
            "detection_time": None, "simulated_recovery_time": None,
            "time_note": "No event-arrival or action-duration timestamps are available; detection/recovery times are not derivable from the CSV."}