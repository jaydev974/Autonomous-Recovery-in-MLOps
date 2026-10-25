import { useEffect, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowDownToLine, BookOpen, Check, ChevronDown, CircleHelp,
  ClipboardList, Clock3, Database, Gauge, GitBranch, LayoutDashboard, ListFilter,
  RotateCcw, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, Sparkles, Upload, X,
} from 'lucide-react'
import {
  Area, Cell, ComposedChart, CartesianGrid, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

type Nav = 'Overview' | 'Runs' | 'Recovery Lab' | 'Evaluation' | 'Audit Log' | 'Architecture & Limitations'
type AnyRow = Record<string, any>
const navItems: { label: Nav; icon: typeof LayoutDashboard }[] = [
  { label: 'Overview', icon: LayoutDashboard }, { label: 'Runs', icon: ListFilter },
  { label: 'Recovery Lab', icon: Sparkles }, { label: 'Evaluation', icon: Activity },
  { label: 'Audit Log', icon: ClipboardList }, { label: 'Architecture & Limitations', icon: BookOpen },
]
const colors = ['#d96845', '#d29b28', '#477d87', '#7e9d7b', '#bd7453']
const fields = ['run_id', 'timestamp', 'source_dataset', 'source_period', 'crime_domain_context', 'crime_records_in_daily_domain_batch', 'model_name', 'model_version', 'data_quality_missing_rate', 'schema_valid', 'feature_drift_score', 'validation_f1', 'pipeline_latency_ms', 'training_success', 'incident_type', 'incident_label', 'incident_id', 'root_cause', 'recommended_action', 'action_risk', 'action_approved', 'recovery_validation_passed', 'simulation_status', 'data_provenance']

function format(value: any, digits = 3) {
  if (value === null || value === undefined) return 'Not available'
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: digits })
  return String(value)
}

