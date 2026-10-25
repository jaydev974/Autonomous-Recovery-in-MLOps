import json
import sqlite3
from pathlib import Path
from typing import Any

from .config import settings


def connect(path: Path | None = None) -> sqlite3.Connection:
    db_path = path or settings.audit_db
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def init_db(path: Path | None = None) -> None:
    with connect(path) as db:
        db.execute("CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, run_id TEXT, event_type TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 1, details TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS actions (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, run_id TEXT NOT NULL, action_id TEXT NOT NULL, status TEXT NOT NULL, prior_state TEXT NOT NULL, current_state TEXT NOT NULL, details TEXT NOT NULL)")


def log_event(event_type: str, details: dict[str, Any], run_id: str | None = None) -> None:
    with connect() as db:
        db.execute("INSERT INTO audit(run_id,event_type,details) VALUES(?,?,?)", (run_id, event_type, json.dumps(details)))


def add_action(run_id: str, action_id: str, status: str, prior: dict[str, Any], current: dict[str, Any], details: dict[str, Any]) -> int:
    with connect() as db:
        cursor = db.execute("INSERT INTO actions(run_id,action_id,status,prior_state,current_state,details) VALUES(?,?,?,?,?,?)",
                            (run_id, action_id, status, json.dumps(prior), json.dumps(current), json.dumps(details)))
        action_row_id = cursor.lastrowid
    return int(action_row_id)


def update_action(action_row_id: int, status: str, current: dict[str, Any], details: dict[str, Any]) -> None:
    with connect() as db:
        db.execute("UPDATE actions SET status=?,current_state=?,details=? WHERE id=?",
                   (status, json.dumps(current), json.dumps(details), action_row_id))


def get_action(action_row_id: int) -> dict[str, Any] | None:
    with connect() as db:
        row = db.execute("SELECT * FROM actions WHERE id=?", (action_row_id,)).fetchone()
    if row is None:
        return None
    result = dict(row)
    for field in ("prior_state", "current_state", "details"):
        result[field] = json.loads(result[field])
    return result


def get_audit(limit: int = 500) -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [{**dict(row), "details": json.loads(row["details"])} for row in rows]


def get_actions(limit: int = 200) -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute("SELECT * FROM actions ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [{**dict(row), "prior_state": json.loads(row["prior_state"]), "current_state": json.loads(row["current_state"]), "details": json.loads(row["details"])} for row in rows]


def reset_actions() -> int:
    with connect() as db:
        count = db.execute("SELECT COUNT(*) FROM actions").fetchone()[0]
        db.execute("DELETE FROM actions")
    return count