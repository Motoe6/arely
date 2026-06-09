import { globalNodeRegistry } from "../registry/NodeRegistry.js"

export function resolveNode(type: string) {
  return globalNodeRegistry.get(type)
}
