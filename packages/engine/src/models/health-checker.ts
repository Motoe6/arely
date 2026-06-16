import { getConfig } from "../config/index.js";
import { loadUserConfigFile } from "../config/io.js";
import type { KnownProvider } from "../config/types.js";
import { PROVIDER_DEFAULTS } from "./model-registry.js";

export type ProviderStatus = "online" | "offline" | "rate_limited" | "unauthorized";

export interface ProviderHealth {
  provider: string;
  label: string;
  status: ProviderStatus;
  latencyMs?: number;
  modelCount?: number;
  models?: string[];
  defaultModel?: string;
  error?: string;
}

export interface HealthCheckOptions {
  timeoutMs?: number;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  lmstudio: "LM Studio",
};

const TIMEOUT_MS = 5_000;

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

interface ProbeResult {
  status: ProviderStatus;
  latencyMs?: number;
  modelCount?: number;
  models?: string[];
  error?: string;
}

async function probeOpenAI(apiKey: string, baseUrl: string, signal: AbortSignal): Promise<ProbeResult> {
  const start = Date.now();
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  const latencyMs = Date.now() - start;
  if (res.status === 401 || res.status === 403) return { status: "unauthorized", latencyMs, error: `${res.status} ${res.statusText}` };
  if (res.status === 429) return { status: "rate_limited", latencyMs, error: "Rate limited" };
  if (!res.ok) return { status: "offline", latencyMs, error: `HTTP ${res.status}` };
  const body = await res.json() as { data?: Array<{ id: string }> };
  const models = (body.data ?? []).map((m: { id: string }) => m.id);
  return { status: "online", latencyMs, modelCount: models.length, models };
}

async function probeAnthropic(apiKey: string, baseUrl: string, signal: AbortSignal): Promise<ProbeResult> {
  const start = Date.now();
  const url = `${baseUrl.replace(/\/+$/, "")}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "claude-sonnet-4", max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    signal,
  });
  const latencyMs = Date.now() - start;
  if (res.status === 401 || res.status === 403) return { status: "unauthorized", latencyMs, error: `${res.status} ${res.statusText}` };
  if (res.status === 429) return { status: "rate_limited", latencyMs, error: "Rate limited" };
  if (!res.ok) return { status: "offline", latencyMs, error: `HTTP ${res.status}` };
  return { status: "online", latencyMs, modelCount: 1 };
}

async function probeOpenRouter(apiKey: string, baseUrl: string, signal: AbortSignal): Promise<ProbeResult> {
  const start = Date.now();
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/auth/key`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  const latencyMs = Date.now() - start;
  if (res.status === 401 || res.status === 403) return { status: "unauthorized", latencyMs, error: `${res.status} ${res.statusText}` };
  if (res.status === 429) return { status: "rate_limited", latencyMs, error: "Rate limited" };
  if (!res.ok) return { status: "offline", latencyMs, error: `HTTP ${res.status}` };
  const body = await res.json() as { data?: { limit?: number; usage?: number } };
  return { status: "online", latencyMs, modelCount: body.data?.limit };
}

async function probeOllama(baseUrl: string, signal: AbortSignal): Promise<ProbeResult> {
  const start = Date.now();
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/tags`, { signal });
  const latencyMs = Date.now() - start;
  if (res.status === 429) return { status: "rate_limited", latencyMs, error: "Rate limited" };
  if (!res.ok) return { status: "offline", latencyMs, error: `HTTP ${res.status}` };
  const body = await res.json() as { models?: Array<{ name: string }> };
  const models = (body.models ?? []).map((m: { name: string }) => m.name);
  return { status: "online", latencyMs, modelCount: models.length, models };
}

async function probeLMStudio(baseUrl: string, signal: AbortSignal): Promise<ProbeResult> {
  const start = Date.now();
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, { signal });
  const latencyMs = Date.now() - start;
  if (res.status === 429) return { status: "rate_limited", latencyMs, error: "Rate limited" };
  if (!res.ok) return { status: "offline", latencyMs, error: `HTTP ${res.status}` };
  const body = await res.json() as { data?: Array<{ id: string }> };
  const models = (body.data ?? []).map((m: { id: string }) => m.id);
  return { status: "online", latencyMs, modelCount: models.length, models };
}

export async function checkProviderHealth(
  provider: KnownProvider,
  apiKey?: string,
  baseUrl?: string,
  opts?: HealthCheckOptions,
): Promise<ProviderHealth> {
  const timeoutMs = opts?.timeoutMs ?? TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new DOMException("Timeout", "TimeoutError")), timeoutMs);

  try {
    const defaults = PROVIDER_DEFAULTS[provider];
    const bUrl = baseUrl || defaults?.baseUrl || "";
    const key = apiKey || process.env[`${provider.toUpperCase()}_API_KEY`] || "";

    let result: ProbeResult;

    if (provider === "openai") {
      if (!key) return { provider, label: providerLabel(provider), status: "unauthorized", error: "Missing API key" };
      result = await probeOpenAI(key, bUrl, ac.signal);
    } else if (provider === "anthropic") {
      if (!key) return { provider, label: providerLabel(provider), status: "unauthorized", error: "Missing API key" };
      result = await probeAnthropic(key, bUrl, ac.signal);
    } else if (provider === "openrouter") {
      if (!key) return { provider, label: providerLabel(provider), status: "unauthorized", error: "Missing API key" };
      result = await probeOpenRouter(key, bUrl, ac.signal);
    } else if (provider === "ollama") {
      result = await probeOllama(bUrl, ac.signal);
    } else if (provider === "lmstudio") {
      result = await probeLMStudio(bUrl, ac.signal);
    } else {
      return { provider, label: providerLabel(provider), status: "offline", error: `Unknown provider: ${provider}` };
    }

    return {
      provider,
      label: providerLabel(provider),
      defaultModel: defaults?.defaultModel,
      ...result,
    };
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    return {
      provider,
      label: providerLabel(provider),
      status: "offline",
      error: isTimeout ? "Connection timed out" : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAllProviders(
  onlyEnabled?: string[],
  opts?: HealthCheckOptions,
): Promise<ProviderHealth[]> {
  const cfg = getConfig();
  const userConfig = loadUserConfigFile();

  const providers = onlyEnabled?.length
    ? onlyEnabled
    : Object.entries(userConfig.providers ?? {})
        .filter(([_, p]) => p?.enabled)
        .map(([k]) => k);

  if (providers.length === 0 && userConfig.defaultProvider) {
    providers.push(userConfig.defaultProvider);
  }

  const results: ProviderHealth[] = [];
  for (const provider of providers) {
    const pCfg = userConfig.providers?.[provider as KnownProvider];
    const apiKey = pCfg?.apiKey;
    const baseUrl = pCfg?.baseUrl;
    results.push(await checkProviderHealth(provider as KnownProvider, apiKey, baseUrl, opts));
  }
  return results;
}
