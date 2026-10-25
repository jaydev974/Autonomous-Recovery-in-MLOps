import csv
import io
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from . import database
from .config import settings
from .data import DatasetError, get_frame, parse_csv_bytes, record_dict
from .detection import Thresholds, detect, thresholds_from_dict
from .evaluation import evaluate
from .policy import recommendation
from .rca import diagnose
from .simulation import INJECTIONS, OVERLAYS, execute, rollback, simulated_record


app = FastAPI(title="Autonomous Recovery in MLOps", version="1.0.0", description="Local prototype using simulated telemetry scenarios. No real infrastructure actions.")
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
database.init_db()
thresholds = Thresholds()
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class ThresholdBody(BaseModel):
    drift_score: float = Field(ge=0.001, le=1)
    missing_rate: float = Field(ge=0, le=1)
    latency_ms: float = Field(gt=0, le=60000)


class ActionBody(BaseModel):
    action_id: str
    human_approved: bool


class ResetBody(BaseModel):
    confirmed: bool


class InjectBody(BaseModel):
    scenario: str


class CreateRunBody(BaseModel):
    timestamp: datetime | None = None
    crime_domain_context: str = Field(default="Other Crime", min_length=1, max_length=120)
    crime_records_in_daily_domain_batch: int = Field(default=0, ge=0, le=100000000)
    model_name: str = Field(default="ManualDemoModel", min_length=1, max_length=120)
    model_version: str = Field(default="v1", min_length=1, max_length=40)
    data_quality_missing_rate: float = Field(default=0, ge=0, le=1)
    schema_valid: bool = True
    feature_drift_score: float = Field(default=0, ge=0, le=1)
    validation_f1: float = Field(default=0.5, ge=0, le=1)
    pipeline_latency_ms: float = Field(default=500, ge=0, le=3600000)
    training_success: bool = True
    incident_type: Literal["normal", "data_drift", "missing_data", "schema_error", "high_latency", "training_failure"] = "normal"

    @field_validator("crime_domain_context", "model_name", "model_version")
    @classmethod
    def require_nonblank_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value must contain at least one non-whitespace character.")
        return value


def base_records() -> list[dict[str, Any]]:
    try:
        source_records = [record_dict(row) for _, row in get_frame().iterrows()]
        return source_records + database.get_telemetry_runs()
    except DatasetError:
        raise


def filtered_records(records: list[dict[str, Any]], start_date: str | None = None, end_date: str | None = None,
                     incident_type: str | None = None, simulation_status: str | None = None,
                     model_version: str | None = None, crime_domain_context: str | None = None) -> list[dict[str, Any]]:
    result = records
    if start_date:
        result = [row for row in result if row["timestamp"][:10] >= start_date]
    if end_date:
        result = [row for row in result if row["timestamp"][:10] <= end_date]
    for key, value in (("incident_type", incident_type), ("simulation_status", simulation_status),
                       ("model_version", model_version), ("crime_domain_context", crime_domain_context)):
        if value:
            result = [row for row in result if str(row[key]).lower() == value.lower()]
    return result


def enrich(record: dict[str, Any], audit: bool = False) -> dict[str, Any]:
    live = simulated_record(record)
    observed_alerts = detect(live, thresholds)
    alerts = [] if live.get("quarantined") else observed_alerts
    if audit:
        database.log_event("detection", {"alerts": alerts, "detector_output_separate_from_label": True}, record["run_id"])
    diagnoses = diagnose(live, alerts)
    if audit and diagnoses:
        database.log_event("diagnosis", {"diagnoses": diagnoses}, record["run_id"])
    proposal = recommendation(alerts)
    if audit and proposal:
        database.log_event("recommendation", proposal, record["run_id"])
    return {**live, "alerts": alerts, "contained_alerts": observed_alerts if live.get("quarantined") else [], "diagnoses": diagnoses, "recommendation": proposal,
            "detected": bool(alerts), "ground_truth_incident_label": record["incident_label"],
            "overlay": OVERLAYS.get(record["run_id"], {}), "simulated": True}


def dataset_or_503():
    try:
        return base_records()
    except DatasetError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/health")
def health():
    try:
        rows = base_records()
        return {"status": "ok", "dataset": "available", "rows": len(rows), "simulated": True}
    except DatasetError as exc:
        return {"status": "degraded", "dataset": "unavailable", "error": str(exc), "simulated": True}


