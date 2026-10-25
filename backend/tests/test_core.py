import pytest
from fastapi.testclient import TestClient

from backend.app.detection import Thresholds, detect
from backend.app.evaluation import evaluate
from backend.app.policy import recommendation
from backend.app.rca import diagnose
from backend.app.simulation import INJECTIONS, OVERLAYS, execute, rollback


def sample(**overrides):
    base = {"run_id": "run_test", "timestamp": "2024-01-01T00:00:00Z", "feature_drift_score": 0.8,
            "data_quality_missing_rate": 0.01, "schema_valid": True, "pipeline_latency_ms": 300.0,
            "training_success": True, "model_version": "v1"}
    return {**base, **overrides}


def test_detector_reports_transparent_rules_and_observed_values():
    alerts = detect(sample(), Thresholds())
    assert [alert["rule_id"] for alert in alerts] == ["high_drift"]
    assert alerts[0]["observed_value"] == 0.8
    assert alerts[0]["threshold"] == 0.35
    assert alerts[0]["simulated"] is True


def test_rca_uses_evidence_and_policy_escalates_high_risk():
    record = sample(schema_valid=False)
    alerts = detect(record, Thresholds())
    diagnosis = diagnose(record, alerts)
    assert any(item["cause"] == "Required schema validation failed" for item in diagnosis)
    assert diagnosis[0]["evidence"][0]["field"] in {"feature_drift_score", "schema_valid"}
    policy = recommendation(alerts)
    assert policy["risk"] == "high"
    assert policy["approval_required"] is True


def test_action_requires_explicit_approval_and_rollback_restores_overlay(monkeypatch, tmp_path):
    from backend.app import database
    monkeypatch.setattr(database.settings, "audit_db", tmp_path / "test.sqlite3")
    database.init_db()
    OVERLAYS.clear()
    INJECTIONS.clear()
    record = sample(data_quality_missing_rate=0.4)
    with pytest.raises(PermissionError):
        execute(record, "quarantine_batch", False, Thresholds())
    result = execute(record, "quarantine_batch", True, Thresholds())
    assert result["validation_passed"] is True
    assert OVERLAYS[record["run_id"]]["quarantined"] is True
    rolled_back = rollback(result["action_row_id"])
    assert rolled_back["state"] == {}
    assert record["data_quality_missing_rate"] == 0.4


def test_failed_validation_rolls_back_and_escalates(monkeypatch, tmp_path):
    from backend.app import database
    monkeypatch.setattr(database.settings, "audit_db", tmp_path / "failed-validation.sqlite3")
    database.init_db()
    OVERLAYS.clear()
    INJECTIONS.clear()
    record = sample()
    result = execute(record, "compare_baseline", True, Thresholds())
    assert result["validation_passed"] is False
    assert result["status"] == "rolled_back_escalated"
    assert result["post_action"]["feature_drift_score"] == record["feature_drift_score"]
    assert OVERLAYS.get(record["run_id"], {}) == {}
    event_types = [event["event_type"] for event in database.get_audit(20)]
    assert "rollback" in event_types
    assert "escalation" in event_types


def test_evaluation_metrics_against_binary_scenario_labels():
    result = evaluate([{"incident_label": 1, "detected": True}, {"incident_label": 1, "detected": False},
                       {"incident_label": 0, "detected": True}, {"incident_label": 0, "detected": False}])
    assert result["confusion_matrix"] == {"true_positive": 1, "false_positive": 1, "true_negative": 1, "false_negative": 1}
    assert result["precision"] == 0.5
    assert result["recall"] == 0.5
    assert result["f1"] == 0.5
    assert result["false_positive_rate"] == 0.5
    assert result["false_negative_rate"] == 0.5
    assert result["detection_time"] is None


def test_api_injection_is_overlay_only_and_action_must_match_policy(monkeypatch, tmp_path):
    from backend.app import api, database
    monkeypatch.setattr(database.settings, "audit_db", tmp_path / "api.sqlite3")
    database.init_db()
    record = sample(feature_drift_score=0.1, data_quality_missing_rate=0.01)
    record["incident_label"] = 0
    monkeypatch.setattr(api, "dataset_or_503", lambda: [record])
    monkeypatch.setattr(api, "thresholds", Thresholds())
    OVERLAYS.clear()
    client = TestClient(api.app)

    response = client.post("/api/runs/run_test/inject", json={"scenario": "training_failure"})
    assert response.status_code == 200
    assert response.json()["record"]["training_success"] is False
    assert record["training_success"] is True
    replaced = client.post("/api/runs/run_test/inject", json={"scenario": "data_drift"})
    assert replaced.status_code == 200
    injected_record = replaced.json()["record"]
    assert injected_record["feature_drift_score"] > 0.35
    assert injected_record["training_success"] is True
    assert injected_record["schema_valid"] is True

    blocked = client.post("/api/runs/run_test/simulate", json={"action_id": "quarantine_batch", "human_approved": True})
    assert blocked.status_code == 409
    assert record["model_version"] == "v1"