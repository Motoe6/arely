import { memo } from "react"
import { Handle, Position, type NodeProps } from "reactflow"
import type { FlowNodeData } from "./types.js"

const CATEGORY_COLORS: Record<string, string> = {
  trigger: "#d29922",
  action: "#58a6ff",
  logic: "#3fb950",
  ai: "#bc8cff",
  code: "#f0883e",
}

export const WorkflowNode = memo(({ data }: NodeProps<FlowNodeData>) => {
  const color = data.category
    ? CATEGORY_COLORS[data.category]
    : CATEGORY_COLORS.action
  const statusColor =
    data.status === "completed"
      ? "#3fb950"
      : data.status === "failed"
        ? "#f85149"
        : color

  const isTrigger = data.step.id === "__trigger__"
  const inputFields = data.step.input
    ? Object.entries(data.step.input).slice(0, 3)
    : []

  return (
    <div
      className="custom-node"
      style={{
        borderColor: statusColor,
        background: "linear-gradient(135deg, #1c2333 0%, #161b22 100%)",
      }}
    >
      <div className="custom-node-header" style={{ borderBottomColor: statusColor }}>
        <div className="custom-node-dot" style={{ background: statusColor }} />
        <span className="custom-node-type">{isTrigger ? "⚡" : "▶"} {data.label}</span>
      </div>
      <div className="custom-node-body">
        <div className="custom-node-id">{data.step.id}</div>
        {inputFields.length > 0 && (
          <div className="custom-node-inputs">
            {inputFields.map(([key, val]) => (
              <div key={key} className="custom-node-input">
                <span className="input-key">{key}:</span>
                <span className="input-val">
                  {typeof val === "string"
                    ? val.length > 20
                      ? val.slice(0, 20) + "…"
                      : val
                    : JSON.stringify(val).slice(0, 20)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Top}
        style={{ background: statusColor, width: 10, height: 10, border: "2px solid #0d1117" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: statusColor, width: 10, height: 10, border: "2px solid #0d1117" }}
      />
    </div>
  )
})

WorkflowNode.displayName = "WorkflowNode"
