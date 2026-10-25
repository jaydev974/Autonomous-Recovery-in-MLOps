# User Guide

## Purpose and safety

This application is a local college demonstration of governed recovery for ML pipelines. **It is not connected to production systems.** The supplied CSV is a telemetry/scenario dataset, not model-training data. Its operational measurements, scenario labels, diagnoses, approvals, and recovery results are synthetic. Crime-domain context and aggregate batch counts are source-derived context only; the app does not predict individual or community crime risk.

Recovery actions are simulations against reversible in-memory state. They never change the CSV, deploy a model, call an external service, or run shell commands. The default policy is **recommend-only**; the interface requires explicit approval before each simulated action.

## Start the application

The project setup is described in [README.md](README.md). If you have already installed the requirements, start two PowerShell terminals from the workspace root.

Terminal 1, start the API:

```powershell
python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Terminal 2, start the web UI:

```powershell
Set-Location frontend
npm run dev
```

Open <http://127.0.0.1:5173>. The API health check is <http://127.0.0.1:8000/api/health>; API documentation is <http://127.0.0.1:8000/docs>. If the UI says the API is unavailable, make sure both terminals are still running and check the health URL.

## Shared controls

The six navigation items are **Overview**, **Runs**, **Recovery Lab**, **Evaluation**, **Audit Log**, and **Architecture & Limitations**. A persistent notice near the top of the page identifies synthetic values and distinguishes them from source-derived context.

The filter bar is shared across data views. Use the start/end dates, incident type, scenario status, model version, and domain context to narrow displayed runs and evaluation. Choose **Clear all** to restore the full dataset. The page-level **Export filtered runs** button downloads the filtered result set as CSV.

All dates and metrics shown in the dashboard come from the supplied scenario records; the timeline is not live monitoring. The domain filter is for exploring the provided context only.

## Overview

The summary area reports total runs, normal and fault scenario counts, detector alert count, average validation F1, median latency, and recovery validation rate when actions have been run. Metric cards and charts are based on scenario data; the app labels these signals simulated.

Charts show validation F1, feature drift, missing-data rate, latency, and the fault-category mix. Hover for values. Select a chart point to open its run details. The category breakdown uses the CSV's synthetic scenario labels, not the detector's output.

## Runs

### Add a telemetry run

1. Open **Runs** and select **Add run**.
2. Enter a timestamp, scenario type, descriptive domain context, aggregate batch count, model name/version, and operational measurements. Choose the schema and training booleans.
3. Keep measurements synthetic and use aggregate context only. The form labels this restriction and validates numeric ranges before saving.
4. Select **Save simulated run**. The app assigns a `local_...` run ID, derives a synthetic binary scenario label from the selected scenario type, and writes the new record to a separate SQLite table.
5. The new run appears in the run list, charts/summary, filters, evaluation, and filtered CSV export. Its `SIMULATED_USER_ADDED` status and provenance distinguish it from the supplied CSV rows. Approval starts false and recovery validation is unknown; adding a scenario does not approve or execute a recovery action.

Adding records never changes `mlops_crime_telemetry_synthetic.csv`. User-entered records persist across API restarts in `backend/mlops_audit.sqlite3`. This is distinct from injected fault/recovery overlays, which exist only in memory and are reset when the API process restarts. The simulation reset button clears action history and overlays, not user-entered telemetry.

1. Use the search field to find a run ID, scenario type, root-cause text, model version, or domain context.
2. Use the table headers to sort supported columns. Each row shows the scenario label separately from whether the configured detector raised an alert.
3. Select a row to open its detail drawer.
4. In the drawer, inspect all 24 CSV fields, timestamp, detector rule/threshold/observed value, evidence-linked diagnosis, recommendation and risk, and the scenario label.
5. Read the provenance values carefully: operational metrics are synthetic; crime-domain and aggregate batch context are derived.

The drawer's confidence is a rule-based category, not a statistically calibrated probability. A rule-based cause is not independent causal ground truth.

## Recovery Lab

### Adjust detector rules

The lab shows the current thresholds for drift score, missing-data rate, and pipeline latency. Use the sliders and select **Apply rule settings** to apply them. The schema-invalid and training-failed boolean checks are always enabled. Thresholds are prototype choices, not validated production limits; lowering thresholds may increase false positives.

### Explore normal scenarios

Select **No-fault mode** to show runs whose CSV scenario label is normal. Detector rules still evaluate the measurements, so a normal-labeled run can have a detector alert. That disagreement is useful when discussing false positives; it is not a data error to hide.

### Inject a fault in memory

1. Choose a run in **Run for scenario injection**.
2. Choose one of `data_drift`, `missing_data`, `schema_error`, `high_latency`, or `training_failure`.
3. Select **Inject in memory**.
4. Reinspect the run and its detector evidence.

Injection changes an overlay for that run, not the source CSV. A later injection on the same run replaces its prior injected scenario. In-memory overlays are lost if the API process restarts; the audit log is stored in SQLite.

### Approve a simulated action

1. Select a detected run and inspect the recommendation, evidence, risk, and rationale.
2. Select **Review & approve** in the table or **Approve simulated action** in the run detail.
3. Read the browser confirmation, then explicitly confirm to proceed. Cancel leaves the run unchanged.
4. Return to the Recovery Lab to inspect the pre-action and post-action alert counts and validation result. Open the Audit Log to review approval, execution, and validation records.

Every action requires user approval. Schema-invalid and training-failure actions are high risk and must be treated as human-review cases. The API only accepts the current allowlisted recommendation for the selected run. Actions include advisory baseline comparison, simulated batch quarantine, and selecting a previous model version in the local overlay. Baseline comparison does not fix a signal, so validation may fail; when validation fails, the overlay is restored and the run is escalated.

### Undo or reset

- **Undo** in Action History restores the action's prior simulated overlay state. Confirm the browser prompt.
- **Reset simulation** clears all in-memory fault/recovery overlays and simulated action-history rows after confirmation. It does not change the CSV. The audit log is preserved and receives a reset event.
- Restarting the API also clears in-memory overlays; it does not remove SQLite audit history.

## Evaluation

This page is explicitly titled **Prototype evaluation against simulated scenario labels**. It compares deterministic detector predictions with the CSV's synthetic `incident_label`. It reports true/false positives and negatives, precision, recall, F1, false-positive rate, and false-negative rate for the current filters and thresholds.

Use this as a demonstration of evaluation mechanics, not as evidence of production reliability. Scenario labels are synthetic, metric values can overlap across normal and fault scenarios, and thresholds can overfit this dataset. The app does not claim causal ground truth. MTTD and MTTR are marked **Not derivable** because the CSV does not provide the event-arrival or action-duration timestamps needed to calculate them.

## Audit Log and exports

The Audit Log lists recent detection/inspection, diagnosis, recommendation, rule configuration, fault injection, approval, execution, validation, rollback, escalation, and reset events. The separate action history shows each simulated action's status and provides **Undo**. Audit/action history is local to this workspace in `backend/mlops_audit.sqlite3`.

Use **Export audit JSON** to download audit and action history. Use **Export filtered runs** to save the current filtered run set to CSV. Exports include scenario/detector information; label those outputs as simulated if you share them outside the app.

## Architecture & Limitations

This page maps the paper's seven layers to the app: telemetry collection; contextual monitoring; failure detection; evidence-grounded RCA; risk/policy decision; simulated recovery; and validation/feedback. It also includes the demo walkthrough and the research limitations. Use it to explain that the paper proposes a conceptual architecture, while this app is a small local reference demonstration with no live infrastructure integration.

## Suggested presentation sequence

1. Start on Overview. State that all operational values and scenario labels are synthetic, and point out the source-derived context distinction.
2. Open a normal run such as `run_00003`; compare its scenario label with the detector result.
3. In Runs, inspect one scenario each for data drift, missing data, schema error, high latency, and training failure. Explain the evidence field and threshold rather than presenting the label as detector output.
4. In Recovery Lab, adjust one threshold, select no-fault mode, then inject a scenario into an in-memory copy.
5. Review a recommendation. Demonstrate the explicit approval prompt and the high-risk human-review gate.
6. Approve a missing-data quarantine simulation; show the pre/post validation and Audit Log. Undo or reset after the demonstration.
7. Open Evaluation and discuss the confusion matrix, false positives, and why time-to-detect/recovery cannot be computed.
8. Finish on Architecture & Limitations. Reiterate that this does not train a crime model or infer personal/community risk, and does not prove production recovery.

## Quick troubleshooting

- **UI cannot reach the API:** verify both processes are running; open `/api/health` on port 8000.
- **Dataset cannot load:** confirm `mlops_crime_telemetry_synthetic.csv` is at the workspace root or set `ML_TELEMETRY_CSV` before starting the API.
- **A simulation appears to disappear:** overlays are intentionally in memory only; check the persisted action/audit entry, and remember an API restart clears overlays.
- **A recovery action is blocked:** inspect the current recommendation and risk. The approval must match the current allowlisted action; high-risk cases require human review.
- **Metrics differ after changing rules or filters:** evaluation is recalculated from current thresholds and the selected records. Reset the sliders/filters to compare with defaults.