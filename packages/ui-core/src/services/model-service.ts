import type { ModelDefinition } from "../types/index.js";
import { appStore } from "../stores/app-store.js";

// Stub — real implementation lives in packages/cli/src/services/model-service.ts
export async function listModels(): Promise<ModelDefinition[]> {
  return [];
}

export function changeModel(modelId: string): void {
  appStore.setState({ model: modelId });
}

export function changeProvider(provider: string): void {
  appStore.setState({ provider });
}