function Badge({ children, tone = 'simulated' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

function App() {
  const [page, setPage] = useState<Nav>('Overview')
  const [metadata, setMetadata] = useState<AnyRow | null>(null)
  const [dashboard, setDashboard] = useState<AnyRow | null>(null)
  const [runData, setRunData] = useState<AnyRow>({ items: [], total: 0 })
  const [evaluation, setEvaluation] = useState<AnyRow | null>(null)
  const [audit, setAudit] = useState<AnyRow>({ items: [] })
  const [actions, setActions] = useState<AnyRow>({ items: [] })
  const [filters, setFilters] = useState({ start_date: '', end_date: '', incident_type: '', simulation_status: '', model_version: '', crime_domain_context: '' })
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<AnyRow | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [thresholds, setThresholds] = useState({ drift_score: 0.35, missing_rate: 0.1, latency_ms: 2000 })
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [simulationResult, setSimulationResult] = useState<AnyRow | null>(null)
  const [showAddRun, setShowAddRun] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, value]))
  const queryString = query.toString()
  async function api(path: string, init?: RequestInit) {
    const isMultipart = init?.body instanceof FormData
    const response = await fetch(`/api${path}`, { ...init, headers: { ...(isMultipart ? {} : { 'Content-Type': 'application/json' }), ...(init?.headers || {}) } })
    const body = await response.json()
    if (!response.ok) throw new Error(body.detail || 'Request failed. Check that the local API is running.')
    return body
  }
  async function refresh(showLoading = false) {
    if (showLoading) setLoading(true)
    try {
      const [meta, dash, evalResult, runResult, auditResult, actionResult, rules] = await Promise.all([
        api('/metadata'), api(`/dashboard?${queryString}`), api(`/evaluation?${queryString}`),
        api(`/runs?${queryString}&search=${encodeURIComponent(search)}&limit=2000&sort_by=timestamp&order=desc`),
        api('/audit?limit=300'), api('/actions?limit=100'), api('/rules'),
      ])
      setMetadata(meta); setDashboard(dash); setEvaluation(evalResult); setRunData(runResult)
      setAudit(auditResult); setActions(actionResult); setThresholds(rules.thresholds); setError('')
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load local data.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh(true) }, [queryString, refreshToken])
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh() }, 250)
    return () => window.clearTimeout(timer)
  }, [search])

  async function openRun(runId: string) {
    try { setSelected(await api(`/runs/${runId}`)) }
    catch (err) { setNotice(err instanceof Error ? err.message : 'Unable to open run.') }
  }
  async function addRun(form: AnyRow) {
    setBusy(true)
    try {
      const created = await api('/runs', { method: 'POST', body: JSON.stringify(form) })
      setShowAddRun(false)
      setPage('Runs')
      setSearch('')
      setFilters({ start_date: '', end_date: '', incident_type: '', simulation_status: '', model_version: '', crime_domain_context: '' })
      setRefreshToken(value => value + 1)
      setNotice(`${created.run_id} saved to local SQLite as SIMULATED_USER_ADDED. The source CSV was not changed.`)
      await openRun(created.run_id)
    } catch (err) { setNotice(err instanceof Error ? err.message : 'Could not add run.') }
    finally { setBusy(false) }
  }
  async function uploadCsv(file: File) {
    const approved = window.confirm(`Import ${file.name} (${Math.ceil(file.size / 1024)} KB)?\n\nAll uploaded operational values will be treated as simulated demo telemetry. Rows are added to local SQLite; the configured source CSV is not modified.`)
    if (!approved) return
    const payload = new FormData()
    payload.append('file', file)
    setBusy(true)
    try {
      const result = await api('/runs/import-csv', { method: 'POST', body: payload })
      setNotice(`Imported ${result.imported_count} rows as SIMULATED_CSV_UPLOAD. The source CSV was unchanged.`)
      setRefreshToken(value => value + 1)
    } catch (err) { setNotice(err instanceof Error ? err.message : 'CSV import failed.') }
    finally { setBusy(false) }
  }
  async function saveThresholds() {
    setBusy(true)
    try { const result = await api('/rules', { method: 'PUT', body: JSON.stringify(thresholds) }); setThresholds(result.thresholds); setNotice('Rule thresholds saved; detector output is recalculated.'); await refresh() }
    catch (err) { setNotice(err instanceof Error ? err.message : 'Could not save rules.') }
    finally { setBusy(false) }
  }
  async function simulate(row: AnyRow) {
    const proposal = row.recommendation
    if (!proposal) return
    const accepted = window.confirm(`Approve SIMULATED action: ${proposal.label}?\n\nRisk: ${proposal.risk.toUpperCase()}\n${proposal.rationale}\n\nNo real service, model, or source data will be changed.`)
    if (!accepted) return
    setBusy(true)
    try {
      const result = await api(`/runs/${row.run_id}/simulate`, { method: 'POST', body: JSON.stringify({ action_id: proposal.action_id, human_approved: true }) })
      setSimulationResult(result)
      setNotice(result.validation_passed ? 'SIMULATED action validated. Audit event recorded.' : 'Validation failed: simulated state rolled back and escalated.')
      await refresh()
      if (selected?.run_id === row.run_id) await openRun(row.run_id)
    } catch (err) { setNotice(err instanceof Error ? err.message : 'Simulation failed.') }
    finally { setBusy(false) }
  }
  async function injectScenario(runId: string, scenario: string) {
    if (!runId) return
    setBusy(true)
    try {
      await api(`/runs/${runId}/inject`, { method: 'POST', body: JSON.stringify({ scenario }) })
      setNotice(`Injected ${scenario} into an in-memory copy of ${runId}; the CSV is unchanged.`)
      await refresh()
    } catch (err) { setNotice(err instanceof Error ? err.message : 'Scenario injection failed.') }
    finally { setBusy(false) }
  }
  async function undo(id: number) {
    if (!window.confirm('Undo this simulated action and restore its prior local overlay state?')) return
    try { await api(`/actions/${id}/rollback`, { method: 'POST' }); setNotice('Simulated overlay restored.'); await refresh() }
    catch (err) { setNotice(err instanceof Error ? err.message : 'Rollback failed.') }
  }
  async function resetSimulation() {
    if (!window.confirm('Reset all simulated overlays and action history? This does not change the source CSV.')) return
    try { const result = await api('/simulation/reset', { method: 'POST', body: JSON.stringify({ confirmed: true }) }); setNotice(`Simulation state reset. ${result.removed_action_records} action records removed.`); setSelected(null); await refresh() }
    catch (err) { setNotice(err instanceof Error ? err.message : 'Reset failed.') }
  }
  function exportFile(path: string) { window.location.href = `/api${path}${path.includes('?') ? '&' : '?'}${queryString}` }

  const rows = runData.items as AnyRow[]
  const current = selected
  const timeline = dashboard?.timeline || []

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-lockup"><div className="brand-mark"><Activity size={20} /></div><div><strong>Recovery Lab</strong><span>MLOps research prototype</span></div></div>
      <div className="side-caption">WORKSPACE</div>
      <nav aria-label="Primary navigation">
        {navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${page === label ? 'active' : ''}`} onClick={() => setPage(label)}><Icon size={17} /><span>{label}</span>{label === 'Recovery Lab' && <i className="nav-dot" />}</button>)}
      </nav>
      <div className="sidebar-foot"><span className="live-dot" />LOCAL DEMO ENVIRONMENT<div className="side-dataset"><Database size={14} /><span>Telemetry scenarios<br /><b>{format(metadata?.rows, 0)} records</b></span></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="crumb">Research prototype <span>/</span> {page}</div><div className="top-actions"><span className="local-pill"><span className="live-dot" /> Local only</span><button className="icon-button" title="About simulated data" onClick={() => setPage('Architecture & Limitations')}><CircleHelp size={18} /></button></div></header>
      <section className="page-wrap">
        <div className="page-title-row"><div><div className="eyebrow">AUTONOMOUS RECOVERY IN MLOPS <Badge>SIMULATED</Badge></div><h1>{page}</h1><p className="subtitle">Governed detection and recovery demonstrations against synthetic pipeline scenarios.</p></div>
          <button className="button secondary" onClick={() => exportFile('/export/runs.csv')}><ArrowDownToLine size={16} /> Export filtered runs</button>
        </div>
        <div className="integrity-banner"><ShieldCheck size={18} /><p><strong>Scenario data, not production telemetry.</strong> Operational metrics, labels, diagnoses, and recovery outcomes are synthetic. Crime-domain context and aggregate batch counts are source-derived; no individual or community risk is inferred.</p><Badge>SIMULATED</Badge></div>
        {notice && <div className="notice" role="status"><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss message"><X size={16} /></button></div>}
        {error && <div className="error-banner"><AlertTriangle size={18} /><div><strong>Local API unavailable</strong><p>{error}</p><span>Start the backend with the PowerShell commands in README.md.</span></div><button className="button secondary" onClick={() => void refresh(true)}>Retry</button></div>}
        {loading && !metadata ? <div className="loading-state"><div className="loader" />Loading local scenario dataset…</div> : <>
          <FilterBar filters={filters} setFilters={setFilters} metadata={metadata} onClear={() => setFilters({ start_date: '', end_date: '', incident_type: '', simulation_status: '', model_version: '', crime_domain_context: '' })} />
          {page === 'Overview' && <Overview dashboard={dashboard} timeline={timeline} onOpen={openRun} />}
          {page === 'Runs' && <Runs rows={rows} total={runData.total} search={search} setSearch={setSearch} onOpen={openRun} onAdd={() => setShowAddRun(true)} onUpload={uploadCsv} busy={busy} />}
          {page === 'Recovery Lab' && <Recovery rows={rows} thresholds={thresholds} setThresholds={setThresholds} saveThresholds={saveThresholds} busy={busy} onOpen={openRun} onSimulate={simulate} onInject={injectScenario} onReset={resetSimulation} simulationResult={simulationResult} setSimulationResult={setSimulationResult} />}
          {page === 'Evaluation' && <Evaluation data={evaluation} onExport={() => exportFile('/export/runs.csv')} />}
          {page === 'Audit Log' && <Audit audit={audit} actions={actions} onUndo={undo} onExport={() => exportFile('/export/audit.json')} />}
          {page === 'Architecture & Limitations' && <Architecture />}
        </>}
      </section>
    </main>
    {showAddRun && <AddRunDialog busy={busy} onClose={() => setShowAddRun(false)} onSubmit={addRun} />}
    {current && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}><aside className="detail-drawer" aria-label={`Run details ${current.run_id}`}><div className="drawer-head"><div><Badge>SIMULATED</Badge><h2>{current.run_id}</h2><span>{current.timestamp}</span></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close run details"><X /></button></div><div className="drawer-scroll"><div className="detail-status"><Badge tone={current.detected ? 'fault' : 'normal'}>{current.detected ? `${current.alerts?.length} detector alert${current.alerts?.length === 1 ? '' : 's'}` : 'No detector alert'}</Badge><Badge tone="warning">{current.incident_type} scenario</Badge></div>
      <section className="detail-section"><h3>Detector output <span className="simulated-label">SIMULATED</span></h3>{current.alerts?.length ? current.alerts.map((alert: AnyRow) => <div className="evidence-row" key={alert.rule_id}><div><b>{alert.rule_name}</b><small>{alert.timestamp} · {alert.run_id}</small></div><Badge tone={alert.severity === 'critical' ? 'fault' : 'warning'}>{alert.severity}</Badge><p>Observed {format(alert.observed_value)} · threshold {format(alert.threshold)}</p></div>) : <p className="muted">No configured rule triggered for this run.</p>}</section>
      <section className="detail-section"><h3>Evidence-based diagnosis</h3>{current.diagnoses?.length ? current.diagnoses.map((item: AnyRow, index: number) => <div className="diagnosis" key={`${item.rule_id}-${index}`}><strong>{item.cause}</strong><p>{item.rationale}</p><small>Rule confidence: {item.confidence}. Not a calibrated probability.</small><div>{item.evidence.map((e: AnyRow) => <span className="evidence-chip" key={e.field}>{e.field}: {format(e.value)}</span>)}</div></div>) : <p className="muted">No rule-based cause assigned.</p>}</section>
      <section className="detail-section"><h3>Recovery policy</h3>{current.recommendation ? <div className="policy-panel"><div className="policy-title"><strong>{current.recommendation.label}</strong><Badge tone={current.recommendation.risk === 'high' ? 'fault' : 'warning'}>{current.recommendation.risk} risk</Badge></div><p>{current.recommendation.rationale}</p><div className="policy-meta"><span>Reversible: yes</span><span>Human approval: required</span><span>Mode: recommend-only</span></div><button className="button primary full" disabled={busy} onClick={() => void simulate(current)}><ShieldCheck size={16} /> Approve simulated action</button></div> : <p className="muted">No recovery action recommended.</p>}</section>
      <section className="detail-section"><h3>Scenario truth <span className="simulated-label">SIMULATED LABEL</span></h3><div className="source-grid"><span>incident_label</span><b>{format(current.incident_label, 0)}</b><span>incident_type</span><b>{current.incident_type}</b><span>record origin</span><b>{current.simulation_status === 'SIMULATED_USER_ADDED' ? 'User-entered local demo' : 'Supplied CSV scenario'}</b><span>source context</span><b>{current.crime_domain_context} · descriptive context only</b></div></section>
      <section className="detail-section"><h3>All source row fields</h3><div className="field-list">{fields.map(field => <div key={field}><span>{field}</span><b>{format(current[field])}</b></div>)}</div></section></div></aside></div>}
  </div>
}

function FilterBar({ filters, setFilters, metadata, onClear }: { filters: AnyRow; setFilters: (value: any) => void; metadata: AnyRow | null; onClear: () => void }) {
  const set = (key: string, value: string) => setFilters((current: AnyRow) => ({ ...current, [key]: value }))
  return <div className="filterbar"><div className="filter-head"><span><SlidersHorizontal size={15} /> FILTER SCENARIOS</span><button className="text-button" onClick={onClear}>Clear all</button></div><div className="filter-controls"><label>From<input type="date" value={filters.start_date} onChange={e => set('start_date', e.target.value)} /></label><label>To<input type="date" value={filters.end_date} onChange={e => set('end_date', e.target.value)} /></label>
    <Select label="Incident type" value={filters.incident_type} options={metadata?.incident_types || []} onChange={v => set('incident_type', v)} /><Select label="Scenario status" value={filters.simulation_status} options={metadata?.simulation_statuses || []} onChange={v => set('simulation_status', v)} /><Select label="Model version" value={filters.model_version} options={metadata?.model_versions || []} onChange={v => set('model_version', v)} /><Select label="Domain context" value={filters.crime_domain_context} options={metadata?.crime_domain_contexts || []} onChange={v => set('crime_domain_context', v)} />
  </div></div>
}
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label>{label}<span className="select-wrap"><select value={value} onChange={e => onChange(e.target.value)}><option value="">All</option>{options.map(option => <option key={option}>{option}</option>)}</select><ChevronDown size={14} /></span></label> }

function Overview({ dashboard, timeline, onOpen }: { dashboard: AnyRow | null; timeline: AnyRow[]; onOpen: (id: string) => void }) {
  if (!dashboard) return <Empty text="Dashboard data is not available." />
  const summary = dashboard.summary
  const metrics = [
    { label: 'Telemetry runs', value: summary.total_runs, note: 'scenario records · supplied CSV', icon: Database, tone: 'sage' },
    { label: 'Normal scenarios', value: summary.normal_runs, note: 'SIMULATED_NORMAL_RUN', icon: Check, tone: 'green' },
    { label: 'Fault scenarios', value: summary.simulated_fault_runs, note: 'SIMULATED_FAULT', icon: AlertTriangle, tone: 'coral' },
    { label: 'Detector alerts', value: summary.alert_count, note: 'rules over simulated signals', icon: ShieldAlert, tone: 'amber' },
    { label: 'Mean validation F1', value: summary.average_f1 == null ? '—' : format(summary.average_f1), note: 'synthetic measurement', icon: Gauge, tone: 'blue' },
    { label: 'Median latency', value: summary.median_latency_ms == null ? '—' : `${format(summary.median_latency_ms, 0)} ms`, note: 'synthetic measurement', icon: Clock3, tone: 'blue' },
    { label: 'Recovery validation', value: summary.simulated_recovery_success_rate == null ? '—' : `${format(summary.simulated_recovery_success_rate * 100, 0)}%`, note: 'local simulations only', icon: RotateCcw, tone: 'sage' },
  ]
  const chartData = timeline.map((item, index) => ({ ...item, shortDate: item.timestamp.slice(0, 10), index }))
  const breakdown = dashboard.fault_breakdown || []
  return <>
    <div className="metric-grid">{metrics.map(({ label, value, note, icon: Icon, tone }) => <article className="metric-card" key={label}><div className={`metric-icon ${tone}`}><Icon size={17} /></div><div className="metric-label">{label}<span title="All operational measurements and outcomes here are synthetic">ⓘ</span></div><strong>{format(value, 0)}</strong><small>{note}</small></article>)}</div>
    <div className="section-heading"><div><h2>System signal timeline <Badge>SIMULATED</Badge></h2><p>Daily sample history · generated operational values, not live monitoring</p></div><span className="range-label">{chartData[0]?.shortDate || '—'} — {chartData[chartData.length - 1]?.shortDate || '—'}</span></div>
    <div className="chart-grid"><article className="panel chart-panel wide"><div className="panel-head"><div><h3>Model validation F1</h3><span>SIMULATED · select a point to inspect its run</span></div><span className="chart-unit">score</span></div><ResponsiveContainer width="100%" height={240}><ComposedChart data={chartData} onClick={(event: any) => event?.activePayload?.[0]?.payload?.run_id && onOpen(event.activePayload[0].payload.run_id)}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e7e9e2" /><XAxis dataKey="shortDate" minTickGap={38} tick={{ fontSize: 10 }} /><YAxis domain={[0, 1]} tick={{ fontSize: 10 }} /><Tooltip labelFormatter={label => `Scenario date: ${label}`} formatter={(value: any) => [format(value), 'Synthetic F1']} /><Area type="monotone" dataKey="validation_f1" stroke="#477d87" fill="#b6d0cc" fillOpacity={0.35} strokeWidth={1.8} dot={false} activeDot={{ r: 4 }} /><Line type="monotone" dataKey="incident_label" name="Simulated scenario label" stroke="#d96845" strokeWidth={0} dot={(props: any) => props.payload.incident_label ? <circle key={props.payload.run_id} cx={props.cx} cy={props.cy} r={2} fill="#d96845" stroke="#fff" strokeWidth={1} /> : <g key={props.payload.run_id} />} /></ComposedChart></ResponsiveContainer></article>
      <article className="panel chart-panel"><div className="panel-head"><div><h3>Fault mix</h3><span>Synthetic scenario labels</span></div><span className="chart-unit">count</span></div>{breakdown.length ? <><ResponsiveContainer width="100%" height={185}><PieChart><Pie data={breakdown} dataKey="count" nameKey="incident_type" innerRadius={48} outerRadius={73} paddingAngle={3}>{breakdown.map((_: AnyRow, index: number) => <Cell key={index} fill={colors[index % colors.length]} />)}</Pie><Tooltip formatter={(value: any, name: any) => [value, name]} /></PieChart></ResponsiveContainer><div className="legend-list">{breakdown.map((item: AnyRow, index: number) => <div key={item.incident_type}><i style={{ background: colors[index % colors.length] }} />{item.incident_type.replace('_', ' ')}<b>{item.count}</b></div>)}</div></> : <Empty text="No fault categories match the current filters." />}</article>
      <MetricTrend title="Feature drift score" unit="score" data={chartData} field="feature_drift_score" color="#d29b28" onOpen={onOpen} />
      <MetricTrend title="Missing-data rate" unit="rate" data={chartData} field="data_quality_missing_rate" color="#bd7453" onOpen={onOpen} />
      <MetricTrend title="Pipeline latency" unit="ms" data={chartData} field="pipeline_latency_ms" color="#477d87" onOpen={onOpen} />
    </div>
    <div className="note-strip"><ShieldCheck size={16} /><span>Detector alerts are computed independently of the CSV scenario labels. The evaluation page reports disagreement honestly.</span></div>
  </>
}
function MetricTrend({ title, unit, data, field, color, onOpen }: { title: string; unit: string; data: AnyRow[]; field: string; color: string; onOpen: (id: string) => void }) { return <article className="panel chart-panel"><div className="panel-head"><div><h3>{title}</h3><span>SIMULATED measurement</span></div><span className="chart-unit">{unit}</span></div><ResponsiveContainer width="100%" height={180}><LineChart data={data} onClick={(event: any) => event?.activePayload?.[0]?.payload?.run_id && onOpen(event.activePayload[0].payload.run_id)}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e7e9e2" /><XAxis dataKey="shortDate" minTickGap={38} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={44} /><Tooltip formatter={(value: any) => [format(value), `Synthetic ${title.toLowerCase()}`]} /><Line type="monotone" dataKey={field} stroke={color} strokeWidth={1.8} dot={false} activeDot={{ r: 4 }} /></LineChart></ResponsiveContainer></article> }

function Runs({ rows, total, search, setSearch, onOpen, onAdd, onUpload, busy }: { rows: AnyRow[]; total: number; search: string; setSearch: (value: string) => void; onOpen: (id: string) => void; onAdd: () => void; onUpload: (file: File) => void; busy: boolean }) {
  const [sort, setSort] = useState<'timestamp' | 'run_id' | 'validation_f1' | 'pipeline_latency_ms'>('timestamp')
  const fileInput = useRef<HTMLInputElement>(null)
  const ordered = [...rows].sort((a, b) => String(a[sort]).localeCompare(String(b[sort]), undefined, { numeric: true }) * (sort === 'timestamp' ? -1 : 1))
  return <><div className="table-toolbar"><div className="search-field"><Search size={16} /><input aria-label="Search telemetry runs" placeholder="Search run, cause, model, domain…" value={search} onChange={event => setSearch(event.target.value)} /></div><div className="runs-toolbar-actions"><span>{format(total, 0)} matching records <Badge>SIMULATED</Badge></span><input ref={fileInput} className="visually-hidden" type="file" accept=".csv,text/csv" aria-label="Choose telemetry CSV" onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = '' }} /><button className="button secondary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={15} /> Upload CSV</button><button className="button primary" onClick={onAdd}><Database size={15} /> Add run</button></div></div><div className="table-wrap"><table><thead><tr><th>RUN</th><th><SortButton title="Timestamp" sort="timestamp" setSort={setSort} /></th><th>SCENARIO</th><th>DETECTOR</th><th>F1 <button className="sort-inline" onClick={() => setSort('validation_f1')}>↕</button></th><th>DRIFT</th><th>LATENCY <button className="sort-inline" onClick={() => setSort('pipeline_latency_ms')}>↕</button></th><th>VERSION</th><th></th></tr></thead><tbody>{ordered.map(row => <tr key={row.run_id} tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpen(row.run_id)} onClick={() => onOpen(row.run_id)}><td><strong>{row.run_id}</strong><small>{row.simulation_status === 'SIMULATED_CSV_UPLOAD' ? 'Uploaded CSV · simulated' : row.run_id.startsWith('local_') ? 'Local addition · simulated' : `${row.crime_domain_context} · derived`}</small></td><td>{row.timestamp.slice(0, 10)}</td><td><Badge tone={row.incident_label ? 'fault' : 'normal'}>{row.incident_type}</Badge></td><td>{row.detected ? <Badge tone="warning">{row.alerts.length} rule(s)</Badge> : <span className="muted">Clear</span>}</td><td>{format(row.validation_f1)}</td><td>{format(row.feature_drift_score)}</td><td>{format(row.pipeline_latency_ms, 0)} ms</td><td>{row.model_version}</td><td><ChevronDown className="row-chevron" size={15} /></td></tr>)}</tbody></table>{!ordered.length && <Empty text="No runs match these filters. Try clearing the search or filters." />}</div><p className="table-foot">Uploaded rows are marked SIMULATED_CSV_UPLOAD. Imported operational values are treated as synthetic; the source CSV remains unchanged.</p></>
}

function AddRunDialog({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (form: AnyRow) => void }) {
  const [form, setForm] = useState({
    timestamp: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
    crime_domain_context: 'Other Crime', crime_records_in_daily_domain_batch: '0',
    model_name: 'ManualDemoModel', model_version: 'v1', data_quality_missing_rate: '0',
    schema_valid: true, feature_drift_score: '0', validation_f1: '0.5',
    pipeline_latency_ms: '500', training_success: true, incident_type: 'normal',
  })
  const [error, setError] = useState('')
  const set = (key: string, value: string | boolean) => setForm(current => ({ ...current, [key]: value }))
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const missing = Number(form.data_quality_missing_rate)
    const drift = Number(form.feature_drift_score)
    const f1 = Number(form.validation_f1)
    const latency = Number(form.pipeline_latency_ms)
    const batch = Number(form.crime_records_in_daily_domain_batch)
    if ([missing, drift, f1].some(value => !Number.isFinite(value) || value < 0 || value > 1) || latency < 0 || !Number.isFinite(latency) || batch < 0 || !Number.isInteger(batch)) {
      setError('Check inputs: rates and scores must be 0–1, latency must be non-negative, and batch count must be a whole number.')
      return
    }
    onSubmit({ ...form, timestamp: new Date(form.timestamp).toISOString(), crime_records_in_daily_domain_batch: batch, data_quality_missing_rate: missing, feature_drift_score: drift, validation_f1: f1, pipeline_latency_ms: latency })
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="add-run-modal" role="dialog" aria-modal="true" aria-labelledby="add-run-title"><div className="modal-heading"><div><Badge>SIMULATED LOCAL ENTRY</Badge><h2 id="add-run-title">Add telemetry run</h2><p>Saved to this workspace's SQLite database. The source CSV is never changed.</p></div><button className="icon-button" onClick={onClose} aria-label="Close add-run form"><X /></button></div><div className="modal-data-notice"><ShieldCheck size={16} /><span>Enter synthetic demonstration values only. Use aggregate counts and context labels; do not enter personal or sensitive information.</span></div><form onSubmit={submit}><div className="add-run-grid"><label>Run timestamp<input type="datetime-local" value={form.timestamp} onChange={e => set('timestamp', e.target.value)} /></label><label>Scenario type<select value={form.incident_type} onChange={e => set('incident_type', e.target.value)}>{['normal', 'data_drift', 'missing_data', 'schema_error', 'high_latency', 'training_failure'].map(value => <option key={value}>{value}</option>)}</select><small>Creates a synthetic scenario label for prototype evaluation.</small></label><label>Domain context (descriptive only)<input required maxLength={120} value={form.crime_domain_context} onChange={e => set('crime_domain_context', e.target.value)} /></label><label>Aggregate batch count<input type="number" min="0" step="1" value={form.crime_records_in_daily_domain_batch} onChange={e => set('crime_records_in_daily_domain_batch', e.target.value)} /></label><label>Model name<input required maxLength={120} value={form.model_name} onChange={e => set('model_name', e.target.value)} /></label><label>Model version<input required maxLength={40} value={form.model_version} onChange={e => set('model_version', e.target.value)} /></label><label>Missing-data rate<input type="number" min="0" max="1" step="0.001" value={form.data_quality_missing_rate} onChange={e => set('data_quality_missing_rate', e.target.value)} /></label><label>Feature drift score<input type="number" min="0" max="1" step="0.001" value={form.feature_drift_score} onChange={e => set('feature_drift_score', e.target.value)} /></label><label>Validation F1<input type="number" min="0" max="1" step="0.001" value={form.validation_f1} onChange={e => set('validation_f1', e.target.value)} /></label><label>Pipeline latency (ms)<input type="number" min="0" max="3600000" step="1" value={form.pipeline_latency_ms} onChange={e => set('pipeline_latency_ms', e.target.value)} /></label></div><div className="checkbox-row"><label><input type="checkbox" checked={form.schema_valid} onChange={e => set('schema_valid', e.target.checked)} /> Schema valid</label><label><input type="checkbox" checked={form.training_success} onChange={e => set('training_success', e.target.checked)} /> Training succeeded</label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy}><Database size={15} /> {busy ? 'Saving…' : 'Save simulated run'}</button></div></form></section></div>
}
function SortButton({ title, sort, setSort }: { title: string; sort: any; setSort: (sort: any) => void }) { return <button className="sort-button" onClick={() => setSort(sort)}>{title} ↕</button> }

function Recovery({ rows, thresholds, setThresholds, saveThresholds, busy, onOpen, onSimulate, onInject, onReset, simulationResult, setSimulationResult }: { rows: AnyRow[]; thresholds: AnyRow; setThresholds: (value: any) => void; saveThresholds: () => void; busy: boolean; onOpen: (id: string) => void; onSimulate: (row: AnyRow) => void; onInject: (runId: string, scenario: string) => void; onReset: () => void; simulationResult: AnyRow | null; setSimulationResult: (result: AnyRow | null) => void }) {
  const [mode, setMode] = useState<'Recommend only' | 'No-fault mode'>('Recommend only')
  const [injectRun, setInjectRun] = useState(rows[0]?.run_id || '')
  const [injectType, setInjectType] = useState('data_drift')
  const candidates = mode === 'No-fault mode' ? rows.filter(row => !row.incident_label).slice(0, 20) : rows.filter(row => row.detected).slice(0, 30)
  const change = (key: string, value: number) => setThresholds({ ...thresholds, [key]: value })
  return <><div className="lab-intro"><div><div className="eyebrow">CONTROL PLANE <Badge>SIMULATED</Badge></div><h2>Rule-based recovery lab</h2><p>Adjust thresholds, inspect evidence, then explicitly approve a reversible local simulation.</p></div><button className="button danger-outline" onClick={onReset}><RotateCcw size={16} /> Reset simulation</button></div>
    {simulationResult && <section className={`panel validation-result ${simulationResult.validation_passed ? 'passed' : 'failed'}`}><div className="panel-head"><div><h3>{simulationResult.validation_passed ? 'Post-action validation passed' : 'Validation failed · rolled back and escalated'} <Badge>SIMULATED</Badge></h3><span>Action #{simulationResult.action_row_id} · {simulationResult.run_id} · {simulationResult.action_id}</span></div><button className="icon-button" aria-label="Dismiss comparison" onClick={() => setSimulationResult(null)}><X size={16} /></button></div><div className="before-after"><div><small>PRE-ACTION</small><strong>{simulationResult.pre_action.alerts?.length || 0} detector alert(s)</strong><span>Missing {format(simulationResult.pre_action.data_quality_missing_rate)} · schema {String(simulationResult.pre_action.schema_valid)} · training {String(simulationResult.pre_action.training_success)}</span></div><div className="compare-arrow">→</div><div><small>POST-ACTION</small><strong>{simulationResult.remaining_alerts?.length || 0} detector alert(s) remaining</strong><span>Missing {format(simulationResult.post_action.data_quality_missing_rate)} · schema {String(simulationResult.post_action.schema_valid)} · training {String(simulationResult.post_action.training_success)}</span></div></div></section>}
    <div className="lab-grid"><section className="panel rules-panel"><div className="panel-head"><div><h3><SlidersHorizontal size={16} /> Detection thresholds</h3><span>Transparent deterministic rules</span></div><Badge tone="warning">Configurable</Badge></div><ThresholdInput label="High drift score" field="drift_score" value={thresholds.drift_score} min={0.01} max={1} step={0.01} change={change} display={format(thresholds.drift_score)} /><ThresholdInput label="Excess missing-data rate" field="missing_rate" value={thresholds.missing_rate} min={0} max={1} step={0.01} change={change} display={`${format(thresholds.missing_rate * 100, 1)}%`} /><ThresholdInput label="High pipeline latency" field="latency_ms" value={thresholds.latency_ms} min={100} max={10000} step={50} change={change} display={`${format(thresholds.latency_ms, 0)} ms`} /><div className="fixed-rules"><span>Also enforced:</span><Badge tone="fault">schema_valid = false</Badge><Badge tone="fault">training_success = false</Badge></div><button className="button primary" disabled={busy} onClick={saveThresholds}>Apply rule settings</button><p className="micro-note">Thresholds are prototype settings, not learned or calibrated production limits.</p></section>
      <section className="panel policy-panel-large"><div className="panel-head"><div><h3><ShieldCheck size={16} /> Governed action policy</h3><span>Allowlisted actions · human approval always required</span></div><Badge tone="warning">Recommend only</Badge></div><div className="policy-cards">{[['compare_baseline', 'Compare with baseline', 'LOW', 'Advisory only; does not clear an alert.'], ['quarantine_batch', 'Quarantine batch', 'MEDIUM / HIGH', 'Overlay flag only; input CSV remains unchanged.'], ['retain_previous_model', 'Select previous model', 'HIGH', 'Local overlay only; mandatory human review.']].map(item => <div className="policy-card" key={item[0]}><div><strong>{item[1]}</strong><Badge tone={item[2] === 'LOW' ? 'normal' : 'fault'}>{item[2]}</Badge></div><p>{item[3]}</p><small>Reversible · simulated · approval required</small></div>)}</div><div className="mode-row"><label>Scenario mode</label><div className="segmented"><button className={mode === 'Recommend only' ? 'selected' : ''} onClick={() => setMode('Recommend only')}>Recommend only</button><button className={mode === 'No-fault mode' ? 'selected' : ''} onClick={() => setMode('No-fault mode')}>No-fault mode</button></div></div><p className="micro-note">No-fault mode displays records whose synthetic scenario label is normal; detector rules still run normally. No artificial signal is written into the CSV.</p><div className="inject-row"><label>In-memory fault injection</label><div><select aria-label="Run for scenario injection" value={injectRun} onChange={event => setInjectRun(event.target.value)}>{rows.map(row => <option key={row.run_id} value={row.run_id}>{row.run_id}</option>)}</select><select aria-label="Fault type to inject" value={injectType} onChange={event => setInjectType(event.target.value)}>{['data_drift', 'missing_data', 'schema_error', 'high_latency', 'training_failure'].map(type => <option key={type}>{type}</option>)}</select><button className="button tiny" disabled={busy} onClick={() => onInject(injectRun, injectType)}>Inject in memory</button></div><small>Changes only a reversible local overlay, never the source CSV.</small></div></section></div>
    <div className="section-heading compact"><div><h2>{mode === 'No-fault mode' ? 'Normal scenario review' : 'Detected scenarios'} <Badge>SIMULATED</Badge></h2><p>Detection and CSV scenario labels are shown separately.</p></div><span className="range-label">{candidates.length} shown</span></div>
    <div className="table-wrap"><table><thead><tr><th>RUN</th><th>SCENARIO LABEL</th><th>DETECTOR OUTPUT</th><th>ROOT CAUSE (RULE-BASED)</th><th>POLICY ACTION</th><th>RISK</th><th></th></tr></thead><tbody>{candidates.map(row => <tr key={row.run_id}><td><button className="link-button" onClick={() => onOpen(row.run_id)}>{row.run_id}</button><small>{row.timestamp.slice(0, 10)}</small></td><td><Badge tone={row.incident_label ? 'fault' : 'normal'}>{row.incident_type}</Badge></td><td>{row.detected ? row.alerts.map((alert: AnyRow) => <Badge key={alert.rule_id} tone={alert.severity === 'critical' ? 'fault' : 'warning'}>{alert.rule_id}</Badge>) : 'No rule triggered'}</td><td>{row.diagnoses[0]?.cause || 'No diagnosis'}</td><td>{row.recommendation?.label || 'Monitor'}</td><td>{row.recommendation?.risk || '—'}</td><td>{row.recommendation && <button className="button tiny" disabled={busy} onClick={() => onSimulate(row)}>Review & approve</button>}</td></tr>)}</tbody></table>{!candidates.length && <Empty text="No records in this view." />}</div></>
}
function ThresholdInput({ label, field, value, min, max, step, change, display }: { label: string; field: string; value: number; min: number; max: number; step: number; change: (key: string, value: number) => void; display: string }) { return <label className="threshold-control"><span>{label}<b>{display}</b></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => change(field, Number(event.target.value))} /></label> }

function Evaluation({ data, onExport }: { data: AnyRow | null; onExport: () => void }) {
  if (!data) return <Empty text="Evaluation results unavailable." />
  const cm = data.confusion_matrix
  const score = [{ label: 'Precision', value: data.precision }, { label: 'Recall', value: data.recall }, { label: 'F1 score', value: data.f1 }, { label: 'False-positive rate', value: data.false_positive_rate }, { label: 'False-negative rate', value: data.false_negative_rate }]
  return <><div className="evaluation-title"><div><Badge tone="warning">PROTOTYPE EVALUATION</Badge><h2>Against simulated scenario labels</h2><p>{format(data.sample_count, 0)} filtered records · predictions are deterministic rules, labels are synthetic CSV fields.</p></div><button className="button secondary" onClick={onExport}><ArrowDownToLine size={16} /> Export filtered records</button></div><div className="score-grid">{score.map(item => <div key={item.label} className="score-card"><small>{item.label}</small><strong>{format(item.value * 100, 1)}<i>%</i></strong><div className="score-track"><span style={{ width: `${Math.max(0, Math.min(100, item.value * 100))}%` }} /></div></div>)}</div>
    <div className="evaluation-grid"><section className="panel confusion-panel"><div className="panel-head"><div><h3>Confusion matrix</h3><span>Detector output vs synthetic scenario label</span></div><Badge>SIMULATED LABELS</Badge></div><div className="matrix"><div /><div className="matrix-axis">Predicted fault</div><div className="matrix-axis">Predicted normal</div><div className="matrix-label">Actual fault</div><div className="matrix-cell tp"><b>{cm.true_positive}</b><small>True positive</small></div><div className="matrix-cell fn"><b>{cm.false_negative}</b><small>False negative</small></div><div className="matrix-label">Actual normal</div><div className="matrix-cell fp"><b>{cm.false_positive}</b><small>False positive</small></div><div className="matrix-cell tn"><b>{cm.true_negative}</b><small>True negative</small></div></div></section><section className="panel time-panel"><div className="panel-head"><div><h3>Timing metrics</h3><span>Only when derivable from available records</span></div><Clock3 size={18} /></div><div className="not-derived"><span>—</span><strong>Not derivable</strong><p>{data.time_note}</p></div></section></div>
    <section className="panel limitations-panel"><h3><AlertTriangle size={17} /> How to read these metrics</h3><ul>{data.limitations.map((item: string) => <li key={item}>{item}</li>)}</ul><p>The `incident_label` / `incident_type` fields are treated only as scenario labels. They are not independent operational ground truth or evidence that a detector identifies causal failures.</p></section></>
}

function Audit({ audit, actions, onUndo, onExport }: { audit: AnyRow; actions: AnyRow; onUndo: (id: number) => void; onExport: () => void }) {
  const events = audit.items || []
  return <><div className="audit-heading"><div><h2>Audit trail</h2><p>Approvals, recommendations, executions, validation, rollback, and reset events.</p></div><button className="button secondary" onClick={onExport}><ArrowDownToLine size={16} /> Export audit JSON</button></div><div className="audit-summary"><div><strong>{events.length}</strong><span>recent audit events</span></div><div><strong>{actions.items?.length || 0}</strong><span>simulated actions</span></div><Badge>APPEND-ONLY EVENTS · SIMULATED</Badge></div><section className="panel audit-panel"><div className="panel-head"><div><h3>Event history</h3><span>Newest first · SQLite local persistence</span></div><Badge>SIMULATED</Badge></div>{events.length ? <div className="audit-list">{events.map((event: AnyRow) => <article className="audit-event" key={event.id}><div className="audit-marker"><span /></div><div className="audit-event-body"><div><strong>{event.event_type.replace('_', ' ')}</strong><span>{event.timestamp}</span></div><p>{event.run_id || 'workspace'}{event.details?.action_id ? ` · ${event.details.action_id}` : ''}</p><small>{event.details?.reason || event.details?.label || JSON.stringify(event.details).slice(0, 180)}</small></div><Badge>{event.simulated ? 'SIMULATED' : 'SYSTEM'}</Badge></article>)}</div> : <Empty text="Audit events appear after rules are evaluated or a simulated action is recorded." />}</section><div className="section-heading compact"><div><h2>Action history</h2><p>Local overlay state with undo support.</p></div></div><div className="table-wrap"><table><thead><tr><th>ID / TIME</th><th>RUN</th><th>ACTION</th><th>STATUS</th><th>VALIDATION</th><th></th></tr></thead><tbody>{(actions.items || []).map((action: AnyRow) => <tr key={action.id}><td>#{action.id}<small>{action.timestamp}</small></td><td>{action.run_id}</td><td>{action.action_id}</td><td><Badge tone={action.status === 'validated' ? 'validated' : 'warning'}>{action.status}</Badge></td><td>{action.details?.validation_passed ? 'Passed' : 'Rolled back / escalated'}</td><td><button className="button tiny secondary" onClick={() => onUndo(action.id)}>Undo</button></td></tr>)}</tbody></table>{!actions.items?.length && <Empty text="No simulated actions have been executed." />}</div></>
}

function Architecture() {
  const layers = [
    ['01', 'Data collection & telemetry', 'CSV loader + typed validation', 'Immutable 1,200-row scenario source; measurements are synthetic.'],
    ['02', 'Contextual monitoring', 'Overview charts + filters', 'Combines quality, drift, latency, model status, and source-derived context.'],
    ['03', 'Failure detection', 'Configurable deterministic rules', 'Five rules expose threshold, observed value, severity, time, and run ID.'],
    ['04', 'Root cause analysis', 'Evidence-linked rule mapping', 'Deterministic causes cite telemetry fields; confidence is categorical, not probabilistic.'],
    ['05', 'Decision engine', 'Allowlisted policy catalog', 'Recommend-only default; high-risk schema/training actions require human review.'],
    ['06', 'Self-healing execution', 'Approved in-memory simulation', 'Reversible local overlay only; no real service/model or source data is changed.'],
    ['07', 'Validation & feedback', 'Rule re-evaluation + SQLite audit', 'Failed validation rolls back and escalates; all events are logged locally.'],
  ]
  return <><div className="architecture-intro"><div><div className="eyebrow">PAPER-TO-PROTOTYPE MAP <Badge>SIMULATED</Badge></div><h2>Governed control loop</h2><p>Mapped to the seven layers in the research paper, with execution deliberately constrained to a local demonstration.</p></div><div className="paper-tag"><BookOpen size={16} /> Based on the supplied research paper</div></div><div className="flowline">{layers.map((layer, index) => <div className="flow-step" key={layer[0]}><div className={`flow-number step-${index + 1}`}>{layer[0]}</div><div><strong>{layer[1]}</strong><span>{layer[2]}</span></div>{index < layers.length - 1 && <div className="flow-arrow">→</div>}</div>)}</div><div className="architecture-grid"><section className="panel mapping-panel"><div className="panel-head"><div><h3>Layer mapping</h3><span>Paper concept to implemented component</span></div><GitBranch size={18} /></div><div className="mapping-table"><div className="mapping-row mapping-head"><span>PAPER LAYER</span><span>APP COMPONENT</span><span>IMPLEMENTATION NOTE</span></div>{layers.map(layer => <div className="mapping-row" key={layer[0]}><span><i>{layer[0]}</i>{layer[1]}</span><b>{layer[2]}</b><small>{layer[3]}</small></div>)}</div></section><section className="panel walkthrough-panel"><div className="panel-head"><div><h3>College-demo walkthrough</h3><span>Suggested sequence</span></div><BookOpen size={18} /></div><ol><li><b>Normal run</b><span>Open Runs, search `run_00003`, inspect scenario label versus detector output.</span></li><li><b>Data drift</b><span>Open a `data_drift` scenario, inspect drift evidence, approve baseline comparison.</span></li><li><b>Missing data</b><span>Open a `missing_data` scenario, simulate batch quarantine and inspect validation.</span></li><li><b>Schema error</b><span>Show mandatory human approval and high-risk escalation; do not bypass the gate.</span></li><li><b>High latency</b><span>Inspect measured latency, adjust the visible threshold, compare alert behavior.</span></li><li><b>Training failure</b><span>Show the high-risk previous-version recommendation and audit history.</span></li><li><b>Evaluate & reset</b><span>Review prototype metrics, export audit JSON, then reset simulated state.</span></li></ol></section></div><section className="panel limitations-panel research-limitations"><h3><AlertTriangle size={17} /> Research limitations</h3><ul><li>Operational telemetry and scenario labels in the CSV are synthetic.</li><li>No real production monitoring, infrastructure integrations, or actual recovery is present.</li><li>This is a small local prototype, not a production-ready autonomous control plane.</li><li>There is no independent causal ground truth beyond the synthetic scenario generation.</li><li>Thresholds may overfit scenario labels; values overlap across normal and fault categories.</li><li>Crime-domain context and aggregate counts are derived context only. No individual or community risk is inferred.</li><li>The CSV is telemetry/scenario data, not raw model training data; no crime prediction model is trained.</li><li>MTTD and MTTR cannot be calculated because event-arrival and recovery-duration timestamps are absent.</li></ul><p>These limits are consistent with the paper's framing as a conceptual architecture requiring future empirical validation.</p></section><section className="panel paper-workflow"><h3>Paper workflow, implemented as a safe local loop</h3><pre>{'Telemetry -> Context -> Detect -> Evidence-based RCA\n    -> Risk/policy gate -> Human-approved simulation\n    -> Post-action validation -> Rollback + escalation (on failure)'}</pre></section></>
}

function Empty({ text }: { text: string }) { return <div className="empty-state"><Database size={20} /><span>{text}</span></div> }

export default App