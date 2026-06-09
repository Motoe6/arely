import type { NodeDefinition } from "../types/node.js"

export class NodeRegistry {
  private nodes = new Map<string, NodeDefinition>()

  register(def: NodeDefinition): void {
    if (this.nodes.has(def.type)) {
      throw new Error(`Node type already registered: ${def.type}`)
    }
    this.nodes.set(def.type, def)
  }

  get(type: string): NodeDefinition {
    const node = this.nodes.get(type)
    if (!node) {
      throw new Error(`Unknown node type: ${type}`)
    }
    return node
  }

  list(): NodeDefinition[] {
    return Array.from(this.nodes.values())
  }

  has(type: string): boolean {
    return this.nodes.has(type)
  }

  unregister(type: string): boolean {
    return this.nodes.delete(type)
  }
}

export const globalNodeRegistry = new NodeRegistry()
