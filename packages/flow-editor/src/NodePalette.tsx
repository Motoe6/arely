import type { FlowNode } from "./types.js"

const CATEGORY_ICONS: Record<string, string> = {
  trigger: "⚡",
  action: "▶",
  logic: "◆",
  ai: "☆",
  code: "◈",
}

interface NodePaletteProps {
  nodes: FlowNode[]
}

export function NodePalette({ nodes }: NodePaletteProps) {
  if (nodes.length === 0) {
    return <div className="empty-state">No nodes registered</div>
  }

  const grouped: Record<string, FlowNode[]> = {}
  for (const node of nodes) {
    const cat = node.category || "other"
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(node)
  }

  return (
    <div className="palette">
      {Object.entries(grouped).map(([cat, catNodes]) => (
        <div key={cat} className="palette-group">
          <div className="palette-group-title">
            {CATEGORY_ICONS[cat] || "◈"} {cat}
          </div>
          {catNodes.map((node) => (
            <div
              key={node.type}
              className="palette-node"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "application/reactflow",
                  JSON.stringify(node),
                )
                e.dataTransfer.effectAllowed = "move"
              }}
            >
              <span className="palette-node-label">{node.label}</span>
              <span className="palette-node-type">{node.type}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
