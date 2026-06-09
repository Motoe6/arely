import { useState, useEffect } from "react"
import type { Workflow, ExecuteResult, CompileDiagnostic, RunWithSteps, MetricsSummary } from "./types.js"
import { getMetricsSummary } from "./api.js"

interface DslPreviewProps {
  workflow: Workflow | null
  execResult: ExecuteResult | null
  compileDiag: CompileDiagnostic[]
  runs?: RunWithSteps[]
}

export function DslPreview({ workflow, execResult, compileDiag, runs = [] }: DslPreviewProps) {
  const [activeTab, setActiveTab] = useState<"dsl" | "exec" | "diag" | "history" | "metrics">("dsl")
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)

  useEffect(() => {
    if (activeTab === "metrics" && !metrics && !metricsLoading) {
      setMetricsLoading(true)
      getMetricsSummary().then(setMetrics).catch(() => {}).finally(() => setMetricsLoading(false))
    }
  }, [activeTab, metrics, metricsLoading])

  if (!workflow) {
    return (
      <div className="dsl-preview">
        <div className="empty-state">Compile a workflow to see its DSL here</div>
      </div>
    )
  }

  return (
    <div className="dsl-preview">
      <div className="dsl-tabs">
        <button className={activeTab === "dsl" ? "active" : ""} onClick={() => setActiveTab("dsl")}>
          DSL
        </button>
        <button className={activeTab === "exec" ? "active" : ""} onClick={() => setActiveTab("exec")}>
          Execution
        </button>
        <button className={activeTab === "diag" ? "active" : ""} onClick={() => setActiveTab("diag")}>
          Diagnostics
          {compileDiag.length > 0 && (
            <span className="diag-badge">{compileDiag.length}</span>
          )}
        </button>
        <button className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")}>
          History
          {runs.length > 0 && <span className="diag-badge">{runs.length}</span>}
        </button>
        <button className={activeTab === "metrics" ? "active" : ""} onClick={() => setActiveTab("metrics")}>
          Metrics
        </button>
      </div>

      <div className="dsl-content">
        {activeTab === "dsl" && (
          <pre>{JSON.stringify(workflow, null, 2)}</pre>
        )}

        {activeTab === "exec" && (
          <>
            {!execResult ? (
              <div className="empty-state">Execute the workflow to see results</div>
            ) : (
              <div className="exec-log">
                <div className="exec-summary">
                  Run: <strong>{execResult.runId}</strong> &middot;{" "}
                  {execResult.success ? (
                    <span className="exec-pass">All {execResult.steps.length} steps passed</span>
                  ) : (
                    <span className="exec-fail">Failed{execResult.error ? `: ${execResult.error}` : ""}</span>
                  )}
                </div>
                {execResult.steps.map((step) => (
                  <div key={step.stepId} className={`exec-step exec-step-${step.status}`}>
                    <span className="exec-step-id">{step.stepId}</span>
                    <span className="exec-step-status">{step.status}</span>
                    {step.output && (
                      <span className="exec-step-output">{step.output.slice(0, 100)}</span>
                    )}
                    {step.error && <span className="exec-step-error">{step.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "diag" && (
          <>
            {compileDiag.length === 0 ? (
              <div className="empty-state">No diagnostics</div>
            ) : (
              <div className="diag-list">
                {compileDiag.map((d, i) => (
                  <div key={i} className={`diag-item diag-${d.kind}`}>
                    <span className="diag-kind">{d.kind === "warning" ? "⚠" : "✗"}</span>
                    <span>{d.message}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "history" && (
          <>
            {runs.length === 0 ? (
              <div className="empty-state">No runs yet</div>
            ) : (
              <div className="history-list">
                {runs.map(({ run, steps }) => (
                  <details key={run.id} className="history-entry">
                    <summary className={`history-summary history-${run.status}`}>
                      <span className="history-status-dot" />
                      <span className="history-id">#{run.id.slice(0, 10)}</span>
                      <span className="history-status-label">{run.status}</span>
                      {run.durationMs != null && (
                        <span className="history-duration">{(run.durationMs / 1000).toFixed(1)}s</span>
                      )}
                    </summary>
                    <div className="history-steps">
                      {run.error && <div className="history-error">{run.error}</div>}
                      {steps.length === 0 && <div className="empty-state" style={{ padding: "8px 0" }}>No step details</div>}
                      {steps.map((s) => (
                        <div key={s.id} className={`history-step history-step-${s.status}`}>
                          <div className="history-step-header">
                            <span className="history-step-name">{s.stepId}</span>
                            <span className="history-step-status">{s.status}</span>
                            {s.durationMs != null && (
                              <span className="history-step-duration">{(s.durationMs / 1000).toFixed(2)}s</span>
                            )}
                          </div>
                          {s.error && <div className="history-step-error">{s.error}</div>}
                          {s.output && (
                            <div className="history-step-output" title={s.output}>{s.output.slice(0, 200)}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "metrics" && (
          <div className="metrics-panel">
            {metricsLoading && <div className="empty-state">Loading metrics...</div>}
            {!metricsLoading && !metrics && <div className="empty-state">No data yet</div>}
            {!metricsLoading && metrics && metrics.totalRuns === 0 && (
              <div className="empty-state">No runs yet — execute a workflow to see metrics</div>
            )}
            {!metricsLoading && metrics && metrics.totalRuns > 0 && (
              <>
                <div className="metrics-grid">
                  <div className="metric-card">
                    <div className={`metric-value ${metrics.successRate >= 80 ? "metric-green" : metrics.successRate > 0 ? "metric-orange" : ""}`}>
                      {metrics.successRate}%
                    </div>
                    <div className="metric-label">Success Rate</div>
                    <div className="metric-sub">{metrics.completedRuns} of {metrics.totalRuns} runs</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-value metric-blue">{metrics.totalRuns}</div>
                    <div className="metric-label">Total Runs</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-value metric-blue">{metrics.runsPerDay > 0 ? metrics.runsPerDay + "/day" : "—"}</div>
                    <div className="metric-label">Runs per Day</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-value metric-blue">{(metrics.avgDurationMs / 1000).toFixed(1)}s</div>
                    <div className="metric-label">Avg Duration</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-value metric-green">{metrics.completedRuns}</div>
                    <div className="metric-label">Completed</div>
                  </div>
                  <div className="metric-card">
                    <div className={`metric-value ${metrics.failedRuns > 0 ? "metric-red" : ""}`}>{metrics.failedRuns}</div>
                    <div className="metric-label">Failed</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-value metric-blue">{metrics.totalWorkflows}</div>
                    <div className="metric-label">Workflows</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-value metric-blue">{metrics.runningRuns}</div>
                    <div className="metric-label">Running</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-value metric-blue">{metrics.totalDurationMs ? (metrics.totalDurationMs / 1000).toFixed(0) + "s" : "—"}</div>
                    <div className="metric-label">Total Duration</div>
                  </div>
                </div>

                {metrics.topNodes.length > 0 && (
                  <>
                    <div className="metrics-section-title">Most Used Nodes
                      <button className="metrics-refresh" onClick={() => { setMetrics(null); getMetricsSummary().then(setMetrics).catch(() => {}) }}>Refresh</button>
                    </div>
                    <table className="metrics-table">
                      <thead><tr><th>Node Type</th><th>Executions</th><th>Avg Duration</th><th>Failures</th><th>Failure Rate</th></tr></thead>
                      <tbody>
                        {metrics.topNodes.map((n, i) => {
                          const fr = n.count > 0 ? Math.round(n.failCount / n.count * 100) : 0
                          return (
                            <tr key={i}>
                              <td><strong>{n.stepType}</strong></td>
                              <td>{n.count}</td>
                              <td>{n.avgDurationMs > 0 ? (n.avgDurationMs / 1000).toFixed(2) + "s" : "—"}</td>
                              <td>{n.failCount > 0 ? <span className="metric-red">{n.failCount}</span> : "0"}</td>
                              <td>{fr > 0 ? <span className="metric-red">{fr}%</span> : "0%"}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </>
                )}

                {metrics.slowestNodes.length > 0 && (
                  <>
                    <div className="metrics-section-title">Slowest Nodes</div>
                    <table className="metrics-table">
                      <thead><tr><th>Node Type</th><th>Avg Duration</th><th>Executions</th></tr></thead>
                      <tbody>
                        {metrics.slowestNodes.map((n, i) => (
                          <tr key={i}>
                            <td><strong>{n.stepType}</strong></td>
                            <td>{n.avgDurationMs > 0 ? <span className="metric-orange">{(n.avgDurationMs / 1000).toFixed(2)}s</span> : "—"}</td>
                            <td>{n.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