@app.get("/api/metadata")
def metadata():
    records = dataset_or_503()
    return {"title": "Autonomous Recovery in MLOps", "rows": len(records), "source_rows": len(get_frame()),
            "user_added_rows": len(records) - len(get_frame()), "columns": list(records[0]),
            "incident_types": sorted({row["incident_type"] for row in records}),
            "simulation_statuses": sorted({row["simulation_status"] for row in records}),
            "model_versions": sorted({row["model_version"] for row in records}),
            "crime_domain_contexts": sorted({row["crime_domain_context"] for row in records}),
            "date_min": min(row["timestamp"] for row in records), "date_max": max(row["timestamp"] for row in records),
            "thresholds": thresholds.to_dict(), "source_is_immutable": True, "simulated": True}


def filters(start_date, end_date, incident_type, simulation_status, model_version, crime_domain_context):
    return filtered_records(dataset_or_503(), start_date, end_date, incident_type, simulation_status, model_version, crime_domain_context)


@app.get("/api/dashboard")
def dashboard(start_date: str | None = None, end_date: str | None = None, incident_type: str | None = None,
              simulation_status: str | None = None, model_version: str | None = None, crime_domain_context: str | None = None):
    records = filters(start_date, end_date, incident_type, simulation_status, model_version, crime_domain_context)
    enriched = [enrich(row) for row in records]
    normal = sum(row["incident_label"] == 0 for row in records)
    fault = len(records) - normal
    alert_count = sum(len(row["alerts"]) for row in enriched)
    outcomes = [action for action in database.get_actions() if action["run_id"] in {r["run_id"] for r in records} and action["status"] in {"validated", "rolled_back_escalated"}]
    valid_outcomes = sum(action["status"] == "validated" for action in outcomes)
    return {"summary": {"total_runs": len(records), "normal_runs": normal, "simulated_fault_runs": fault,
                        "alert_count": alert_count, "simulated_recovery_success_rate": valid_outcomes / len(outcomes) if outcomes else None,
                        "average_f1": sum(row["validation_f1"] for row in records) / len(records) if records else None,
                        "median_latency_ms": __import__("statistics").median(row["pipeline_latency_ms"] for row in records) if records else None},
            "timeline": [{"run_id": row["run_id"], "timestamp": row["timestamp"], "validation_f1": row["validation_f1"],
                          "feature_drift_score": row["feature_drift_score"], "data_quality_missing_rate": row["data_quality_missing_rate"],
                          "pipeline_latency_ms": row["pipeline_latency_ms"], "incident_type": row["incident_type"],
                          "detected": row["detected"], "incident_label": row["incident_label"]} for row in enriched],
            "fault_breakdown": [{"incident_type": label, "count": count} for label, count in
                                sorted(__import__("collections").Counter(row["incident_type"] for row in records if row["incident_label"] == 1).items())],
            "thresholds": thresholds.to_dict(), "simulated": True}


@app.get("/api/runs")
def runs(search: str | None = None, sort_by: str = "timestamp", order: str = "desc", offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=2000),
         start_date: str | None = None, end_date: str | None = None, incident_type: str | None = None,
         simulation_status: str | None = None, model_version: str | None = None, crime_domain_context: str | None = None):
    records = filters(start_date, end_date, incident_type, simulation_status, model_version, crime_domain_context)
    if search:
        term = search.lower()
        records = [row for row in records if any(term in str(row[field]).lower() for field in ["run_id", "incident_type", "root_cause", "model_version", "crime_domain_context"])]
    if sort_by not in records[0] if records else False:
        raise HTTPException(status_code=400, detail="Unsupported sort field.")
    records.sort(key=lambda row: (row[sort_by] is None, row[sort_by]), reverse=order.lower() != "asc")
    return {"total": len(records), "items": [enrich(row) for row in records[offset:offset + limit]], "offset": offset, "limit": limit, "simulated": True}


