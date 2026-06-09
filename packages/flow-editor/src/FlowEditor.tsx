import React, { useMemo, useCallback } from "react"
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
} from "reactflow"
import "reactflow/dist/style.css"
import { WorkflowNode } from "./WorkflowNode.js"
import type { Workflow, IntentStep, ExecuteResult, CompileDiagnostic } from "./types.js"

interface FlowEditorProps {
  workflow: Workflow
  execResult: ExecuteResult | null
  selectedStepId: string | null
  compileDiag: CompileDiagnostic[]
  status: string
  onSelectStep: (step: IntentStep | null) => void
  onUpdateStep: (stepId: string, updates: Partial<IntentStep>) => void
  onExecute: () => void
}

const nodeTypes: NodeTypes = { workflow: WorkflowNode }

function getStepStatus(
  stepId: string,
  execResult: ExecuteResult | null,
): "idle" | "completed" | "failed" {
  if (!execResult) return "idle"
  const step = execResult.steps.find((s) => s.stepId === stepId)
  if (!step) return "idle"
  return step.status === "completed" ? "completed" : "failed"
}

export function FlowEditor({
  workflow,
  execResult,
  selectedStepId: _selectedStepId,
  compileDiag,
  status,
  onSelectStep,
  onUpdateStep,
  onExecute,
}: FlowEditorProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const ns: Node[] = []
    const es: Edge[] = []

    if (workflow.trigger) {
      ns.push({
        id: "__trigger__",
        type: "workflow",
        position: { x: 280, y: 0 },
        data: {
          step: { id: "__trigger__", type: `trigger:${workflow.trigger.type}` },
          label: `Trigger: ${workflow.trigger.type}`,
          category: "trigger",
        },
      })
    }

    const yOffset = workflow.trigger ? 140 : 0

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i]
      const st = getStepStatus(step.id, execResult)
      ns.push({
        id: step.id,
        type: "workflow",
        position: { x: 280, y: yOffset + i * 140 },
        data: { step, label: step.type, category: "", status: st },
      })
    }

    const stepMap = new Map(workflow.steps.map((s) => [s.id, s]))
    for (const step of workflow.steps) {
      if (step.next) {
        const targets = Array.isArray(step.next) ? step.next : [step.next]
        for (const t of targets) {
          if (stepMap.has(t) || t === "__trigger__") {
            es.push({
              id: `${step.id}->${t}`,
              source: step.id,
              target: t,
              markerEnd: { type: MarkerType.ArrowClosed, color: "#58a6ff" },
              style: { stroke: "#58a6ff", strokeWidth: 2 },
            })
          }
        }
      }
    }

    if (workflow.trigger && workflow.steps.length > 0) {
      const firstStep = workflow.steps[0]
      if (firstStep && !firstStep.next?.includes("__trigger__")) {
        const hasExistingEdge = es.some(
          (e) => e.source === "__trigger__" && e.target === firstStep.id,
        )
        if (!hasExistingEdge) {
          es.push({
            id: `__trigger__->${firstStep.id}`,
            source: "__trigger__",
            target: firstStep.id,
            markerEnd: { type: MarkerType.ArrowClosed, color: "#58a6ff" },
            style: { stroke: "#58a6ff", strokeWidth: 2 },
          })
        }
      }
    }

    return { nodes: ns, edges: es }
  }, [workflow, execResult])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  React.useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id === "__trigger__") return
      const step = workflow.steps.find((s) => s.id === node.id)
      if (step) onSelectStep(step)
    },
    [workflow.steps, onSelectStep],
  )

  const onPaneClick = useCallback(() => {
    onSelectStep(null)
  }, [onSelectStep])

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return
      const sourceStep = workflow.steps.find((s) => s.id === conn.source)
      if (!sourceStep) return

      const existing = sourceStep.next
        ? Array.isArray(sourceStep.next)
          ? sourceStep.next
          : [sourceStep.next]
        : []
      if (existing.includes(conn.target)) return

      onUpdateStep(conn.source, {
        next: [...existing, conn.target],
      })
    },
    [workflow.steps, onUpdateStep],
  )

  return (
    <div className="flow-canvas-wrapper">
      <div className="flow-toolbar">
        <span className="flow-title">{workflow.description || workflow.id.slice(0, 8)}</span>
        {compileDiag
          .filter((d) => d.kind === "warning")
          .map((d, i) => (
            <span key={i} className="diag-warn">
              ⚠ {d.message}
            </span>
          ))}
        <button className="btn-execute" onClick={onExecute} disabled={status === "executing"}>
          {status === "executing" ? "Executing..." : "▶ Execute"}
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#30363d" gap={20} />
        <Controls />
        <MiniMap
          style={{ background: "#161b22" }}
          nodeColor={() => "#58a6ff"}
          maskColor="rgba(13, 17, 23, 0.8)"
        />
      </ReactFlow>
    </div>
  )
}
