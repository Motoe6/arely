import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  StreamFunction,
  StreamOptions,
} from "./types.js";

export type ApiStreamFunction = (
  model: Model,
  context: Context,
  options?: StreamOptions,
) => AssistantMessageEventStream;

export interface ApiProvider<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> {
  api: TApi;
  stream: StreamFunction<TApi, TOptions>;
}

interface ApiProviderInternal {
  api: Api;
  stream: ApiStreamFunction;
}

const registry = new Map<string, { provider: ApiProviderInternal; sourceId?: string }>();

function wrapStream<TApi extends Api, TOptions extends StreamOptions>(
  api: TApi,
  stream: StreamFunction<TApi, TOptions>,
): ApiStreamFunction {
  return (model, context, options) => {
    if (model.api !== api) {
      throw new Error(`Mismatched api: ${model.api} expected ${api}`);
    }
    return stream(model as Model<TApi>, context, options as TOptions);
  };
}

export function registerApiProvider<TApi extends Api, TOptions extends StreamOptions>(
  provider: ApiProvider<TApi, TOptions>,
  sourceId?: string,
): void {
  registry.set(provider.api, {
    provider: {
      api: provider.api,
      stream: wrapStream(provider.api, provider.stream),
    },
    sourceId,
  });
}

export function getApiProvider(api: Api): ApiProviderInternal | undefined {
  return registry.get(api)?.provider;
}

export function getApiProviders(): ApiProviderInternal[] {
  return Array.from(registry.values(), (e) => e.provider);
}

export function unregisterApiProviders(sourceId: string): void {
  for (const [api, entry] of registry.entries()) {
    if (entry.sourceId === sourceId) registry.delete(api);
  }
}

export function clearApiProviders(): void {
  registry.clear();
}