@app.post("/api/runs", status_code=201)
def create_run(body: CreateRunBody):
    timestamp = body.timestamp or datetime.now(timezone.utc)
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    timestamp_text = timestamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    fault_metadata = {
        "normal": ("none_detected", "continue_monitoring", "low"),
        "data_drift": ("feature_distribution_shift", "compare_with_baseline_and_request_retraining_review", "medium"),
        "missing_data": ("upstream_data_completeness_issue", "quarantine_bad_batch_for_review", "medium"),
        "schema_error": ("required_schema_validation_failed", "stop_run_and_validate_input_schema", "high"),
        "high_latency": ("pipeline_processing_delay", "compare_pipeline_latency_with_baseline", "low"),
        "training_failure": ("training_job_failed", "retain_previous_model_and_review_job_logs", "high"),
    }
    root_cause, action, risk = fault_metadata[body.incident_type]
    record = {
        "run_id": f"local_{uuid4().hex[:12]}",
        "timestamp": timestamp_text,
        "source_dataset": "user_entered_demo",
        "source_period": timestamp.year,
        "crime_domain_context": body.crime_domain_context.strip(),
        "crime_records_in_daily_domain_batch": body.crime_records_in_daily_domain_batch,
        "model_name": body.model_name.strip(),
        "model_version": body.model_version.strip(),
        "data_quality_missing_rate": body.data_quality_missing_rate,
        "schema_valid": body.schema_valid,
        "feature_drift_score": body.feature_drift_score,
        "validation_f1": body.validation_f1,
        "pipeline_latency_ms": body.pipeline_latency_ms,
        "training_success": body.training_success,
        "incident_type": body.incident_type,
        "incident_label": int(body.incident_type != "normal"),
        "incident_id": None,
        "root_cause": root_cause,
        "recommended_action": action,
        "action_risk": risk,
        "action_approved": False,
        "recovery_validation_passed": None,
        "simulation_status": "SIMULATED_USER_ADDED",
        "data_provenance": "user-entered synthetic demo telemetry; persisted locally; not production data",
    }
    try:
        database.add_telemetry_run(record)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Could not save run: {exc}") from exc
    database.log_event("telemetry_run_added", {"simulation_status": "SIMULATED_USER_ADDED", "source_csv_modified": False}, record["run_id"])
    return enrich(record)


@app.post("/api/runs/import-csv", status_code=201)
async def import_runs_csv(file: UploadFile = File(...)):
    filename = (file.filename or "").lower()
    if not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a .csv file.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="CSV upload exceeds the 10 MB limit.")
    try:
        frame = parse_csv_bytes(content)
    except DatasetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    records = [record_dict(row) for _, row in frame.iterrows()]
    run_ids = [record["run_id"] for record in records]
    existing_source_ids = set(get_frame()["run_id"].astype(str))
    local_duplicates = database.existing_telemetry_run_ids(run_ids)
    duplicate_ids = sorted((set(run_ids) & existing_source_ids) | local_duplicates)
    if duplicate_ids:
        preview = ", ".join(duplicate_ids[:5])
        suffix = "..." if len(duplicate_ids) > 5 else ""
        raise HTTPException(status_code=409, detail=f"CSV contains run IDs already in the system: {preview}{suffix}. No rows were imported.")

    for record in records:
        record["simulation_status"] = "SIMULATED_CSV_UPLOAD"
        record["data_provenance"] = f"{record['data_provenance']}; uploaded CSV; treated as simulated demo telemetry; source CSV unchanged"
    try:
        database.add_telemetry_runs(records)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Could not import CSV transaction: {exc}") from exc
    database.log_event("telemetry_csv_imported", {
        "filename": file.filename,
        "imported_count": len(records),
        "simulation_status": "SIMULATED_CSV_UPLOAD",
        "source_csv_modified": False,
    })
    return {"imported_count": len(records), "run_ids": run_ids, "simulation_status": "SIMULATED_CSV_UPLOAD",
            "source_csv_modified": False, "message": f"Imported {len(records)} synthetic scenario records into local SQLite."}


