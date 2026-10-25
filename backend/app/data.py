from functools import lru_cache
from io import BytesIO
from typing import Any

import pandas as pd

from .config import settings


REQUIRED_COLUMNS = [
    "run_id", "timestamp", "source_dataset", "source_period", "crime_domain_context",
    "crime_records_in_daily_domain_batch", "model_name", "model_version",
    "data_quality_missing_rate", "schema_valid", "feature_drift_score", "validation_f1",
    "pipeline_latency_ms", "training_success", "incident_type", "incident_label",
    "incident_id", "root_cause", "recommended_action", "action_risk", "action_approved",
    "recovery_validation_passed", "simulation_status", "data_provenance",
]
BOOLEAN_COLUMNS = {"schema_valid", "training_success", "action_approved", "recovery_validation_passed"}
NUMERIC_COLUMNS = {
    "source_period", "crime_records_in_daily_domain_batch", "data_quality_missing_rate",
    "feature_drift_score", "validation_f1", "pipeline_latency_ms", "incident_label",
}


class DatasetError(ValueError):
    pass


def load_frame(path=None) -> pd.DataFrame:
    source = path or settings.telemetry_csv
    if not source.exists():
        raise DatasetError(f"Telemetry CSV not found at {source}. Set ML_TELEMETRY_CSV to the supplied dataset path.")
    try:
        frame = pd.read_csv(source)
    except Exception as exc:
        raise DatasetError(f"Could not read telemetry CSV: {exc}") from exc
    return validate_frame(frame)


def parse_csv_bytes(content: bytes) -> pd.DataFrame:
    try:
        frame = pd.read_csv(BytesIO(content))
    except Exception as exc:
        raise DatasetError(f"Could not read uploaded CSV: {exc}") from exc
    return validate_frame(frame)


def validate_frame(frame: pd.DataFrame) -> pd.DataFrame:
    missing = sorted(set(REQUIRED_COLUMNS) - set(frame.columns))
    unexpected = sorted(set(frame.columns) - set(REQUIRED_COLUMNS))
    if missing:
        raise DatasetError(f"Telemetry CSV is missing required columns: {', '.join(missing)}")
    if unexpected:
        raise DatasetError(f"Telemetry CSV has unexpected columns: {', '.join(unexpected)}")
    if frame.empty:
        raise DatasetError("Telemetry CSV contains no records.")
    if frame[REQUIRED_COLUMNS].isna().drop(columns=["incident_id"]).any().any():
        raise DatasetError("Telemetry CSV contains blank values in required fields (incident_id may be blank).")
    for column in NUMERIC_COLUMNS:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
        if frame[column].isna().any():
            raise DatasetError(f"Column {column} contains non-numeric values.")
    for column in BOOLEAN_COLUMNS:
        values = frame[column].astype(str).str.lower()
        if not values.isin({"true", "false"}).all():
            raise DatasetError(f"Column {column} must contain only true/false values.")
        frame[column] = values.eq("true")
    parsed = pd.to_datetime(frame["timestamp"], errors="coerce", utc=True)
    if parsed.isna().any():
        raise DatasetError("Column timestamp contains invalid datetime values.")
    frame["timestamp"] = parsed.dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    if frame["run_id"].duplicated().any():
        raise DatasetError("Column run_id must contain unique values.")
    return frame


@lru_cache(maxsize=1)
def get_frame() -> pd.DataFrame:
    return load_frame()


def record_dict(row: pd.Series | dict[str, Any]) -> dict[str, Any]:
    result = dict(row)
    for key, value in result.items():
        if pd.isna(value):
            result[key] = None
        elif hasattr(value, "item"):
            result[key] = value.item()
    return result