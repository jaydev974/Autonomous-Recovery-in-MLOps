from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class Thresholds:
    drift_score: float = 0.35
    missing_rate: float = 0.10
    latency_ms: float = 2000.0

    def validate(self) -> "Thresholds":
        if not 0 < self.drift_score <= 1:
            raise ValueError("Drift threshold must be between 0 and 1.")
        if not 0 <= self.missing_rate <= 1:
            raise ValueError("Missing-rate threshold must be between 0 and 1.")
        if not 0 < self.latency_ms <= 60000:
            raise ValueError("Latency threshold must be between 0 and 60000 ms.")
        return self

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


def detect(record: dict[str, Any], thresholds: Thresholds) -> list[dict[str, Any]]:
    thresholds.validate()
    checks = [
        ("high_drift", "High feature drift", record["feature_drift_score"] > thresholds.drift_score,
         thresholds.drift_score, record["feature_drift_score"], "warning", "feature_drift_score"),
        ("missing_data", "Excessive missing data", record["data_quality_missing_rate"] > thresholds.missing_rate,
         thresholds.missing_rate, record["data_quality_missing_rate"], "critical", "data_quality_missing_rate"),
        ("schema_invalid", "Invalid schema", not record["schema_valid"], True, record["schema_valid"], "critical", "schema_valid"),
        ("high_latency", "High pipeline latency", record["pipeline_latency_ms"] > thresholds.latency_ms,
         thresholds.latency_ms, record["pipeline_latency_ms"], "warning", "pipeline_latency_ms"),
        ("training_failed", "Training failed", not record["training_success"], True, record["training_success"], "critical", "training_success"),
    ]
    return [
        {"rule_id": rule_id, "rule_name": name, "threshold": threshold, "observed_value": observed,
         "severity": severity, "evidence_field": field, "run_id": record["run_id"],
         "timestamp": record["timestamp"], "simulated": True}
        for rule_id, name, triggered, threshold, observed, severity, field in checks if triggered
    ]


def thresholds_from_dict(values: dict[str, float] | None, current: Thresholds | None = None) -> Thresholds:
    base = current or Thresholds()
    return Thresholds(
        drift_score=float(values.get("drift_score", base.drift_score)) if values else base.drift_score,
        missing_rate=float(values.get("missing_rate", base.missing_rate)) if values else base.missing_rate,
        latency_ms=float(values.get("latency_ms", base.latency_ms)) if values else base.latency_ms,
    ).validate()