@app.get("/api/runs/{run_id}")
def run_detail(run_id: str):
    row = next((item for item in dataset_or_503() if item["run_id"] == run_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found.")
    return enrich(row, audit=True)


@app.get("/api/alerts")
def alerts(limit: int = Query(500, ge=1, le=2000)):
    result = []
    for row in dataset_or_503():
        result.extend(enrich(row)["alerts"])
    return {"total": len(result), "items": result[:limit], "simulated": True}


@app.get("/api/rules")
def get_rules():
    return {"thresholds": thresholds.to_dict(), "rules": [
        {"rule_id": "high_drift", "field": "feature_drift_score", "operator": ">", "threshold": thresholds.drift_score},
        {"rule_id": "missing_data", "field": "data_quality_missing_rate", "operator": ">", "threshold": thresholds.missing_rate},
        {"rule_id": "schema_invalid", "field": "schema_valid", "operator": "is false", "threshold": False},
        {"rule_id": "high_latency", "field": "pipeline_latency_ms", "operator": ">", "threshold": thresholds.latency_ms},
        {"rule_id": "training_failed", "field": "training_success", "operator": "is false", "threshold": False}], "simulated": True}


@app.put("/api/rules")
def set_rules(body: ThresholdBody):
    global thresholds
    thresholds = thresholds_from_dict(body.model_dump())
    database.log_event("rule_configuration", {"thresholds": thresholds.to_dict(), "simulated": True})
    return get_rules()


@app.post("/api/runs/{run_id}/simulate")
def simulate(run_id: str, body: ActionBody):
    row = next((item for item in dataset_or_503() if item["run_id"] == run_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found.")
    if not body.human_approved:
        raise HTTPException(status_code=403, detail="Explicit user approval is required. High-risk actions require human review.")
    proposed = recommendation(detect(simulated_record(row), thresholds))
    if proposed is None or proposed["action_id"] != body.action_id:
        raise HTTPException(status_code=409, detail="Action does not match the current allowlisted recommendation for this run.")
    try:
        return execute(row, body.action_id, body.human_approved, thresholds)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/runs/{run_id}/inject")
def inject_scenario(run_id: str, body: InjectBody):
    row = next((item for item in dataset_or_503() if item["run_id"] == run_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found.")
    if body.scenario not in {"data_drift", "missing_data", "schema_error", "high_latency", "training_failure"}:
        raise HTTPException(status_code=400, detail="Unsupported scenario. Choose one of the five allowlisted fault types.")
    overlay = {}
    if body.scenario == "data_drift":
        overlay["feature_drift_score"] = max(row["feature_drift_score"], thresholds.drift_score + 0.01)
    elif body.scenario == "missing_data":
        overlay["data_quality_missing_rate"] = max(row["data_quality_missing_rate"], thresholds.missing_rate + 0.01)
    elif body.scenario == "schema_error":
        overlay["schema_valid"] = False
    elif body.scenario == "high_latency":
        overlay["pipeline_latency_ms"] = max(row["pipeline_latency_ms"], thresholds.latency_ms + 1)
    elif body.scenario == "training_failure":
        overlay["training_success"] = False
    INJECTIONS[run_id] = overlay
    database.log_event("fault_injection", {"scenario": body.scenario, "in_memory_copy_only": True, "simulated": True}, run_id)
    return {"run_id": run_id, "scenario": body.scenario, "record": enrich(row), "simulated": True}


@app.post("/api/actions/{action_row_id}/rollback")
def undo(action_row_id: int):
    try:
        return rollback(action_row_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/simulation/reset")
def reset_simulation(body: ResetBody):
    if not body.confirmed:
        raise HTTPException(status_code=400, detail="Reset requires explicit confirmation.")
    OVERLAYS.clear()
    INJECTIONS.clear()
    count = database.reset_actions()
    database.log_event("reset", {"removed_action_records": count, "simulated": True})
    return {"reset": True, "removed_action_records": count, "simulated": True}


@app.get("/api/evaluation")
def evaluation(start_date: str | None = None, end_date: str | None = None, incident_type: str | None = None,
               simulation_status: str | None = None, model_version: str | None = None, crime_domain_context: str | None = None):
    records = [{**row, "detected": bool(detect(row, thresholds))} for row in filters(start_date, end_date, incident_type, simulation_status, model_version, crime_domain_context)]
    return evaluate(records)


@app.get("/api/audit")
def audit(limit: int = Query(500, ge=1, le=2000)):
    return {"items": database.get_audit(limit), "total": len(database.get_audit(limit)), "simulated": True}


@app.get("/api/actions")
def actions(limit: int = Query(200, ge=1, le=1000)):
    return {"items": database.get_actions(limit), "simulated": True}


@app.get("/api/export/runs.csv")
def export_runs(start_date: str | None = None, end_date: str | None = None, incident_type: str | None = None,
                simulation_status: str | None = None, model_version: str | None = None, crime_domain_context: str | None = None):
    records = [enrich(row) for row in filters(start_date, end_date, incident_type, simulation_status, model_version, crime_domain_context)]
    buffer = io.StringIO()
    fields = list(records[0]) if records else ["run_id"]
    writer = csv.DictWriter(buffer, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(records)
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=simulated_filtered_runs.csv"})


@app.get("/api/export/audit.json")
def export_audit():
    return {"label": "SIMULATED audit history", "items": database.get_audit(2000), "actions": database.get_actions(1000)}