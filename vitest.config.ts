import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@opencode/engine": fileURLToPath(new URL("./packages/engine/src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "packages/engine/src/config/**/*.ts",
        "packages/engine/src/persistence/**/*.ts",
        "packages/engine/src/server/sse.ts",
        "packages/engine/src/server/agent-loop.ts",
        "packages/engine/src/server/session-manager.ts",
        "packages/engine/src/transport/router.ts",
        "packages/engine/src/transport/http-server.ts",
        "packages/engine/src/tools/*.ts",
        "packages/engine/src/permissions/*.ts",
        "packages/engine/src/llm/adapter.ts",
        "packages/engine/src/llm/openaicompat.ts",
        "packages/engine/src/llm/conversation.ts",
      ],
      exclude: [
        "tests/**",
        "packages/engine/src/types/**",
        "packages/engine/src/ui/**",
        "packages/engine/src/index.ts",
        "packages/engine/src/tools/base-tool.ts",
        "packages/engine/src/persistence/schema.ts",
        "packages/engine/src/persistence/database.ts",
        "packages/engine/src/persistence/migrate.ts",
        "packages/engine/src/transport/http-server.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
