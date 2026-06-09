import { useState, useEffect } from "react"
import type { IntentStep } from "./types.js"

interface ConfigPanelProps {
  step: IntentStep | null
  onUpdate: (stepId: string, updates: Partial<IntentStep>) => void
}

interface InputEntry {
  key: string
  value: string
}

export function ConfigPanel({ step, onUpdate }: ConfigPanelProps) {
  const [inputs, setInputs] = useState<InputEntry[]>([])
  const [nextStr, setNextStr] = useState("")

  useEffect(() => {
    if (!step) {
      setInputs([])
      setNextStr("")
      return
    }
    const entries: InputEntry[] = step.input
      ? Object.entries(step.input).map(([k, v]) => ({
          key: k,
          value: typeof v === "string" ? v : JSON.stringify(v),
        }))
      : [{ key: "", value: "" }]
    setInputs(entries.length === 0 ? [{ key: "", value: "" }] : entries)
    setNextStr(
      step.next
        ? Array.isArray(step.next)
          ? step.next.join(", ")
          : step.next
        : "",
    )
  }, [step])

  if (!step || step.id === "__trigger__") {
    return (
      <div className="config-panel">
        <div className="panel-title">Node Config</div>
        <div className="empty-state">Select a step to configure</div>
      </div>
    )
  }

  const updateInput = (index: number, field: "key" | "value", val: string) => {
    const next = [...inputs]
    next[index] = { ...next[index], [field]: val }
    setInputs(next)
  }

  const addInput = () => setInputs([...inputs, { key: "", value: "" }])

  const removeInput = (index: number) => {
    if (inputs.length <= 1) return
    setInputs(inputs.filter((_, i) => i !== index))
  }

  const applyInputs = () => {
    const obj: Record<string, unknown> = {}
    for (const entry of inputs) {
      if (entry.key.trim()) {
        obj[entry.key.trim()] = entry.value
      }
    }
    onUpdate(step.id, {
      input: Object.keys(obj).length > 0 ? obj : undefined,
    })
  }

  const applyNext = () => {
    const trimmed = nextStr.trim()
    if (!trimmed) {
      onUpdate(step.id, { next: undefined })
      return
    }
    const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean)
    onUpdate(step.id, { next: parts.length === 1 ? parts[0] : parts })
  }

  return (
    <div className="config-panel">
      <div className="panel-title">Node Config</div>
      <div className="config-section">
        <label>ID</label>
        <div className="config-value">{step.id}</div>
      </div>
      <div className="config-section">
        <label>Type</label>
        <div className="config-value">{step.type}</div>
      </div>

      <div className="config-section">
        <label>Next Steps</label>
        <div className="input-hint">Comma-separated step IDs</div>
        <input
          className="config-input"
          value={nextStr}
          onChange={(e) => setNextStr(e.target.value)}
          onBlur={applyNext}
          placeholder="e.g. step-2, step-3"
        />
      </div>

      <div className="config-section">
        <label>Inputs</label>
        {inputs.map((entry, i) => (
          <div key={i} className="input-row">
            <input
              className="config-input input-key"
              value={entry.key}
              onChange={(e) => updateInput(i, "key", e.target.value)}
              placeholder="key"
            />
            <input
              className="config-input input-val"
              value={entry.value}
              onChange={(e) => updateInput(i, "value", e.target.value)}
              placeholder="value"
            />
            <button className="btn-remove" onClick={() => removeInput(i)}>
              ×
            </button>
          </div>
        ))}
        <div className="input-row-actions">
          <button className="btn-small" onClick={addInput}>
            + Add input
          </button>
          <button className="btn-small btn-apply" onClick={applyInputs}>
            Apply
          </button>
        </div>
      </div>

      {step.onFailure && (
        <div className="config-section">
          <label>On Failure</label>
          <div className="config-value">
            {step.onFailure.retry
              ? `Retry ${step.onFailure.retry.maxAttempts}×`
              : step.onFailure.fallback
                ? `Fallback: ${step.onFailure.fallback}`
                : "None"}
          </div>
        </div>
      )}
    </div>
  )
}
