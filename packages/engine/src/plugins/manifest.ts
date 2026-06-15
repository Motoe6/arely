export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  entry: string;
  capabilities?: PluginCapability[];
}

export type PluginCapability =
  | { kind: "provider"; api: string }
  | { kind: "tool"; name: string }
  | { kind: "channel"; name: string }
  | { kind: "hook"; name: string }
  | { kind: "mcp-server"; name: string };
