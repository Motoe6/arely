import { useState, useCallback, useEffect, useRef } from "react"
import { ReactFlowProvider } from "reactflow"
import "reactflow/dist/style.css"
import { FlowEditor } from "./FlowEditor.js"
import { NodePalette } from "./NodePalette.js"
import { ConfigPanel } from "./ConfigPanel.js"
import { DslPreview } from "./DslPreview.js"
import { executeWorkflow, compilePrompt, listNodes, listWorkflows, getWorkflow, listRuns } from "./api.js"
import type {
  FlowNode,
  WorkflowSummary,
  Workflow,
  IntentStep,
  CompileResult,
  ExecuteResult,
  RunWithSteps,
} from "./types.js"

export function App() {
  const [nodes, setNodes] = useState<FlowNode[]>([])
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [currentWf, setCurrentWf] = useState<Workflow | null>(null)
  const [selectedStep, setSelectedStep] = useState<IntentStep | null>(null)
  const [prompt, setPrompt] = useState("")
  const [status, setStatus] = useState<"idle" | "compiling" | "compiled" | "executing" | "error">("idle")
  const [statusMsg, setStatusMsg] = useState("Idle")
  const [execResult, setExecResult] = useState<ExecuteResult | null>(null)
  const [compileDiag, setCompileDiag] = useState<{ kind: "warning" | "error"; message: string }[]>([])
  const [chat, setChat] = useState<{ role: "user" | "system"; html: string }[]>([{
    role: "system",
    html: "Describe the workflow you want to build. For example:<br><em>\"fetch user data from an API and send the results by email\"</em>",
  }])
  const [activeNodeTab, setActiveNodeTab] = useState<"palette" | "workflows" | "chat" | "history">("chat")
  const [runs, setRuns] = useState<RunWithSteps[]>([])
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listNodes().then(setNodes).catch(() => {})
    listWorkflows().then(setWorkflows).catch(() => {})
    listRuns().then(setRuns).catch(() => {})
  }, [])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [chat])

  const addChat = useCallback((role: "user" | "system", html: string) => {
    setChat((prev) => [...prev, { role, html }])
  }, [])

  const handleCompile = useCallback(async () => {
    if (!prompt.trim()) return
    addChat("user", prompt)
    setStatus("compiling")
    setStatusMsg("Compiling...")
    setExecResult(null)
    setSelectedStep(null)

    const result: CompileResult = await compilePrompt(prompt)
    setPrompt("")

    if (result.success && result.workflow) {
      setCurrentWf(result.workflow)
      setCompileDiag(result.diagnostics ?? [])
      setStatus("compiled")
      setStatusMsg(`Compiled — ${result.workflow.steps.length} steps`)
      addChat(
        "system",
        `<strong>Workflow compiled</strong> &middot; ${result.workflow.steps.length} step${result.workflow.steps.length !== 1 ? "s" : ""} &middot; id: ${result.workflow.id}`,
      )
      listWorkflows().then(setWorkflows).catch(() => {})
      listRuns().then(setRuns).catch(() => {})
    } else {
      const errors = (result.diagnostics ?? []).filter((d) => d.kind === "error")
      setStatus("error")
      setStatusMsg("Compilation failed")
      addChat(
        "system",
        `<strong>Compilation failed</strong><br>${errors.map((e) => e.message).join("<br>")}`,
      )
    }
  }, [prompt, addChat])

  const handleExecute = useCallback(async () => {
    if (!currentWf) return
    setStatus("executing")
    setStatusMsg("Executing...")
    setExecResult(null)

    const result = await executeWorkflow(currentWf.id)
    setExecResult(result)

    listRuns(currentWf.id).then(setRuns).catch(() => {})
    if (result.success) {
      setStatus("compiled")
      setStatusMsg("Execution completed")
      addChat(
        "system",
        `<strong>Workflow completed</strong> &middot; ${result.steps.length} steps, all passed`,
      )
    } else {
      setStatus("compiled")
      setStatusMsg("Execution failed")
      addChat(
        "system",
        `<strong>Workflow failed</strong>${result.error ? ": " + result.error : ""}`,
      )
    }
  }, [currentWf, addChat])

  const handleSelectStep = useCallback((step: IntentStep | null) => {
    setSelectedStep(step)
  }, [])

  const handleUpdateStep = useCallback(
    (stepId: string, updates: Partial<IntentStep>) => {
      if (!currentWf) return
      const newSteps = currentWf.steps.map((s) =>
        s.id === stepId ? { ...s, ...updates } : s,
      )
      const newWf = { ...currentWf, steps: newSteps }
      setCurrentWf(newWf)
      if (selectedStep && selectedStep.id === stepId) {
        setSelectedStep(newSteps.find((s) => s.id === stepId) ?? null)
      }
    },
    [currentWf, selectedStep],
  )

  const handleLoadWorkflow = useCallback((wf: Workflow | null) => {
    setCurrentWf(wf)
    setSelectedStep(null)
    setExecResult(null)
    setStatus(wf ? "compiled" : "idle")
    setStatusMsg(wf ? `Loaded — ${wf.steps.length} steps` : "Idle")
  }, [])

  const loadWfId = useCallback(
    async (id: string) => {
      const wf = await getWorkflow(id)
      if (wf) handleLoadWorkflow(wf)
    },
    [handleLoadWorkflow],
  )

  return (
    <ReactFlowProvider>
      <div className="app">
        <header>
          <h1>Flow Editor</h1>
          <span className={`status-badge status-${status}`}>{statusMsg}</span>
          <nav>
            <a href="/dashboard">Dashboard</a>
          </nav>
        </header>

        <div className="main-layout">
          <aside className="left-panel">
            <div className="tabs">
              <button
                className={activeNodeTab === "chat" ? "active" : ""}
                onClick={() => setActiveNodeTab("chat")}
              >
                Chat
              </button>
              <button
                className={activeNodeTab === "palette" ? "active" : ""}
                onClick={() => setActiveNodeTab("palette")}
              >
                Nodes
              </button>
              <button
                className={activeNodeTab === "workflows" ? "active" : ""}
                onClick={() => setActiveNodeTab("workflows")}
              >
                Workflows
              </button>
              <button
                className={activeNodeTab === "history" ? "active" : ""}
                onClick={() => setActiveNodeTab("history")}
              >
                History
              </button>
            </div>

            <div className="tab-content">
              {activeNodeTab === "chat" && (
                <div className="chat-panel">
                  <div ref={chatRef} className="chat-messages">
                    {chat.map((m, i) => (
                      <div key={i} className={`msg msg-${m.role}`}>
                        <div className="msg-label">{m.role === "user" ? "You" : "Builder"}</div>
                        <div dangerouslySetInnerHTML={{ __html: m.html }} />
                      </div>
                    ))}
                  </div>
                  <div className="chat-input">
                    <textarea
                      rows={2}
                      placeholder="Describe your workflow..."
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          handleCompile()
                        }
                      }}
                    />
                    <button onClick={handleCompile} disabled={status === "compiling" || !prompt.trim()}>
                      Send
                    </button>
                  </div>
                </div>
              )}

              {activeNodeTab === "palette" && (
                <NodePalette nodes={nodes} />
              )}

              {activeNodeTab === "workflows" && (
                <div className="workflow-list">
                  {workflows.length === 0 && (
                    <div className="empty-state">No workflows yet</div>
                  )}
                  {workflows.map((wf) => (
                    <div
                      key={wf.id}
                      className={`wf-item ${currentWf?.id === wf.id ? "active" : ""}`}
                      onClick={() => loadWfId(wf.id)}
                    >
                      <div className="wf-name">{wf.description || wf.id.slice(0, 8)}</div>
                      <div className="wf-meta">{wf.stepCount} steps</div>
                    </div>
                  ))}
                </div>
              )}

              {activeNodeTab === "history" && (
                <div className="history-panel">
                  {runs.length === 0 && (
                    <div className="empty-state">No runs yet. Execute a workflow to see history.</div>
                  )}
                  {runs
                    .filter((r) => !currentWf || r.run.workflowId === currentWf.id)
                    .map(({ run, steps }) => (
                      <details key={run.id} className="run-entry">
                        <summary className={`run-summary run-${run.status}`}>
                          <span className="run-status-dot" />
                          <span className="run-id">#{run.id.slice(0, 12)}</span>
                          <span className="run-status-label">{run.status}</span>
                          {run.durationMs != null && (
                            <span className="run-duration">{(run.durationMs / 1000).toFixed(1)}s</span>
                          )}
                        </summary>
                        <div className="run-steps">
                          {run.error && <div className="run-error">{run.error}</div>}
                          {steps.map((s) => (
                            <div key={s.id} className={`run-step run-step-${s.status}`}>
                              <div className="run-step-header">
                                <span className="run-step-name">{s.stepId}</span>
                                <span className="run-step-type">{s.stepType}</span>
                                <span className="run-step-status">{s.status}</span>
                                {s.durationMs != null && (
                                  <span className="run-step-duration">{(s.durationMs / 1000).toFixed(2)}s</span>
                                )}
                              </div>
                              {s.error && <div className="run-step-error">{s.error}</div>}
                              {s.output && (
                                <div className="run-step-output">{s.output.slice(0, 200)}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                </div>
              )}
            </div>
          </aside>

          <main className="canvas-area">
            {currentWf ? (
              <FlowEditor
                workflow={currentWf}
                execResult={execResult}
                onSelectStep={handleSelectStep}
                selectedStepId={selectedStep?.id ?? null}
                onUpdateStep={handleUpdateStep}
                onExecute={handleExecute}
                compileDiag={compileDiag}
                status={status}
              />
            ) : (
              <div className="empty-state canvas-empty">
                <div className="icon">⚡</div>
                <div>Type a prompt in Chat or select a workflow to begin</div>
              </div>
            )}
          </main>

          <aside className="right-panel">
            <ConfigPanel
              step={selectedStep}
              onUpdate={handleUpdateStep}
            />
          </aside>
        </div>

        <footer className="bottom-panel">
          <DslPreview
            workflow={currentWf}
            execResult={execResult}
            compileDiag={compileDiag}
            runs={runs.filter((r) => !currentWf || r.run.workflowId === currentWf.id)}
          />
        </footer>
      </div>
    </ReactFlowProvider>
  )
}
