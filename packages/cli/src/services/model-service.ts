import type { ModelDefinition } from "@arelyos/ui-core/types/index.js";
import { appStore } from "@arelyos/ui-core/stores/app-store.js";

export async function listModels(): Promise<ModelDefinition[]> {
  try {
    const { modelPerformanceService } = await import("@arelyos/engine/llm/model-performance-service.js");
    const snapshots = (modelPerformanceService as unknown as { getSnapshots: () => { provider: string; model: string }[] }).getSnapshots();
    const seen = new Set<string>();
    const models: ModelDefinition[] = [];
    for (const s of snapshots) {
      const key = `${s.provider}/${s.model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      models.push({
        id: s.model,
        provider: s.provider,
        label: s.model,
        enabled: true,
        isDefault: s.model === appStore.getState().model,
      });
    }
    return models;
  } catch {
    return [];
  }
}

export function changeModel(modelId: string): void {
  appStore.setState({ model: modelId });
}

export function changeProvider(provider: string): void {
  appStore.setState({ provider });
}
